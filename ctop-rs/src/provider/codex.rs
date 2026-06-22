use crate::{
    model::{Provider as SessionProvider, Session, SessionState, TokenUsage},
    parser::{date_minus, normalize_model, read_to_string, short_id, walk_files},
    pricing::{estimate_credits, Pricing},
};
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub fn is_available(home: &Path) -> bool {
    home.join(".codex").join("sessions").exists()
}

pub fn load_sessions(
    home: &Path,
    date: NaiveDate,
    lookback_days: usize,
    pricing: &Pricing,
) -> Vec<Session> {
    candidate_dirs(home, date, lookback_days)
        .into_iter()
        .flat_map(|dir| walk_files(dir, ".jsonl"))
        .filter_map(|file| read_session(&file, date, pricing))
        .collect()
}

fn candidate_dirs(home: &Path, date: NaiveDate, lookback_days: usize) -> Vec<PathBuf> {
    (0..lookback_days)
        .map(|offset| {
            let value = date_minus(date, offset as i64);
            home.join(".codex")
                .join("sessions")
                .join(format!("{:04}", value.year()))
                .join(format!("{:02}", value.month()))
                .join(format!("{:02}", value.day()))
        })
        .collect()
}

fn read_session(file: &Path, date: NaiveDate, pricing: &Pricing) -> Option<Session> {
    let text = read_to_string(file).ok()?;
    let fallback_id = fallback_session_id(file);
    let mut session = Session::new(
        short_id(&fallback_id),
        SessionProvider::Codex,
        "-",
        Local::now(),
        Duration::zero(),
        TokenUsage::default(),
        0.0,
        SessionState::Done,
    );

    let mut prev_usage: Option<TokenUsage> = None;
    let mut found_activity = false;
    let mut first_ts: Option<DateTime<Local>> = None;
    let mut latest_ts: Option<DateTime<Local>> = None;
    let mut session_id = fallback_id.to_string();

    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if let Some(id) = session_id_from_value(&value) {
            session_id = id.to_string();
        }

        if let Some(model) = model_from_value(&value) {
            if model != "-" {
                session.model = model;
            }
        }

        let Some(payload) = value.get("payload") else {
            continue;
        };
        if payload.get("type").and_then(|v| v.as_str()) != Some("token_count") {
            continue;
        }

        let Some(info) = payload
            .get("info")
            .and_then(|info| info.get("total_token_usage"))
        else {
            continue;
        };

        let usage = usage_from_value(info);
        let ts = parse_timestamp_from_value(&value);
        let Some(ts) = ts else {
            continue;
        };

        let Some(delta) = delta_usage(prev_usage.as_ref(), &usage) else {
            prev_usage = Some(usage);
            continue;
        };
        prev_usage = Some(usage);

        if ts.date_naive() != date {
            continue;
        }

        found_activity = true;
        first_ts = Some(first_ts.map_or(ts, |current| current.min(ts)));
        latest_ts = Some(latest_ts.map_or(ts, |current| current.max(ts)));
        session.started_at = ts;
        session.usage.input += delta.input;
        session.usage.output += delta.output;
        session.usage.cache_create += delta.cache_create;
        session.usage.cache_read += delta.cache_read;
        session.usage.reasoning += delta.reasoning;
        session.usage.total += delta.total;
    }

    if !found_activity {
        return None;
    }

    let earliest = first_ts.unwrap_or(session.started_at);
    let latest = latest_ts.unwrap_or(session.started_at);
    session.started_at = latest;
    session.elapsed = latest.signed_duration_since(earliest);
    session.id = short_id(&session_id);
    session.credits = estimate_credits(&session.usage, &session.model, pricing);

    Some(session)
}

