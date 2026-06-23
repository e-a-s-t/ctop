---
id: REQ-008
title: Handle date navigation edge cases
status: Accepted
related_requirements:
  - FEATURE-003
related_adrs: []
related_stories: []
related_tests: []
---

# REQ-008 - Handle date navigation edge cases

## Requirement

The dashboard shall handle dates without session data in a predictable way.

## Acceptance Criteria

- The user can navigate to dates with no session data.
- Empty dates show a clear empty state instead of an error.
- Navigating to future dates is allowed but shows no sessions unless data exists.
- Pressing `t` returns the selected date to today.
