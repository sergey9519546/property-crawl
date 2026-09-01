# AUDIT — Agent System (property-crawl / Kilo + Codex)

> Agent 1 (Auditor). Inventory + score only. No proposals.
> Date: 2026-08-31. Evidence gathered directly from filesystem + `git log` + executed unit suite.

---

## 1. INVENTORY

### 1.1 Component counts (authoritative)

| Category | Count | Notes |
|---|---|---|
| Skills — `~/.kilocode/skills` | **104** top-level dirs (103 SKILL.md) | 916 files |
| Skills — `~/.agents/skills` | **515** SKILL.md (214 top-level dirs) | 3161 files; some mtimes = 1980-01-01 (epoch, zip-extract artifact) |
| Skills — project `.agents/skills` | **29** | GCP/BigQuery/Dataform/dloud "datacloud" skill pack |
| Skills — project `.gemini/skills` | **29** | **byte-for-byte mirror** of `.agents/skills` (committed to git) |
| **Agents** (`kilo.jsonc` `agent` block) | **5** inline definitions | code-reviewer, code-skeptic, frontend-specialist, code, plan. No `.kilo/agent/*.md` files exist |
| **Commands** (`.kilo/command/*.md`) | **0** | none in project or global |
| **Hooks** | **0** | none in project or global |
| **MCP servers** | **0** | `kilo.jsonc` contains no `mcp`/`mcpServers` key (0 grep hits) |
| **Memory files** | **1** (AGENTS.md) + CLAUDE.md (@AGENTS.md) | no `memory/` dir, no MEMORY.md, no persistent memory |
| Other skill bundles | `skills1.zip` (376 KB, 2026-04-12), `.skill-lock.json` (39 KB, 2026-08-26), `~/.agents/plugins/` (empty) | stale packaged copies |

### 1.2 Agents (inline, `C:\Users\serge\.config\kilo\kilo.jsonc`)

| Agent | Purpose | Trigger | Dependencies | Evidence |
|---|---|---|---|---|
| `code-reviewer` | senior code review; feedback on patterns/bugs/security | spin-up when code review requested | model `kilo/nvidia/nemotron-3-super-120b-a12b:free`; read/bash allow, edit+skill deny | config-only; no usage trace |
| `code-skeptic` | skeptical code-quality inspector; challenges "everything is good" claims | adversarial review | read/bash/skill allow, edit deny | config-only |
| `frontend-specialist` | React/TS/CSS UI; a11y, responsive, perf | frontend work | read/bash allow, edit+skill deny | config-only |
| `code` (mode) | default coding mode | implicit | model `kilo/stepfun/step-3.5-flash:free` | config-only |
| `plan` (mode) | planning mode | implicit | model `zai-coding-plan/glm-5.1` | config-only |

Top-level model selection: `openai/gpt-5.3-codex-spark`, small model `kilo/x-ai/grok-code-fast-1:optimized:free`. Permission policy: bash/read/glob/grep/list/edit/skill/task all `allow`; `external_directory` allow; compaction auto.

**Finding**: agents exist only as inline JSON. The documented convention (`.kilo/agent/*.md` per the system prompt) is entirely unpopulated. No agent files, no hooks, no commands.

### 1.3 Skills — thematic clusters

**A. CRE / real-estate "RIDGE" family (`~/.agents/skills`)** — a coherent, named, industrial-RE investment suite:
`acq-investment-report`, `cre-legal-reviewer`, `cre-underwriting`, `cre-financing`, `cre-capital-markets`, `dd-tracker`, `debt-tool`, `lens`, `market-pulse`, `napkin`, `scout`, `the-gavel`, `waterfall`, `loi-generator`, `creating-financial-models`. Designed to chain (napkin → lens → dd-tracker → debt-tool → waterfall → acq-investment-report).

