# Episode — 2026-09-01 Agent System Upgrade — Phase 3 (hooks, MCP, skills)

**Date**: 2026-09-01
**Branch**: system-upgrade-workflow
**Task**: Implement remaining fixes and improvements from the audit

## What was done

1. **Completion gate hook** (T2.1/T3.1): Created `.kilo/hooks/hooks.json` with a blocking `Stop` event hook and `scripts/hooks/pre-completion.js` that runs the proportional verify-gate. "Verify before done" is now mechanical, not advisory.

2. **Self-verifying loop** (T3.1): Added "agent" change type to `verify-gate.js` — changes to `.kilo/`, `.agents/`, `memory/`, or hooks trigger the agent-system acceptance tests + drift gates. The pre-completion hook uses this classification.

3. **Conditional MCP** (T2.3): Created `.kilo/mcp.json` with PostGIS and Playwright MCP server definitions. Both are `disabled: true` with `disabledReason` documenting why (no DATABASE_URL, no Playwright). A `gracefulDegradation` section maps each server to its fallback.

4. **Capability collapse** (T3.2): Created 3 project-native skills: `listing-normalization` (canonical listing contract), `deal-scoring` (formula + SCORE_BANDS + worked example), `agent-verification` (proportional gate + evidence-cited completion + drift gates). Skills index regenerated (34 skills).

5. **Telemetry hook** (T3.4): Created `scripts/hooks/post-tool-use.js` — a non-blocking hook that appends to `memory/episodes/telemetry.log`. Intentionally minimal (single append-only log, not a second system).

6. **Skills-doctor fix**: Fixed bug where absent `.gemini` directory was flagged as stale bundle. Now only flags directories that actually exist.

7. **Updated tests**: Extended `test/agent-system.test.js` scenarios 2, 5, 10 to cover the new "agent" change type, hooks existence, and MCP config with graceful degradation.

## What passed

- Agent-system scenarios 1-10: 10/10 pass
- Commands config-under-test: 3/3 pass
- Agents config-under-test: 3/3 pass
- Skills doctor: 0 stale bundles (after fix)
- Pre-completion hook: certifies completion with evidence
- Agent gate: 5/5 suites pass (agent-system + commands + agents + 2 drift checks)
- Router: `deal-scoring` picked deterministically for "deal score formula"
- Full verify: 14/17 (3 pre-existing infra failures)

## What failed and was fixed

- Skills-doctor flagged absent `.gemini` → fixed `dirEmpty` check to require `fs.existsSync`
- Old test assertion expected `.kilo/command/test.md` as 'trivial' → updated to 'agent' after adding agent change type

## What's next

- T3.2 full collapse: remove generic GCP/SEO skills (needs owner approval)
- T3.3 Capability graph / typed dispatch (DAG orchestrator)
- MCP activation: set DATABASE_URL and install Playwright
