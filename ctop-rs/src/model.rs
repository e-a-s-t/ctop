use chrono::{DateTime, Duration, Local, NaiveDate};

#[derive(Clone, Debug)]
pub struct Dashboard {
    pub date: NaiveDate,
    pub generated_at: DateTime<Local>,
    pub day: PeriodUsage,
    pub week: PeriodUsage,
    pub month: PeriodUsage,
    pub sessions_24h: Vec<Session>,
}

#[derive(Clone, Debug)]
pub struct PeriodUsage {
    pub label: String,
    pub usage: TokenUsage,
    pub credits: f64,
    pub codex_limit: Option<f64>,
}

impl PeriodUsage {
    pub fn empty(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            usage: TokenUsage::default(),
            credits: 0.0,
            codex_limit: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct TokenUsage {
    /// Non-cached input tokens, matching the Codex footer `input` field.
    pub input: u64,
    /// Output tokens, matching the footer `output` field.
    pub output: u64,
    /// Cache creation input tokens, billed like normal input.
    pub cache_create: u64,
    /// Cached input tokens, shown separately as cache read.
    pub cache_read: u64,
    /// Reasoning output tokens, tracked separately from the main total.
    pub reasoning: u64,
    /// Display total: input + output, excluding cache reads.
    pub total: u64,
}

impl TokenUsage {
    pub fn new(
        input: u64,
        output: u64,
        cache_create: u64,
        cache_read: u64,
        reasoning: u64,
        total: u64,
    ) -> Self {
        Self {
            input,
            output,
            cache_create,
            cache_read,
            reasoning,
            total,
        }
    }

    pub fn total(&self) -> u64 {
        self.total
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Provider {
    Codex,
    GitHubCopilot,
    Claude,
}

impl Provider {
    pub fn short(&self) -> &'static str {
        match self {
            Provider::Codex => "CX",
            Provider::GitHubCopilot => "GH",
            Provider::Claude => "CC",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionState {
    Running,
    Sleeping,
    Done,
}

impl SessionState {
    pub fn as_str(&self) -> &'static str {
        match self {
            SessionState::Running => "running",
            SessionState::Sleeping => "sleeping",
            SessionState::Done => "done",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Session {
    pub id: String,
    pub provider: Provider,
    pub model: String,
    pub started_at: DateTime<Local>,
    pub elapsed: Duration,
    pub usage: TokenUsage,
    pub credits: f64,
    pub state: SessionState,
}

impl Session {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: impl Into<String>,
        provider: Provider,
        model: impl Into<String>,
        started_at: DateTime<Local>,
        elapsed: Duration,
        usage: TokenUsage,
        credits: f64,
        state: SessionState,
    ) -> Self {
        Self {
            id: id.into(),
            provider,
            model: model.into(),
            started_at,
            elapsed,
            usage,
            credits,
            state,
        }
    }
}
