---
id: TEST-003
title: Claude parity
status: Draft
related_requirements:
  - FEATURE-002
  - REQ-004
related_adrs:
  - ADR-002
related_stories:
  - STORY-003
related_tests:
  - TEST-002
---

# TEST-003 - Claude parity

## Test Case

Given identical Claude Code JSONL transcript data (one or more `assistant` events with `message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}` and `message.model`),

When usage is collected for a given date by both the JS provider (`bin/providers/claude.js`) and the Rust provider (`ctop-rs/src/provider/claude.rs`),

Then both providers shall produce the same normalised session output: matching token counts, model name, and provider tag `CC`.
