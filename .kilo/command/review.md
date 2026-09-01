---
description: Review changes since a fixed point along Standards and Spec axes, reporting pass/fail with evidence.
---

# /review

Review the current working-tree changes (or `--since <ref>` from $ARGUMENTS) along two axes:

1. **Standards** — does the code follow the repo's documented conventions (see `@CONTEXT.md` invariants)?
2. **Spec** — does it match what the originating task/spec asked for?

Reference the `code-review` skill. Every finding cites a file:line and a rule, not an opinion.

Related gates: `npm run test:canonical`, `test/sync.test.js`, `test/context.test.js`, `test/skills-doctor.test.js`.