---
name: agent-verification
description: |
  Proportional verification gate, evidence-cited completion, and drift detection
  for the property-crawl agent system. Use this when the agent must verify its
  own output before claiming completion.
license: MIT
metadata:
  version: v1
  domain: agent-system
---

# Agent Verification Skill

Use this skill when the agent needs to verify its own output before claiming "done".

## Proportional Verification Gate

`scripts/verify-gate.js` classifies changes by blast radius and runs the proportionate suite:

| Change type | Detection | Gate suites | Max duration |
|---|---|---|---|
| `trivial` | docs, config, .kilo, tests | `test/suite.test.js` (fast unit) | 5s |
| `scraper` | `server/scrapers/*`, `server/ai/*` | scrapers + unit + telemetry | 30s |
| `schema` | `data.js`, `server/db/*`, `CONTEXT.md` | sync + context drift + db contract | 15s |
| `runtime` | `server/routes/*`, `server/server.js`, `src/*` | server + unit + hardening | 20s |
| `agent` | `.kilo/*`, `.agents/*`, `memory/*`, `scripts/hooks/*` | agent-system acceptance + drift gates | 30s |
| `full` | anything (pre-merge) | full `test/verify.js` (17 suites) | 120s |

**Never** block a trivial edit on the full multi-minute gate. **Never** skip
verification for a schema/scraper change.

## Evidence-Cited Completion

On finishing any task, emit a machine-readable completion block:

```
=== COMPLETION GATE ===
Change type: scraper
Gate: scraper + unit + telemetry
Suites run: 3
All passed: true

Evidence:
  node test/scrapers.test.js: PASS (exit 0, 1200ms)
  node test/suite.test.js: PASS (exit 0, 52ms)
  node test/telemetry.test.js: PASS (exit 0, 30ms)
=== END COMPLETION GATE ===
```

**Refuse to certify "done" on any failure.** Report the fail-path truthfully with
the error output, not a reassurance.

## Drift Gates

| Artifact | Generator | Drift test |
|---|---|---|
| `CONTEXT.md` | `scripts/gen-context.js` | `test/context.test.js` |
| `.agents/skills-index.json` | `scripts/gen-skills-index.js` | `test/agent-system.test.js` (scenario 1) |
| `data.js` SOURCES ↔ `src/` SOURCES | — | `test/sync.test.js` |

Any change that makes a derived artifact diverge from its source is caught
**before merge**, not after.

## Pre-Completion Hook

`.kilo/hooks/hooks.json` wires a `Stop` event hook that runs `scripts/hooks/pre-completion.js`.
This makes the proportional gate **mechanical** — the agent cannot claim completion
without the gate passing. The hook is blocking: exit 1 = completion refused.

## Adversary Acceptance Scenarios

`test/agent-system.test.js` contains 10 acceptance scenarios the upgraded system
must handle. Run with: `node --test test/agent-system.test.js`

The pre-completion hook runs these when agent-system files change.
