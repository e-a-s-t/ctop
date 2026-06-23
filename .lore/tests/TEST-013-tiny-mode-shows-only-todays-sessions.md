---
id: TEST-013
title: Tiny mode shows only today's sessions
status: Accepted
related_requirements:
  - FEATURE-004
  - REQ-010
related_adrs: []
related_stories: []
related_tests: []
---

# TEST-013 - Tiny mode shows only today's sessions

## Test Case

Given sessions exist on multiple dates
When Tiny mode is enabled
Then only sessions active today shall be displayed
