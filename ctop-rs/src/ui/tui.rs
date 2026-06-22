use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table},
};
use std::{io, time::Duration};

use chrono::{Local, NaiveDate};

use crate::{
    collect_usage,
    model::{Dashboard, PeriodUsage},
    ui::text::human,
};

const TABLE_COLUMNS: [Constraint; 10] = [
    Constraint::Length(5),
    Constraint::Length(4),
    Constraint::Length(14),
    Constraint::Length(7),
    Constraint::Length(6),
    Constraint::Length(6),
    Constraint::Length(9),
    Constraint::Length(9),
    Constraint::Length(8),
    Constraint::Length(18),
];

pub struct TuiOptions {
    pub date: Option<NaiveDate>,
    pub refresh_seconds: u64,
}

pub fn run(options: TuiOptions) -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = run_loop(&mut terminal, options);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    result
}

fn run_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    options: TuiOptions,
) -> Result<()> {
    let refresh = Duration::from_secs(options.refresh_seconds.max(1));

    loop {
        let dashboard = load_dashboard(options.date)?;

        terminal.draw(|frame| {
            let area = frame.area();
            draw_dashboard(frame, area, &dashboard);
        })?;

        if event::poll(refresh)? {
            if let Event::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Esc => break,
                        _ => {}
                    }
                }
            }
        }
    }

    Ok(())
}

fn load_dashboard(date: Option<NaiveDate>) -> Result<Dashboard> {
    let date = date.unwrap_or_else(|| Local::now().date_naive());
    collect_usage(date)
}

fn draw_dashboard(frame: &mut ratatui::Frame, area: Rect, dashboard: &Dashboard) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(6),
            Constraint::Min(8),
            Constraint::Length(1),
        ])
        .split(area);

    draw_top(frame, chunks[0], dashboard);
    draw_sessions(frame, chunks[1], dashboard);
    draw_footer(frame, chunks[2]);
}

fn draw_top(frame: &mut ratatui::Frame, area: Rect, d: &Dashboard) {
    let lines = vec![
        Line::from(vec![
            Span::raw(format!(
                "CTop: {} sessions",
                d.sessions_24h.len()
            )),
            Span::raw(format!("{:>32}", d.generated_at.format("%H:%M:%S"))),
        ]),
        summary_line(&d.day),
        summary_line(&d.week),
        summary_line(&d.month),
        Line::raw("Providers: CX Codex, GH GitHub Copilot"),
        Line::raw("Window: sessions during the last 24 hours"),
    ];

    let paragraph = Paragraph::new(lines);
    frame.render_widget(paragraph, area);
}

fn summary_line(period: &PeriodUsage) -> Line<'static> {
    let limit = period
        .codex_limit
        .map(|limit| {
            let pct = if limit > 0.0 {
                period.credits / limit * 100.0
            } else {
                0.0
            };
            format!(" limit:{:.0}/{:.0} {:.0}%", period.credits, limit, pct)
        })
        .unwrap_or_default();

    // Codex totals follow the footer: input excludes cache reads, and total is input + output.
    Line::from(format!(
        "{:<5} Tokens: {:>8}  in:{:>8} out:{:>7} cache create:{:>8} cache read:{:>7}  cr:{:>8.2}{}",
        period.label,
        human(period.usage.total()),
        human(period.usage.input),
        human(period.usage.output),
        human(period.usage.cache_create),
        human(period.usage.cache_read),
        period.credits,
        limit
    ))
}

fn draw_sessions(frame: &mut ratatui::Frame, area: Rect, d: &Dashboard) {
    let header = Row::new(vec![
        table_header("TIME", 5, Alignment::Left),
        table_header("PROV", 4, Alignment::Left),
        table_header("MODEL", 14, Alignment::Left),
        table_header("TOKENS", 7, Alignment::Right),
        table_header("IN", 6, Alignment::Right),
        table_header("OUT", 6, Alignment::Right),
        table_header("CACHE-WR", 9, Alignment::Right),
        table_header("CACHE-RD", 9, Alignment::Right),
        table_header("CREDIT", 8, Alignment::Right),
        table_header("SESSION", 18, Alignment::Left),
    ])
    .style(Style::default().add_modifier(Modifier::BOLD));

    let rows = d.sessions_24h.iter().map(|s| {
        Row::new(vec![
            table_cell(s.started_at.format("%H:%M").to_string(), 5, Alignment::Left),
            table_cell(s.provider.short(), 4, Alignment::Left),
            table_cell(s.model.clone(), 14, Alignment::Left),
            table_cell_colored(human(s.usage.total()), 7, Alignment::Right, Color::Yellow),
            table_cell(human(s.usage.input), 6, Alignment::Right),
            table_cell(human(s.usage.output), 6, Alignment::Right),
            table_cell(human(s.usage.cache_create), 9, Alignment::Right),
            table_cell(human(s.usage.cache_read), 9, Alignment::Right),
            table_cell_colored(format!("{:.2}", s.credits), 8, Alignment::Right, Color::Yellow),
            table_cell(s.id.clone(), 18, Alignment::Left),
        ])
    });

    let table = Table::new(rows, TABLE_COLUMNS)
        .header(header)
        .block(Block::default().borders(Borders::TOP));

    frame.render_widget(table, area);
}

fn table_header(text: &str, width: usize, alignment: Alignment) -> Cell<'static> {
    Cell::from(fit(text, width, alignment))
}

fn table_cell(text: impl Into<String>, width: usize, alignment: Alignment) -> Cell<'static> {
    Cell::from(fit(text.into(), width, alignment))
}

fn table_cell_colored(
    text: impl Into<String>,
    width: usize,
    alignment: Alignment,
    color: Color,
) -> Cell<'static> {
    table_cell(text, width, alignment).style(Style::default().fg(color))
}

fn fit(text: impl AsRef<str>, width: usize, alignment: Alignment) -> String {
    let value = truncate(text.as_ref(), width);
    let padding = width.saturating_sub(value.chars().count());
    match alignment {
        Alignment::Right => format!("{}{}", " ".repeat(padding), value),
        Alignment::Center => {
            let left = padding / 2;
            let right = padding - left;
            format!("{}{}{}", " ".repeat(left), value, " ".repeat(right))
        }
        Alignment::Left => format!("{}{}", value, " ".repeat(padding)),
    }
}

fn truncate(text: &str, width: usize) -> String {
    text.chars().take(width).collect()
}

fn draw_footer(frame: &mut ratatui::Frame, area: Rect) {
    let footer = Paragraph::new("q: quit | --once: render plain text | refresh every N s");
    frame.render_widget(footer, area);
}
