use anyhow::{Context, Result};
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate};
use serde_json::Value;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
};
use std::{
    fs,
    path::{Path, PathBuf},
};

thread_local! {
    static IO_COUNTS: Cell<(usize, usize)> = const { Cell::new((0, 0)) };
    static COLLECTION_CACHE: RefCell<Option<CollectionCache>> = const { RefCell::new(None) };
}

#[derive(Default)]
struct CollectionCache {
    files: HashMap<(PathBuf, String), Vec<PathBuf>>,
    directories: HashMap<PathBuf, Vec<PathBuf>>,
    text: HashMap<PathBuf, String>,
    json_lines: HashMap<PathBuf, Rc<Vec<Value>>>,
}

pub fn with_collection_cache<T>(collect: impl FnOnce() -> T) -> T {
    let owns_cache = COLLECTION_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if cache.is_some() {
            false
        } else {
            *cache = Some(CollectionCache::default());
            true
        }
    });

    let result = collect();
    if owns_cache {
        COLLECTION_CACHE.with(|cache| *cache.borrow_mut() = None);
    }
    result
}

pub fn reset_io_counts() {
    IO_COUNTS.with(|counts| counts.set((0, 0)));
}

pub fn io_counts() -> (usize, usize) {
    IO_COUNTS.with(Cell::get)
}

pub(crate) fn count_read_dir() {
    IO_COUNTS.with(|counts| {
        let (dirs, reads) = counts.get();
        counts.set((dirs + 1, reads));
    });
}

pub fn walk_directories(root: impl AsRef<Path>) -> Vec<PathBuf> {
    let root = root.as_ref();
    if let Some(directories) = COLLECTION_CACHE.with(|cache| {
        cache
            .borrow()
            .as_ref()
            .and_then(|cache| cache.directories.get(root).cloned())
    }) {
        return directories;
    }

    count_read_dir();
    let directories = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|file_type| file_type.is_dir())
                .map(|_| entry.path())
        })
        .collect::<Vec<_>>();
    COLLECTION_CACHE.with(|cache| {
        if let Some(cache) = cache.borrow_mut().as_mut() {
            cache
                .directories
                .insert(root.to_path_buf(), directories.clone());
        }
    });
    directories
}

fn count_file_read() {
    IO_COUNTS.with(|counts| {
        let (dirs, reads) = counts.get();
        counts.set((dirs, reads + 1));
    });
}

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
    let root = root.as_ref();
    let key = (root.to_path_buf(), suffix.to_string());
    if let Some(files) = COLLECTION_CACHE.with(|cache| {
        cache
            .borrow()
            .as_ref()
            .and_then(|cache| cache.files.get(&key).cloned())
    }) {
        return files;
    }

    let mut files = Vec::new();
    walk_files_inner(root, suffix, &mut files);
    COLLECTION_CACHE.with(|cache| {
        if let Some(cache) = cache.borrow_mut().as_mut() {
            cache.files.insert(key, files.clone());
        }
    });
    files
}

fn walk_files_inner(root: &Path, suffix: &str, files: &mut Vec<PathBuf>) {
    count_read_dir();
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
    if let Some(text) = COLLECTION_CACHE.with(|cache| {
        cache
            .borrow()
            .as_ref()
            .and_then(|cache| cache.text.get(path).cloned())
    }) {
        return Ok(text);
    }

    count_file_read();
    let text =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    COLLECTION_CACHE.with(|cache| {
        if let Some(cache) = cache.borrow_mut().as_mut() {
            cache.text.insert(path.to_path_buf(), text.clone());
        }
    });
    Ok(text)
}

pub fn read_json_lines(path: impl AsRef<Path>) -> Result<Rc<Vec<Value>>> {
    let path = path.as_ref();
    if let Some(lines) = COLLECTION_CACHE.with(|cache| {
        cache
            .borrow()
            .as_ref()
            .and_then(|cache| cache.json_lines.get(path).cloned())
    }) {
        return Ok(lines);
    }

    count_file_read();
    let text =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    let lines: Rc<Vec<Value>> = Rc::new(
        text.lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .collect(),
    );
    COLLECTION_CACHE.with(|cache| {
        if let Some(cache) = cache.borrow_mut().as_mut() {
            cache.json_lines.insert(path.to_path_buf(), lines.clone());
        }
    });
    Ok(lines)
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
