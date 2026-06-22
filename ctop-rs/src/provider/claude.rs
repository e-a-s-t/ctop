use crate::{
    model::{Provider as SessionProvider, Session, SessionState, TokenUsage},
    parser::{parse_timestamp, read_to_string, short_id, walk_files},
    pricing::{Pricing, estimate_credits},
};
use chrono::{DateTime, Local, NaiveDate};
use serde_json::Value;
use std::path::Path;

pub fn is_available(home: &Path) -> bool {
    home.join(".claude").join("projects").exists()
}

pub fn load_sessions(home: &Path, date: NaiveDate, pricing: &Pricing) -> Vec<Session> {
    let projects_dir = home.join(".claude").join("projects");
    walk_files(&projects_dir, ".jsonl")
        .into_iter()
        .filter_map(|file| read_session(&file, date, pricing))
        .collect()
}

fn read_session(file: &Path, date: NaiveDate, pricing: &Pricing) -> Option<Session> {
    let text = read_to_string(file).ok()?;
    let session_id = file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");

    let mut model = "-".to_string();
    let mut usage = TokenUsage::default();
    let mut earliest_ts: Option<DateTime<Local>> = None;
    let mut latest_ts: Option<DateTime<Local>> = None;
    let mut found_activity = false;

    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let Ok(obj) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if obj.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }

        let Some(ts_str) = obj.get("timestamp").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(ts) = parse_timestamp(Some(ts_str)) else {
            continue;
        };
        if ts.date_naive() != date {
            continue;
        }

        let Some(msg_usage) = obj.get("message").and_then(|m| m.get("usage")) else {
            continue;
        };

        let input = msg_usage
            .get("input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let output = msg_usage
            .get("output_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let cache_read = msg_usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let cache_create = msg_usage
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        if input == 0 && output == 0 && cache_read == 0 && cache_create == 0 {
            continue;
        }

        if let Some(m) = obj
            .get("message")
            .and_then(|m| m.get("model"))
            .and_then(|v| v.as_str())
        {
            if !m.is_empty() {
                model = m.to_string();
            }
        }

        usage.input += input;
        usage.output += output;
        usage.cache_read += cache_read;
        usage.cache_create += cache_create;
        usage.total += input + output;

        earliest_ts = Some(earliest_ts.map_or(ts, |cur: DateTime<Local>| cur.min(ts)));
        latest_ts = Some(latest_ts.map_or(ts, |cur: DateTime<Local>| cur.max(ts)));
        found_activity = true;
    }

    if !found_activity {
        return None;
    }

    let latest = latest_ts.unwrap_or_else(Local::now);
    let earliest = earliest_ts.unwrap_or(latest);
    let credits = estimate_credits(&usage, &model, pricing);

    Some(Session::new(
        short_id(session_id),
        SessionProvider::Claude,
        model,
        latest,
        latest.signed_duration_since(earliest),
        usage,
        credits,
        SessionState::Done,
    ))
}
