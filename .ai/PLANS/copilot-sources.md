# Copilot Sources

## Done

- split GH/Copilot discovery into `vscode` and `cli`
- keep `providerTag` as `GH`
- keep Codex path and parsing unchanged
- add source suffix in row name: `vscode` / `cli`

## Source Rules

- VS Code source reads `workspaceStorage/*/chatSessions/*.jsonl`
- VS Code also recognizes companion DB filenames:
- VS Code companion DBs inspected:
  - `state.vscdb`
  - `session-store.db`
- CLI source reads `~/.copilot/session-state/*/workspace.yaml`
- CLI source reads `~/.copilot/session-state/*/events.jsonl`
- CLI may fall back to process logs for time/model only

## Real Counters Only

- no Copilot token estimation
- no Copilot credit estimation
- VS Code leaves usage and credits unavailable unless real counters appear
- CLI uses real token counters from `session.shutdown.modelMetrics.*.usage`
- CLI does not map `totalNanoAiu` to credits

## Schema Notes

- observed VS Code DB shape here: `ItemTable(key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)`
- CLI `session-store.db` was inspected but not needed for v1 parsing

## Validation

- `node --test test/providers.test.js`