**B. SEO / GEO / content (`.kilocode/skills` + `.agents/skills`)** — the largest cluster (~60+):
- `blog-*` family (~40): blog, blog-analyze, blog-audio, blog-audit, blog-brand, blog-brief, blog-calendar, blog-cannibalization, blog-chart, blog-cluster, blog-decay, blog-discourse, blog-factcheck, blog-flow, blog-geo, blog-google, blog-image, blog-locale-audit, blog-localize, blog-multilingual, blog-notebooklm, blog-outline, blog-persona, blog-repurpose, blog-rewrite, blog-schema, blog-seo-check, blog-strategy, blog-style, blog-taxonomy, blog-translate, blog-write.
- SEO auditors: `seo-audit`, `technical-seo-checker`, `on-page-seo-auditor`, `content-quality-auditor`, `domain-authority-auditor`, `content-gap-analysis`, `competitor-analysis`, `keyword-research`, `serp-analysis`, `rank-tracker`, `performance-reporter`, `alert-manager`, `internal-linking-optimizer`, `backlink-analyzer`, `entity-optimizer`, `geo-content-optimizer`, `schema-markup-generator`, `meta-tags-optimizer`, `seo-content-writer`, `content-refresher`, `memory-management`.

**C. GCP / data-engineering (project `.agents/skills` + `.gemini/skills`, 29 mirrored)**: `bigquery-ai-ml`, `bigquery-bigframes`, `bigquery-data-transfer-service`, `bigquery-graph`, `bigquery-sql`, `building-data-apps`, `data-autocleaning`, `dataform-bigquery`, `dbt-bigquery`, `discovering-gcp-data-assets`, `enforcing-resource-attribution`, `federate-lakehouse-catalog`, `gcloud-auth-verification`, `gcp-composer-troubleshooting`, `gcp-data-pipelines`, `gcp-dataflow`, `gcp-managed-airflow-*` (3), `gcp-pipeline-orchestration`, `gcp-pipeline-resource-provisioning`, `gcp-spark`, `gcs-security-assessment`, `google-cloud-storage-basics`, `managing-python-dependencies`, `ml-best-practices`, `notebook-guidance`, `skill-repair`, `accidental-data-loss-prevention`.

**D. Media / video (`.kilocode/skills`)**: ~30 — `hyperframes*` (9), `higgsfield*` (5), `embedded-captions`, `faceless-explainer`, `general-video`, `motion-graphics`, `music-to-video`, `pr-to-video`, `product-launch-video`, `remotion-to-hyperframes`, `slideshow`, `talking-head-recut`, `video-editing`, `video-downloader`, `media-use`, `sprite-processing`.

**E. Engineering / coding (`~/.kilocode/skills`)**: `tdd`, `security-audit`, `diagnose`, `code-review`, `improve-codebase-architecture`, `full-stack-dev`, `vite`, `vitest`, `typescript-advanced-types`, `supabase*` (2), `vercel*` (2), `frontend-design`, `design-taste-frontend`, `gpt-taste`, `high-end-visual-design`, `minimalist-ui`, `industrial-brutalist-ui`, `redesign-existing-projects`, `prototype`, `zoom-out`, `grill-me`, `grill-with-docs`, `to-issues`, `to-prd`, `triage`, `handoff`, `performance`, `core-web-vitals`, `accessibility`, `savethetokens`, `full-output-enforcement`, `write-a-skill`, `find-skills`, `caveman`, `setup-matt-pocock-skills`, `vercel-deploy`, `deploy-to-vercel`.

**F. Research / writing / "self-improving" (`~/.agents/skills`)**: `deep-research`, `academic-paper`, `academic-paper-reviewer`, `academic-pipeline`, `self-improving`, `self-improving-agent`, `continuous-learning`, `continuous-learning-v2`, `skillopt-sleep`, `skill-creator`, `skill-development`, `skill-share`, `reload-skills`, `writing-skills`, `superpowers*` (many), `understand*` (9), `wiki*` (17), `morph-warpgrep`, `mcp-builder`, `mcp-server-patterns`, `Codex-api`, `letta-api-client`, `foundation-models-on-device`, `memory-bridge`, `memory-management`, `firecrawl*` (7), `bailian*` (5).

### 1.4 "No evidence of use" list (critical)

