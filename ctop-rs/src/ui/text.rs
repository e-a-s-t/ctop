use crate::model::{Dashboard, PeriodUsage, Session};

const TABLE_WIDTHS: [usize; 10] = [5, 4, 14, 7, 6, 6, 9, 9, 8, 18];
const YELLOW: &str = "\x1b[33m";
const RESET: &str = "\x1b[0m";

pub fn render_text(d: &Dashboard) -> String {
    let mut out = String::new();

    out.push_str(&format!(
        "CTop {}: {} sessions{:>24}\n",
        d.date,
        d.sessions_24h.len(),
        d.generated_at.format("%H:%M:%S")
    ));

    out.push_str(&summary_line(&d.day));
    out.push('\n');
    out.push_str(&summary_line(&d.week));
    out.push('\n');
    out.push_str(&summary_line(&d.month));
    out.push('\n');
    out.push('\n');

    if d.sessions_24h.is_empty() {
        out.push_str(&format!("No sessions active on {}\n", d.date));
    } else {
        out.push_str(&render_header());
        out.push('\n');

        for s in &d.sessions_24h {
            out.push_str(&render_session_line(s));
            out.push('\n');
        }
    }

    out
}

fn render_header() -> String {
    render_columns(
        [
            ("TIME".to_string(), Alignment::Left),
            ("PROV".to_string(), Alignment::Left),
            ("MODEL".to_string(), Alignment::Left),
            ("TOKENS".to_string(), Alignment::Right),
            ("IN".to_string(), Alignment::Right),
            ("OUT".to_string(), Alignment::Right),
            ("CACHE-WR".to_string(), Alignment::Right),
            ("CACHE-RD".to_string(), Alignment::Right),
            ("CREDIT".to_string(), Alignment::Right),
            ("SESSION".to_string(), Alignment::Left),
        ],
        &TABLE_WIDTHS,
    )
}

fn summary_line(p: &PeriodUsage) -> String {
    let limit = p
        .codex_limit
        .map(|limit| format!(" limit:{:.0}/{:.0}", p.credits, limit))
        .unwrap_or_default();

    // Codex totals follow the footer: input excludes cache reads, and total is input + output.
    format!(
        "{:<5} Tokens: {:>8}  in:{:>8} out:{:>7} cache create:{:>8} cache read:{:>7}  cr:{:>8.2}{}",
        p.label,
        human(p.usage.total()),
        human(p.usage.input),
        human(p.usage.output),
        human(p.usage.cache_create),
        human(p.usage.cache_read),
        p.credits,
        limit
    )
}

fn render_session_line(s: &Session) -> String {
    [
        fit(s.started_at.format("%H:%M").to_string(), TABLE_WIDTHS[0], Alignment::Left),
        fit(s.provider.short(), TABLE_WIDTHS[1], Alignment::Left),
        fit(display_model(&s.model), TABLE_WIDTHS[2], Alignment::Left),
        format!(
            "{}{}{}",
            YELLOW,
            fit(human(s.usage.total()), TABLE_WIDTHS[3], Alignment::Right),
            RESET
        ),
        fit(human(s.usage.input), TABLE_WIDTHS[4], Alignment::Right),
        fit(human(s.usage.output), TABLE_WIDTHS[5], Alignment::Right),
        fit(human(s.usage.cache_create), TABLE_WIDTHS[6], Alignment::Right),
        fit(human(s.usage.cache_read), TABLE_WIDTHS[7], Alignment::Right),
        format!(
            "{}{}{}",
            YELLOW,
            fit(format!("{:.2}", s.credits), TABLE_WIDTHS[8], Alignment::Right),
            RESET
        ),
        fit(s.id.clone(), TABLE_WIDTHS[9], Alignment::Left),
    ]
    .join(" ")
}

fn render_columns(columns: [(String, Alignment); 10], widths: &[usize; 10]) -> String {
    columns
        .into_iter()
        .zip(widths)
        .map(|((value, alignment), width)| fit(value, *width, alignment))
        .collect::<Vec<_>>()
        .join(" ")
}

fn fit(text: impl AsRef<str>, width: usize, alignment: Alignment) -> String {
    let value = truncate(text.as_ref(), width);
    let padding = width.saturating_sub(value.chars().count());

    match alignment {
        Alignment::Right => format!("{}{}", " ".repeat(padding), value),
        Alignment::Left => format!("{}{}", value, " ".repeat(padding)),
    }
}

fn truncate(text: &str, width: usize) -> String {
    text.chars().take(width).collect()
}

enum Alignment {
    Left,
    Right,
}

pub fn display_model(model: &str) -> &str {
    model.strip_prefix("claude-").unwrap_or(model)
}

pub fn human(n: u64) -> String {
    if n >= 1_000_000_000 {
        format!("{:.1}G", n as f64 / 1_000_000_000.0)
    } else if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{}k", n / 1_000)
    } else {
        n.to_string()
    }
}
