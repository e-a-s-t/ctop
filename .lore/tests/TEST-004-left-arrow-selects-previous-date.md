---
id: TEST-004
title: Left arrow selects previous date
status: Accepted
related_requirements:
  - FEATURE-003
related_adrs: []
related_stories: []
related_tests: []
---

# TEST-004 - Left arrow selects previous date

## Test Case

Given the dashboard is showing `2026-06-23`  
When the user presses Left Arrow  
Then the selected date should become `2026-06-22`