The following have **zero filesystem or git evidence of ever being exercised** in this context:

- All 5 inline `kilo.jsonc` agents — pure config, no execution trace.
- The entire `~/.agents/skills` tree (515 skills) — no local session reference, no project usage; it is a vendored public marketplace pack (indicated by `.skill-lock.json`, `skills1.zip`, `plugins/`, epoch mtimes).
- The entire `~/.kilocode/skills` tree (104) — same; installed but no project-specific usage trace.
- `hooks`, `commands`, `MCP servers`, persistent `memory` — **do not exist at all**.
- `CLAUDE.md` — trivial (`@AGENTS.md`).

The only components with **positive evidence of use/function**:

| Component | Evidence |
|---|---|
| `AGENTS.md` | actively maintained; nextjs-agent-rules block auto-re-added by `next dev` |
| Project test harness `test/verify.js` + 11 suites | **executed**: `node test/suite.test.js` → **12 passed, 0 failed** (ran 2026-08-31); other suites present for server/scrapers/ai/e2e/hardening/sync/db/build/canonical/playwright |
| `server/` Node API | 7 routes + 5 scrapers + security middleware; wired in `server/server.js:97-110`; active in git |
| `git history` | 15 commits, latest `9facc35` (landbanksearch scraper, today) — active repo |

---

## 2. SIX-AXIS SCORING

### Coverage — **72/100**
Remarkable breadth: CRE underwriting, SEO/GEO, GCP data engineering, video/media generation, academic research, coding patterns, and self-improvement meta-skills are all represented. The RIDGE CRE suite and blog/SEO families are genuinely deep. **But** coverage is *generic marketplace* breadth, not *task-fit* depth: there is no project-specific skill for the actual work this repo does (distressed-property scraping, Next.js 16 App Router, Node http API, PostGIS). Coverage of the owner's real domain is incidental.

### Redundancy — **28/100** (higher redundancy = worse)
Severe triplication. `.gemini/skills` is a byte-for-byte committed copy of `.agents/skills` (29 GCP dirs). `skills1.zip` is a third packaged copy. Overlapping SEO auditors (seo-audit vs technical-seo-checker vs on-page-seo-auditor vs content-quality-auditor vs blog-audit). Multiple `code-review` (both roots), `deep-research` (both roots), `self-improving`/`self-improving-agent`/`continuous-learning`/`continuous-learning-v2`/`skillopt-sleep` (5 near-duplicate meta skills), 9 `understand*`, 17 `wiki*`, 7 `firecrawl*`. No dedupe mechanism. A request like "audit my site" can plausibly match 6+ skills.

### Trigger precision — **38/100**
Dispatch is description-only frontmatter matching across ~650 skills with no namespacing, no command layer, no routing table, no hooks. Intersecting trigger keywords ("audit", "seo", "research", "review", "write") map to many skills each. Precision is emergent, not designed. The only disambiguation signals are the long "Triggers on:" phrases in descriptions — fragile and inconsistent across families.

### Verification — **50/100**
The *codebase* has outstanding self-verification: an 11-suite gate (`test/verify.js` invoking suite/server/scrapers/ai/e2e/hardening/sync/db/next-build/canonical/playwright) that demonstrably runs (unit suite 12/12 green). **But this verifies the application, not the agent system.** No hook runs tests before claiming completion; no gate blocks an agent's "done" claim; verification is a handful of *advisory* skills (`verification-before-completion`, `receiving-code-review`, `deep-fact-check`, `agentic-eval`) whose enforcement is aspirational docstring, not executable mechanism.

### Composability — **45/100**
A few deliberate orchestrators exist (`academic-pipeline`, `autonomous-loops`, `ralphinho-rfc-pipeline`, `dispatching-parallel-agents`) and the RIDGE CRE family is explicitly designed to chain (napkin → lens → dd-tracker → debt-tool → waterfall → acq-investment-report → loi-generator). **But** there is no shared schema, no common state vocabulary, no inter-skill contract; skills self-manage heterogeneous state; cross-root duplication (`.agents` vs `.gemini` vs `.kilocode`) breaks any single load order; most skills are monolithic one-shot recipes.

