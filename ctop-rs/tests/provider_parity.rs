use chrono::NaiveDate;
use ctop_rs::{
    model::Provider,
    model::TokenUsage,
    ui::text::render_text,
    pricing::{default_pricing, estimate_credits, load_pricing},
    provider,
};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn fixture_home() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test/fixtures/home")
}

fn codex_only_home() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../test/fixtures/codex-only-home")
}

fn codex_line(
    timestamp: &str,
    session_id: &str,
    input_tokens: u64,
    output_tokens: u64,
    cached_input_tokens: u64,
    reasoning_output_tokens: u64,
    total_tokens: u64,
) -> String {
    serde_json::json!({
        "timestamp": timestamp,
        "model": "gpt-5.5",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cached_input_tokens": cached_input_tokens,
                    "cache_creation_input_tokens": 0,
                    "reasoning_output_tokens": reasoning_output_tokens,
                    "total_tokens": total_tokens,
                }
            }
        },
        "session_id": session_id,
    })
    .to_string()
}

fn codex_line_without_session_id(
    timestamp: &str,
    input_tokens: u64,
    output_tokens: u64,
    cached_input_tokens: u64,
    reasoning_output_tokens: u64,
    total_tokens: u64,
) -> String {
    serde_json::json!({
        "timestamp": timestamp,
        "model": "gpt-5.5",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "cached_input_tokens": cached_input_tokens,
                    "cache_creation_input_tokens": 0,
                    "reasoning_output_tokens": reasoning_output_tokens,
                    "total_tokens": total_tokens,
                }
            }
        }
    })
    .to_string()
}

fn write_codex_session(dir: &Path, file_name: &str, lines: &[String]) {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join(file_name), lines.join("\n")).unwrap();
}

fn strip_ansi(text: &str) -> String {
    text.replace("\x1b[33m", "").replace("\x1b[0m", "")
}

#[test]
fn collect_usage_matches_fixture_totals() {
    let date = NaiveDate::from_ymd_opt(2026, 6, 4).unwrap();
    let dashboard = provider::collect_periods(&fixture_home(), date, default_pricing());

    assert_eq!(dashboard.sessions_24h.len(), 3);
    assert_eq!(dashboard.day.usage.total(), 320);
    assert_eq!(dashboard.day.usage.input, 170);
    assert_eq!(dashboard.day.usage.output, 100);
    assert_eq!(dashboard.day.usage.cache_read, 120);
    assert_eq!(dashboard.day.usage.cache_create, 0);
    assert_eq!(dashboard.day.usage.reasoning, 10);
    assert!((dashboard.day.credits - 0.041).abs() < 1e-12);
    assert_eq!(dashboard.week.usage.total(), 320);
    assert_eq!(dashboard.month.usage.total(), 320);

    let codex = dashboard
        .sessions_24h
        .iter()
        .find(|session| session.provider == Provider::Codex)
        .expect("codex session");
    assert_eq!(codex.model, "g5.5");
    assert_eq!(codex.usage.total(), 70);
    assert_eq!(codex.usage.input, 20);
    assert_eq!(codex.usage.output, 50);
    assert_eq!(codex.usage.cache_read, 80);
    assert!((codex.credits - 0.041).abs() < 1e-12);

    let copilot_totals: Vec<_> = dashboard
        .sessions_24h
        .iter()
        .filter(|session| session.provider == Provider::GitHubCopilot)
        .collect();
    assert_eq!(copilot_totals.len(), 2);
    assert!(copilot_totals.iter().any(|session| session.model == "g5-mini" && session.usage.total() == 250));
    assert!(copilot_totals.iter().any(|session| session.model == "g4.1" && session.usage.total() == 0));
}

#[test]
fn pricing_override_merges_and_aliases_work() {
    let pricing_dir = std::env::temp_dir().join("ctop-rs-pricing");
    let pricing_file = pricing_dir.join("pricing.json");

    std::fs::create_dir_all(&pricing_dir).unwrap();
    std::fs::write(
        &pricing_file,
        r#"{
          "models": {
            "gpt-5.5": { "input": 1, "cachedInput": 1, "output": 1 }
          },
          "aliases": {
            "demo": "gpt-5.5"
          }
        }"#,
    )
    .unwrap();

    let custom = load_pricing(Some(&pricing_file)).unwrap();
    let usage = TokenUsage::new(1_000_000, 1_000_000, 1_000_000, 1_000_000, 0, 5_000_000);

    assert_eq!(estimate_credits(&usage, "demo", &custom), 4.0);
}

#[test]
fn codex_only_home_still_collects() {
    let date = NaiveDate::from_ymd_opt(2026, 6, 4).unwrap();
    let sessions = provider::collect_sessions_for_date(&codex_only_home(), date, default_pricing());

    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].provider, Provider::Codex);
    assert_eq!(sessions[0].usage.total(), 26);
}

