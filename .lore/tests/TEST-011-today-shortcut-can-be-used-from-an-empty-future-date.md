---
id: TEST-011
title: Today shortcut can be used from an empty future date
status: Accepted
related_requirements:
  - FEATURE-003
  - REQ-008
related_adrs: []
related_stories: []
related_tests: []
---

# TEST-011 - Today shortcut can be used from an empty future date

## Test Case

Given the selected date is a future date with no sessions
When the user presses `t`
Then the selected date should become today
And the dashboard should display today's sessions
