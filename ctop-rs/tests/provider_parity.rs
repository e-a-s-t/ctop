use chrono::NaiveDate;
use ctop_rs::{
    model::{Dashboard, PeriodUsage},
    model::Provider,
    model::TokenUsage,
    parser::{io_counts, read_json_lines, reset_io_counts, walk_files, with_collection_cache},
    pricing::{default_pricing, estimate_credits, load_pricing},
    provider,
    ui::text::{display_model, render_text},
};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn claude_event(
    timestamp: &str,
    session_id: &str,
    model: &str,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_input_tokens: u64,
    cache_creation_input_tokens: u64,
) -> String {
    serde_json::json!({
        "type": "assistant",
        "timestamp": timestamp,
        "sessionId": session_id,
        "message": {
            "model": model,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_read_input_tokens": cache_read_input_tokens,
                "cache_creation_input_tokens": cache_creation_input_tokens,
            }
        }
    })
    .to_string()
}

fn write_claude_session(dir: &Path, file_name: &str, lines: &[String]) {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join(file_name), lines.join("\n")).unwrap();
}

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
    assert_eq!(dashboard.day.usage.total(), 580);
    assert_eq!(dashboard.day.usage.input, 300);
    assert_eq!(dashboard.day.usage.output, 120);
    assert_eq!(dashboard.day.usage.cache_read, 150);
    assert_eq!(dashboard.day.usage.cache_create, 0);
    assert_eq!(dashboard.day.usage.reasoning, 10);
    assert!((dashboard.day.credits - 0.058875).abs() < 1e-12);
    assert_eq!(dashboard.week.usage.total(), 580);
    assert_eq!(dashboard.month.usage.total(), 580);

    let codex = dashboard
        .sessions_24h
        .iter()
        .find(|session| session.provider == Provider::Codex)
        .expect("codex session");
    assert_eq!(codex.model, "g5.5");
    assert_eq!(codex.usage.total(), 330);
    assert_eq!(codex.usage.input, 150);
    assert_eq!(codex.usage.output, 70);
    assert_eq!(codex.usage.cache_read, 110);
    assert!((codex.credits - 0.058875).abs() < 1e-12);

    let copilot_totals: Vec<_> = dashboard
        .sessions_24h
        .iter()
        .filter(|session| session.provider == Provider::GitHubCopilot)
        .collect();
    assert_eq!(copilot_totals.len(), 2);
    assert!(
        copilot_totals
            .iter()
            .any(|session| session.model == "g5-mini" && session.usage.total() == 250)
    );
    assert!(
        copilot_totals
            .iter()
            .any(|session| session.model == "g4.1" && session.usage.total() == 0)
    );
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
    assert_eq!(sessions[0].usage.total(), 51);
    assert_eq!(sessions[0].usage.input, 30);
}

#[test]
fn codex_footer_semantics_match_session_footers() {
    let base = std::env::temp_dir().join(format!("ctop-codex-footers-{}", std::process::id()));
    let session_dir = base.join(".codex/sessions/2026/06/22");
    let date = NaiveDate::from_ymd_opt(2026, 6, 22).unwrap();

    write_codex_session(
        &session_dir,
        "session-1.jsonl",
        &[
            codex_line("2026-06-22T09:00:00.000Z", "session-1", 0, 0, 0, 0, 0),
            codex_line(
                "2026-06-22T09:15:00.000Z",
                "session-1",
                15_091_509,
                86_342,
                14_651_008,
                51_379,
                15_177_851,
            ),
        ],
    );
    write_codex_session(
        &session_dir,
        "session-2.jsonl",
        &[
            codex_line("2026-06-22T11:00:00.000Z", "session-2", 0, 0, 0, 0, 0),
            codex_line(
                "2026-06-22T11:30:00.000Z",
                "session-2",
                1_791_740,
                32_475,
                1_641_728,
                21_279,
                1_824_215,
            ),
        ],
    );

    let sessions = provider::collect_sessions_for_date(&base, date, default_pricing());
    assert_eq!(sessions.len(), 2);
    assert_eq!(sessions[0].usage.total(), 15_177_851);
    assert_eq!(sessions[0].usage.input, 15_091_509);
    assert_eq!(sessions[0].usage.output, 86_342);
    assert_eq!(sessions[0].usage.cache_read, 14_651_008);
    assert_eq!(sessions[0].usage.reasoning, 51_379);
    assert_eq!(sessions[1].usage.total(), 1_824_215);
    assert_eq!(sessions[1].usage.input, 1_791_740);
    assert_eq!(sessions[1].usage.output, 32_475);
    assert_eq!(sessions[1].usage.cache_read, 1_641_728);
    assert_eq!(sessions[1].usage.reasoning, 21_279);

    let period = provider::collect_usage_for_day(&sessions);
    assert_eq!(period.usage.input, 16_883_249);
    assert_eq!(period.usage.output, 118_817);
    assert_eq!(period.usage.cache_read, 16_292_736);
    assert_eq!(period.usage.total(), 17_002_066);
    assert_eq!(period.usage.reasoning, 72_658);
    assert!((period.credits - 366.586075).abs() < 1e-9);
}