fn parse_timestamp_from_value(value: &Value) -> Option<DateTime<Local>> {
    let ts = value
        .get("timestamp")
        .and_then(|value| value.as_str())
        .or_else(|| value.get("time").and_then(|value| value.as_str()))
        .or_else(|| value.get("created_at").and_then(|value| value.as_str()))
        .or_else(|| {
            value
                .get("payload")
                .and_then(|payload| payload.get("timestamp"))
                .and_then(|value| value.as_str())
        });

    ts.and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|ts| ts.with_timezone(&Local))
}

fn model_from_value(value: &Value) -> Option<String> {
    let model = value
        .get("model")
        .and_then(|value| value.as_str())
        .or_else(|| {
            value
                .get("payload")
                .and_then(|payload| payload.get("model"))
                .and_then(|value| value.as_str())
        })
        .or_else(|| {
            value
                .get("payload")
                .and_then(|payload| payload.get("response"))
                .and_then(|response| response.get("model"))
                .and_then(|value| value.as_str())
        })
        .or_else(|| {
            value
                .get("payload")
                .and_then(|payload| payload.get("message"))
                .and_then(|message| message.get("model"))
                .and_then(|value| value.as_str())
        });

    Some(normalize_model(model))
}

fn usage_from_value(value: &Value) -> TokenUsage {
    let input = value.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    let output = value.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
    let cache_create = value
        .get("cache_creation_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let cache_read = value
        .get("cached_input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let reasoning = value
        .get("reasoning_output_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    // Codex footer semantics: input excludes cached input, and total is input + output.
    TokenUsage::new(
        input.saturating_sub(cache_read),
        output,
        cache_create,
        cache_read,
        reasoning,
        input.saturating_sub(cache_read) + output,
    )
}

fn delta_usage(prev: Option<&TokenUsage>, next: &TokenUsage) -> Option<TokenUsage> {
    let Some(prev) = prev else {
        return None;
    };

    let delta = TokenUsage::new(
        next.input.saturating_sub(prev.input),
        next.output.saturating_sub(prev.output),
        next.cache_create.saturating_sub(prev.cache_create),
        next.cache_read.saturating_sub(prev.cache_read),
        next.reasoning.saturating_sub(prev.reasoning),
        next.total.saturating_sub(prev.total),
    );

    (delta.input > 0
        || delta.output > 0
        || delta.cache_create > 0
        || delta.cache_read > 0
        || delta.reasoning > 0
        || delta.total > 0)
        .then_some(delta)
}

fn session_id_from_value(value: &Value) -> Option<&str> {
    value
        .get("session_id")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("sessionId").and_then(|v| v.as_str()))
        .or_else(|| value.get("id").and_then(|v| v.as_str()))
        .or_else(|| {
            value
                .get("payload")
                .and_then(|payload| payload.get("session_id"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            value
                .get("payload")
                .and_then(|payload| payload.get("sessionId"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            value
                .get("payload")
                .and_then(|payload| payload.get("session"))
                .and_then(|session| session.get("id"))
                .and_then(|v| v.as_str())
        })
}

fn fallback_session_id(file: &Path) -> String {
    let fallback = file
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("unknown");

    if let Some(uuidish) = extract_uuidish(fallback) {
        return uuidish;
    }

    fallback.strip_prefix("rollout-").unwrap_or(fallback).to_string()
}

fn extract_uuidish(value: &str) -> Option<String> {
    value
        .as_bytes()
        .windows(36)
        .filter_map(|window| std::str::from_utf8(window).ok())
        .find(|candidate| is_uuidish(candidate))
        .map(ToOwned::to_owned)
}

fn is_uuidish(value: &str) -> bool {
    let chars: Vec<char> = value.chars().collect();
    chars.len() == 36
        && matches!(chars.get(8), Some('-'))
        && matches!(chars.get(13), Some('-'))
        && matches!(chars.get(18), Some('-'))
        && matches!(chars.get(23), Some('-'))
        && chars.iter().enumerate().all(|(index, ch)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *ch == '-'
            } else {
                ch.is_ascii_hexdigit()
            }
        })
}
