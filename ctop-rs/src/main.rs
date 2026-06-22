use anyhow::Result;
use chrono::{Local, NaiveDate};
use clap::Parser;
use std::env;

#[derive(Parser, Debug)]
#[command(name = "ctop")]
#[command(version)]
#[command(about = "AI usage dashboard inspired by top")]
struct Args {
    /// Render once as plain text instead of opening the TUI
    #[arg(long)]
    once: bool,

    /// Refresh interval in seconds for the TUI, defaults to 2
    #[arg(long)]
    refresh: Option<u64>,

    /// Dashboard date, defaults to today. Format: YYYY-MM-DD
    #[arg(long)]
    date: Option<NaiveDate>,
}

fn main() -> Result<()> {
    let args = Args::parse();

    if args.once {
        let date = args.date.unwrap_or_else(|| Local::now().date_naive());
        let dashboard = ctop_rs::collect_usage(date)?;
        print!("{}", ctop_rs::ui::text::render_text(&dashboard));
        return Ok(());
    }

    ctop_rs::ui::tui::run(ctop_rs::ui::tui::TuiOptions {
        date: args.date,
        refresh_seconds: args
            .refresh
            .or_else(|| env::var("AI_USAGE_REFRESH").ok().and_then(|raw| raw.parse().ok()))
            .unwrap_or(2),
    })
}
