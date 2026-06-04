Feature: provider breakdown

Goal:
- Make source visible near provider in row layout.
- Add Week/Month provider totals under existing totals.

Target files:
- `bin/ctop.js`
- `lib/providers.js`
- `test/providers.test.js`

Steps:
1. Update `lib/providers.js`
   - add fixed source label data for GH/CX rows
   - add provider breakdown total helpers
   - keep Codex token behavior same
2. Update `bin/ctop.js`
   - render provider + source column near model
   - render Week/Month provider breakdown lines
3. Update `test/providers.test.js`
   - row layout source near provider
   - Week/Month show CX and GH totals
   - metadata-only GH rows count msg/req only
   - token GH rows still count tokens
   - overall totals unchanged

Validation:
- `node --test test/providers.test.js`

Non-goals:
- new colors
- pricing/model changes
- broad UI rewrite
