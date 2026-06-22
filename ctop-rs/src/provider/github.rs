use crate::{
    model::{Provider as SessionProvider, Session, SessionState, TokenUsage},
    parser::{local_date, max_timestamp, normalize_model, parse_timestamp, parse_yaml_scalar, read_to_string, short_id, walk_files},
};
use chrono::{DateTime, Local, NaiveDate};
use serde_json::Value;
use std::{
    collections::HashMap,
    path::Path,
};

pub fn is_available(home: &Path) -> bool {
    home.join(".copilot").join("session-state").exists()
        || home.join(".copilot").join("logs").exists()
        || home
            .join("Library")
            .join("Application Support")
            .join("Code")
            .join("User")
            .join("workspaceStorage")
            .exists()
}

pub fn load_sessions(home: &Path, date: NaiveDate) -> Vec<Session> {
    let mut sessions = Vec::new();
    let storage_root = home
        .join("Library")
        .join("Application Support")
        .join("Code")
        .join("User")
        .join("workspaceStorage");

    if storage_root.exists() {
        if let Ok(entries) = std::fs::read_dir(&storage_root) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|ty| ty.is_dir()).unwrap_or(false) {
                    continue;
                }

                let chat_root = entry.path().join("chatSessions");
                for file in walk_files(chat_root, ".jsonl") {
                    if let Some(session) = read_vscode_session(&file, date) {
                        sessions.push(session);
                    }
                }
            }
        }
    }

    let state_root = home.join(".copilot").join("session-state");
    let log_root = home.join(".copilot").join("logs");
    let logs = if state_root.exists() {
        parse_logs(&log_root, date)
    } else {
        HashMap::new()
    };

    if state_root.exists() {
        if let Ok(entries) = std::fs::read_dir(&state_root) {
            for entry in entries.flatten() {
                if !entry.file_type().map(|ty| ty.is_dir()).unwrap_or(false) {
                    continue;
                }

                let session_dir = entry.path();
                let session_id = entry.file_name().to_string_lossy().to_string();
                if let Some(session) = read_cli_session(&session_dir, date, logs.get(&session_id)) {
                    sessions.push(session);
                }
            }
        }
    }

    sessions.sort_by(|a, b| a.started_at.cmp(&b.started_at).then_with(|| a.id.cmp(&b.id)));
    sessions
}

#[derive(Clone, Debug)]
struct LogMeta {
    model: String,
    times: Vec<DateTime<Local>>,
}

fn parse_logs(log_dir: &Path, date: NaiveDate) -> HashMap<String, LogMeta> {
    let mut result = HashMap::new();

    for file in walk_files(log_dir, ".log") {
        let Ok(text) = read_to_string(&file) else {
            continue;
        };

        let unique_ids = extract_session_ids(&text);
        let file_model = extract_model(&text).unwrap_or_else(|| "-".to_string());

        for line in text.lines() {
            let Some(ts_text) = line.split_whitespace().next() else {
                continue;
            };

            if local_date(Some(ts_text)) != Some(date) {
                continue;
            }

            let line_ids = extract_session_ids(line);
            let ids = if !line_ids.is_empty() {
                line_ids
            } else if unique_ids.len() == 1 {
                unique_ids.clone()
            } else {
                Vec::new()
            };

            let Some(ts) = parse_timestamp(Some(ts_text)) else {
                continue;
            };

            for id in ids {
                let entry = result.entry(id).or_insert_with(|| LogMeta {
                    model: file_model.clone(),
                    times: Vec::new(),
                });

                if entry.model == "-" && file_model != "-" {
                    entry.model = file_model.clone();
                }
                entry.times.push(ts);
            }
        }
    }

    result
}

