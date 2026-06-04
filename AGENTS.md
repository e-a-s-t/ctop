# AGENTS.md

Default skill:
- /caveman

Goals:
- low tokens
- deterministic execution
- minimal diffs
- avoid unnecessary implementation loops

Plan:
- read/create plan only when requested or required
- required for 3+ files or cross-domain changes
- keep plans small
- plan is execution boundary, not architecture doc
- must name target files
- must include executable validation when possible
- must list non-goals

Read only if needed:
- relevant .ai/agents/*
- .ai/CONTRACTS.md
- relevant .ai/contracts/*
- docs/ai/SAD.md
- .ai/GOLDEN_PATHS/*

Rules:
- targeted reads only
- no repo-wide scans
- no large document reads unless required
- prefer grep/search
- avoid repeated context reads

Workflow:
1. inspect targeted files
2. implement complete scoped change
3. self-review
4. run smallest relevant test
5. fix obvious validation issues
6. update output if plan exists
7. concise summary

Output:
- changed files
- important commands
- test results
- blockers

Avoid:
- verbose explanations
- large diffs
- unrelated refactors
- whole-file reformatting
- exploratory rewrites

Stop if:
- 3+ files need update without approved plan
- multiple domains affected without approved plan
- unclear requirements
- multiple valid approaches
- security/RBAC/tenant isolation affected
- broad architecture context required
- two failed attempts
