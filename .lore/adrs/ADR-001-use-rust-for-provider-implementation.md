---
id: ADR-001
title: Use Rust for provider implementation
status: Draft
related_requirements:
  - FEATURE-001
related_adrs: []
related_stories: []
related_tests: []
---

# ADR-001 - Use Rust for provider implementation

## Context

Provider parsing currently runs in Node.js and may become a bottleneck as more providers are added.

## Decision

Implement providers in Rust and expose them to the JavaScript CLI.

## Consequences

* Improved performance.
* Better type safety.
* Additional Rust toolchain dependency.
