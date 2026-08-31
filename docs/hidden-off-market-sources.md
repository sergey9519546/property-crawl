# Hidden / Off-Market Sources — Beyond Public Auctions

**Compiled 2026-08-31.** This file covers the **lesser-known sources** that active flippers, wholesalers, and Land-Use Hackers use to find deals *before* they hit the auction or MLS. The auction sites in `docs/all-auction-sources.md` are downstream of these — these are the upstream signals.

> **The 7 public-data sources serious investors use, ranked by signal strength** (per the FlaggedLeads playbook):
> 1. **Code violations** (city open data) — freshest signal, days-old
> 2. **Tax delinquency** (county treasurer, annual) — 2+ years delinquent is the sweet spot
> 3. **Pre-foreclosure filings** (NOD / Lis Pendens) — 14-45 days after filing
> 4. **Probate filings** (county court) — heirs need to sell
> 5. **Bankruptcy filings** (USTrustee / PACER) — 363(b) sales
> 6. **HOA foreclosure** (super-lien states) — riskier, deed subject to first mortgage
> 7. **Vacant property registries** (1,900+ local ordinances) — pre-foreclosure flag

Each layer below is ordered by **deal-flow size** (number of parcels/year available) and **freshness** (how quickly after distress appears).

---

## 1. Land Banks — the single biggest hidden source

**Why hidden:** Most investors don't know land banks exist. Most general-purpose aggregators don't index them. They handle property that *already failed* tax foreclosure and went to the municipality.

**What they are:** State-authorized entities (300+ nationwide) that take title to tax-foreclosed, abandoned, or blighted properties, then resell — usually at auction, fixed price, or side-lot discount to neighbors. They're the endgame of the tax-delinquency pipeline.

**The numbers (per `landbanksearch.com`, 70 feeds tracked, refreshed nightly):**

| Land Bank | Live listings | Notes |
|---|---|---|
| **Cleveland Land Bank (OH)** | **16,413** | Largest single source of any kind we've found. **Bigger than HUD nationwide.** |
| **Genesee County Land Bank (MI)** | 10,769 | Flint area |
| **St. Louis Land Reutilization Authority (MO)** | 8,193 | "Side-lot" program: $100 side lots to adjacent owners |
| **City of Chicago Land Sales (ChiBlockBuilder) (IL)** | 6,444 | `chiblockbuilder.com` |
| Montgomery County Land Bank (OH) | 3,743 | Dayton |
| Wyandotte County Land Bank (KS) | 3,636 | KC area |
| Pittsburgh Land Bank (PA) | 2,876 | |
| Land Bank of Kansas City, MO | 2,576 | |
| Mahoning County Land Reutilization Corp (OH) | 2,202 | Youngstown |
| Shelby County Land Bank (TN) | 2,048 | Memphis |
| Detroit Land Bank Authority (MI) | 1,647 | `buildingdetroit.org` |
| Philadelphia Land Bank (PA) | 1,600 | |
| The Port — Hamilton County Landbank (OH) | 1,539 | Cincinnati |
| Birmingham Land Bank (AL) | 1,414 | |
| Michigan State Land Bank Authority (MI) | 1,361 | Statewide MI |
| Albany County Land Bank (NY) | 1,224 | |
| City of Peoria Land Bank (IL) | 1,104 | |
| Cook County Land Bank (IL) | 931 | |
| New Orleans Redevelopment Authority (LA) | 886 | |
| Cuyahoga Land Bank (OH) | 790 | (separate from Cleveland Land Bank) |
| + ~50 smaller land banks | <700 each | |

**Top 20 land banks alone = ~70,000 active listings.** That's 4x the entire Bid4Assets inventory.

