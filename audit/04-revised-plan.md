# REVISED PLAN — Architect v2, reconciled against Adversary

> Agent 2 revision. Inputs: `02-plan.md` + `03-adversary.md`. Every Adversary charge is answered; the plan is re-staged for a solo operator and made concretely implementable + measurable against the 10 acceptance scenarios.

---

## 0. PRINCIPLES ADOPTED FROM THE ADVERSARY

1. **Delete beats index.** Where a thing is dead weight, remove it; only index what survives.
2. **Generated, drift-gated, never static-doc.** Every derived artifact ships with a *regenerator* and a *drift test* that fails when it diverges from source.
3. **Proportional verification.** Fast path for trivial edits; full gate only where it matters.
4. **Config under test, in the repo.** `kilo.jsonc`, commands, agents, memory live in the repo and are CI-checked.
5. **Fail-paths and graceful degradation are first-class**, not afterthoughts.
6. **Real acceptance scenarios**, not an empty harness.

---

## 1. REVISED GAP LIST (unchanged G1–G9, plus two new)

- **G10 — No fail-path contract.** Nothing reports "I tried X, it failed with Y, here's the partial artifact." (Adversary §3.)
- **G11 — Config lives in global untracked state.** `~/.config/kilo/kilo.jsonc` + agents are not versioned/tested/reversible. (Adversary §3.)

---

## 2. REVISED THREE-TIER PLAN (re-ordered for a solo operator)

### TIER 1 — table-stakes, all proportionate, all testable

- **T1.0 Dedupe with provenance + safe apply (was T1.1, strengthened).** First `grep` the repo for references to `.gemini/skills` and `skills1.zip`. Then a `doctor` script *lists* duplicates/stale/epoch artifacts with a per-item recommended action and a `--apply` that refuses to remove anything still referenced. Ships as `scripts/skills-doctor.js` with a unit test. **Answers Adversary §4 ("deleting will break e970215") and scenario 6.**
- **T1.1 Drift-gated `CONTEXT.md` (was T1.3, made generated).** A generator `scripts/gen-context.js` derives `CONTEXT.md` from the repo (reads `data.js` SOURCES/LISTINGS, `server/` routes, `package.json` scripts, `audit/SYSTEM_MODEL.md`), and a drift test `test/context.test.js` fails when `CONTEXT.md` is stale vs. source. `AGENTS.md` `@`-includes it. **Answers §1 (rotting doc) and scenario 4.**
- **T1.2 Commands under test (was T1.2).** `.kilo/command/` for `/scrape`, `/refresh-data`, `/test`, `/review`, `/research`. Each references only existing npm scripts/skills; a `test/commands.test.js` asserts every command references an existing script/skill. **Answers scenario 5 (config-under-test).**
- **T1.3 Agents as scoped files (was T1.4), mirrored into the repo.** `.kilo/agent/` for `scraper-engineer`, `reviewer`, `qa-engineer`, each with scoped permissions; a `test/agents.test.js` asserts each references existing skills and its permission map is well-formed. **Answers scenario 5.**
- **T1.4 Capability index + `doctor` (was T1.5) — bounded to the *surviving* root only.** Index the canonical skill root into `skills-index.json` with `name/trigger/depends_on/freshness`; `doctor` flags duplicate/shadowed/stale. **Answers scenario 6; scoped so it indexes a root we've already slimmed.**

### TIER 2 — recognized-as-right, still solo-affordable

- **T2.1 Proportional completion gate (was T2.2, now proportional).** A `Stop` hook that (a) for trivial changes runs the fast unit suite, (b) for scraper/runtime changes runs scraper+unit, (c) for schema changes runs sync/db drift, and (d) refuses "done" without a citation block. Explicit fast-path so it won't be disabled. **Answers §1 + scenarios 2 and 3.**
- **T2.2 Golden acceptance scenarios (was T2.5, now filled with content).** `audit/scenarios/` contains the 10 Adversary scenarios as runnable checks. Each Tier-1 item is *kept only if it passes its scenario(s)*, else reverted. **Answers §2 ("shape without content") + scenario set.**
- **T2.3 PostGIS MCP — *conditional*, optional, with an in-memory fallback (was T2.1).** Register a Postgres MCP but gate it on `DATABASE_URL` being set; when unset (Base44 dev loop), the agent uses the in-memory provider and skips MCP cleanly. **Answers §4 ("MCP PostGIS will never start") + scenario 10.**
- **T2.4 Ranked disambiguation (unchanged).** Grow the index into a scored matcher: "these N candidates match, top-3 ranked" with explicit ask. **Answers scenario 1.**
- **T2.5 Layered memory with provenance (was T2.3).** `memory/` dir: `facts.md` (invariants/decisions), `episodes/` (session digests), `working.md`; every memory entry *cites the source file it came from*. **Answers scenario 9.**

### TIER 3 — changes what the system is (≥3, retained + tightened)

- **T3.1 Self-verifying loop** — the T2.1 gate binds to the T2.2 scenario harness; "nothing kept without evidence" becomes mechanical. **Answers §3 (QA fail-path) indirectly + scenario 3.**
- **T3.2 Project-native capability collapse** — *pulled earlier in spirit*: instead of a foggy late-stage rewrite, the surviving skill set is reduced to the project's real verbs (scrape → normalize → score → publish). **Answers §1 ("conservative"): deletion is now front-loaded.**
- **T3.3 Capability graph / typed dispatch.** Typed input/output/dep schema; deterministic parallel composition. **Unchanged.**
- **T3.4 Telemetry + sleep** — *deferred and de-scoped*: reduced to a single optional "record skill outcome to memory" hook, no second system. **Answers §4 ("second system no one runs").**

---

## 3. REVISED IMPLEMENTATION SEQUENCE (leverage order, each step evidence-gated)

1. `T1.0` dedupe-with-provenance (`scripts/skills-doctor.js` + grep first) — **scenario 6**
2. `T1.1` generated + drift-gated `CONTEXT.md` — **scenario 4**
3. `T1.2` + `T1.3` commands + agents under test — **scenario 5**
4. `T1.4` slimmed capability index + doctor — **scenarios 1, 6**
5. `T2.1` proportional completion gate — **scenarios 2, 3**
6. `T2.2` golden scenario harness (the 10) — **gates all prior**
7. `T2.3` conditional PostGIS MCP — **scenario 10**
8. `T2.4` ranked disambiguation — **scenario 1**
9. `T2.5` provenance memory — **scenario 9**
10. `T3.x` loop / collapse / graph — **scenarios 3, 8**

**Rule for every step:** a change is *kept only when it produces actual output* (a passing test, a grep-verified result, a generated file diff) measured against its scenario; anything that fails is reverted, not argued for.