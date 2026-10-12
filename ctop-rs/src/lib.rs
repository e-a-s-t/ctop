pub mod aggregate;
pub mod model;
pub mod parser;
pub mod pricing;
pub mod provider;
pub mod ui;

use anyhow::Result;
use chrono::NaiveDate;
use model::Dashboard;
use parser::{month_end, month_start, reset_io_counts, week_end, week_start};
use std::time::Instant;

pub fn collect_usage(date: NaiveDate) -> Result<Dashboard> {
    let timing = std::env::var_os("CTOP_TIMING").is_some();
    let refresh_started = Instant::now();
    reset_io_counts();
    let home = parser::home_dir();
    let pricing_started = Instant::now();
    let pricing = pricing::load_pricing_from_env()?;
    if timing {
        eprintln!(
            "ctop_timing stage=pricing ms={:.3}",
            pricing_started.elapsed().as_secs_f64() * 1000.0
        );
    }

    let (sessions, week_sessions, month_sessions) = parser::with_collection_cache(|| {
        let day_started = Instant::now();
        let sessions = provider::collect_sessions_for_date(&home, date, &pricing);
        if timing {
            eprintln!(
                "ctop_timing stage=day ms={:.3}",
                day_started.elapsed().as_secs_f64() * 1000.0
            );
        }
        let week_started = Instant::now();
        let week_sessions =
            provider::collect_sessions_for_range(&home, week_start(date), week_end(date), &pricing);
        if timing {
            eprintln!(
                "ctop_timing stage=week ms={:.3}",
                week_started.elapsed().as_secs_f64() * 1000.0
            );
        }
        let month_started = Instant::now();
        let month_sessions = provider::collect_sessions_for_range(
            &home,
            month_start(date),
            month_end(date),
            &pricing,
        );
        if timing {
            eprintln!(
                "ctop_timing stage=month ms={:.3}",
                month_started.elapsed().as_secs_f64() * 1000.0
            );
        }
        (sessions, week_sessions, month_sessions)
    });

    let (week_limit, month_limit) = provider::load_limits();

    let aggregation_started = Instant::now();
    let mut day = aggregate::usage_for_sessions(&sessions);
    let mut week = aggregate::usage_for_sessions(&week_sessions);
    let mut month = aggregate::usage_for_sessions(&month_sessions);

    week.label = "Week".to_string();
    month.label = "Month".to_string();
    week.codex_limit = week_limit;
    month.codex_limit = month_limit;
    day.codex_limit = None;

    if timing {
        let (read_dirs, file_reads) = parser::io_counts();
        eprintln!(
            "ctop_timing stage=aggregation ms={:.3}",
            aggregation_started.elapsed().as_secs_f64() * 1000.0
        );
        eprintln!(
            "ctop_timing stage=collect_total ms={:.3} read_dirs={read_dirs} file_reads={file_reads}",
            refresh_started.elapsed().as_secs_f64() * 1000.0
        );
    }

    Ok(Dashboard {
        date,
        generated_at: provider::generated_at(),
        day,
        week,
        month,
        sessions_24h: sessions,
    })
}
