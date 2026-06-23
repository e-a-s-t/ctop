use anyhow::Result;
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{
        disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
    },
};
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Cell, Paragraph, Row, Table},
};
use std::{collections::HashMap, io, time::Duration};

use chrono::{Local, NaiveDate};

use crate::{
    collect_usage,
    model::{Dashboard, PeriodUsage},
    provider,
    ui::text::{display_model, human},
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ViewMode {
    Normal,
    Tiny,
}

pub fn run(options: TuiOptions) -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, crossterm::event::EnableFocusChange)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let result = run_loop(&mut terminal, options);

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        crossterm::event::DisableFocusChange
    )?;
    terminal.show_cursor()?;

    result
}

fn run_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    options: TuiOptions,
) -> Result<()> {
    let refresh = Duration::from_secs(options.refresh_seconds.max(1));
    let mut cache = DashboardCache::default();
    let mut selected_date = options.date.unwrap_or_else(|| Local::now().date_naive());
    let mut view_mode = ViewMode::Normal;
    let mut has_focus = true;

    loop {
        let dashboard_date = dashboard_date_for_mode(selected_date, view_mode, Local::now().date_naive());
        let dashboard = load_dashboard(&mut cache, dashboard_date)?;

        terminal.draw(|frame| {
            let area = frame.area();
            draw_dashboard(frame, area, &dashboard, view_mode);
        })?;

        if event::poll(refresh)? {
            match event::read()? {
                Event::FocusGained => has_focus = true,
                Event::FocusLost => has_focus = false,
                Event::Key(key) if has_focus && key.kind == KeyEventKind::Press => {
                    match handle_key(selected_date, key.code, key.modifiers) {
                        KeyAction::Quit => break,
                        KeyAction::SelectDate(date) => selected_date = date,
                        KeyAction::ToggleViewMode => {
                            view_mode = match view_mode {
                                ViewMode::Normal => ViewMode::Tiny,
                                ViewMode::Tiny => ViewMode::Normal,
                            };
                        }
                        KeyAction::None => {}
                    }
                }
                _ => {}
            }
        }
    }

    Ok(())
}

fn load_dashboard(cache: &mut DashboardCache, date: NaiveDate) -> Result<Dashboard> {
    if let Some(dashboard) = cache.get(date) {
        return Ok(with_fresh_timestamp(dashboard));
    }

    let dashboard = collect_usage(date)?;
    cache.insert(date, dashboard.clone());
    Ok(with_fresh_timestamp(dashboard))
}

fn draw_dashboard(
    frame: &mut ratatui::Frame,
    area: Rect,
    dashboard: &Dashboard,
    view_mode: ViewMode,
) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(dashboard_constraints(view_mode))
        .split(area);

    match view_mode {
        ViewMode::Normal => draw_top(frame, chunks[0], dashboard),
        ViewMode::Tiny => draw_tiny_top(frame, chunks[0], dashboard),
    }
    draw_sessions(frame, chunks[1], dashboard);
    draw_footer(frame, chunks[2], view_mode);
}

fn draw_top(frame: &mut ratatui::Frame, area: Rect, d: &Dashboard) {
    let lines = vec![
        Line::from(vec![
            Span::raw(format!("CTop {}: {} sessions", d.date, d.sessions_24h.len())),
            Span::raw(format!("{:>32}", d.generated_at.format("%H:%M:%S"))),
        ]),
        summary_line(&d.day),
        summary_line(&d.week),
        summary_line(&d.month),
        Line::raw("Providers: CX Codex, GH GitHub Copilot, CC Claude"),
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
    if d.sessions_24h.is_empty() {
        let empty = Paragraph::new(format!("No sessions active on {}", d.date))
            .alignment(Alignment::Center)
            .block(Block::default().borders(Borders::TOP));
        frame.render_widget(empty, area);
        return;
    }

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
            table_cell(display_model(&s.model), 14, Alignment::Left),
            table_cell_colored(human(s.usage.total()), 7, Alignment::Right, Color::Yellow),
            table_cell(human(s.usage.input), 6, Alignment::Right),
            table_cell(human(s.usage.output), 6, Alignment::Right),
            table_cell(human(s.usage.cache_create), 9, Alignment::Right),
            table_cell(human(s.usage.cache_read), 9, Alignment::Right),
            table_cell_colored(
                format!("{:.2}", s.credits),
                8,
                Alignment::Right,
                Color::Yellow,
            ),
            table_cell(s.id.clone(), 18, Alignment::Left),
        ])
    });

    let table = Table::new(rows, TABLE_COLUMNS)
        .header(header)
        .block(Block::default().borders(Borders::TOP));

    frame.render_widget(table, area);
}

