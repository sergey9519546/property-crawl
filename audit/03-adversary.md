# ADVERSARY — Attack the Plan + 10 Acceptance Scenarios

> Agent 3 (Adversary). Produced from `02-plan.md` ONLY. Job: break it. Where is it conservative, what does it avoid, what does an unrelated-field practitioner do that it misses, what fails in practice — then 10 concrete test scenarios the upgraded system must pass that the current one cannot.

---

## 1. WHERE THE PLAN IS CONSERVATIVE

- **It keeps the marketplace sprawl.** T3.2 "collapse" is deferred to the last tier, after several upgrades already assume 650 skills still exist and merely get indexed. The plan says "ideal = not a file cabinet" but then invests three tiers in tidying the file cabinet before shrinking it. The single highest-leverage act — *delete* — is only half-committed (it deletes `.gemini` but shrinks nothing else).
- **T1.3 domain model is described as documentation.** Writing `CONTEXT.md` is exactly the kind of static doc that rots the moment the repo changes. "Auto-refreshed from the repo" is asserted but no mechanism (hook that regenerates it? test that fails on drift?) is specified. A static doc with no generator is a new staleness liability, not an asset.
- **T2.2 "completion gate" is underspecified.** "Runs the verification gate before claiming done" sounds right, but `test/verify.js` runs an 11-suite gate including `npx next build` and Playwright — potentially minutes. An every-turn hook that blocks on a multi-minute gate will be disabled within a day. There is no notion of *proportional* verification (unit-only for a one-line change; full gate before merge).

## 2. WHAT THE PLAN AVOIDS

- **It never defines the project's actual acceptance tests.** It references "the 11-suite gate" as if the correct behavior is already encoded — but the audit shows that gate is a *codebase* gate, not a specification of what "the agent did the right thing" means. The plan proposes an eval harness (T2.5) but never lists a single scenario. It's shape without content.
- **It avoids the team-of-one reality.** There is one owner. The plan's ideal (capability graph, telemetry feedback loop, MCP PostGIS) is a *platform team's* architecture. For a solo dev, several proposed pieces have negative ROI and will decay unmaintained. The plan does not stage by "what a solo dev will actually keep running."
- **It avoids cost/latency.** The audit shows the default model is `gpt-5.3-codex-spark` with a free small model and `nemotron-120b:free` agent. Adding heavy hooks, MCP round-trips, and telemetry on top of free-tier inference will hit rate limits and bloat latency. Nothing in the plan accounts for that.

## 3. WHAT AN UNRELATED-FIELD PRACTITIONER DOES THAT THIS MISSES

- **A QA engineer asks "what's the fail path?"** The plan only adds happy-path scaffolding. None of it says what happens when a skill errors, a hook times out, memory corrupts, or a scraped source 404s. An upgraded system that can't report "I tried X, it failed with Y, here's the artifact" is not actually more reliable.
- **An SRE treats the agent as a deployable.** They'd insist the agent's config itself be versioned, tested in CI, and roll-back-able — i.e., that `kilo.jsonc`, commands, agents, and memory are in the repo under test, not just living in `~/.config`. The plan edits global config as if it's untracked state.
- **A data engineer formalizes the schema boundary.** The project already has a drift test (`test/sync.test.js` failing on v0↔v2 SOURCES drift). A data engineer would generalize that pattern: *every* derived artifact (CONTEXT.md, skill index, scenario list) gets a drift test that fails when the artifact diverges from its source. The plan adds artifacts but not the drift tests that keep them honest.

## 4. WHAT WILL FAIL IN PRACTICE

- **The completion-gate hook will be disabled** (see §1) unless it's proportional and fast.
- **`CONTEXT.md` will rot** within days of the next `data.js` change because nothing regenerates it.
- **MCP PostGIS will never start** — `DATABASE_URL` is unset in the Base44 dev loop (in-memory provider), so there is no live Postgres to connect to in the environment where the agent actually runs.
- **Deleting `.gemini/skills`** will break whatever `e970215` scaffolding expected it, unless the plan first greps for references (it doesn't; it just says "delete").
- **The skill index will be stale on arrival** because ~650 skills have no stable identity to index against and no freshness signal.
- **Telemetry/sleep is a second system** no one will run; it's a Tier-3 item promised with no trigger.

---

## 5. TEN ACCEPTANCE SCENARIOS (the upgraded system must handle; current cannot)

1. **Deterministic routing under ambiguity.** Given "audit my site", the system names *exactly one* candidate (or asks with ≤3 ranked options) and *justifies the choice with a ranked top-3 list* — the current system matches 5+ skills with equal weight.

2. **Proportional verification.** For a one-line doc/typo change it runs a sub-second check; for a scraper/runtime change it runs the scraper+unit gate; for a schema change it runs the sync/db drift gate. It never blocks a trivial edit on the full multi-minute `next build`+Playwright gate. The current system runs nothing before claiming "done".

3. **Evidence-cited completion.** On finishing *any* task, the system emits a machine-readable completion block (what ran, pass/fail, artifact path or exit code). The current system asserts completion with no citation.

4. **Drift-gated domain model.** After `data.js` adds/removes a `SOURCE`, the `CONTEXT.md` (or equivalent index) is flagged stale by a runnable test, and regeneration is one command — the current system has no domain model at all, so this scenario is undefined for it.

5. **Config-under-test.** A CI step asserts that `kilo.jsonc`, commands, and agents parse and reference only existing skills/commands; adding a command that references a missing skill fails the build. Current system: no such check, no CI for config.

6. **Dead-config cleanup with provenance.** Running the doctor/scanner lists `.gemini/skills` duplication, epoch-stamped skills, and `skills1.zip` with a *recommended action per item* and a safe one-command apply — without blindly deleting anything still referenced. Current system: no scanner.

7. **Graceful scrape failure.** When a source (e.g. a county sheriff page) 404s/times out mid-scrape, the system returns a *partial* result plus a per-source error record, and the agent's report includes the failure truthfully rather than silently dropping the source. Current system: scrapers exist but there is no evidence of failure-reporting to the agent layer.

8. **Schema-boundary drift is caught.** Any change that makes the UI's `SOURCES` and the scrapers' registry diverge is caught by a drift test (generalizing `test/sync.test.js`) *before* merge. Current system: one drift test exists for v0↔v2 only; the scraper↔UI boundary is unguarded.

9. **Memory survives and stays truthful.** After a session, key facts (invariants, run commands, current state) are retrievable next session with no hallucinated "memory" entries — the system *cites the file* a memory fact came from. Current system: no memory layer.

10. **Free-tier resilience.** With the free/small model and no `DATABASE_URL`, the upgraded system still completes the top `/scrape`, `/test`, `/review` flows within rate limits and without hanging on an unstartable MCP — it degrades gracefully (in-memory DB, no-MCP fallback) instead of erroring. Current system: no MCP to fail, but also no graceful-degradation contract.

---

## SUMMARY OF ATTACKS THE REVISION MUST ANSWER

The revision must: (a) commit harder to *deletion* early, not just indexing; (b) make the domain model *generated + drift-gated*, not a static doc; (c) make verification *proportional* with an explicit fast-path; (d) stage for a solo operator, not a platform team; (e) put config *in the repo under test*; (f) state the fail-path and graceful degradation; (g) name real acceptance scenarios, not an empty harness.