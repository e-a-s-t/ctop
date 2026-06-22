---
id: FEATURE-001
title: Rewrite providers from Node to Rust
status: Draft
related_requirements: []
related_adrs: []
related_stories: []
related_tests: []
---

# FEATURE-001 - Rewrite providers from Node to Rust

## Feature

Rewrite the provider layer from Node.js to Rust while keeping the existing ctop user experience and output behavior stable.

The Rust provider implementation should read the same source data as the current Node.js providers, normalize it into the existing internal usage model, and preserve current calculations for tokens, credits, sessions, provider splits, and date/range summaries.

The goal is to improve performance, startup time, maintainability, and long-term portability without changing how users interact with ctop.

## Scope

- Rewrite Codex provider parsing in Rust.
- Rewrite GitHub Copilot provider parsing in Rust.
- Preserve current CLI behavior and dashboard rendering.
- Preserve current pricing and credit calculation semantics.
- Keep existing tests as regression coverage.
- Add Rust-side tests for provider parsing and normalization.

## Out of Scope

- Redesigning the dashboard UI.
- Changing credit formulas.
- Changing pricing file format.
- Adding new providers.
- Changing install/distribution strategy unless required by the Rust rewrite.