#[test]
fn codex_stopped_session_counts_nonzero_first_snapshot_and_final_usage() {
    let base = std::env::temp_dir().join(format!("ctop-codex-stopped-{}", std::process::id()));
    let session_dir = base.join(".codex/sessions/2026/10/09");
    let date = NaiveDate::from_ymd_opt(2026, 10, 9).unwrap();

    write_codex_session(
        &session_dir,
        "rollout-01a1213a.jsonl",
        &[
            codex_line(
                "2026-10-09T15:14:05.376Z",
                "stopped-session",
                22_590,
                135,
                11_008,
                0,
                22_725,
            ),
            codex_line(
                "2026-10-09T15:36:33.282Z",
                "stopped-session",
                3_940_037,
                27_126,
                3_715_584,
                16_687,
                3_967_163,
            ),
        ],
    );

    let sessions = provider::collect_sessions_for_date(&base, date, default_pricing());
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].usage.input, 3_940_037);
    assert_eq!(sessions[0].usage.output, 27_126);
    assert_eq!(sessions[0].usage.cache_read, 3_715_584);
    assert_eq!(sessions[0].usage.reasoning, 16_687);
    assert_eq!(sessions[0].usage.total(), 3_967_163);
}

#[test]
fn codex_total_falls_back_to_raw_input_plus_output() {
    let base = std::env::temp_dir().join(format!("ctop-codex-fallback-{}", std::process::id()));
    let session_dir = base.join(".codex/sessions/2026/10/09");
    let mut line = serde_json::json!({
        "timestamp": "2026-10-09T15:14:05.376Z",
        "model": "gpt-5.5",
        "session_id": "fallback-session",
        "payload": {
            "type": "token_count",
            "info": {
                "total_token_usage": {
                    "input_tokens": 1_000,
                    "cached_input_tokens": 800,
                    "output_tokens": 200,
                    "reasoning_output_tokens": 100,
                }
            }
        }
    });
    line["payload"]["info"]["total_token_usage"]
        .as_object_mut()
        .unwrap()
        .remove("total_tokens");
    write_codex_session(&session_dir, "session.jsonl", &[line.to_string()]);

    let sessions = provider::collect_sessions_for_date(
        &base,
        NaiveDate::from_ymd_opt(2026, 10, 9).unwrap(),
        default_pricing(),
    );
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].usage.input, 1_000);
    assert_eq!(sessions[0].usage.cache_read, 800);
    assert_eq!(sessions[0].usage.output, 200);
    assert_eq!(sessions[0].usage.reasoning, 100);
    assert_eq!(sessions[0].usage.total(), 1_200);
}

#[test]
fn codex_daily_delta_uses_previous_day_as_baseline() {
    let base = std::env::temp_dir().join(format!("ctop-codex-day-boundary-{}", std::process::id()));
    let session_dir = base.join(".codex/sessions/2026/10/08");
    write_codex_session(
        &session_dir,
        "session.jsonl",
        &[
            codex_line(
                "2026-10-08T21:59:00.000Z",
                "boundary-session",
                100,
                10,
                20,
                2,
                110,
            ),
            codex_line(
                "2026-10-08T22:01:00.000Z",
                "boundary-session",
                150,
                20,
                40,
                5,
                170,
            ),
        ],
    );

    let sessions = provider::collect_sessions_for_date(
        &base,
        NaiveDate::from_ymd_opt(2026, 10, 9).unwrap(),
        default_pricing(),
    );
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].usage.input, 50);
    assert_eq!(sessions[0].usage.output, 10);
    assert_eq!(sessions[0].usage.cache_read, 20);
    assert_eq!(sessions[0].usage.reasoning, 3);
    assert_eq!(sessions[0].usage.total(), 60);
}

