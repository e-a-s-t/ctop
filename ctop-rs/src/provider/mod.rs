pub mod claude;
pub mod codex;
pub mod github;

use crate::{
    model::{Dashboard, PeriodUsage, Session},
    parser::{date_plus, month_end, month_start, week_end, week_start},
    pricing::{Pricing, resolve_limit},
};
use chrono::{Local, NaiveDate, Timelike};
use std::path::Path;

pub const LOOKBACK_DAYS: usize = 14;

pub fn collect_sessions_for_date(home: &Path, date: NaiveDate, pricing: &Pricing) -> Vec<Session> {
    let mut sessions = Vec::new();

    if codex::is_available(home) {
        sessions.extend(codex::load_sessions(home, date, LOOKBACK_DAYS, pricing));
    }

    if github::is_available(home) {
        sessions.extend(github::load_sessions(home, date));
    }

    if claude::is_available(home) {
        sessions.extend(claude::load_sessions(home, date, pricing));
    }

    sessions.sort_by(|a, b| {
        a.started_at
            .cmp(&b.started_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    sessions
}

pub fn collect_sessions_for_range(
    home: &Path,
    start_date: NaiveDate,
    end_date: NaiveDate,
    pricing: &Pricing,
) -> Vec<Session> {
    let mut sessions = Vec::new();
    let mut date = start_date;

    while date <= end_date {
        sessions.extend(collect_sessions_for_date(home, date, pricing));
        date = date_plus(date, 1);
    }

    sessions
}

pub fn collect_usage_for_day(sessions: &[Session]) -> PeriodUsage {
    aggregate_period("Day", sessions)
}

pub fn collect_usage_for_range(
    label: &str,
    sessions: &[Session],
    codex_limit: Option<f64>,
) -> PeriodUsage {
    let mut period = aggregate_period(label, sessions);
    period.codex_limit = codex_limit;
    period
}

pub fn week_range(date: NaiveDate) -> (NaiveDate, NaiveDate) {
    (week_start(date), week_end(date))
}

pub fn month_range(date: NaiveDate) -> (NaiveDate, NaiveDate) {
    (month_start(date), month_end(date))
}

pub fn generated_at() -> chrono::DateTime<Local> {
    let now = Local::now();
    now.with_second(0).unwrap_or(now)
}

pub fn aggregate_period(label: &str, sessions: &[Session]) -> PeriodUsage {
    let usage = sessions
        .iter()
        .fold(crate::model::TokenUsage::default(), |mut acc, session| {
            acc.input += session.usage.input;
            acc.output += session.usage.output;
            acc.cache_create += session.usage.cache_create;
            acc.cache_read += session.usage.cache_read;
            acc.reasoning += session.usage.reasoning;
            acc.total += session.usage.total;
            acc
        });

    let credits = sessions.iter().map(|session| session.credits).sum();

    PeriodUsage {
        label: label.to_string(),
        usage,
        credits,
        codex_limit: None,
    }
}

pub fn load_limits() -> (Option<f64>, Option<f64>) {
    (
        resolve_limit("CTOP_CODEX_WEEKLY_LIMIT"),
        resolve_limit("CTOP_CODEX_MONTHLY_LIMIT"),
    )
}

pub fn is_today_active(date: NaiveDate, latest: Option<chrono::DateTime<Local>>) -> bool {
    latest.map(|ts| ts.date_naive() == date).unwrap_or(false)
}

pub fn local_time_str(ts: Option<chrono::DateTime<Local>>) -> String {
    ts.map(|value| value.format("%H:%M").to_string())
        .unwrap_or_else(|| "--:--".to_string())
}

pub fn today_sessions_with_ranges(
    home: &Path,
    date: NaiveDate,
    pricing: &Pricing,
) -> (Vec<Session>, Vec<Session>, Vec<Session>) {
    let sessions = collect_sessions_for_date(home, date, pricing);
    let (week_start, week_end) = week_range(date);
    let (month_start, month_end) = month_range(date);
    let week_sessions = collect_sessions_for_range(home, week_start, week_end, pricing);
    let month_sessions = collect_sessions_for_range(home, month_start, month_end, pricing);
    (sessions, week_sessions, month_sessions)
}

pub fn collect_periods(home: &Path, date: NaiveDate, pricing: &Pricing) -> Dashboard {
    let (sessions, week_sessions, month_sessions) = today_sessions_with_ranges(home, date, pricing);
    let (week_limit, month_limit) = load_limits();

    let mut day = aggregate_period("Day", &sessions);
    let mut week = aggregate_period("Week", &week_sessions);
    let mut month = aggregate_period("Month", &month_sessions);
    week.codex_limit = week_limit;
    month.codex_limit = month_limit;
    day.codex_limit = None;

    Dashboard {
        date,
        generated_at: generated_at(),
        day,
        week,
        month,
        sessions_24h: sessions,
    }
}
