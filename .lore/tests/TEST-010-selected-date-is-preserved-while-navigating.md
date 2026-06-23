---
id: TEST-010
title: Selected date is preserved while navigating
status: Accepted
related_requirements:
  - FEATURE-003
  - REQ-007
related_adrs: []
related_stories: []
related_tests: []
---

# TEST-010 - Selected date is preserved while navigating

## Test Case

Given the selected date is 2026-06-20
When the dashboard refreshes
Then the selected date should remain 2026-06-20
And it should not automatically return to today