#[test]
fn refresh_collection_cache_reuses_paths_and_parsed_json() {
    let base = std::env::temp_dir().join(format!("ctop-read-cache-{}", std::process::id()));
    let nested = base.join("nested");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("event.jsonl"), r#"{"type":"fixture"}"#).unwrap();
    reset_io_counts();

    with_collection_cache(|| {
        let first = walk_files(&base, ".jsonl");
        let second = walk_files(&base, ".jsonl");
        assert_eq!(first, second);
        assert_eq!(read_json_lines(&first[0]).unwrap().len(), 1);
        assert_eq!(read_json_lines(&first[0]).unwrap().len(), 1);
    });

    assert_eq!(io_counts(), (2, 1));
}

#[test]
fn text_render_uses_stable_session_columns() {
    let date = NaiveDate::from_ymd_opt(2026, 6, 4).unwrap();
    let dashboard = provider::collect_periods(&fixture_home(), date, default_pricing());
    let rendered = render_text(&dashboard);
    let lines: Vec<_> = rendered.lines().collect();
    let top = strip_ansi(lines[0]);
    let header = strip_ansi(lines[5]);
    let row = strip_ansi(lines[7]);

    assert!(top.contains("2026-06-04"));
    assert!(header.contains("CACHE-WR"));
    assert!(header.contains("CACHE-RD"));
    assert!(!header.contains("STATE"));
    assert!(row.starts_with("11:15 "));
    assert!(row.contains(" CX "));
    assert!(row.contains("g5.5"));
    assert!(row.contains("   330 "));
    assert!(row.contains("   150 "));
    assert!(row.contains("   110 "));
    assert!(row.contains("    70 "));
    assert!(row.contains("  0.06 "));
    assert!(lines[7].contains("\x1b[33m    330\x1b[0m"));
    assert!(lines[7].contains("\x1b[33m    0.06\x1b[0m"));
}

#[test]
fn text_render_shows_empty_state_for_missing_sessions() {
    let dashboard = Dashboard {
        date: NaiveDate::from_ymd_opt(2026, 6, 24).unwrap(),
        generated_at: chrono::Local::now(),
        day: PeriodUsage::empty("Day"),
        week: PeriodUsage::empty("Week"),
        month: PeriodUsage::empty("Month"),
        sessions_24h: vec![],
    };

    let rendered = render_text(&dashboard);
    assert!(rendered.contains("No sessions active on 2026-06-24"));
    assert!(!rendered.contains("TIME"));
}

#[test]
fn codex_fallback_session_id_strips_rollout_prefix() {
    let base = std::env::temp_dir().join(format!("ctop-codex-rollout-{}", std::process::id()));
    let session_dir = base.join(".codex/sessions/2026/06/22");
    let date = NaiveDate::from_ymd_opt(2026, 6, 22).unwrap();

    write_codex_session(
        &session_dir,
        "rollout-019e1234-5678-9abc-def0-123456786a0c.jsonl",
        &[
            codex_line_without_session_id("2026-06-22T09:00:00.000Z", 0, 0, 0, 0, 0),
            codex_line_without_session_id("2026-06-22T09:15:00.000Z", 50, 20, 30, 0, 70),
        ],
    );

    let sessions = provider::collect_sessions_for_date(&base, date, default_pricing());
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "019e…6a0c");
}

#[test]
fn codex_fallback_session_id_extracts_uuid_from_filename() {
    let base = std::env::temp_dir().join(format!("ctop-codex-uuid-{}", std::process::id()));
    let session_dir = base.join(".codex/sessions/2026/06/22");
    let date = NaiveDate::from_ymd_opt(2026, 6, 22).unwrap();

    write_codex_session(
        &session_dir,
        "2026-06-22-019eef81-d26d-7d00-b3c2-44d92ef503b0.jsonl",
        &[
            codex_line_without_session_id("2026-06-22T09:00:00.000Z", 0, 0, 0, 0, 0),
            codex_line_without_session_id("2026-06-22T09:15:00.000Z", 50, 20, 30, 0, 70),
        ],
    );

    let sessions = provider::collect_sessions_for_date(&base, date, default_pricing());
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "019e…03b0");
}

