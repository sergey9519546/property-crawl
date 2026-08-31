# PROPERTY_CRAWL — Verified Build Blueprint v2

*AI-powered aggregator for foreclosure sales + government seized/surplus/REO property. Every URL in this document was live-verified on August 15, 2026. Budget target: $0 at MVP, under $150/month in production.*

---

## 0. The one-sentence product

**"Zillow for distressed and government-sold property, with an AI that reads the fine print and tells you if each one is actually a deal — and what the catch is."**

You are a discovery + intelligence layer. You never touch the transaction, never contact homeowners, never sell phone numbers. That single design decision deletes the TCPA, §1695/Mortgage-Rescue-Fraud, and brokerage-license landmines that sink the Instagram-course version of this idea.

---

## 1. The five real AI hacks (each one verified, not vibes)

### Hack #1 — Email-as-API: the statutory-publication loophole
This is the crown jewel, and neither of your research docs found it.

Foreclosure/sheriff sale notices are **required by state law to be published**. State press associations aggregate them on free statewide sites — verified live in FL, IL, TX, OH, PA, GA. You cannot scrape these (Illinois' ToS explicitly bans bots with **$10,000-per-incident liquidated damages**). But every one of them offers **free "Smart Search" keyword email alerts, delivered within hours of publication**.

So don't scrape the sites. **Subscribe.** Set up saved searches ("sheriff's sale", "notice of foreclosure sale", "trustee's sale", per county) → alerts land in a dedicated inbox → a GitHub Actions cron reads the inbox via IMAP → an LLM parses each messy legal-prose notice into structured JSON (address, sale date, plaintiff/lender, defendant, judgment amount, attorney, terms).

Why this is the real edge:
- **Zero cost, zero scraping-ToS exposure** — you're a subscriber using the alert feature exactly as designed, then processing your own mail.
- **Legal notices are unstructured prose** — dollar amounts, addresses, and dates buried in dense boilerplate. Pre-LLM, structuring them required human data entry (that's literally what 40-year-old vendors like RETRAN sell). An LLM does it for ~a tenth of a cent per notice. **This is the specific task where AI collapsed the cost of a whole data-entry industry, and almost nobody has rebuilt on it yet.**
- Latency is hours-from-publication — competitive with paid feeds.

Verified alert sources: floridapublicnotices.com · publicnoticeillinois.com · texaspublicnotices.com · publicnoticesohio.com · publicnoticepa.com · georgiapublicnotice.com (all free search + email alerts; no APIs anywhere — which is exactly why this stays underexploited).

The same pattern extends to every government source with an email subscription (IRS auctions has one). **Your ingestion layer is an inbox.**

### Hack #2 — Platform-level parsers: one scraper, dozens of counties
Counties don't build their own websites; they buy the same three vendors. Verified:
- **salesweb.civilview.com** hosts sheriff-sale lists for many NJ counties on one URL scheme (`?countyId=N`) as clean free HTML tables — Bergen alone had 78 upcoming sales with address, date, plaintiff, defendant. One parser = most of New Jersey.
- **Realauction** (`{county}.sheriffsaleauction.ohio.gov`) hosts most large Ohio counties' weekly foreclosure auctions, free to view.
- **AcclaimWeb** (Harris Recording Solutions) powers recorder document search with doc-type filters in Clark County NV and many others.

Write parsers per *platform*, not per county. Coverage scales with your time, not your money. (Check each platform's ToS/robots before automating; where it's restricted, these are still your manual-review sources.)

### Hack #3 — LLM-as-parser, self-healing ingestion
Every ingest job is: fetch (or read email) → hand raw HTML/text to a cheap model with a strict JSON schema → validate with Pydantic → insert. When a site changes layout, nothing breaks — the model reads the new layout. You maintain ~40 *prompts + schemas*, not 40 brittle XPath scrapers. Failures route to a review queue where you (or Claude Code, interactively) fix the prompt in minutes.

Model routing: **Gemini Flash free tier / Claude Haiku batch ($0.50/MTok in)** for volume extraction; a smart model (Sonnet/Fable) only for the last-mile Deal Score explanation on the ~50 listings/day that survive filtering. Realistic LLM bill: $10–50/month.

### Hack #4 — Free enrichment stack that replaces $1,000/mo of APIs
All verified live:
- **US Census Geocoder** — free, no key: canonical addresses + lat/lon (replaces Google geocoding).
- **County ArcGIS REST endpoints** — free JSON parcel queries with owner + assessed value (verified pattern: maps.bexar.org, maps.bannockcounty.us; most counties have one).
- **FHFA House Price Index** — free CSVs down to ZIP/tract: turns an old assessment or last-sale price into a today-value estimate.
- **Zillow Research CSVs** (files.zillowstatic.com, no key) — ZHVI to neighborhood level, monthly.
- **Redfin Data Center** — 14 free market datasets to ZIP level.
- **Socrata open-data code-enforcement feeds** (verified live JSON: data.cityoforlando.net, data.nola.gov) — vacancy/violation signals, the legitimate ToS-clean version of "vision AI driving for dollars."
- **OpenStreetMap + Leaflet** for maps.

Valuation formula (honest, ranged): `assessed value × county assessment ratio`, cross-checked against `last recorded sale × FHFA HPI appreciation` and the ZIP-level ZHVI. **Deal Score = opening bid ÷ estimated value band.** Show the band, link out to Zillow/Redfin for the user's own final comps. You're triaging, not appraising — which is both more defensible and more useful.

### Hack #5 — Free infrastructure that is actually free (2026 limits verified)
| Layer | Tool | Free limit | Catch |
|---|---|---|---|
| Cron + compute | GitHub Actions | 2,000 min/mo private repo; cron supported | disabled after 60 days repo inactivity |
| DB + auth | Supabase | 500MB DB, built-in auth | **pauses after 1 idle week** — add a keep-warm ping to your cron |
| Frontend + functions | **Cloudflare Pages/Workers** | 100k req/day, cron triggers | use this, NOT Vercel Hobby — **Vercel's free tier bans commercial use** |
| Email alerts out | Resend | 3,000/mo, 100/day | upgrade when list grows |
| Geocoding/maps | Census + OSM | unlimited-ish | none |
| LLM volume | Gemini Flash free tier | ~1,000–1,500 req/day | per-account; Haiku batch as overflow |
| Payments | Stripe | 2.9% + 30¢ | add at Phase 4 |

**Total: $0 MVP → ~$50–150/mo live** (domain, Supabase Pro when you outgrow 500MB, LLM, email).

---

## 2. Verified source registry

### Tier A — Federal / GSE (open, meant to be seen, start here)
| Source | URL | Format | Catch |
|---|---|---|---|
| HUD Homes | hudhomestore.gov | public browse | **robots.txt blocks crawlers; no official feed** — treat as manual/daily-check source; ~900 listings nationally; investors bid only after the owner-occupant exclusive window, via HUD-registered broker |
| Fannie Mae REO | homepath.com | JS site, public | no export; First Look owner-occupant window |
| Freddie Mac REO | homesteps.com | public search | no export |
| USDA RD/FSA REO | resales.usda.gov | map search | the data.gov file is dead (2018) — parse the site respectfully or check manually |
| VA REO | vrmproperties.com (VRM) | public browse, photos+price | registration only to offer |
| IRS seized property | irsauctions.gov | HTML cards + **email subscribe** | low volume, updated 2 days ago — alive |
| Treasury forfeiture | treasury.gov/auctions/treasury/rp/realprop.shtml | **legacy static HTML — trivially parseable**; contractor CWS Marketing | ~13 auctions Aug–Sep 2026 |
| US Marshals real estate | usmarshals.gov/what-we-do/asset-forfeiture → RealLook.com | listed at market via brokers | personal property via Bid4Assets, Gaston & Sheehan |
| GSA surplus real property | realestatesales.gov | HTML | low volume (~5 live) |
| GSA Auctions API | gsa.github.io/auctions_api | **real JSON API, free key** | **personal property only** — this is your vehicles/repo vertical, not homes |

### Tier B — Foreclosure sale notices (the volume engine)
Press-association alert emails (Hack #1) + platform sheriff-sale sites (Hack #2): civilview.com (NJ), Realauction (OH), county pages like buckscounty.gov/579/Sheriff-Sales (PA). This tier is where the deal-flow actually is — thousands of scheduled sales/month across six verified states.

### Tier C — Enrichment (Hack #4 list) + recorder searches for deed-sale comps (Clark NV, Harris TX, Maricopa AZ verified free).

### Do not build
- Stealth/TLS-spoof scraping of hostile portals (hiQ lost on *contract* and paid $500k; IL press ToS = $10k/incident).
- Street-View vision AI (Google Maps ToS §3.2.3 explicitly bans it, including model training).
- Anything that touches homeowner phone numbers or cold outreach (TCPA $500–1,500/call, *Coffey v. Fast Easy Offer* killed the "I'm a buyer" defense, CA §1695 = up to $25k + a year in jail per violation).
- LA County recorder anything — they publish no online index, by law.

---

## 3. The agentic pipeline (six agents, one inbox, one cron)

```
                         ┌──────────────────────────────┐
  press-assoc alerts ───►│                              │
  IRS/gov alert emails ─►│  INGEST (IMAP + fetchers)    │  GitHub Actions cron, 2×/day
  static gov pages ─────►│  LLM → JSON schema → Pydantic│
  platform tables ──────►│                              │
                         └──────────────┬───────────────┘
                                        ▼
                          NORMALIZE/DEDUPE (Census geocoder,
                          cross-source merge on address+APN)
                                        ▼
                          ENRICH (ArcGIS parcel, FHFA/ZHVI,
                          code-violation flags, photos where allowed)
                                        ▼
                          SCORE + EXPLAIN (cheap model filters,
                          smart model writes the "here's the catch"
                          paragraph for survivors only)
                                        ▼
                          PUBLISH (Supabase → Cloudflare site,
                          Resend alert emails, saved searches)
                                        ▼
                          CONTENT (programmatic SEO: "Sheriff sales
                          in {county} this week" pages = free acquisition)
```

Each agent is a Python script + a prompt file + a JSON schema. No Kestra, no BigQuery, no orchestration framework — a `main.py` per stage and a workflow YAML. Claude Code writes and repairs these; that's your dev team.

The **Score + Explain** stage is the product. Every listing ships with: value band, Deal Score, and a plain-English risk paragraph — *"Occupied; Ohio allows confirmation-of-sale delays; 10% deposit due day-of; this county's sales require certified funds"* — generated once, cached forever. Nobody at the $40/mo incumbents does this.

---

## 4. Build sequence

**Phase 0 (this weekend):** Pick ONE state from the verified six — **Ohio or New Jersey** (best structured sources: Realauction/civilview + press alerts + judicial-state sale lists). Create the alerts inbox, subscribe to Smart Search alerts for 3 counties, and hand-run the LLM parser on the first 20 emails. If the parse quality is good (it will be), the whole thesis is proven for ~$0.

**Phase 1 (week 1):** GitHub Actions cron → IMAP → parse → Supabase → one bare Cloudflare page listing this week's sales. End-to-end loop live.

**Phase 2 (week 2–3):** Add normalize/enrich/score, map view, county filters. Add the federal Tier A sources (Treasury static pages first — easiest win).

**Phase 3 (week 4):** Saved searches + Resend alert emails. This is your list-builder — free tier of the product.

**Phase 4:** Stripe, $19–49/mo for full listings + scores + instant alerts. Programmatic SEO pages for acquisition.

**Phase 5:** Second and third states (each ≈ new alert subscriptions + maybe one platform parser). Add the GSA vehicles API as a repo/vehicles vertical — it's a real free JSON API sitting right there.

**Gate before scaling:** 100 email signups or 5 paying users from one state. If a single state's version can't get that, more states won't fix it.

---

## 5. Money math

- **Costs:** $0 until Phase 4; then ~$50–150/mo (Supabase Pro $25, LLM $10–50, Resend $20, domain, Cloudflare likely still $0).
- **Revenue:** 40 subscribers × $29 ≈ $1,160/mo — reachable in a niche where incumbents (Foreclosure.com $40/mo, RealtyTrac $50/mo) prove willingness to pay but ship zero AI explanation and ugly UX. Ladder: subscriptions → agent/investor lead referrals → affiliate (financing, title) → data/API tier.
- **Your own deals:** the tool doubles as your private deal screen for bidding at government/sheriff auctions yourself — the legally clean acquisition channel (no homeowner outreach; you're bidding at a public sale).

## 6. Guardrails (the short version)
Facts aren't copyrightable and federal works are public domain (17 USC §105) — but **respect robots.txt and ToS everywhere**, never republish listing photos you don't have rights to, never make earnings claims in marketing (FTC's Operation AI Comply exists precisely for "AI + real estate riches" pitches), and keep zero homeowner-contact features in the product. If you ever add pre-foreclosure *owner* data later, that's the moment to pay a lawyer, not before launch of the aggregator.

---

*Verified 2026-08-15. Source-status table should be re-checked quarterly — government URLs move.*