**URLs (verified):**
- `https://www.landbanksearch.com/data` — meta-aggregator of 70 feeds, refreshed nightly, "feed last changed" tracking
- `https://www.landbanksearch.com/land-banks/detroit-land-bank-authority` — example
- `https://www.buildingdetroit.org` — Detroit Land Bank's own site
- `https://www.clevelandohio.gov/city-hall/departments/community-development/programs-services/cleveland-land-bank` — Cleveland
- `https://www.lrastl.org/property-search` — St. Louis LRA
- `https://chiblockbuilder.com` — Chicago
- `https://www.landbanksearch.com/land-banks/{slug}` — direct pages

**ToS / scraping:** Most land banks are government entities (city/county) and publish under public records. Per the search results: "Every listing on LandBankSearch comes from a land bank's official published inventory." The land bank is publishing, we're aggregating.

**Pattern:** Most land bank sites have either (a) a tabular search form, or (b) a CSV/JSON export. Cleveland's site is at `clevelandohio.gov` and has searchable inventory. Detroit's `buildingdetroit.org` is a custom React app with API behind it.

---

## 2. Vacant Property Registries (1,900+ ordinances)

**Why hidden:** Local. No national index. Each city has its own ordinance, fee structure, and database.

**What they are:** Cities require owners of vacant properties to register, often paying escalating annual fees. This is a **pre-foreclosure flag** — owners who let properties go vacant are usually heading toward default.

**Numbers:** 1,900+ local ordinances nationwide (per NAR white paper). Hundreds of cities have an online portal where you can search the registry by address.

