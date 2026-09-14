# Agent swarm gap analysis — 2026-09-13

Comparison of the claude-flow swarm coordination model against what `property-crawl`
actually ships. Evidence-based; file:line refs throughout. Companion work on the
runtime layer lives in `scripts/swarm/` (config, memory-store, agent-registry) and is
**not** modified by this report.

---

## 1. Executive summary

The repo has strong **completion discipline** (evidence-gated verify-gate, CONTEXT
drift tests, capability-graph DAG, scraper circuit breakers, discovery lease
fencing, citation-only memory) but almost none of the **swarm runtime**: no task
queue, no orchestrator process, no work-stealing, no monitoring CLI, no agent-level
retry/timeout, and no queryable memory API. The three existing `.kilo/agent/*.md`
files are role prompts, not runtimes. **Recommendation: ship a thin `scripts/swarm/`
layer that reuses capability-graph + verify-gate + skill-router rather than
replacing them, and keep enterprise multi-tenant features out of scope.**

---

## 2. Capability matrix

Legend: ✅ present and usable · 🟡 partial / adjacent · ❌ absent

| Claude-Flow Feature | Repo Status | What exists | Gap / Action |
|---|---|---|---|
| Strategy: `auto` | 🟡 | `scripts/skill-router.js` does ranked skill disambiguation; `scripts/swarm/config.js:21-27` declares `auto` | Wire router → strategy pick in orchestrator |
| Strategy: `development` | 🟡 | Declared `scripts/swarm/config.js:28-33`; `.kilo/agent/scraper-engineer.md` + `developer.md` playbooks | No runtime that executes the phase plan |
| Strategy: `research` | 🟡 | Declared `config.js:34-39`; `researcher`/`analyzer`/`documenter` playbooks added | Same — config only |
| Strategy: `analysis` | 🟡 | Declared `config.js:40-45`; `server/intelligence/signals.js` is a real analyzer | No swarm-level analysis run |
| Strategy: `testing` | ✅-ish | `scripts/verify-gate.js` is the proportional test strategy end-to-end | Expose as a swarm strategy, do not rewrite |
| Strategy: `optimization` | 🟡 | Declared `config.js:52-57` | Needs profile→benchmark loop |
| Strategy: `maintenance` | 🟡 | Declared `config.js:58-63`; `/test` + hooks cover the verify half | Needs triage + document phases |
| Agent type: coordinator | ✅ (new) | `.kilo/agent/coordinator.md` (this change); `config.js:68-82` | No live dispatcher yet |
| Agent type: developer | ✅ (new) | `.kilo/agent/developer.md`; `config.js:83-88` | — |
| Agent type: researcher | ✅ (new) | `.kilo/agent/researcher.md`; `config.js:89-94` | — |
| Agent type: analyzer | ✅ (new) | `.kilo/agent/analyzer.md`; `config.js:95-100` | — |
| Agent type: documenter | ✅ (new) | `.kilo/agent/documenter.md`; `config.js:113-118` | — |
| Agent type: monitor | ✅ (new) | `.kilo/agent/monitor.md`; `config.js:119-124` | Needs live health polling |
| Agent type: specialist | ✅ (new) | `.kilo/agent/specialist.md`; overlaps scraper-engineer; `config.js:125-135` | Keep scraper-engineer as alias |
| Agent type: tester/reviewer | ✅ | Pre-existing `.kilo/agent/qa-engineer.md`, `reviewer.md` | Already correct |
| Coordination: centralized | 🟡 | `config.js:139-142` declares it; hooks act as a crude single gate | No coordinator process |
| Coordination: distributed | ❌ | Declared `config.js:143-146` only | Needs shared claim queue |
| Coordination: hierarchical | ❌ | Declared `config.js:147-150` only | Low priority |
| Coordination: mesh | ❌ | Declared `config.js:151-154` only | Out of scope for now |
| Coordination: hybrid | ❌ | Declared `config.js:155-158` only | Phase 2+ |
| Flag: `maxAgents` | 🟡 | `config.js:161` default 5; per-type `maxConcurrency` | Orchestrator must enforce |
| Flag: `timeout` | 🟡 | `config.js:163` default 60 min; verify-gate has per-suite `maxDuration` (`verify-gate.js:80-118`) | No agent-level timeout kill |
| Flag: `background` | ❌ | — | Needs detached worker mode |
| Flag: `monitor` | ❌ | Hooks emit telemetry (`hooks.json:9-17`) but no live view | Build `swarm monitor` |
| Flag: `parallel` | 🟡 | `capability-graph.js` computes stratified parallel stages; `config.js:165` | Orchestrator must consume stages |
| Timeout-free execution | ❌ | verify-gate kills long suites; agents can hang | Add per-task deadline |
| Checkpoint recovery | 🟡 | `test/scheduler-checkpoint.test.js` + discovery worker checkpoints exist | No agent-run checkpoint |
| Work stealing | ❌ | — | Task-queue with steal-on-idle |
| Load balancing | 🟡 | `maxConcurrency` per type only | No queue-level balancing |
| Circuit breakers (agent-level) | 🟡 | `server/scrapers/circuit-breaker.js` (network only); `server/scrapers/telemetry.js` is process-local | Wrap agent tool calls |
| Fault tolerance / retry | ❌ | No agent retry or timeout recovery | Add bounded retry + dead-letter |
| Real-time collaboration | ❌ | Agents do not share live state | Memory-store is the substrate |
| Cross-agent comms | ❌ | No channels; hooks are one-way telemetry | Queue + memory namespaces |
| Shared memory | 🟡 | `memory/facts.md`, `working.md`, `episodes/` are cited markdown; `scripts/swarm/memory-store.js` adds queryable JSON | Markdown is write-only |
| Monitoring CLI (`monitor`/`status`/`agent list`) | ❌ | No CLI | `scripts/swarm/cli.js` |
| Memory store / query / export | 🟡 | memory-store.js exists (get/set/search/export) | Wire CLI + enforce citations |
| Enterprise RBAC | ❌ | Single `SCRAPER_ADMIN_TOKEN` (see `reports/swarm-analysis-2026-09-13.md` P3.1) | Only if multi-tenant |
| Audit logging | 🟡 | `scripts/hooks/post-tool-use.js` episodic log | No tamper-evident trail |
| Encryption at rest | ❌ | — | Out of scope (P4) |
| Quality thresholds | ✅ | verify-gate refuses uncertified completion; `hooks.json:5-7` blocking Stop hook | — |
| Sched: FIFO | ❌ | — | Default for task-queue v1 |
| Sched: priority | ❌ | — | Add priority field |
| Sched: deadline | ❌ | — | P2 |
| Sched: SJF | ❌ | — | Not needed |
| Sched: critical path | ✅ | `capability-graph.js` topological stages are the critical-path substrate | Expose in orchestrator |
| Sched: resource-aware | 🟡 | `maxConcurrency` per agent type | No CPU/IO awareness |
| Sched: adaptive | ❌ | — | P3 |
| Dry-run | ✅ | `scripts/seed-from-v0.js --dry-run`; capability-graph `--plan` | Extend to swarm runs |
| Peer review | ✅ | `.kilo/agent/reviewer.md` + `/review` command + `test/agents.test.js` | — |
| Auto testing | ✅ | verify-gate + Stop hook + proportionate suites | — |

