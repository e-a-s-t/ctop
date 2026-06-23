---
id: ADR-003
title: Use selected date instead of rolling 24 hour window
status: Accepted
related_requirements:
  - FEATURE-003
related_adrs: []
related_stories: []
related_tests: []
---

# ADR-00X - Use selected date instead of rolling 24 hour window

## Context

The dashboard currently shows sessions based on a rolling time window.
This makes date navigation unclear because the visible sessions depend on the current time rather than the selected date.

## Decision

The dashboard shall use an explicit selected date as the primary filter for active sessions.
A session is included when it was active during the selected date.
Date navigation shall not be bounded by existing session data. 
Dates without data shall render an empty state. 
The `t` key shall act as a shortcut back to today.

## Consequences

- Date navigation becomes predictable.
- Left and right arrow keys can move between full calendar dates.
- The dashboard no longer depends on a rolling last-24-hours view.
