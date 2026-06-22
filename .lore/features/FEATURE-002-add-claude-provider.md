---
id: FEATURE-002
title: Add Claude provider
status: Draft
related_requirements:
  - REQ-004
related_adrs:
  - ADR-002
related_stories:
  - STORY-003
related_tests:
  - TEST-003
---

# FEATURE-002 - Add Claude provider

## Feature

Add a Claude Code provider to ctop so that Claude Code session usage appears in the mixed-provider dashboard alongside Codex and Copilot.

The provider discovers local Claude Code JSONL transcripts under `~/.claude/projects/`, parses real token counters from `assistant` events, and normalises them into the existing usage model. No estimation is performed; only counters present in `message.usage` are used.

The provider is implemented on both the JS side (`bin/providers/claude.js`) and the Rust side (`ctop-rs/src/provider/claude.rs`) so that the parity test suite covers it.

## Scope

- Discover JSONL transcripts under `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`.
- Parse `assistant` events; extract `message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}` and `message.model`.
- Sum per-call counters directly; no estimation.
- Use provider short tag `CC`.
- Implement in both JS (`bin/providers/claude.js`) and Rust (`ctop-rs/src/provider/claude.rs`).
- Add provider to `bin/providers/index.js` and `ctop-rs/src/provider/mod.rs`.

## Out of Scope

- Credit estimation beyond what the shared pricing helper already does.
- UI redesign.
- Pricing file format changes.
- Adding new providers other than Claude.