---

## 3. What we already do better

These are real, shipped advantages over a generic swarm framework. Do not replace them.

1. **Evidence-gated completion.** `scripts/verify-gate.js` classifies blast radius
   (trivial/scraper/schema/runtime/agent/full) and refuses to certify "done"
   without cited test output. The Stop hook is blocking
   (`.kilo/hooks/hooks.json:3-8`). Generic swarms declare "done" on return code.
2. **CONTEXT drift gate.** `test/context.test.js` + `scripts/gen-context.js --check`
   keep the generated `CONTEXT.md` honest. Most agent systems have no equivalent.
3. **Typed DAG, not prompt spaghetti.** `scripts/capability-graph.js` validates
   inputs/outputs, detects cycles, and emits stratified parallel stages
   (`capability-graph.js:5-9, 57-79`). This is the correct scheduling substrate.
4. **Lease fencing on discovery writes.** `server/discovery/job-fence.js:12-39`
   re-asserts the job claim before and after the evidence transaction — a lost
   lease cannot poison the store. Generic work-stealing has no equivalent.
5. **Scraper circuit breakers.** `server/scrapers/circuit-breaker.js` rejects
   403/CAPTCHA/empty payloads before they touch the DB
   (`circuit-breaker.js:8-36`). Domain-specific fault tolerance, not generic retry.