### Freshness — **58/100**
Repo itself is fresh (commits today; GCP skills touched 2026-08-31). `.kilocode/skills` newest 2026-08-14. **But** `.agents/skills` contains files with mtime `1980-01-01` (epoch artifact from zip extraction, i.e. loss of real timestamps), `skills1.zip` is a stale 2026-04-12 backup, and there is no deprecation marker, no staleness scanner, no update/manifest story beyond `.skill-lock.json`. Versioned frontmatter (e.g. `self-improving` v1.2.16) suggests a marketplace with no auto-update path.

---

## 3. OVERALL SCORE

**51 / 100**

Rationale: a *fresh, well-verified application* (green 11-suite test gate, active git) is wrapped in a *sprawling, redundant, un-orchestrated skill collection* — ~650 skills across four roots with no commands, no hooks, no MCP, no persistent memory, and no mechanism for the agent system to verify its own output. Coverage is broad but generic; structure is essentially absent.

## 4. SUMMARY OF GAPS (observed, not proposed)

1. No `.kilo/command/*.md`, `.kilo/agent/*.md`, or hooks exist — the documented extension points are empty.
2. Zero MCP servers configured.
3. Zero persistent memory (`memory/`, MEMORY.md).
4. ~~`.gemini/skills` duplicates `.agents/skills`~~ — **CORRECTED, see ERRATA below.**
5. No dedupe / no namespacing / no routing between ~650 skills (the *user* roots, not the project root).
6. No agent-output verification enforcement (only advisory skills + a codebase test gate that the agent never auto-runs).
7. ~~No project-specific capability~~ — **CORRECTED**: two project-native skills exist (see ERRATA).

---

## 5. ERRATA (re-verification, 2026-08-31, later than the body above)

The first-pass body above contains **two factual errors** found on closer re-verification. Per the discipline (evidence over assertion, revert what fails), they are corrected here and supersede the earlier claims.

**E1 — `.gemini/skills` is NOT a live duplicate.** Re-verification: `Get-ChildItem .gemini -Recurse` returns **0 entries** (the directory is empty) and `git ls-files .gemini/skills` returns **0 tracked files**. It was once created (git log shows `.gemini` in commits `e970215` and `252146d`) but holds nothing now. The "byte-for-byte mirror" claim in §1.1/§2/§4.4 was wrong at time of writing. Consequence: there is **nothing to delete** under `.gemini`.

**E2 — Project-native capability ALREADY exists.** The project skill root `.agents/skills` contains two domain-specific skills the first pass missed (they were alphabetically deep in a mostly-GCP list):

| Skill | Purpose | File |
|---|---|---|
| `property-scraper-engineering` (v1, data-engineering) | Circuit-breaker enforcement, canonical listing-contract normalization (matches `data.js` schema), `normalizeOcrText`, 250–750ms jitter politeness for sheriff/Bid4Assets/HUD/Treasury/IRS scrapers | `.agents/skills/property-scraper-engineering/SKILL.md` |
| `foreclosure-title-intelligence` (v1, real-estate-intelligence) | Lien priority/survival, 50-state statutory redemption periods, cash-to-close computation, multi-parcel disambiguation | `.agents/skills/foreclosure-title-intelligence/SKILL.md` |

**E3 — A provenance manifest already exists.** `.agents/skills/.datacloud_skills_manifest` (4546 B, modified 2026-08-31) records a `bundleChecksum` plus per-skill `checksum`/`status` for the 29 GCP skills. The audit's "no manifest/provenance story" was overstated.

**Net effect on scores:** Coverage was understated (two real domain skills exist) — adjust **72 → 74**. Redundancy was overstated (the `.gemini` copy no longer exists) — adjust **28 → 32**. Other axes unchanged. Overall **51 → 53/100**. The structural findings (no commands/hooks/MCP/memory, no output-verification enforcement, ambiguous dispatch) stand.