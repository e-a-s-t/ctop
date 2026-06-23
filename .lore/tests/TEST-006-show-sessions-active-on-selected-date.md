---
id: TEST-006
title: Show sessions active on selected date
status: Accepted
related_requirements:
  - FEATURE-003
  - REQ-006
related_adrs: []
related_stories: []
related_tests: []
---

# TEST-006 - Show sessions active on selected date

## Test Case

Given a session started before midnight and ended after midnight  
When the selected date is either affected date  
Then the session should be included in the dashboard
