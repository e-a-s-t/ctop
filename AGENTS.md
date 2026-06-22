# AGENTS.md

Default skill:

* /caveman

## Goals:

* low tokens
* deterministic execution
* minimal diffs
* avoid unnecessary implementation loops

Lore:

* use Lore as the source of truth
* prefer Feature artifacts as execution boundaries
* inspect only artifacts relevant to the current task
* prefer:

  ```sh
  lore show <ID> --recursive
  ```

* prefer:

  ```sh
  lore search <text>
  ```

  over repository scans

* do not read `.lore/` files directly unless Lore commands are unavailable
* do not invent requirements, tests or ADRs
* follow linked artifacts
* update Lore artifacts when requirements or design change

## Planning:

* read/create plans only when requested or required
* required for:
  * 3+ files
  * cross-domain changes
  * multiple valid approaches
* keep plans small
* plans are execution boundaries, not architecture documents
* plans must name target files
* plans should include executable validation
* plans should list non-goals

## Feature workflow:

1. identify target Feature
2. inspect:

   ```sh
   lore show FEATURE-XXX --recursive
   ```

3. follow linked REQ, ADR, STORY and TEST artifacts
4. implement complete scoped change
5. self-review
6. run smallest relevant validation
7. update Lore artifacts if needed
8. concise summary

### Artifact roles:

* FEATURE: execution boundary
* REQ: behavior
* ADR: architectural decisions
* STORY: user intent
* TEST: expected outcome

## Read only if needed:

* relevant docs/*
* targeted source files

## Rules:

* targeted reads only
* no repo-wide scans
* no large document reads unless required
* prefer grep/search
* avoid repeated context reads
* avoid rereading files unnecessarily

## Workflow:

1. inspect targeted files
2. implement complete scoped change
3. self-review
4. run smallest relevant test
5. fix obvious validation issues
6. update output if plan exists
7. concise summary

## Validation:

Prefer the smallest relevant commands.

Examples:

```sh
cargo test
cargo fmt
npm test
go test ./...
lore validate
```

## Output:

* changed files
* important commands
* test results
* blockers

Avoid:

* verbose explanations
* large diffs
* unrelated refactors
* whole-file reformatting
* exploratory rewrites
* speculative architecture changes

## Stop if:

* 3+ files need update without approved plan
* multiple domains are affected without approved plan
* unclear requirements
* multiple valid approaches exist without ADR guidance
* security, RBAC or tenant isolation is affected
* broad architecture context is required
* two failed attempts occur
* no Feature exists for the requested work

## Prefer:

* FEATURE-* as entry point
* targeted reads
* small diffs
* existing tests
* deterministic execution

## Planning flow:

User request:

```text
Plan FEATURE-001
```

Expected first action:

```sh
lore show FEATURE-001 --recursive
```

Planning output must include:

* short implementation plan
* target files
* validation commands
* non-goals
* blockers or questions, if any

No implementation is done during planning.

## Implementation flow:

User request:

```text
Implement approved plan for FEATURE-001
```

Expected first action:

* read the approved plan
* inspect only target files from the plan
* implement the scoped change
* run the validation commands from the plan
* summarize changed files, commands and test results

Do not implement a Feature before a plan exists when planning is required.