fn read_vscode_session(file: &Path, date: NaiveDate) -> Option<Session> {
    let text = read_to_string(file).ok()?;
    let fallback_id = file
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("unknown");
    let mut session_id = fallback_id.to_string();
    let mut session_model = "-".to_string();
    let mut earliest_ts: Option<DateTime<Local>> = None;
    let mut latest_ts: Option<DateTime<Local>> = None;

    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(obj) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if obj.get("kind").and_then(|v| v.as_i64()) == Some(0) {
            if let Some(data) = obj.get("v").and_then(|v| v.as_object()) {
                if let Some(id) = data.get("sessionId").and_then(|v| v.as_str()) {
                    session_id = id.to_string();
                }

                if let Some(model) = parse_vs_code_selected_model(data.get("inputState")) {
                    session_model = model;
                }

                if let Some(ts) = data
                    .get("creationDate")
                    .and_then(|v| v.as_str())
                    .and_then(|ts| parse_timestamp(Some(ts)))
                {
                    earliest_ts = min_timestamp(earliest_ts, Some(ts));
                    latest_ts = max_timestamp(latest_ts, Some(ts));
                }
            }
        }

        if let Some(keys) = obj.get("k").and_then(|v| v.as_array()) {
            if keys.first().and_then(|v| v.as_str()) != Some("requests") {
                continue;
            }

            if keys.len() == 1 {
                if let Some(Value::Array(requests)) = obj.get("v") {
                    for request in requests {
                        if let Some(model) = request_model(Some(request)) {
                            session_model = model;
                        }
                        if let Some(ts) = request_timestamp(request) {
                            earliest_ts = min_timestamp(earliest_ts, Some(ts));
                            latest_ts = max_timestamp(latest_ts, Some(ts));
                        }
                    }
                }
            } else if keys.len() == 2 {
                if let Some(model) = request_model(obj.get("v")) {
                    session_model = model;
                }
                if let Some(ts) = obj.get("v").and_then(request_timestamp) {
                    earliest_ts = min_timestamp(earliest_ts, Some(ts));
                    latest_ts = max_timestamp(latest_ts, Some(ts));
                }
            } else if keys.len() > 2 && keys.last().and_then(|v| v.as_str()) == Some("modelState")
            {
                if let Some(ts) = obj
                    .get("v")
                    .and_then(|v| v.get("completedAt"))
                    .and_then(|v| v.as_str())
                    .and_then(|ts| parse_timestamp(Some(ts)))
                {
                    latest_ts = max_timestamp(latest_ts, Some(ts));
                }
            }
        }
    }

    let latest = latest_ts?;
    if latest.date_naive() != date {
        return None;
    }

    let session = Session::new(
        format!("{} vscode", short_id(&session_id)),
        SessionProvider::GitHubCopilot,
        session_model,
        latest,
        latest.signed_duration_since(earliest_ts.unwrap_or(latest)),
        TokenUsage::default(),
        0.0,
        SessionState::Done,
    );

    Some(session)
}

fn read_cli_session(session_dir: &Path, date: NaiveDate, log_meta: Option<&LogMeta>) -> Option<Session> {
    let workspace_file = session_dir.join("workspace.yaml");
    if !workspace_file.exists() {
        return None;
    }

    let workspace = read_to_string(&workspace_file).ok()?;
    let fallback_id = session_dir.file_name()?.to_str()?.to_string();
    let mut session_id = parse_yaml_scalar(&workspace, "id").unwrap_or(fallback_id);
    let mut session_model = "-".to_string();
    let mut usage = TokenUsage::default();
    let mut earliest_ts: Option<DateTime<Local>> = None;
    let mut latest_ts: Option<DateTime<Local>> = None;
    let mut active_today = false;

    for ts_text in [
        parse_yaml_scalar(&workspace, "created_at"),
        parse_yaml_scalar(&workspace, "updated_at"),
    ] {
        if let Some(ts) = ts_text.as_deref().and_then(|ts| parse_timestamp(Some(ts))) {
            earliest_ts = min_timestamp(earliest_ts, Some(ts));
            latest_ts = max_timestamp(latest_ts, Some(ts));
            if ts.date_naive() == date {
                active_today = true;
            }
        }
    }

    let events_file = session_dir.join("events.jsonl");
    if events_file.exists() {
        if let Ok(text) = read_to_string(&events_file) {
            for line in text.lines().filter(|line| !line.trim().is_empty()) {
                let Ok(event) = serde_json::from_str::<Value>(line) else {
                    continue;
                };

                if let Some(ts) = event
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .or_else(|| {
                        event
                            .get("data")
                            .and_then(|data| data.get("startTime"))
                            .and_then(|v| v.as_str())
                    })
                    .and_then(|ts| parse_timestamp(Some(ts)))
                {
                    earliest_ts = min_timestamp(earliest_ts, Some(ts));
                    latest_ts = max_timestamp(latest_ts, Some(ts));
                    if ts.date_naive() == date {
                        active_today = true;
                    }
                }

                match event.get("type").and_then(|v| v.as_str()) {
                    Some("session.start") => {
                        if let Some(id) = event
                            .get("data")
                            .and_then(|data| data.get("sessionId"))
                            .and_then(|v| v.as_str())
                        {
                            session_id = id.to_string();
                        }
                    }
                    Some("session.model_change") => {
                        if let Some(model) = event
                            .get("data")
                            .and_then(|data| data.get("newModel"))
                            .and_then(|v| v.as_str())
                        {
                            let model = normalize_model(Some(model));
                            if model != "-" {
                                session_model = model;
                            }
                        }
                    }
                    Some("session.shutdown") => {
                        if let Some(model) = event
                            .get("data")
                            .and_then(|data| data.get("currentModel"))
                            .and_then(|v| v.as_str())
                        {
                            let model = normalize_model(Some(model));
                            if model != "-" {
                                session_model = model;
                            }
                        }

                        if let Some(parsed) = parse_cli_usage(&event) {
                            usage = parsed;
                        }
                    }
                    _ => {}
                }
            }
        }
    } else if let Some(meta) = log_meta {
        if let Some(last) = meta.times.iter().copied().max() {
            latest_ts = Some(last);
            active_today = true;
        }

        let model = normalize_model(Some(&meta.model));
        if model != "-" {
            session_model = model;
        }
    }

    if !active_today {
        return None;
    }

    let latest = latest_ts?;
    Some(Session::new(
        format!("{} cli", short_id(&session_id)),
        SessionProvider::GitHubCopilot,
        session_model,
        latest,
        latest.signed_duration_since(earliest_ts.unwrap_or(latest)),
        usage,
        0.0,
        SessionState::Done,
    ))
}

