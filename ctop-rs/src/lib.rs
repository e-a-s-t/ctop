pub mod aggregate;
pub mod model;
pub mod parser;
pub mod pricing;
pub mod provider;
pub mod ui;

use anyhow::Result;
use chrono::NaiveDate;
use model::Dashboard;
use parser::{month_end, month_start, week_end, week_start};

pub fn collect_usage(date: NaiveDate) -> Result<Dashboard> {
    let home = parser::home_dir();
    let pricing = pricing::load_pricing_from_env()?;

    let sessions = provider::collect_sessions_for_date(&home, date, &pricing);
    let week_sessions = provider::collect_sessions_for_range(
        &home,
        week_start(date),
        week_end(date),
        &pricing,
    );
    let month_sessions = provider::collect_sessions_for_range(
        &home,
        month_start(date),
        month_end(date),
        &pricing,
    );

    let (week_limit, month_limit) = provider::load_limits();

    let mut day = aggregate::usage_for_sessions(&sessions);
    let mut week = aggregate::usage_for_sessions(&week_sessions);
    let mut month = aggregate::usage_for_sessions(&month_sessions);

    week.label = "Week".to_string();
    month.label = "Month".to_string();
    week.codex_limit = week_limit;
    month.codex_limit = month_limit;
    day.codex_limit = None;

    Ok(Dashboard {
        date,
        generated_at: provider::generated_at(),
        day,
        week,
        month,
        sessions_24h: sessions,
    })
}
