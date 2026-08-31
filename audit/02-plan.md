# PLAN — Ideal System + Gaps + Three-Tier Upgrade (Architect)

> Agent 2 (Architect). Produced from `01-audit.md` ONLY. No self-critique. Decisive and concrete.
> Goal context (from audit): agent system serving "property-crawl" — a distressed/government-sale property product (Next.js 16 App Router UI, plain Node `http` listing API, PostGIS DB, 5 scrapers) — plus a general coding/writing/research assistant.

---

## 1. THE IDEAL SYSTEM (10x resources, zero attachment to what exists)

A self-maintaining, self-verifying instrument — not a file cabinet.

1. **Project-native domain model.** A `CONTEXT.md` auto-loaded every session encodes: the three-layer architecture (v0 static PWA → v1 Node `http` API → v2 Next.js App Router), the entity schema (`SOURCE`, `LISTING`, computed metrics, `SCORE_BAND`, `PARSED_NOTICE`), the invariants (every dynamic/AI string passes `esc()`; `SCORE_BANDS` is the single score source-of-truth), run commands, and test commands. It is extracted from the repo and re-synced after big changes.

2. **Typed capability registry + routing index.** One machine-readable manifest: every skill declares `name`, `trigger` (regex + keywords), `depends_on` (skills/MCP/env), `produces` (output schema), `freshness`, `provenance`. Dispatch is a scored match with a deterministic disambiguation step — never a vague "best guess."

3. **Commands layer** (`.kilo/command/*.md`). The owner's top operations are first-class, versionable, testable commands: `/scrape`, `/refresh-data`, `/test`, `/ship`, `/review`, `/research`, `/write`, `/audit`. Predictable behavior for the 20% of things done 80% of the time.

4. **Agents layer** (`.kilo/agent/*.md`). Real personas — `scraper-engineer`, `reviewer`, `security-auditor`, `qa-engineer` — each with a scoped permission set, model, and skill subset (not the monolithic inline JSON that exists today).

5. **Hooks** for lifecycle enforcement: a pre-completion hook that runs the verification gate (`test/verify.js`) and refuses to certify "done" without an evidence citation; a telemetry hook that records which skill fired and its outcome.

6. **MCP servers**: a `postgres`/PostGIS server (live DB inspection instead of guessing), a `playwright` browser server (UI verification), and a `github` server (issues/PRs). Removes the guesswork gap documented in the audit.

7. **Persistent layered memory**: global facts (invariants, decisions), episodic (session digests, what was done), working (current task). With automatic dedupe + a compaction/"sleep" consolidation step.

8. **Self-verification loop**: a golden-scenario eval harness; the agent runs a verification command before completion, cites its own output as evidence, and failures are mechanical gates — not advisory docstrings.

9. **Freshness/dedupe hygiene**: one canonical skill root (not four roots with byte-copies), a manifest with versions + provenance, and a `skills doctor` that flags duplicate/shadowed/stale/deprecated skills.

---

## 2. EVERY GAP (ideal vs. current)

| # | Gap | Evidence anchor (from audit) |
|---|---|---|
| G1 | Documented extension points are empty: zero `.kilo/command/*.md`, zero `.kilo/agent/*.md`, zero hooks | §1.1, §1.4 |
| G2 | Zero MCP servers | §1.1 (0 grep hits) |
| G3 | Zero persistent memory (`memory/`, `MEMORY.md` absent) | §1.1, §1.4 |
| G4 | Four skill roots, ~650 skills, byte-for-byte triplication (`.gemini` mirrors `.agents`, plus `skills1.zip`), no dedupe/namespacing/routing | §1.1, §2 Redundancy 28/100 |
| G5 | No enforcement of agent-output verification (advisory skills only; the 11-suite codebase gate is not auto-run by the agent) | §1.4, §2 Verification 50/100 |
| G6 | No project-specific capability for the real domain (property scraping / Next 16 / Node API) | §2 Coverage, §4.7 |
| G7 | Ambiguous trigger resolution ("audit my site" → 5+ skills) | §2 Trigger precision 38/100 |
| G8 | No freshness/staleness mechanism (epoch mtimes `1980-01-01`, stale `skills1.zip`, no deprecation markers) | §1.1, §2 Freshness 58/100 |
| G9 | Ghost infrastructure (`plugins/` empty, stale packages, `CLAUDE.md` = bare `@AGENTS.md`) | §1.4 |

