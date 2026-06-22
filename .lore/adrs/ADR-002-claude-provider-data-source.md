---
id: ADR-002
title: Claude provider data source
status: Draft
related_requirements:
  - FEATURE-002
  - REQ-004
related_adrs:
  - ADR-001
related_stories:
  - STORY-003
related_tests:
  - TEST-003
---

# ADR-002 - Claude provider data source

## Context

Claude Code writes one JSONL file per session under `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. Each line is a JSON object; `assistant` events carry a `message.usage` object with real token counters (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) and a `message.model` field. Counters are per-call and accurate; no estimation is needed.

## Decision

Parse Claude Code local JSONL transcripts and use only the real token counters from `message.usage`. No token estimation is performed. The implementation mirrors Copilot's partial-data handling: events without a `usage` object are skipped, and sessions with no activity on the requested date are omitted. The provider is implemented on both the JS and Rust sides for parity.

## Consequences

* Real counters only — no estimation drift.
* Requires `~/.claude/projects/` to exist; the provider marks itself unavailable otherwise.
* Behaviour is consistent across JS and Rust implementations; the existing parity test harness covers both.
* The JSONL format is a local implementation detail of Claude Code and may change in future Claude Code releases.
