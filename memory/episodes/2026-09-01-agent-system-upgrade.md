# Episode — 2026-09-01 Agent System Upgrade Implementation

**Date**: 2026-09-01
**Branch**: system-upgrade-workflow
**Task**: Implement remaining revised-plan items with evidence against Adversary scenarios

## What was done

1. Verified existing three-agent artifacts (01-audit through 04-revised-plan) are sound.
2. Identified critical gap: `test/adversary.test.js` tested domain features (liens, OCR, parsing), NOT the actual Adversary's 10 agent-system scenarios (routing, verification, memory, config-under-test).
3. Implemented T1.4: `scripts/gen-skills-index.js` + `.agents/skills-index.json` (31 skills indexed, drift-gated).
4. Implemented T2.4: `scripts/skill-router.js` (ranked disambiguation, top-3 candidates, deterministic pick when dominant).
5. Implemented T2.1: `scripts/verify-gate.js` (proportional completion gate, change-type classification, evidence-cited completion block).
6. Implemented T2.5: `memory/` layer (facts.md with source citations, working.md, episodes/).
7. Created `test/commands.test.js` + `test/agents.test.js` (config-under-test, scenario 5).
8. Created `test/agent-system.test.js` (all 10 actual Adversary scenarios, 10/10 pass).
9. Wired new suites into `test/verify.js` (suites 15-17) and `package.json` scripts.

## What passed

- Agent-system scenarios 1-10: 10/10 pass
- Commands config-under-test: 3/3 pass
- Agents config-under-test: 3/3 pass
- Skills index: generated, drift-gated, 31 skills
- Skill router: deterministic pick for precise queries, honest "no match" for irrelevant queries
- Verify gate: proportional classification (trivial/scraper/schema/runtime), evidence-cited completion
- Full verify suite: 14/17 pass (3 pre-existing failures require node_modules/next, unrelated to agent system)

## What failed and was fixed

- commands.test.js regex captured trailing backticks → fixed to `[\w:-]+`
- agents.test.js didn't handle nested path-based permissions → fixed to allow empty-string values

## What's next

- T3.x (self-verifying loop, capability collapse, graph, telemetry) — requires framework-level hook integration
- Conditional PostGIS MCP (T2.3) — needs MCP runtime support
