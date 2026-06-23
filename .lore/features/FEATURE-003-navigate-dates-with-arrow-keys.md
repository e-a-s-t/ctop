---
id: FEATURE-003
title: Navigate dates with arrow keys
status: Accepted
related_requirements: []
related_adrs: []
related_stories: []
related_tests: []
---

# FEATURE-003 - Navigate dates with arrow keys

## Feature

The dashboard should support changing the selected date using the left and right arrow keys.

- Left arrow: move to previous date
- Right arrow: move to next date
- Pressing `t` returns the selected date to today.

The selected date should control which sessions are shown.
Instead of showing sessions from the last 24 hours, the dashboard should show sessions that were active during the selected date.
