---
id: REQ-004
title: Claude data sources
status: Draft
related_requirements:
  - FEATURE-002
  - REQ-002
related_adrs:
  - ADR-002
related_stories:
  - STORY-003
related_tests:
  - TEST-003
---

# REQ-004 - Claude data sources

## Requirement

* The system shall support Claude Code session transcripts (`~/.claude/projects/**/*.jsonl`) as a data source.
* The system shall use only real token counters from `message.usage`; no estimation shall be performed.
* The system shall expose the provider under the short tag `CC`.
* The system shall skip sessions that have no activity on the requested date.
