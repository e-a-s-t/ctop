use crate::model::{PeriodUsage, Session, TokenUsage};

pub fn usage_for_sessions(sessions: &[Session]) -> PeriodUsage {
    let usage = sessions.iter().fold(TokenUsage::default(), |mut acc, session| {
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
        label: "Day".to_string(),
        usage,
        credits,
        codex_limit: None,
    }
}