fn parse_vs_code_selected_model(input_state: Option<&Value>) -> Option<String> {
    let selected = input_state?.get("selectedModel")?;
    let model = selected
        .get("metadata")
        .and_then(|metadata| metadata.get("version"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            selected
                .get("metadata")
                .and_then(|metadata| metadata.get("name"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| selected.get("identifier").and_then(|v| v.as_str()))?;

    let model = normalize_model(Some(model));
    (model != "-").then_some(model)
}

fn request_model(value: Option<&Value>) -> Option<String> {
    let request = value?.as_object()?;
    let model = request
        .get("resolvedModel")
        .and_then(|v| v.as_str())
        .or_else(|| request.get("modelId").and_then(|v| v.as_str()))
        .or_else(|| request.get("model").and_then(|v| v.as_str()))
        .or_else(|| request.get("responseId").and_then(|v| v.as_str()))?;
    let model = normalize_model(Some(model));
    (model != "-").then_some(model)
}

fn request_timestamp(value: &Value) -> Option<DateTime<Local>> {
    value
        .get("modelState")
        .and_then(|state| state.get("completedAt"))
        .and_then(|value| value.as_str())
        .and_then(|ts| parse_timestamp(Some(ts)))
        .or_else(|| {
            value
                .get("responseCreatedAt")
                .and_then(|value| value.as_str())
                .and_then(|ts| parse_timestamp(Some(ts)))
        })
        .or_else(|| {
            value
                .get("requestCreatedAt")
                .and_then(|value| value.as_str())
                .and_then(|ts| parse_timestamp(Some(ts)))
        })
        .or_else(|| {
            value
                .get("timestamp")
                .and_then(|value| value.as_str())
                .and_then(|ts| parse_timestamp(Some(ts)))
        })
}

fn parse_cli_usage(event: &Value) -> Option<TokenUsage> {
    let current_model = event
        .get("data")
        .and_then(|data| data.get("currentModel"))
        .and_then(|v| v.as_str())?;
    let usage = event
        .get("data")
        .and_then(|data| data.get("modelMetrics"))
        .and_then(|metrics| metrics.get(current_model))
        .and_then(|model| model.get("usage"))?;

    let parsed = TokenUsage::new(
        usage.get("inputTokens").and_then(|v| v.as_u64()).unwrap_or(0),
        usage.get("outputTokens").and_then(|v| v.as_u64()).unwrap_or(0),
        usage
            .get("cacheWriteTokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        usage
            .get("cacheReadTokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        usage
            .get("reasoningTokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        usage
            .get("totalTokens")
            .and_then(|v| v.as_u64())
            .unwrap_or_else(|| {
                usage.get("inputTokens").and_then(|v| v.as_u64()).unwrap_or(0)
                    + usage.get("outputTokens").and_then(|v| v.as_u64()).unwrap_or(0)
                    + usage
                        .get("cacheReadTokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0)
                    + usage
                        .get("cacheWriteTokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0)
                    + usage
                        .get("reasoningTokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0)
            }),
    );

    (parsed.total() > 0).then_some(parsed)
}

fn extract_session_ids(text: &str) -> Vec<String> {
    text.split(|ch: char| !(ch.is_ascii_hexdigit() || ch == '-'))
        .filter(|candidate| is_uuidish(candidate))
        .map(ToOwned::to_owned)
        .collect()
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

fn extract_model(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        line.find("Using default model:").map(|index| {
            line[index + "Using default model:".len()..]
                .trim()
                .split_whitespace()
                .next()
                .unwrap_or("-")
                .to_string()
        })
    })
}

fn min_timestamp(
    current: Option<DateTime<Local>>,
    next: Option<DateTime<Local>>,
) -> Option<DateTime<Local>> {
    match (current, next) {
        (None, next) => next,
        (current, None) => current,
        (Some(current), Some(next)) => Some(current.min(next)),
    }
}