6. **Citation-only memory.** `memory/facts.md` requires every entry to name a
   source file. No hallucinated facts. The memory-store API must preserve this.
7. **Project-native skills.** `.agents/skills/` (8 skills) encode this product's
   contracts (listing camelCase, Migration 014 promotion, OCR normalization) —
   not a marketplace of generic prompts. `scripts/skill-router.js` ranks them.
8. **Proportional test gates.** verify-gate does not force full `npm test` for a
   one-line docs edit. That is the right default; keep it.

---

## 4. Critical findings

**(a) Hardcoded API key — CLOSED.**
`reports/swarm-analysis-2026-09-13.md:26-29` recorded a committed default key in
`server/intelligence/zillow-mcp.js` and `property-title.js`. `.kilo/mcp.json` now
uses `${PROPERTY_TITLE_API_KEY}` / `${ZILLOW_MCP_API_KEY}` with explicit
`disabledReason` and the comment "Never commit a key default"
(`.kilo/mcp.json:22-38`). Treat as closed; do not re-introduce defaults.

**(b) The 3 existing agent files are prompts, not runtimes.**
`.kilo/agent/{scraper-engineer,reviewer,qa-engineer}.md` are 14–18 line role
prompts with permission blocks. Nothing in the repo loads them into a running
process. `scripts/swarm/agent-registry.js:17-21` maps only those three filenames
onto types — the seven roles added today need that map extended (owned by the
parallel swarm work, not this change).

**(c) `memory/` is write-only markdown.**
`memory/facts.md` and `memory/working.md` are human-curated. There is no query
API, no export, no namespace isolation. `scripts/swarm/memory-store.js` is the
intended fix (atomic JSON + episode snapshots under `memory/episodes/`).

**(d) No agent-level retry / timeout / circuit-breaker.**
Scraper breakers protect network calls. An agent that hangs in `bash` has no
deadline. `config.js:163` declares `timeoutMinutes: 60` but nothing enforces it.

**(e) capability-graph exists but nothing calls it at runtime.**
`scripts/capability-graph.js` is fully tested (`test/capability-graph.test.js`)
and supports `--plan=<product>`. No orchestrator, hook, or npm script consumes
the plan. It is a library waiting for a caller.

---

## 5. Recommended architecture

A thin `scripts/swarm/` layer, already in progress. Node builtins only — no new
npm deps.

| Module | Role | Status |
|---|---|---|
| `scripts/swarm/config.js` | Frozen strategies, agent types, coordination modes, defaults | exists |
| `scripts/swarm/memory-store.js` | Queryable JSON memory + episode snapshots + export | exists |
| `scripts/swarm/agent-registry.js` | Loads types + attaches `.kilo/agent/*.md` playbooks | exists (map needs the 7 new files) |
| `scripts/swarm/task-queue.js` | Priority FIFO with claim/complete/fail, steal-on-idle | to build |
| `scripts/swarm/orchestrator.js` | Compiles capability-graph plan → tasks, enforces maxAgents/timeout, retry | to build |
| `scripts/swarm/cli.js` | `swarm run`, `swarm status`, `swarm monitor`, `swarm agent list` | to build |

**Reuse, do not replace:**
- `capability-graph.js` → stage compilation and parallelism.
- `verify-gate.js` → every task's completion contract (the `testing` strategy is
  already this).
- `skill-router.js` → `auto` strategy routing.
- `server/scrapers/circuit-breaker.js` + `server/discovery/job-fence.js` → stay
  the domain fault-tolerance primitives; the swarm calls them, does not fork them.

