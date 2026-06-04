# Copilot Support Plan

## Findings

- Current app logic lived in `bin/ctop.js` and assumed Codex-only paths and JSONL token events.
- Codex source path was hardcoded to `~/.codex/sessions/YYYY/MM/DD/*.jsonl`.
- Credits were estimated from Codex token usage and model table.
- Local Copilot data exists in:
  - `~/.copilot/session-state/<id>/workspace.yaml`
  - `~/.copilot/logs/process-*.log`
- Sample Copilot logs exposed session ids and model, but no proven token or credit counters.

## Design

- Add provider boundary in `lib/providers.js`.
- Keep current Codex behavior by moving existing discovery/parsing into Codex provider.
- Add Copilot provider with:
  - stage 1 session discovery from `workspace.yaml`
  - stage 2 best-effort log inspection for model, activity, usage, credits
- Normalize provider output to shared session shape:
  - `provider`, `providerTag`, `file`, `name`, `time`, `model`
  - token fields
  - `credits`
  - `usageAvailable`, `creditAvailable`, `note`
- Keep one mixed session list. Add short provider tag per row.
- If Copilot usage/credits unavailable:
  - show row with `--` metrics and `cr:--`
  - exclude missing data from totals
  - show note that totals are partial

## Stages

1. Add provider registry and move Codex parsing behind it.
2. Add Copilot session discovery from `workspace.yaml`.
3. Add best-effort Copilot log correlation for model/activity and future usage/credit extraction.
4. Add tests and README updates.

## Risks

- Copilot logs may not expose token or credit counters.
- Mixed-provider rows can undercount totals if Copilot usage is unavailable.
- Small repo means refactor must stay narrow to avoid churn.

## Tests

- Codex fixture keeps current parsing and totals.
- Copilot fixture discovers session from `workspace.yaml`.
- Copilot log fixture attaches model and activity.
- Missing Copilot path does not break Codex.
- Partial Copilot data excluded from totals and marked partial.

## Commits

1. `plan: add copilot support plan`
2. `refactor: add provider registry while preserving codex behavior`
3. `feat: discover copilot sessions in mixed-provider dashboard`
4. `feat: inspect copilot logs for best-effort metadata`
5. `docs: document copilot behavior and limits`
