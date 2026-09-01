# Memory — Working (current task state)

> Current task context. Updated during work, cleared when task completes.

## Current state

- Branch: `system-upgrade-workflow`
- Task: Agent system upgrade — COMPLETE (Tier 1 + Tier 2 implemented, Tier 3 deferred)
- Status: All implemented changes evidence-gated against Adversary scenarios 1–10

## Completed this session

- T1.4: `scripts/gen-skills-index.js` + `.agents/skills-index.json` (31 skills, drift-gated)
- T2.4: `scripts/skill-router.js` (ranked disambiguation, top-3, deterministic pick)
- T2.1: `scripts/verify-gate.js` (proportional completion gate, evidence-cited)
- T2.5: `memory/` layer (facts.md with citations, working.md, episodes/)
- Config-under-test: `test/commands.test.js` + `test/agents.test.js` (3/3 each)
- Agent-system acceptance: `test/agent-system.test.js` (10/10 Adversary scenarios)
- Updated `/test` command to reference verify-gate
- Wired new suites into `test/verify.js` (suites 15-17) and `package.json`

## Deferred (Tier 3)

- T3.1 Self-verifying loop (requires hook runtime)
- T3.2 Capability collapse (reduce to project verbs)
- T3.3 Capability graph / typed dispatch (DAG orchestrator)
- T3.4 Telemetry + sleep (optional, de-scoped)
- T2.3 Conditional PostGIS MCP (requires MCP runtime)