#[test]
fn codex_footer_semantics_match_session_footers() {
    let base = std::env::temp_dir().join(format!(
        "ctop-codex-footers-{}",
        std::process::id()
    ));
    let session_dir = base.join(".codex/sessions/2026/06/22");
    let date = NaiveDate::from_ymd_opt(2026, 6, 22).unwrap();

    write_codex_session(
        &session_dir,
        "session-1.jsonl",
        &[
            codex_line(
                "2026-06-22T09:00:00.000Z",
                "session-1",
                0,
                0,
                0,
                0,
                0,
            ),
            codex_line(
                "2026-06-22T09:15:00.000Z",
                "session-1",
                15_091_509,
                86_342,
                14_651_008,
                51_379,
                526_843,
            ),
        ],
    );
    write_codex_session(
        &session_dir,
        "session-2.jsonl",
        &[
            codex_line(
                "2026-06-22T11:00:00.000Z",
                "session-2",
                0,
                0,
                0,
                0,
                0,
            ),
            codex_line(
                "2026-06-22T11:30:00.000Z",
                "session-2",
                1_791_740,
                32_475,
                1_641_728,
                21_279,
                182_487,
            ),
        ],
    );

    let sessions = provider::collect_sessions_for_date(&base, date, default_pricing());
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0].usage.total(), 526_843);
    assert_eq!(sessions[0].usage.input, 440_501);
    assert_eq!(sessions[0].usage.output, 86_342);
    assert_eq!(sessions[0].usage.cache_read, 14_651_008);
    assert_eq!(sessions[0].usage.reasoning, 51_379);
    assert_eq!(sessions[1].usage.total(), 182_487);
    assert_eq!(sessions[1].usage.input, 150_012);
    assert_eq!(sessions[1].usage.output, 32_475);
    assert_eq!(sessions[1].usage.cache_read, 1_641_728);
    assert_eq!(sessions[1].usage.reasoning, 21_279);

    let period = provider::collect_usage_for_day(&sessions);
    assert_eq!(period.usage.input, 590_513);
    assert_eq!(period.usage.output, 118_817);
    assert_eq!(period.usage.cache_read, 16_292_736);
    assert_eq!(period.usage.total(), 709_330);
    assert_eq!(period.usage.reasoning, 72_658);
    assert!((period.credits - 366.586075).abs() < 1e-9);
}

#[test]
fn text_render_uses_stable_session_columns() {
    let date = NaiveDate::from_ymd_opt(2026, 6, 4).unwrap();
    let dashboard = provider::collect_periods(&fixture_home(), date, default_pricing());
    let lines: Vec<_> = render_text(&dashboard).lines().collect();
    let header = strip_ansi(lines[5]);
    let row = strip_ansi(lines[7]);

    assert!(header.contains("CACHE-WR"));
    assert!(header.contains("CACHE-RD"));
    assert!(!header.contains("STATE"));
    assert!(row.starts_with("11:15 "));
    assert!(row.contains(" CX "));
    assert!(row.contains("g5.5"));
    assert!(row.contains("    70 "));
    assert!(row.contains("    20 "));
    assert!(row.contains("    80 "));
    assert!(row.contains("    50 "));
    assert!(row.contains("  0.04 "));
    assert!(lines[7].contains("\x1b[33m    70\x1b[0m"));
    assert!(lines[7].contains("\x1b[33m    0.04\x1b[0m"));
}

#[test]
fn codex_fallback_session_id_strips_rollout_prefix() {
    let base = std::env::temp_dir().join(format!(
        "ctop-codex-rollout-{}",
        std::process::id()
    ));
    let session_dir = base.join(".codex/sessions/2026/06/22");
    let date = NaiveDate::from_ymd_opt(2026, 6, 22).unwrap();

    write_codex_session(
        &session_dir,
        "rollout-019e1234-5678-9abc-def0-123456786a0c.jsonl",
        &[
            codex_line_without_session_id(
                "2026-06-22T09:00:00.000Z",
                0,
                0,
                0,
                0,
                0,
            ),
            codex_line_without_session_id(
                "2026-06-22T09:15:00.000Z",
                50,
                20,
                30,
                0,
                70,
            ),
        ],
    );

    let sessions = provider::collect_sessions_for_date(&base, date, default_pricing());
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "019e…6a0c");
}

#[test]
fn codex_fallback_session_id_extracts_uuid_from_filename() {
    let base = std::env::temp_dir().join(format!(
        "ctop-codex-uuid-{}",
        std::process::id()
    ));
    let session_dir = base.join(".codex/sessions/2026/06/22");
    let date = NaiveDate::from_ymd_opt(2026, 6, 22).unwrap();

    write_codex_session(
        &session_dir,
        "2026-06-22-019eef81-d26d-7d00-b3c2-44d92ef503b0.jsonl",
        &[
            codex_line_without_session_id(
                "2026-06-22T09:00:00.000Z",
                0,
                0,
                0,
                0,
                0,
            ),
            codex_line_without_session_id(
                "2026-06-22T09:15:00.000Z",
                50,
                20,
                30,
                0,
                70,
            ),
        ],
    );

    let sessions = provider::collect_sessions_for_date(&base, date, default_pricing());
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "019e…03b0");
}
