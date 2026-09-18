# Foolproof scrape — research brief (Reddit / HN / GitHub, 2026-09-18)

> Web Search API was unavailable; sources fetched directly from Hacker News Algolia API,
> GitHub READMEs, and Scrapling docs. Reddit blocked anonymous JSON (403); findings below
> use HN discussions that often quote r/webscraping themes plus first-party GitHub docs.

## What “foolproof” actually means (community consensus)

| Definition | Source signal | Fit for property-crawl |
|---|---|---|
| **Selectors never break** | Scrapling adaptive parsers; HN “self-healing scraper” trend (State of Web Scraping 2025) | High — DOM drift on HUD/GSA/county sites |
| **Fetch never silently fails** | We already fail-closed + lastRunReport | Keep; extend with waterfall fetch |
| **SPA/API sites still yield data** | Scrapling `capture_xhr`; Draco tier-2 V8 intercept | Critical for Fannie/Freddie/VA |
| **Polite + legal** | Crawlee AutoThrottle; Scrapling robots_txt_obey; HN legal notes | Mandatory — government ToS |
| **Not “CAPTCHA-bypass everything”** | HN: Cloudflare Enterprise still kills stealth Playwright at scale | **Do not** chase CAPTCHA for Bid4Assets/Land Bank; enrollment or leave blocked |

---

## Research findings (with sources)

### 1. Adaptive parsers — survive redesigns (GitHub · Scrapling)

