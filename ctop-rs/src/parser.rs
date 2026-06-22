use anyhow::{Context, Result};
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn normalize_model(value: Option<&str>) -> String {
    let Some(value) = value else {
        return "-".to_string();
    };

    if value.is_empty() {
        return "-".to_string();
    }

    value.replace("gpt-", "g")
}

pub fn short_id(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() < 8 {
        return value.to_string();
    }

    let prefix: String = chars.iter().take(4).collect();
    let suffix: String = chars.iter().rev().take(4).copied().collect::<Vec<_>>().into_iter().rev().collect();
    format!("{prefix}…{suffix}")
}

pub fn parse_timestamp(value: Option<&str>) -> Option<DateTime<Local>> {
    let value = value?;
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|ts| ts.with_timezone(&Local))
}

pub fn local_date(value: Option<&str>) -> Option<NaiveDate> {
    parse_timestamp(value).map(|ts| ts.date_naive())
}

pub fn local_time(value: Option<&str>) -> String {
    parse_timestamp(value)
        .map(|ts| ts.format("%H:%M").to_string())
        .unwrap_or_else(|| "--:--".to_string())
}

pub fn max_timestamp(
    current: Option<DateTime<Local>>,
    next: Option<DateTime<Local>>,
) -> Option<DateTime<Local>> {
    match (current, next) {
        (None, next) => next,
        (current, None) => current,
        (Some(current), Some(next)) => Some(if next > current { next } else { current }),
    }
}

pub fn date_minus(date: NaiveDate, days: i64) -> NaiveDate {
    date - Duration::days(days)
}

pub fn date_plus(date: NaiveDate, days: i64) -> NaiveDate {
    date + Duration::days(days)
}

pub fn week_start(date: NaiveDate) -> NaiveDate {
    let offset = i64::from(date.weekday().num_days_from_monday());
    date - Duration::days(offset)
}

pub fn week_end(date: NaiveDate) -> NaiveDate {
    week_start(date) + Duration::days(6)
}

pub fn month_start(date: NaiveDate) -> NaiveDate {
    date.with_day(1).unwrap_or(date)
}

pub fn month_end(date: NaiveDate) -> NaiveDate {
    let (year, month) = (date.year(), date.month());
    let first_next_month = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    };

    first_next_month
        .and_then(|d| d.pred_opt())
        .unwrap_or(date)
}

pub fn parse_yaml_scalar(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (lhs, rhs) = line.split_once(':')?;
        if lhs.trim() == key {
            Some(rhs.trim().to_string())
        } else {
            None
        }
    })
}

pub fn walk_files(root: impl AsRef<Path>, suffix: &str) -> Vec<PathBuf> {
    let mut files = Vec::new();
    walk_files_inner(root.as_ref(), suffix, &mut files);
    files
}

fn walk_files_inner(root: &Path, suffix: &str, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            walk_files_inner(&path, suffix, files);
        } else if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(suffix))
        {
            files.push(path);
        }
    }
}

pub fn read_to_string(path: impl AsRef<Path>) -> Result<String> {
    let path = path.as_ref();
    fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
