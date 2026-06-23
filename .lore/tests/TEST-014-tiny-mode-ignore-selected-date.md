---
id: TEST-014
title: Tiny mode ignore selected date
status: Accepted
related_requirements:
  - FEATURE-004
  - REQ-010
related_adrs: []
related_stories: []
related_tests: []
---

# TEST-014 - Tiny mode ignore selected date

## Test Case

Given the selected date is 2026-06-15
When Tiny mode is enabled
Then sessions active today shall be displayed
And sessions from 2026-06-15 shall not be displayed