From [D4Vinci/Scrapling](https://github.com/D4Vinci/Scrapling) and [docs](https://scrapling.readthedocs.io/en/latest/):

- `auto_save` / `adaptive=True` — relocates elements after site redesigns via similarity algorithms
- Auto selector generation from any element
- Parser is **~1s** on nested DOM; faster than BS4/selectolax
- **Our gap:** we only use static `Selector` XPath/CSS profiles. We never call adaptive APIs.

**Upgrade:** For identity fields (case #, auction id), keep **static** selectors (adaptive relocation is disabled for facts — already policy). For **presentation** fields (price labels, date labels), enable Scrapling `adaptive=True` with a frozen saved selector store under `.cache/scrapling-selectors/`.

### 2. Tiered fetch — don’t boot a browser for every request (HN · Draco, Runo)

HN “Show HN: Draco” (2026-08) describes the industry pattern:

| Tier | Method | When | Our use |
|---|---|---|---|
| 0 | Official JSON API | ServiceLink, HUD DataGrid, CourtListener, FL DOR | Already primary |
| 1 | TLS/JA4 impersonated HTTP | HTML government pages | Scrapling `Fetcher(impersonate='chrome')` optional |
| 2 | V8/Playwright + **XHR intercept** | React SPA REO (Fannie/Freddie/VA) | `capture_xhr` to grab JSON the page already fetches |
| 3 | Real browser last resort | Unresolved SPA | Operator opt-in only; never stealth-bypass CAPTCHA |

HN Runo: “plain fetch first, escalate to playwright stealth.” Same shape.

**Upgrade:** `server/scrapers/fetch-strategy.js` — waterfall: native Node fetch → Scrapling Fetcher impersonate → (opt-in) DynamicFetcher with `capture_xhr` pattern → fail-closed with observation_error.

### 3. capture_xhr — steal the SPA’s own API responses (Scrapling docs)

Scrapling DynamicFetcher supports **background API capture**:

```python
page = DynamicFetcher.fetch(url, capture_xhr='*/api/*')
# page.captured_xhr → Response objects of JSON APIs the page called
```

**Direct hit:** Fannie HomePath / Freddie HomeSteps / VA VRM are JS SPAs. Instead of parsing empty React shells, capture the JSON the SPA already requests — **no CAPTCHA, no ToS gray-area** if the same calls are made by a normal user session and robots allows.

**Upgrade:** Scrapling profile `spa-xhr` + env `SCRAPLING_SOURCES=fannie,freddie,va` path that only runs when operator enables fetchers (`scrapling[fetchers]` + browsers). Default stays fail-closed native parse.

### 4. Schema-first / LLM extract (HN · Runo, Spidra, State of Scraping 2025)

- Typed schema → validated JSON instead of brittle CSS
- LLM generates spiders / auto-heals selectors
- Two-pass: analyze structure → extract with hard schema

**Our fit:** we already have `standardizeListing`, validation, and AI notice parser. Upgrade:

1. **JSON Schema per source** for every listing (`schema/listing.schema.json` + per-source extensions)
2. **Secondary extract lane:** Scrapling markdown/HTML → LLM (optional `OPENAI_API_KEY`) → schema-validate → **evidence-only** until human review (match email-ingest policy)
3. Never auto-publish LLM-inferred bid/date without publisher evidence

### 5. Crawlee-style operational reliability (GitHub · apify/crawlee)

Features we lack / only partially have:

| Crawlee feature | Our state | Foolproof upgrade |
|---|---|---|
| Unified HTTP + browser | Node HTTP + optional Scrapling parse only | Waterfall strategy module |
| AutoThrottle / Retry-After | Fixed jitter | Adaptive delay per host + honor Retry-After |
| Session/proxy rotation | None (by design — public gov) | Keep none; polite single operator IP |
| Persistent request queue | Discovery jobs (PG) | Reuse discovery queue for all live adapters |
| Development-mode disk cache | Fixture HTML only | Cache live HTML responses for parser TDD |
| Blocked-request detection | Circuit breaker + challenge finder | Add content-hash drift alarms |

### 6. Robots + legal (Scrapling disclaimer + HN State of Scraping)

- Public data OK; login walls risky; enforcement tightening
- Scrapling official stance: respect ToS and robots.txt
- **Our alignment:** GSA robots exclusion, fail-closed CAPTCHA, no challenge bypass — this is the **correct** long-term strategy, not a limitation to “fix”

### 7. Vision agents for brittle UIs (HN comments)

Lightweight vision agents scrape dynamic UIs without reverse-engineering APIs. Useful **last resort** for county portals with no stable DOM — high cost, low determinism. Recommend only for **manual** research cases, not production inventory.

---

## What we already do better (do not replace)

1. Fail-closed lastRunReport + SPA observation_error
2. Migration 014 canary gates (accepted>0, rejected=0, scope hash)
3. Email-as-API for press notices (STRATEGY Hack #1)
4. Scrapling protocol + SSRF + content-hash evidence
5. Circuit breakers + challenge detection
6. Catalog honesty (47+ sources ≠ live coverage)

---

## Prioritized upgrade roadmap

### P0 — Foolproof without ethics risk (implement next)

| # | Upgrade | Targets | Effort |
|---|---|---|---|
| 1 | **Listing JSON Schema** validate every emit | all adapters | M |
| 2 | **fetch-strategy waterfall** (fetch → impersonate HTTP → fail-closed) | HUD/USDA/GSA/Treasury/IRS | M |
| 3 | **capture_xhr SPA lane** (opt-in Scrapling fetchers) | fannie, freddie, va | L |
| 4 | **AutoThrottle + Retry-After** in http.js | all hosts | S |
| 5 | **Parser development-mode cache** | Scrapling profiles | S |
| 6 | **Selector drift alarm** (page-hash + field yield delta) | HUD/GSA/CivilView | M |

### P1 — Self-healing / LLM (schema-bound, evidence-only)

| # | Upgrade | Note |
|---|---|---|
| 7 | LLM secondary parse → schema → review queue | Never invents bids; OPENAI optional fail-closed |
| 8 | Adaptive presentation selectors (Scrapling) | Identity fields stay static |
| 9 | Markdown evidence snapshots for audits | `page.markdown()` sanitized |

### P2 — Explicitly not recommended for “foolproof” government scrape

| Idea | Why not |
|---|---|
| CAPTCHA-solving farms on Bid4Assets/Land Bank | Violates publisher control; legal risk; our fail-closed is correct |
| Residential proxy fleets on .gov | Escalates bot war; ToS risk |
| Stealth Playwright against Cloudflare Enterprise | HN consensus: still stops at scale |
| Replacing native JSON APIs with browsers | Slower, more fragile, worse provenance |

---

## Concrete mapping to our scrapers

| Source | Today | Foolproof path |
|---|---|---|
| ServiceLink | JSON API | Schema validate + delta-sync (done) + Retry-After |
| HUD | DataGrid + Scrapling hud-cards | Waterfall + drift alarm + adaptive labels |
| USDA | POST form + table | usda-table Scrapling + schema |
| GSA | HTML + scrapling gsa-index | Adaptive cards + robots already handled |
| Treasury/IRS | Detail + scrapling | Schema + capture alternative contractor JSON if published |
| Fannie/Freddie/VA | SPA fail-closed | **capture_xhr** + partner feed fallback |
| CivilView | County enroll + detail | civilview-sales discovery + session cookie (already) |
| CA Controller | Cloudflare fail-closed | Stay blocked until official access |
| Bid4Assets / Land Bank | CAPTCHA fail-closed | Stay blocked; import authorized notices |
| Email notices | IMAP + corpus | Keep; schema-validate packets |

---

## Sources consulted

1. HN Algolia — “Show HN: Draco … Firecrawl alternative in Rust” (2026-08) — tiered fetch
2. HN Algolia — “Show HN: Runo — typed JSON scraping” (2026-05) — schema-first extract
3. HN Algolia — “Show HN: Spidra — AI scraper” (2026-03) — natural-language extract
4. HN Algolia — “Show HN: Reader — scraping engine for LLMs” (2026-02) — markdown for agents
5. HN Algolia — “Show HN: GetHtml waterfall fetcher” (2025-01) — waterfall pattern
6. HN Algolia — “Crawlee for Python / Node” (2024–2025) — AutoThrottle, queues, TLS fingerprints
7. HN Algolia — “The State of Web Scraping 2025” comment — self-healing scrapers
8. GitHub — [D4Vinci/Scrapling](https://github.com/D4Vinci/Scrapling) README + docs — adaptive parse, capture_xhr, spiders, robots
9. GitHub — [apify/crawlee](https://github.com/apify/crawlee) — production crawler features
10. Scrapling docs — https://scrapling.readthedocs.io/en/latest/

**Blocked this session:** websearch plugin disabled; Reddit JSON 403; zread GitHub API quota exhausted.

---

## Bottom line

“Foolproof scrape” for this product is **not** “bypass every CAPTCHA.” It is:

1. **Never lie** about empty inventory (done)
2. **Never break on redesign** (adaptive presentation + schema contracts)
3. **Never miss SPA JSON** (capture_xhr for REO portals)
4. **Never hammer publishers** (AutoThrottle + robots + circuit breakers)
5. **Always evidence-bound** (schema + canary gates + LLM only as secondary review)

Next implementation wave: listing schema + fetch waterfall + SPA XHR lane + drift alarms.
