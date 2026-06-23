---
id: FEATURE-004
title: Toggle compact session view
status: Accepted
related_requirements: []
related_adrs: []
related_stories: []
related_tests: []
---

# FEATURE-004 - Toggle compact session view

## Feature

The dashboard shall support two display modes:

- Normal mode (default)
- Tiny mode

Pressing m shall toggle between the two modes.

Tiny mode is intended for quickly viewing active sessions today.

In Tiny mode:

- Only sessions active today shall be shown.
- Summary sections shall be hidden.
- One row shall be displayed per session.
- The output shall use a compact tabular format.

Example:

` 
TIME  PROV MODEL           TOKENS     IN    OUT  CACHE-WR  CACHE-RD   CREDIT SESSION 
09:20 CX   g5.4-mini         222k   201k    21k         0      1.8M     9.62 019e…7d49 
`