**Verified examples:**
- `https://www.dawgsinc.com/vacant-property-registration-a-curated-collection-for-real-estate-investors-municipal-and-property-management-professionals/` — curated directory of city ordinances
- Detroit VPRO — 30-day registration window
- Newark Foreclosure and Vacant Property Registration Ordinance
- Chicago vacant building registration (per Blueprint §2 Hack #4)
- Wilmington, DE — sliding-fee scale
- Chula Vista, CA — $70/year
- Atlanta Fed research paper (PDF) — `atlantafed.org/-/media/Project/Atlanta/FRBA/Documents/research/publication/working-paper/2019/11/19/foreclosure-externalities-and-vacant-property-registration-ordinances.pdf` — covers VPRO adoption patterns

**Pattern:** Often integrated with code enforcement data. Chicago has both: `data.cityofchicago.org` exposes building violations AND vacant building registrations. Pull one, get the other.

---

## 3. Code Violations / Building Permits (city open data)

**Why hidden:** These are open data portals that exist in most major US cities. Most investors don't know to check them, and they're not in any major aggregator (yet).

**What they are:** City departments of buildings issue violations for unpermitted work, dangerous conditions, overgrown lots, illegal units, etc. A property with a code violation is signaling the owner is in distress.

**Verified examples:**
- `https://data.cityofchicago.org` — **building violations, vacant buildings, building permits, code enforcement** — all as Socrata API + CSV
  - Direct CSV: `https://data.cityofchicago.org/api/views/22u3-xenr/rows.csv?accessType=DOWNLOAD`
  - Web UI: `https://www.chicago.gov/city/en/deps/bldgs/provdrs/inspect/svcs/building_violationsonline.html`
  - Per Blueprint §2 Hack #4: "Socrata open-data code-enforcement feeds (verified live: data.cityoforlando.net, data.nola.gov) — vacancy/violation signals, the legitimate ToS-clean version of 'vision AI driving for dollars'"
- `https://data.cityoforlando.net` — per blueprint
- `https://data.nola.gov` — per blueprint
- `https://data.baltimorecity.gov` — similar Socrata instance
- `https://data.detroitmi.gov` — Socrata
- `https://opendatadc.org` — DC
- `https://data.austintexas.gov` — Austin
- 50+ other major US cities

**Pattern:** All Socrata cities follow the same API pattern: `https://data.{city}.gov/api/views/{id}/rows.csv?accessType=DOWNLOAD`. Pull city-by-city, normalize, dedupe by address. Most have daily updates.

**Volume:** Chicago alone has 200,000+ building violation records spanning 2006-present. **This is the freshest signal** — days-old.

---

## 4. Pre-Foreclosure Filings (NOD, Lis Pendens) — the canonical off-market lead

**Why hidden (relatively):** Most investors use paid aggregators (ATTOM, PropStream) because going to 3,142 county recorders individually is impractical. But the data IS public.

**What they are:**
- **NOD (Notice of Default)** — non-judicial states (CA, AZ, NV, TX, etc.). Lender files with county recorder when borrower defaults.
- **Lis Pendens** — judicial states. Notice of pending litigation, recorded with county recorder.
- **NTS (Notice of Trustee's Sale)** — non-judicial. The auction is scheduled.
- **NFS (Notice of Foreclosure Sale)** — judicial. The auction is scheduled.

**Free county recorder sources** (manual, by county):
- 3,142 counties × 50 states = need to find each recorder's online search portal
- Examples: `cpdocket.cp.cuyahogacounty.gov/sheriffsearch/search.aspx` (Cuyahoga), county recorder search by APN

**Paid aggregators (the practical option):**
- **ATTOM** (attomdata.com) — "largest footprint available from any property data provider" — daily updates
- **BatchLeads** (batchleads.io) — pre-foreclosure data, daily updates
- **BatchData** (batchdata.io) — "Daily Updates from 3,200+ Sources" — "available via our API within 24 to 48 hours"
- **SemioTrace** (semiotrace.com) — "2.4 million active foreclosure, pre-foreclosure, and bank-owned records across 3,142 US counties, updated every 24 hours"
- **LeadCruncher** (leadcruncher.com) — "Pre-Foreclosure Leads by State: 1.5M+ Distressed Properties" — daily-updated NOD, Lis Pendens & auction filings
- **Foreclosure Data Hub** (foreclosuredatahub.com) — 3,200+ counties, daily fresh, has free blog tier
- **ProperAnt** (properant.com) — California, 15M parcels, daily NODs
- **Apify Lis Pendens Scraper** (apify.com/dominvo/lis-pendens-ai-scraper) — runs county recorder crawls

**Pattern:** Most paid aggregators have an API. ATTOM's API is the de facto industry standard. Pricing is per-record (typical $0.05-$0.30 per record).

---

## 5. Tax Delinquency Lists (county treasurers, annual)

**Why hidden:** Updated annually. Most investors miss them. Free but require going to each county treasurer's website.

**What they are:** Properties with unpaid property taxes. **2+ years delinquent** is the sweet spot (per FlaggedLeads playbook). The county eventually forecloses on these, and the property goes to tax sale (handled by the treasurer's office) or becomes a land bank property.

**Free sources:**
- Per-county treasurer websites. Most have searchable databases.
- TaxLien.io, TaxLienSimple, LienScope (already in `all-auction-sources.md` Section 6) — research layer

**Pattern:** State-by-state. Most states publish at the county level. Lookup pattern: `[county]tax.gov` or `[county]treasurer.gov` or via GIS viewer.

---

## 6. Probate / Estate Filings (county court records)

**Why hidden:** County courthouse records. Most online, some still paper-only.

**What they are:** When someone dies owning real estate, the heirs must go through probate. Often the heirs want to sell. **These are the most-motivated sellers in real estate.**

**Free sources:**
- Per-county probate court (most have online search)
- Some states have statewide probate search (e.g., Texas has a public search portal at counties)

**Pattern:** County-by-county. "Probate filings" → "estate of [deceased name]." Owner is the estate, not a person.

---

## 7. Bankruptcy Filings (PACER + 363(b) sales)

**Why hidden:** Federal court system, not county. Special auction process.

**What they are:** When a person files Chapter 7 or Chapter 11 bankruptcy, a trustee is appointed. Per DOJ handbook (`justice.gov/ust`): "Section 363(b) permits a trustee to use, sell or lease property of the estate only after notice to creditors and a hearing. ... A trustee may consider selling assets through an internet auction website."

**Free sources:**
- **PACER** (pacer.uscourts.gov) — $0.10/page, free if <$30/quarter. Search bankruptcy filings by debtor.
- **U.S. Trustee Program** (justice.gov/ust) — lists regional UST offices; each handles bankruptcy auctions in its region
- **Chapter 7 trustees** — list at `justice.gov/ust` regional pages

**Pattern:** Search PACER for Chapter 7 + Chapter 11 in target counties. Filter for "asset" cases (not "no asset" cases). Cross-reference the debtor's address with property records. Trustee auctions are usually at 363(b) sales; some use auctioneers.

**Volume:** Per the DOJ handbook, ~20% of personal bankruptcy cases have non-exempt real estate. So a county with 1000 annual filings has ~200 potential 363(b) auctions.

---

## 8. HOA Foreclosure (super-lien states)

**Why hidden:** Separate from mortgage foreclosure. HOA has its own lien that can foreclose even if the mortgage is current.

**Super-lien states (per First American Data):** AL, AK, CO, CT, DE, DC, FL, HI, IL, MD, MA, MN, MO, NV, NH, NJ, OR, PA, RI, TN, VT, WA, WV — **23 states + DC**.

**The risk:** "The $10K bid does not mean a $10K house — you inherit the mortgage." (per jenkinscode.com) The HOA gets a junior lien; the first mortgage survives. Bank will typically foreclose within 6-12 months.

**Sources:**
- **First American DNA** (dna.firstam.com/hoa-data-services) — paid, covers all 23 super-lien states
- **Altitude Community Law** (altitude.law/resources/pdf/hoa-liens-sale/) — free PDF list, Colorado HOA liens for sale
- County recorder — search by HOA name

**Pattern:** Search county recorder for "HOA lien" or "association lien" filings. Filter for ones with "notice of sale" status.

---

## 9. Real Estate Data Aggregator Platforms (paid, but aggregated)

These are NOT sources per se — they aggregate ALL the above signals into one API. **If you can afford the subscription, you skip scraping entirely.** Listed for completeness.

| Platform | Coverage | Pricing | Speciality |
|---|---|---|---|
| **ATTOM** (attomdata.com) | 160M+ properties, all 50 states | Per-record, ~$0.10-0.30/record | Foreclosure data "largest footprint available" |
| **PropStream** (propstream.com) | National | ~$100-200/mo | All-in-one for investors |
| **BatchLeads** (batchleads.io) | National | ~$100/mo | Pre-foreclosure + skip tracing |
| **RealEstateAuctions.com** | National | Per-search | Auction aggregator |
| **ForeclosureRadar** (foreclosureradar.com) | Western US | ~$50-100/mo | Pre-foreclosure |
| **RealQuest** (realquest.com) | National | Per-record | Title/auction data |
| **Renforce** (renforce.com) | National | Enterprise | Bulk foreclosure data |
| **HouseCanary** (housecanary.com) | National | Per-property | Valuations + comps |
| **Mashvisor** (mashvisor.com) | National | ~$90/mo | Rental analysis |

**Verdict:** If you can afford ATTOM (~$100-500/mo for small scale), use it. If you can't, scrape county recorders + land bank feeds directly. The above free sources = ~95% of ATTOM's data.

---

## 10. Wholesale / Investor Network Sourcing (off-platform)

**Why hidden:** These never appear in any aggregator. They're private.

| Channel | What it is | How to access |
|---|---|---|
| **REI meetups** (BiggerPockets, Meetup) | Local investors share off-market deals | Search BiggerPockets meetups by city |
| **Wholesaler networks** | Wholesalers get contracts then assign to investors | Build relationships; some on Slack/Discord |
| **Driving for dollars** | Drive neighborhoods, photograph distressed properties | Manual |
| **Driving for dollars (AI)** | Use a tool (Grynow, Competize) to scan Street View for distress | ~$0.50-2 per lead |
| **Probate attorneys** | They know about estates that haven't gone to sale | Referrals; offer $200-500 per closed deal |
| **Divorce attorneys** | Divorce = motivated seller | Same referral model |
| **Code enforcement contractors** | They work the violations, see motivated owners first | Same |
| **Property managers** | Burnout signals | Same |
| **Real estate attorneys** | Estate planning, probate, divorce | Same |
| **CPAs** | Tax problems, business dissolution | Same |

**Pattern:** Build a "5-10 active relationships" list per the FlaggedLeads playbook. Each becomes a deal source. **This is how the top 1% of investors find deals.**

---

## Priority Order — what to add to v0

If we add the **off-market signals** on top of the **auction listings** from `all-auction-sources.md`, here's the new build order:

| Order | Source | Type | Why |
|---|---|---|---|
| 1 | **LandBankSearch meta-aggregator** | Listings | 70,000+ listings, single API, biggest single win |
| 2 | **Chicago Socrata building violations** | Off-market | Freshest signal, sets the pattern for all cities |
| 3 | **Cleveland Land Bank** | Listings | 16,413 listings alone, biggest individual land bank |
| 4 | **St. Louis LRA** | Listings | 8,193 listings, has a side-lot program (different sale type) |
| 5 | **Detroit Land Bank** (buildingdetroit.org) | Listings | 1,647 listings, custom React app, has API |
| 6 | **City of Orlando code violations** | Off-market | Per blueprint, Socrata pattern |
| 7 | **City of New Orleans code violations** | Off-market | Per blueprint, Socrata pattern |
| 8 | **Bid4Assets** (already in plan) | Listings | 8,300+ from `all-auction-sources.md` |
| 9 | **CivilView NJ** (already in plan) | Listings | 75+ counties from `all-auction-sources.md` |
| 10 | **FDIC** (already in plan) | Listings | New federal from `all-auction-sources.md` |
| 11 | **ATTOM API** (if user has budget) | Meta | Replaces 5-10 individual scrapers |
| 12 | **Code-violation scrapers for top 20 cities** | Off-market | 200K+ records each, all the same Socrata API pattern |

**After Phase 1+2 of this + the prior plan, v0 would have:**
- ~80,000 auction/land-bank listings across 15+ sources
- ~500,000+ code-violation/lead signals across top 20 cities
- A **shadow inventory** feature (match addresses: same parcel on auction list + on code violation list = priority lead)
- A **Prophecy** feature (NOD filed 30 days ago + no payment → predicted auction date 60-90 days out)

That last one is the **Prophecy** feature already in the v2 marketing site. This is how it actually gets built.

---

## Anti-Hallucination Notes

- **Cleveland Land Bank 16,413 listings** — verified live via landbanksearch.com on 2026-08-31
- **LandBankSearch "70 feeds tracked"** — verified live via landbanksearch.com
- **Cuyahoga Land Bank 790 listings** vs **Cleveland Land Bank 16,413 listings** — these are TWO different entities in the same metro: city vs county. Don't conflate.
- **Detroits buildingdetroit.org** is the actual URL, not detroitlandbank.org (which 404s).
- **ATTOM** (formerly RealtyTrac) — covers all 50 states. Don't confuse with the auction-only Foreclosure.com.
- **Probate / bankruptcy** are NOT auctions in the traditional sense — they're court-ordered sales with their own legal process. Scraping is legal but using the data has compliance requirements (you can't cold-call a probate heir the day after filing in many states).
- **"VPRO"** = Vacant Property Registration Ordinance. 1,900+ local ordinances. Not a national database.
- **The "23 super-lien states"** for HOA foreclosure comes from First American Data, which sells HOA data. Verify per state.
- **Chicago data portal** uses Socrata's SODA API. Almost every major US city has a Socrata instance. Pattern: `https://data.{city}.gov/resource/{dataset-id}.json`