#[test]
fn claude_provider_sums_per_event_token_usage() {
    let base = std::env::temp_dir().join(format!("ctop-claude-parity-{}", std::process::id()));
    let session_id = "aabb1234-5678-9abc-def0-123456789abc";
    let project_dir = base.join(".claude/projects/-home-pol-code-myproject");
    let date = NaiveDate::from_ymd_opt(2026, 6, 22).unwrap();

    write_claude_session(
        &project_dir,
        &format!("{session_id}.jsonl"),
        &[
            // first event on target date
            claude_event(
                "2026-06-22T09:00:00.000Z",
                session_id,
                "claude-opus-4-8",
                100,
                50,
                200,
                300,
            ),
            // second event same date — must be summed
            claude_event(
                "2026-06-22T09:30:00.000Z",
                session_id,
                "claude-opus-4-8",
                50,
                25,
                100,
                0,
            ),
            // event on a different date — must be excluded
            claude_event(
                "2026-06-20T12:00:00.000Z",
                session_id,
                "claude-opus-4-8",
                999,
                999,
                0,
                0,
            ),
        ],
    );

    let sessions = provider::collect_sessions_for_date(&base, date, default_pricing());
    assert_eq!(sessions.len(), 1);

    let session = &sessions[0];
    assert_eq!(session.provider, Provider::Claude);
    assert_eq!(session.model, "claude-opus-4-8");
    assert_eq!(session.usage.input, 150);
    assert_eq!(session.usage.output, 75);
    assert_eq!(session.usage.cache_read, 300);
    assert_eq!(session.usage.cache_create, 300);
    assert_eq!(session.usage.total(), 225);
    assert!(session.credits > 0.0);
}

#[test]
fn display_model_strips_claude_prefix_leaves_others() {
    assert_eq!(display_model("claude-opus-4-8"), "opus-4-8");
    assert_eq!(display_model("claude-sonnet-4-6"), "sonnet-4-6");
    assert_eq!(display_model("claude-haiku-4-5-20251001"), "haiku-4-5-20251001");
    assert_eq!(display_model("gpt-5.5"), "gpt-5.5");
    assert_eq!(display_model("g5-mini"), "g5-mini");
}

#[test]
fn claude_session_model_field_retains_full_id_for_pricing() {
    let base = std::env::temp_dir().join(format!("ctop-claude-model-id-{}", std::process::id()));
    let session_id = "aabb1234-5678-9abc-def0-123456789abc";
    let project_dir = base.join(".claude/projects/-home-pol-code-myproject");
    let date = NaiveDate::from_ymd_opt(2026, 6, 22).unwrap();

    write_claude_session(
        &project_dir,
        &format!("{session_id}.jsonl"),
        &[claude_event(
            "2026-06-22T09:00:00.000Z",
            session_id,
            "claude-opus-4-8",
            100,
            50,
            0,
            0,
        )],
    );

    let sessions = provider::collect_sessions_for_date(&base, date, default_pricing());
    let session = sessions.iter().find(|s| s.provider == Provider::Claude).unwrap();
    assert_eq!(session.model, "claude-opus-4-8", "raw model field must retain full id for pricing");
    assert!(session.credits > 0.0, "credits must resolve from full model id");
    assert_eq!(display_model(&session.model), "opus-4-8", "display strips prefix");
}

#[test]
fn claude_provider_absent_when_projects_dir_missing() {
    let base = std::env::temp_dir().join(format!("ctop-claude-absent-{}", std::process::id()));
    fs::create_dir_all(&base).unwrap();
    let date = NaiveDate::from_ymd_opt(2026, 6, 22).unwrap();

    let sessions = provider::collect_sessions_for_date(&base, date, default_pricing());
    assert_eq!(
        sessions
            .iter()
            .filter(|s| s.provider == Provider::Claude)
            .count(),
        0
    );
}
