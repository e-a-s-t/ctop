# ctop-rs

Rust/Ratatui rewrite skeleton for `ctop`.

The UI is intentionally inspired by ordinary `top`:

- top summary lines for Day, Week and Month
- session table below
- sessions are scoped to the last 24 hours
- `q` exits the TUI
- `--once` renders a plain text version

## Run

```bash
cargo run
```

Plain text mode:

```bash
cargo run -- --once
```

Specific date:

```bash
cargo run -- --date 2026-06-22
```

## Current state

This is a working skeleton with sample data.

Next migration steps:

1. Port current ctop parsing from Node to `src/provider/codex.rs` and `src/provider/github.rs`
2. Port pricing into `src/pricing.rs`
3. Replace sample `collect_usage()` data with real provider collection
4. Keep Ratatui UI independent from parsing and credit calculations
