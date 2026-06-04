# CTop

> htop for AI coding assistants

CTop is a lightweight terminal dashboard for monitoring AI coding assistant usage in real time.

It provides immediate visibility into:

- Input tokens
- Output tokens
- Cached tokens
- Credits consumed
- Session activity
- Daily usage totals

The goal is simple:

> Answer the question *"How many credits have I burned today?"* without needing a spreadsheet or provider dashboard.

---

## Features

- Live updates
- Session-aware usage tracking
- Daily summaries
- Input / output / cache token breakdown
- Fast startup
- Zero configuration
- Cross-platform

Supported:

- Linux
- macOS
- Windows

---

## Installation

Run directly:

```bash
npx ctop
```

Or install globally:

```bash
npm install -g ctop

ctop
```

---

## Example

```text
CTop v0.1

Active sessions
──────────────────────────────────────────
22:31 gpt-5.5     ██████████       19k
22:05 gpt-5.5     ████              7k

Today
──────────────────────────────────────────
Input              82k
Output             11k
Cache             590k
Credits           683k

Refreshing every 2 seconds...
```

---

## Usage

### Live dashboard

```bash
ctop
```

### Show summary

```bash
ctop --summary
```

### Show sessions

```bash
ctop --sessions
```

### Output JSON

```bash
ctop --json
```

### Change refresh interval

```bash
ctop --refresh 5
```

### Show a specific date

```bash
ctop --date 2026-06-04
```

---

## Philosophy

CTop aims to be:

- Small
- Fast
- Simple
- Scriptable

Like `top`, `htop`, and `btop`, it should do one thing well.

---

## Roadmap

### v0.1

- Live dashboard
- Session view
- Daily totals
- JSON output

### v0.2

- Trend graphs
- Top consumers
- Historical view

### v0.3

Support for additional agents:

- Claude Code
- GitHub Copilot CLI
- Gemini CLI

---

## Why?

Many existing tools focus on monthly reports and estimated cost.

CTop focuses on the developer sitting at the keyboard right now.

Questions like:

- How many credits have I burned today?
- Is my current session active?
- Which session consumed the most?
- Did that last prompt explode my usage?

should be answered instantly.

---

## Contributing

Issues, suggestions and pull requests are welcome.

---

## License

MIT
