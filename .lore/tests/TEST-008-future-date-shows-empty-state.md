---
id: TEST-008
title: Future date shows empty state
status: Accepted
related_requirements:
  - FEATURE-003
  - REQ-008
related_adrs: []
related_stories: []
related_tests: []
---

# TEST-008 - Future date shows empty state

## Test Case

Given the selected date is after today  
When the dashboard renders  
Then it should show a clear empty state  
And it should not crash