---

## 6. Boundary-pushing ideas (domain-grounded)

1. **Source-canary swarm.** The release bottleneck is sequential canaries
   (`reports/swarm-analysis-2026-09-13.md` P1 table). A `canary` strategy runs
   USDA/HUD/IRS/Treasury/GSA canaries **in parallel**, each behind its own
   circuit breaker and the existing lease fence (`job-fence.js:12-39`), with the
   Migration 014 two-clean-run contract (`server/discovery/store.js:99`) as the
   completion predicate. One source failing does not stall the others.
2. **Evidence-chain agent.** An agent whose only job is to verify every
   completion claim cites `file:line` + test output, using the verify-gate
   contract. It is the machine-checkable form of `memory/facts.md`'s citation rule.
3. **Adversarial reviewer.** Extends `.kilo/agent/reviewer.md` to actively hunt
   XSS/injection/provenance holes using the existing adversary patterns (`esc()`
   invariant, Puter.js leakage, fabricated Unsplash images — see swarm-analysis
   P2.8 and P3.3).
4. **Memory-as-citations.** Every memory-store write requires a `source` path.
   Reject uncited facts at the API boundary, matching the `facts.md` header rule.
5. **Swarm replay.** Persist a full run report (tasks, claims, gate outputs) so a
   failed release step can replay from the last good phase instead of restarting.
6. **Domain specialist roster.** Prefer product-named roles over generic ones:
   source-gate engineer, evidence auditor, underwriting reviewer, media-policy
   checker. `specialist.md` starts this; grow the roster only when a real phase
   needs it.
7. **Watchdog monitor.** `monitor.md` polls `discovery-worker-health` and
   readiness endpoints; when a source goes stale it files a swarm task (canary or
   triage) instead of waiting for a human to notice.

---

## 7. Phased roadmap

| Phase | Scope | Gate |
|---|---|---|
| **P0** | Security hygiene — hardcoded key rotation, no key defaults in mcp.json | ✅ done (finding 4a) |
| **P1** | Swarm runtime: task-queue, orchestrator, CLI (`run`/`status`/`agent list`); enforce maxAgents + timeout; agent-registry maps all 10 playbooks | Orchestrator can execute one `development` strategy end-to-end through verify-gate |
| **P2** | Domain strategies: `canary` parallel swarm, `auto` via skill-router, swarm replay | USDA/HUD/IRS canaries run in parallel without cross-source stall |
| **P3** | Monitor/watchdog: live health poll, staleness → task filing, `swarm monitor` | A stalled source auto-files a triage task |
| **P4** | Encryption / RBAC / tamper-evident audit — **only if** multi-tenant | Do not start otherwise |

---

## 8. Out of scope

- Do **not** build a generic multi-tenant SaaS orchestrator.
- Do **not** add npm dependencies; Node builtins only.
- Do **not** replace `scripts/verify-gate.js` — it is the completion contract.
- Do **not** fork the scraper circuit-breaker or discovery lease-fence into the
  swarm layer; call them.
- Do **not** implement mesh coordination or adaptive scheduling until P1 is
  proven on real canary runs.

---

## Doc vs code contradictions found during this review

1. `reports/swarm-analysis-2026-09-13.md:54-58` says verify-gate full timeout is
   120s and will always fail. Current `scripts/verify-gate.js:117` is
   `1_800_000` (30 min). The report is stale on this point.
2. `scripts/swarm/agent-registry.js:17-21` only maps 3 playbooks. The swarm
   `config.js` already declares 9 agent types. After this change `.kilo/agent/`
   has 10 markdown roles — the registry map is now the bottleneck (owned by the
   parallel swarm work).
3. `scripts/swarm/config.js:80` gives coordinator `edit: 'scripts/**'`; this
   report's `coordinator.md` sets `edit: deny`. Prefer the stricter playbook
   permission and align config later — a coordinator that edits code is a
   reviewer by another name.
4. `memory/facts.md:41` still says "3 agents". Updated by this change to 10.
