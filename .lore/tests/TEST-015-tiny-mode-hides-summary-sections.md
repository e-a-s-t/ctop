---
id: TEST-015
title: Tiny mode hides summary sections
status: Accepted
related_requirements:
  - FEATURE-004
  - REQ-011
related_adrs: []
related_stories: []
related_tests: []
---

# TEST-015 - Tiny mode hides summary sections

## Test Case

Given Tiny mode is enabled
When the dashboard is rendered
Then summary sections shall not be displayed
And one row shall be shown for each session