fn draw_tiny_top(frame: &mut ratatui::Frame, area: Rect, d: &Dashboard) {
    let line = Line::from(format!(
        "CTop {} tiny: {} sessions",
        d.date,
        d.sessions_24h.len()
    ));
    frame.render_widget(Paragraph::new(line), area);
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

fn dashboard_constraints(view_mode: ViewMode) -> [Constraint; 3] {
    match view_mode {
        ViewMode::Normal => [Constraint::Length(6), Constraint::Min(8), Constraint::Length(1)],
        ViewMode::Tiny => [Constraint::Length(1), Constraint::Min(8), Constraint::Length(1)],
    }
}

fn dashboard_date_for_mode(
    selected_date: NaiveDate,
    view_mode: ViewMode,
    today: NaiveDate,
) -> NaiveDate {
    match view_mode {
        ViewMode::Normal => selected_date,
        ViewMode::Tiny => today,
    }
}

fn draw_footer(frame: &mut ratatui::Frame, area: Rect, view_mode: ViewMode) {
    let footer = match view_mode {
        ViewMode::Normal => Paragraph::new("q: quit | left/right: change day | t: today | m: tiny"),
        ViewMode::Tiny => Paragraph::new("q: quit | m: normal"),
    };
    frame.render_widget(footer, area);
}

#[derive(Default)]
struct DashboardCache {
    entries: HashMap<NaiveDate, Dashboard>,
}

impl DashboardCache {
    fn get(&self, date: NaiveDate) -> Option<Dashboard> {
        self.entries.get(&date).cloned()
    }

    fn insert(&mut self, date: NaiveDate, dashboard: Dashboard) {
        self.entries.insert(date, dashboard);
    }
}

fn with_fresh_timestamp(mut dashboard: Dashboard) -> Dashboard {
    dashboard.generated_at = provider::generated_at();
    dashboard
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum KeyAction {
    None,
    Quit,
    SelectDate(NaiveDate),
    ToggleViewMode,
}

fn handle_key(selected_date: NaiveDate, code: KeyCode, modifiers: KeyModifiers) -> KeyAction {
    match (code, modifiers) {
        (KeyCode::Char('q'), _) | (KeyCode::Esc, _) => KeyAction::Quit,
        (KeyCode::Char('c'), m) if m.contains(KeyModifiers::CONTROL) => KeyAction::Quit,
        (KeyCode::Left, _) => KeyAction::SelectDate(crate::parser::date_minus(selected_date, 1)),
        (KeyCode::Right, _) => KeyAction::SelectDate(crate::parser::date_plus(selected_date, 1)),
        (KeyCode::Char('t'), _) => KeyAction::SelectDate(Local::now().date_naive()),
        (KeyCode::Char('m'), _) => KeyAction::ToggleViewMode,
        _ => KeyAction::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn left_arrow_moves_to_previous_date() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 23).unwrap();
        assert_eq!(
            handle_key(date, KeyCode::Left, KeyModifiers::empty()),
            KeyAction::SelectDate(NaiveDate::from_ymd_opt(2026, 6, 22).unwrap())
        );
    }

    #[test]
    fn right_arrow_moves_to_next_date() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 22).unwrap();
        assert_eq!(
            handle_key(date, KeyCode::Right, KeyModifiers::empty()),
            KeyAction::SelectDate(NaiveDate::from_ymd_opt(2026, 6, 23).unwrap())
        );
    }

    #[test]
    fn t_returns_today() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        assert_eq!(
            handle_key(date, KeyCode::Char('t'), KeyModifiers::empty()),
            KeyAction::SelectDate(Local::now().date_naive())
        );
    }

    #[test]
    fn m_toggles_view_mode() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        assert_eq!(
            handle_key(date, KeyCode::Char('m'), KeyModifiers::empty()),
            KeyAction::ToggleViewMode
        );
    }

    #[test]
    fn tiny_mode_ignores_selected_date() {
        let selected = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 6, 23).unwrap();

        assert_eq!(
            dashboard_date_for_mode(selected, ViewMode::Tiny, today),
            today
        );
    }

    #[test]
    fn normal_mode_keeps_selected_date() {
        let selected = NaiveDate::from_ymd_opt(2026, 6, 15).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 6, 23).unwrap();

        assert_eq!(
            dashboard_date_for_mode(selected, ViewMode::Normal, today),
            selected
        );
    }

    #[test]
    fn tiny_mode_hides_summary_sections() {
        assert_eq!(
            dashboard_constraints(ViewMode::Tiny),
            [
                Constraint::Length(1),
                Constraint::Min(8),
                Constraint::Length(1)
            ]
        );
    }

    #[test]
    fn cache_returns_inserted_dashboard() {
        let mut cache = DashboardCache::default();
        let date = NaiveDate::from_ymd_opt(2026, 6, 23).unwrap();
        let dashboard = Dashboard {
            date,
            generated_at: Local::now(),
            day: PeriodUsage::empty("Day"),
            week: PeriodUsage::empty("Week"),
            month: PeriodUsage::empty("Month"),
            sessions_24h: vec![],
        };

        cache.insert(date, dashboard.clone());

        let cached = cache.get(date).expect("cached dashboard");
        assert_eq!(cached.date, dashboard.date);
        assert_eq!(cached.sessions_24h.len(), dashboard.sessions_24h.len());
    }

    #[test]
    fn ctrl_c_quits() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        assert_eq!(
            handle_key(date, KeyCode::Char('c'), KeyModifiers::CONTROL),
            KeyAction::Quit
        );
    }
}