---

## 3. THREE-TIER UPGRADE PLAN

### TIER 1 — what the owner would have asked for outright

- **T1.1 Consolidate skill roots.** Delete the `.gemini/skills` duplicate (byte-identical copy of `.agents/skills`), remove `skills1.zip` from the working tree, and settle on a single canonical skill root. Kills the largest redundancy tax immediately.
- **T1.2 Commands for the top operations.** Create `.kilo/command/` with `/scrape`, `/refresh-data`, `/test`, `/review`, `/research`, `/audit`. Deterministic entry points for what this repo actually does.
- **T1.3 Real `CONTEXT.md`.** Write a project domain model (3-layer arch + entity schema + invariants + run/test commands) and have `AGENTS.md` `@`-include it. Replaces the bare `CLAUDE.md` (`@AGENTS.md`) with actual intelligence.
- **T1.4 Agents as files.** Create `.kilo/agent/` for `scraper-engineer`, `reviewer`, `qa-engineer` — refining the 5 inline `kilo.jsonc` agents into scoped personas.
- **T1.5 Skill index + `skills doctor`.** A single manifest plus a command that flags duplicate/shadowed/stale/deprecated skills.

### TIER 2 — what they'd recognize as right once shown

- **T2.1 PostGIS MCP + browser MCP.** `mcpServers` entry for Postgres/PostGIS (live listing/DB inspection) and Playwright (UI verification). Turns guesswork into ground truth — directly addresses the audit's "verification" and "coverage" weaknesses.
- **T2.2 Completion gate hook.** A `Stop`/`PostToolUse` hook that runs the verification gate before the agent may claim completion and records an evidence citation. Makes "verify before done" mechanical.
- **T2.3 Persistent layered memory.** Global facts + episodic + working memory with automatic consolidation. Gives continuity the audit found absent.
- **T2.4 Ranked trigger disambiguation.** Grow the T1.5 index into a scored matcher with an explicit "these N candidates match — which?" step. Fixes trigger precision.
- **T2.5 Golden-scenario eval harness.** `audit/scenarios/` with runnable cases so upgrades are *measured*, not asserted.

### TIER 3 — fundamentally changes what the system is (≥3)

- **T3.1 Self-verifying agent loop.** A verification hook coupled to the eval harness gates *every* completion on runnable evidence. The system changes from "assistant" to "assistant + CI-for-its-own-output" — the "nothing kept without evidence" rule becomes mechanical rather than an instruction I hope the model follows.
- **T3.2 Project-native capability collapse.** Replace the generic CRE/SEO/GCP marketplace sprawl with a small project-native skill set (scrape → normalize → score → publish) *generated from the repo's own schema*. The system stops being a general grab-bag and becomes a specialized instrument for distressed-property data.
- **T3.3 Capability graph with runtime dispatch.** A typed registry (each skill declares inputs/outputs/deps as schemas) enables deterministic composition and parallel dispatch (an orchestrator DAG), replacing flat description-matching with a compiled plan.
- **T3.4 Usage-telemetry feedback loop.** Hooks record which skills fire and their outcomes to memory; a periodic "sleep" turns that into tuned trigger weights and deprecates dead skills. The system becomes self-maintaining rather than static.

---

## 4. SEQUENCE BY LEVERAGE (for the implementer)

Highest leverage first: **T1.1 (dedupe) → T1.3 (domain model) → T1.5 (index/doctor) → T1.2+T1.4 (command+agents) → T2.2 (completion gate) → T2.5 (eval harness) → T2.1 (MCP) → T2.4 (disambiguation) → T2.3 (memory) → T3.x (loop / collapse / graph / telemetry).**