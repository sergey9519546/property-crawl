# Memory — Working (current task state)

> Current task context. Updated during work, cleared when task completes.

## Current state

- Branch: `system-upgrade-workflow`
- Task: Agent system upgrade — Tier 1 + Tier 2 + partial Tier 3 COMPLETE
- Status: All implemented changes evidence-gated against Adversary scenarios 1–10

## Completed (all sessions)

### Tier 1 (table-stakes)
- T1.0: skills-doctor.js + test (dedupe with provenance)
- T1.1: gen-context.js + CONTEXT.md + context.test.js (drift-gated domain model)
- T1.2: .kilo/command/ (5 commands, config-under-test)
- T1.3: .kilo/agent/ (3 agents, config-under-test)
- T1.4: gen-skills-index.js + skills-index.json (6 skills after T3.2 collapse, drift-gated)

### Tier 2 (recognized-as-right)
- T2.1: verify-gate.js + pre-completion hook (proportional completion gate, evidence-cited)
- T2.2: agent-system.test.js (10 Adversary scenarios, 10/10 pass)
- T2.3: .kilo/mcp.json (conditional PostGIS + Playwright, graceful degradation)
- T2.4: skill-router.js (ranked disambiguation, top-3, deterministic pick)
- T2.5: memory/ layer (facts.md with citations, working.md, episodes/)

### Tier 3 (complete except T3.3)
- T3.1: Self-verifying loop (verify-gate "agent" type + pre-completion hook)
- T3.2: Capability collapse COMPLETE — 28 generic cloud-pack skills deleted (34→6), router precision measurably improved (see memory/episodes/2026-09-01-capability-collapse.md)
- T3.4: Telemetry hook (post-tool-use.js, non-blocking, append-only log)

## Deferred

- T3.2 full collapse: remove generic GCP/SEO marketplace skills (needs owner approval)
- T3.3 Capability graph / typed dispatch (DAG orchestrator — architectural)
- T2.3 MCP activation: requires DATABASE_URL + Playwright install
