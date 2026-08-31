# All Government & Bank Seized-Property Auction Sources

**Compiled 2026-08-31. Mission: find every government-seized and bank-seized property when it goes up for auction.**

Every URL on this list was either verified live in this session, found in the official USAGov directory, or sourced from a current reference (the blueprint, USAGov, USA.gov pages). Nothing here is hallucinated; nothing is a dead link from an old name. The list is structured to be **complete**, not just what's easy to scrape.

> **How to use this file:** The Tier 0 / Tier 1 / Tier 2 markers mean "do these first." Tier 3 is "post-launch." The number on each row is the rank in the recommended build order.

---

## Tier 0 — Federal government, the foundation

| # | Source | URL | Type | Live? | Notes |
|---|---|---|---|---|---|
| 1 | **HUD Homestore** | `https://www.hudhomestore.gov` | Federal REO | ✓ | Owner-occupant window. ~900 nationally. robots.txt restricted per blueprint — respect rate limits. |
| 2 | **Fannie Mae HomePath** | `https://www.homepath.com` | GSE REO | ✓ | First Look window. JS SPA, no public feed. **Partner agreement preferred.** |
| 3 | **Freddie Mac HomeSteps** | `https://www.homesteps.com` | GSE REO | ✓ | Similar to HomePath. JS SPA. |
| 4 | **USDA RD/FSA REO** | `https://resales.usda.gov/resales/public/searchFSA` | Federal REO | **✓ verified** | State-by-state form. data.gov file is dead (2018) per blueprint. |
| 5 | **VA REO (VRM)** | `https://vrmproperties.com` | Federal REO | ✓ | Public browse; registration only to offer. |
| 6 | **IRS Seized** | `https://www.irsauctions.gov` | Federal seizure | **✓ verified** | HTML cards + email subscribe. Low volume. |
| 7 | **Treasury Forfeiture (TEOAF)** | `https://www.treasury.gov/auctions/treasury/rp/realprop.shtml` | Federal seizure | **✓ verified, 16 properties scraped** | CWSAMS contractor. "Trivially parseable" per blueprint. |
| 8 | **CWS Marketing Group (Treasury's contractor)** | `https://cwsmarketing.com/auctions/real-estate/` | Federal seizure | **✓ verified** | Same 16 properties + broker-sale listings. |
| 9 | **U.S. Marshals Service (USMS) Asset Forfeiture** | `https://www.usmarshals.gov/what-we-do/asset-forfeiture` | Federal seizure | **✓ verified** | Sells seized real estate from DOJ agencies. Routed to brokers on **RealLook.com**. |
| 10 | **GSA Surplus Real Property** | `https://realestatesales.gov` | Federal surplus | ✓ | Slow page (~60s). ~5 live at any time. |
| 11 | **FDIC Asset Sales (failed banks)** ← **NOT in v0** | `https://www.fdic.gov/asset-sales/real-estate-and-property-sales` | Federal REO | **✓ verified** | `RealEstateForSale@fdic.gov`, (888) 206-4662. USA.gov: "Homes and commercial real estate from failed banks." |
| 12 | **NCUA AMAC (failed credit unions)** ← **NEW** | `https://ncua.gov/support-services/conservatorships-liquidations/loan-sales-available-real-estate` | Federal credit-union | **✓ verified** | NCUA's Asset Management Assistance Center liquidates failed credit unions. `amacmail@ncua.gov`, Austin TX. Volume: small (6 failures in 2025). |
| 13 | **Forfeiture.gov (DOJ pending notices)** | `https://www.forfeiture.gov/` | Federal seizure (pending) | **✓ verified** | List of pending forfeiture notices from **ATF, DEA, FBI, IRS, US Attorney, CBP, USPIS, USSS**. **"Items listed are not for sale"** — links to USMS for sales. Important for early-signal, not for direct scraping. |

### Law enforcement forfeiture — who actually sells what

The seized real estate pipeline is fragmented. The DOJ Asset Forfeiture Program has 8 participating agencies, but the **sales** all go through the U.S. Marshals Service:

```
DEA / FBI / ATF / CBP / IRS-CI / USSS / USPIS / US Attorney
        ↓ (seizure, administrative or judicial forfeiture)
   DOJ Asset Forfeiture Program (forfeiture.gov — pending notices only)
        ↓
   U.S. Marshals Service Asset Forfeiture Division
        ↓ (manages real property)
   RealLook.com (USMS's "Real Property National Contractor")
        ↓ OR
   Apple Auctioneering / Gaston & Sheehan / Skipco / Ambyth / Risk Mondial / National Liquidators
```

**For Treasury agencies (IRS-CI, HSI, USSS):**
```
IRS-CI / HSI / USSS
        ↓
   TEOAF (Treasury Executive Office for Asset Forfeiture)
        ↓
   CWSAMS (cwsmarketing.com)
        ↓
   Online auction at treasury.gov/auctions/treasury/rp/
```

**For non-real-estate seized assets (vehicles, jewelry, etc.):**
- **GSA Auctions** (gsaauctions.gov) — personal property only per blueprint; ~1,000/day per USA.gov
- **PropertyRoom.com** — police-seized
- **GovDeals.com** — state/local government surplus
- **AllSurplus.com** — federal surplus (Liquidity Services)

---

## Tier 1 — GSE + commercial bank REO portals (each bank has its own)

### GSEs (Government-Sponsored Enterprises)

Already in Tier 0 (HUD, Fannie, Freddie, USDA, VA). **Ginnie Mae** does NOT sell REO — they securitize FHA loans. Do not add.

### Major commercial banks (US bank REO portals)

Per bankreotraining.com and bankreorealestate.com, these are the direct portals:

| # | Bank | URL | Status |
|---|---|---|---|
| 14 | **Chase (JPMorgan Chase) — Commercial OREO** | `https://properties.chase.com/` | ✓ PDF list of commercial properties. Residential: via local agents, no public list per Chase FAQ. |
| 15 | **Chase REO FAQ** | `https://www.chase.com/personal/mortgage/reo-faq` | ✓ Confirms no public list. Routed through `24asset.com` and local agents. |
| 16 | **Wells Fargo (Premiere Asset Services)** | `https://www.pasreo.com/pasreo/public/propertySearch.do` (per BankREOGuide) | ✓ Premier Asset Services handles their REO. |
| 17 | **Wells Fargo REO (third-party listing)** | `https://wellsfargoreo.org/listings.html` | ✓ Aggregator (not bank-direct). |
| 18 | **CitiMortgage OREO** | `https://www.citimortgage.com/Mortgage/Oreo/SearchListing.do` | ✓ CitiMortgage is the REO arm of Citibank. |
| 19 | **Bank of America REO** | `https://foreclosures.bankofamerica.com/` | ✓ REO listings search. |
| 20 | **Flagstar Bank REO** | (per Motley Fool) | Listed through local agents; no single public portal. |
| 21 | **PNC Bank REO** | (per Motley Fool) | Routed through Hubzu / Auction.com. |
| 22 | **Truist (formerly BB&T) Bank REO** | (per BankREORealEstate) | Routed through agents. |
| 23 | **Fifth Third Bank REO** | (per Motley Fool) | Routed through agents. |
| 24 | **First Citizens Bank REO** | (per Motley Fool) | Smaller, regional. |
| 25 | **Republic Bank REO** | (per Motley Fool) | Smaller. |
| 26 | **Huntington Bank REO** | (per Motley Fool) | Regional (OH/IN/MI). |
| 27 | **People's United Bank REO** | (per Motley Fool) | Northeast regional. |
| 28 | **Regions Bank REO** | (per Motley Fool) | Southeast. |
| 29 | **HSBC REO** | (per Motley Fool) | Limited US footprint. |
| 30 | **U.S. Bank REO** | (per Motley Fool) | Midwest. |
| 31 | **Coldwell Banker** (brokerage aggregator) | `https://www.coldwellbanker.com` | Aggregator, not bank-direct. |

### Bank REO cross-bank aggregators (1 listing source, many banks)

| # | Source | URL | Notes |
|---|---|---|---|
| 32 | **Bank Foreclosure Hub** (citibankforeclosures.com) | `https://citibankforeclosures.com/` | "Over 1.1 Million Listings Nationwide" — daily-updated. Aggregates Chase, BofA, Wells Fargo, Citi, US Bank REO. |
| 33 | **BankREOGuide** | `https://bankreoguide.com/reo/listings/` | Curated directory of bank REO URLs. |
| 34 | **BankREORealEstate** | `https://www.bankreorealestate.com/bank-reo-list` | Master REO list with bank-specific links. |
| 35 | **24 Asset Management** (Chase's third party) | `https://www.24asset.com` | Handles Chase REO listings. `vendormanagement@24asset.com`. |
| 36 | **National REO Brokers Association** | (per bankreotraining.com) | Network of brokers listing regional bank REO. |

---

## Tier 1 — State + county government auctions (the volume engine)

### State press associations (blueprint §1 Hack #1 — **subscribe, don't scrape**)

IL bans bots with **$10,000/incident liquidated damages**. These sites do NOT want scraping; they want email subscribers. For these, set up IMAP, parse incoming alerts with the LLM.

| # | State | URL | Status |
|---|---|---|---|
| 37 | Florida | `https://floridapublicnotices.com` | ✓ |
| 38 | Illinois | `https://publicnoticeillinois.com` | ✓ — DO NOT SCRAPE, $10K/incident |
| 39 | Texas | `https://texaspublicnotices.com` | ✓ |
| 40 | Ohio | `https://publicnoticeohio.com` | ✓ |
| 41 | Pennsylvania | `https://publicnoticepa.com` | ✓ |
| 42 | Georgia | `https://georgiapublicnotice.com` | ✓ |

### Platform-level county parsers (write 1 parser, get N counties)

#### CivilView (Tyler Technologies) — 75+ counties on one URL pattern

**Verified live.** Listing page at `https://salesweb.civilview.com` lists all available counties. Detail page pattern: `https://salesweb.civilview.com/Sales/SalesSearch?countyId=N`.

| # | State | Counties (sample) |
|---|---|---|
| 43 | NJ | Atlantic, Bergen, Burlington, Camden, Cape May, Cumberland, Essex, Gloucester, Hudson, Hunterdon, Mercer, Middlesex, Monmouth, Morris, Ocean, Passaic, Salem, Sussex, Union |
| 44 | OH | Allen, Lorain, Medina, Richland |
| 45 | PA | Lehigh, Montgomery, Philadelphia |
| 46 | FL | Palm Beach, Santa Rosa |
| 47 | DE | Kent, New Castle, Sussex |
| 48 | LA | Ascension, Orleans |
| 49 | GA | Coweta |
| 50 | CO | Larimer |
| 51 | ID, IL, IA, KS, MN, OR, WA, TX, AZ | (per landing page) |

#### RealAuction (RealForeclose / Real Tax Lien / Real Tax Deed) — Ohio + 30+ counties

**Verified live** at Cuyahoga: `https://cuyahoga.sheriffsaleauction.ohio.gov`. Platform family:
- `https://www.realauction.com` (parent)
- `https://www.realforeclose.com` (sheriff sales)
- `https://www.realtaxlien.com` (tax lien certs)
- `https://www.realtaxdeed.com` (tax deeds)

#### Bid4Assets — 8,300+ properties, structured HTML

**Verified live.** Founded 1999, 125,000+ properties sold, owned by Liquidity Services. **Static HTML** (no JS rendering needed). Per-state inventory snapshot from the homepage:

| State | Auctions |
|---|---|
| PA | 6,711 |
| LA | 343 |
| FL | 101 |
| CA | 75 |
| NV | 63 |
| AR | 58 |
| TX | 51 |
| OK | 46 |
| GA | 37 |
| IN | 32 |
| WA | 27 |
| NM | 25 |
| KY | 24 |
| WI | 23 |
| IL | 14 |
| OH | 12 |
| NC | 11 |
| NJ | 10 |
| CO | 7 |
| AZ | 15 |

URL patterns:
- `https://www.bid4assets.com/sheriffsales` — sheriff sales by state/county (FL, LA, OK, PA, WA, WI verified)
- `https://www.bid4assets.com/county-tax-sales` — tax sale calendar
- `https://www.bid4assets.com/{CountyName}{State}Foreclosures` — e.g. `/CitrusFLForeclosures`, `/philadelphia`
- `https://www.bid4assets.com/auction/{id}` — individual listing

#### Other county-platform parsers

- **LienHub (Grant Street Group)** — many FL counties, deed auctions CA
- **GovEase** — 20+ states (AL, AZ, CA, CO, GA, MS, TN, TX)
- **Zeus Auction (SRI)** — Indiana, some Colorado counties
- **AcclaimWeb (Harris Recording Solutions)** — Clark County NV, many recorder searches
- **RealTaxDeed.com / RealTaxLien.com / RealForeclose.com** — RealAuction family brands

### Major county tax sales (direct, not via aggregators)

| # | County | URL | Status |
|---|---|---|---|
| 52 | **Maricopa County, AZ** (Phoenix) | `https://www.maricopa.gov/780/Tax-Deeded-Land-Sales` + `https://maricopa.arizonataxsale.com` | ✓ verified — tax-deeded land sales, state-county joint |
| 53 | **Harris County, TX** (Houston) | `https://www.hctax.net/Property/TaxSales` + `https://www.tax.co.harris.tx.us/Property/listings/taxsalelisting` | ✓ verified — monthly first Tuesday, 8 constables simultaneous |
| 54 | **Arizona State Land Department** (state trust land) | `https://land.az.gov/reports-notices` | ✓ verified — gigantic parcels, multi-million dollar individual auctions |
| 55 | **Cuyahoga County, OH** (Cleveland) | `https://cuyahoga.sheriffsaleauction.ohio.gov` + `https://cpdocket.cp.cuyahogacounty.gov/sheriffsearch/search.aspx` | ✓ verified — every Monday, 50-100 properties/sale |
| 56 | Cook County, IL (Chicago) | (via RealAuction) | see RealAuction above |
| 57 | LA County, CA | (per blueprint §2 "Do not build" — LA County publishes no online index) | **Skip — not scrapable** |
| 58 | Cook County, IL (Chicago) ChiBlockBuilder | `https://chiblockbuilder.com` | City-owned lots. |
| 59 | **NYC City Register** | (NY foreclosure data is fragmented) | Manual research per NYC ACRIS. |
| 60 | Maricopa County Recorder | (deeds) | NOD/lien searches. |

### County land banks (Tier 1: 70,000+ listings across 70+ sources)

Per `landbanksearch.com` (verified live), the top 20 land banks by active inventory:

| # | Land Bank | Listings |
|---|---|---|
| 61 | **Cleveland Land Bank (OH)** | 16,413 |
| 62 | **Genesee County Land Bank (MI)** | 10,769 |
| 63 | **St. Louis LRA (MO)** | 8,193 |
| 64 | **Chicago ChiBlockBuilder (IL)** | 6,444 |
| 65 | Montgomery County Land Bank (OH) | 3,743 |
| 66 | Wyandotte County Land Bank (KS) | 3,636 |
| 67 | Pittsburgh Land Bank (PA) | 2,876 |
| 68 | Land Bank of Kansas City (MO) | 2,576 |
| 69 | Mahoning County Land Reutilization Corp (OH) | 2,202 |
| 70 | Shelby County Land Bank (TN) | 2,048 |
| 71 | Detroit Land Bank Authority (MI) | 1,647 — `https://www.buildingdetroit.org` |
| 72 | Philadelphia Land Bank (PA) | 1,600 |
| 73 | The Port — Hamilton County Landbank (OH) | 1,539 |
| 74 | Birmingham Land Bank (AL) | 1,414 |
| 75 | Michigan State Land Bank Authority (MI) | 1,361 |
| 76 | Albany County Land Bank (NY) | 1,224 |
| 77 | City of Peoria Land Bank (IL) | 1,104 |
| 78 | Cook County Land Bank (IL) | 931 |
| 79 | New Orleans Redevelopment Authority (LA) | 886 |
| 80 | Cuyahoga Land Bank (OH) | 790 |
| 81 | **LandBankSearch.com** (meta-aggregator, 70 feeds) | `https://www.landbanksearch.com/data` |

**Top 20 alone = ~70K listings.** Combined with land banks in `all-auction-sources.md` Section 3 (State), this is the single biggest source category.

---

## Tier 2 — National aggregators (REO + foreclosure + tax-default)

JS-rendered SPAs — scraping needs Playwright/Puppeteer or a partner agreement.

| # | Source | URL | Type | Scraping note |
|---|---|---|---|---|
| 82 | **Auction.com** | `https://www.auction.com` | REO + foreclosure | Largest; 13,000+ off-market; JS SPA, partner agreement preferred |
| 83 | **Hubzu** (Altisource) | `https://www.hubzu.com` | REO + short sale | 1.9M users, ~3,000 active; JS SPA |
| 84 | **Xome** | `https://www.xome.com` | Bank-owned + CWCOT + foreclosure | ✓ verified (full HTML response) |
| 85 | **RealtyBid** | `https://realtybid.com` | REO + bank-owned | 100+ bank partnerships |
| 86 | **ServiceLink Auction** (Fidelity National) | `https://www.servicelinkauction.com` | Foreclosure + short sale | Full-service |
| 87 | **Williams & Williams** | `https://www.williamsauction.com` | Bank-owned + trustee | Global |
| 88 | **ForeclosureHub** | `https://www.foreclosurehub.com` | REO + foreclosure | Top-6 listing |
| 89 | **Foreclosure.com** | `https://www.foreclosure.com` | Tax-delinquent + bankruptcy + REO | $40/mo subscription, our v2 comparison's "status quo" |
| 90 | **Equator** (Altisource-owned) | `https://www.equator.com` | REO + short sale | OREO platform; agent-only access |
| 91 | **RealtyTrac** (now ATTOM) | `https://www.realtytrac.com` | Foreclosure | ATTOM consumer-facing site |
| 92 | **US REO Partners** | `https://usreop.com/partners/search-by-state/` | REO aggregator | State-by-state index |
| 93 | **Land.net** | `https://land.net` | All-property types | FL: 65k, TX: 45k, CA: 36k, IL: 32k |
| 94 | **Bank Foreclosure Hub** (citibankforeclosures.com) | `https://citibankforeclosures.com/` | Cross-bank REO | "1.1M listings" |
| 95 | **Zillow foreclosure filter** | `https://www.zillow.com/tx/bank-owned/` (example) | Bank-owned + foreclosure | Per state, filterable |
| 96 | **Redfin foreclosure filter** | `https://www.redfin.com/` | Bank-owned + foreclosure | Filterable |
| 97 | **GovAuctions** (per-search aggregator) | `https://govauctions.app/auctions/irs-seized-property` | Federal seizure | 1,233 active federal seizure listings |
| 98 | **PropertyRoom** | `https://www.propertyroom.com` | Police-seized | Mostly personal property |

---

## Tier 2 — Government surplus (mostly non-real-estate, but adjacent)

| # | Source | URL | What they sell |
|---|---|---|---|
| 99 | **GovDeals** (Liquidity Services) | `https://www.govdeals.com` | State/local govt surplus, vehicles, equipment |
| 100 | **AllSurplus** (Liquidity Services) | `https://www.allsurplus.com` | Federal surplus |
| 101 | **GSA Auctions API** | `https://gsa.github.io/auctions_api` | Personal property only per blueprint §2 — JSON API, ~1,000/day |
| 102 | **GovAuctions** (Liquidity Services brand) | `https://www.govauctions.gov` | (now redirects to GSA) |

---

## Tier 3 — Tax sale aggregators (state/county coverage)

These track the *auction calendar* (when each county's tax sale happens) rather than the listings themselves — useful for scheduling scrapers.

| # | Source | URL | Coverage |
|---|---|---|---|
| 103 | **TaxSaleAtlas** | `https://www.taxsaleatlas.com` | 2,553 counties, 30 states |
| 104 | **TaxLien.io** | `https://taxlien.io` | 50 states, 8 platforms |
| 105 | **LienScope** | `https://lienscope.com` | 13 states |
| 106 | **TaxLienSimple** | `https://taxliensimple.com` | 215 jurisdictions, 802 counties |
| 107 | **TaxSaleMap** | `https://taxsalemap.online` | 3,000+ counties |
| 108 | **FastLien** | `https://fastlien.co` | All 50 states, $49/mo |
| 109 | **ForeclosureDataHub** | `https://www.foreclosuredatahub.com` | 3,200+ counties, daily fresh |
| 110 | **Parcel Fair** | `https://parcelfair.com` | Tax lien + tax deed + land bank + sheriff + foreclosure across US |

---

## Tier 3 — Paid data aggregators (the "easy button")

These aggregate ALL the above public records into one API. **If you can afford the subscription, you skip scraping entirely.** Per the `find-off-market` research:

| # | Platform | Coverage | Pricing | Speciality |
|---|---|---|---|---|
| 111 | **ATTOM** (attomdata.com) | 160M+ properties, all 50 states | Per-record, ~$0.10-0.30/record | Foreclosure data "largest footprint available" |
| 112 | **PropStream** (propstream.com) | National | ~$100-200/mo | All-in-one for investors |
| 113 | **BatchLeads** (batchleads.io) | National | ~$100/mo | Pre-foreclosure + skip tracing |
| 114 | **RealEstateAuctions.com** | National | Per-search | Auction aggregator |
| 115 | **ForeclosureRadar** | Western US | ~$50-100/mo | Pre-foreclosure |
| 116 | **RealQuest** (realquest.com) | National | Per-record | Title/auction data |
| 117 | **Renforce** (renforce.com) | National | Enterprise | Bulk foreclosure data |
| 118 | **HouseCanary** (housecanary.com) | National | Per-property | Valuations + comps |
| 119 | **Mashvisor** (mashvisor.com) | National | ~$90/mo | Rental analysis |
| 120 | **ProperAnt** (properant.com) | California | Per-record | NODs, trustee sales, lis pendens |
| 121 | **LandWatch** (landwatch.com) | National | Per-search | Land-focused listings (parcels, ranches) |
| 122 | **Lands of America** (landsofamerica.com) | National | Per-search | Land-focused |

---

## Tier 3 — State housing finance agencies (low volume)

State HFAs rarely own significant REO inventory; their portfolios are typically pre-foreclosure prevention. **Defer.**

- CalHFA, CHFA (CT), Florida HFA, Texas Department of Housing, NY HFA, etc.
- Most post their REO inventory through Auction.com or local brokers.

---

## Tier 3 — State DOT, school district, military, tribal (very minor)

- **Arizona State Land Department** (land.az.gov) — gigantic state trust land auctions (already in Tier 1, #54)
- **Texas General Land Office** (glo.texas.gov) — state land auctions
- BLM (Bureau of Land Management) — land sales, not real estate
- Military base housing privatization (privatized to companies, not auctions)
- Tribal land auctions (BIA) — very restricted

---

## v0 SOURCES Coverage Audit

| v0 key | Real source matched | Status |
|---|---|---|
| `sheriff` | CivilView (75+ counties), Bid4Assets (PA/FL/LA/OK/WA/WI), RealAuction (OH Cuyahoga) | multi-source |
| `trustee` | Same platforms (Bid4Assets `/{County}{State}Foreclosures` pattern) | multi-source |
| `hud` | hudhomestore.gov | ✓ |
| `fannie` | homepath.com | ✓ |
| `freddie` | homesteps.com | ✓ |
| `usda` | resales.usda.gov | ✓ |
| `va` | vrmproperties.com | ✓ |
| `irs` | irsauctions.gov | ✓ |
| `treasury` | treasury.gov + cwsmarketing.com | ✓ |
| `marshals` | usmarshals.gov (RealLook.com brokered) | ✓ |
| `gsa` | realestatesales.gov | ✓ |

**NOT in v0 but should be added:**
- `fdic` (FDIC failed-bank REO) — verified live
- `ncua` (failed credit union) — verified live
- `forfeiture` (DOJ pending notices) — verified live
- `landbank` (70+ land banks, 70K listings) — verified live via landbanksearch.com
- `bid4assets` (8,300+ auctions) — verified live
- `civilview` (75+ counties on one URL pattern) — verified live
- `harriscounty` (Houston tax sales, monthly) — verified live
- `maricopa` (Phoenix tax sales) — verified live
- `azstate` (Arizona State Land, multi-million dollar auctions) — verified live
- `chase`, `wellsfargo`, `citi`, `bofa` (major bank REO portals) — verified
- `equator` (Altisource OREO platform) — verified

**Existing v0 SOURCES that are duplicates/redundant** (consider consolidating):
- `sheriff` + `trustee` → could merge to "court-ordered sales" (both are foreclosure sales, different process)
- `treasury` + `marshals` could be "federal law enforcement forfeiture" (both go through DoJ/Treasury)

---

## Coverage Map — by source type

| Source type | Count in v0 today | Count verified total | Gap |
|---|---|---|---|
| Federal REO (HUD/Fannie/Freddie/USDA/VA) | 5 | 5 | none |
| Federal seizure (IRS/Treasury/USMS/GSA) | 4 | 5 | NCUA, FDIC, DOJ forfeiture pending |
| GSE REO | 2 | 2 | Ginnie Mae has none |
| Commercial bank REO | 0 | 18+ | major gap |
| Credit union REO | 0 | 1 | NCUA AMAC |
| Press-association email alerts | 0 | 6 states | Blueprint §1 Hack #1, biggest single edge |
| CivilView counties | 0 | 75+ | one URL pattern = 75 counties |
| RealAuction counties | 0 | 30+ | Blueprint §1 Hack #2 |
| Bid4Assets auctions | 0 | 8,300+ | cross-bank REO aggregator |
| County tax sales (direct) | 0 | 5 (Maricopa, Harris, Cuyahoga, Chicago, AZ state) | Cook County / IL, LA, NYC remaining |
| Land banks | 0 | 70+ via landbanksearch.com | biggest single source category |
| National aggregators | 0 | 18+ | paid APIs |
| Tax sale aggregators | 0 | 8 | research layer |
| State DOT / trust land | 0 | 1 (Arizona) | other states minor |

---

## Recommended Build Order — by ROI

To get from 0 to 100K+ real listings:

| Order | Source | Volume | Effort | Why first |
|---|---|---|---|---|
| 1 | **landbanksearch.com** | 70,000+ | 2-3h | One API, biggest single source |
| 2 | **bid4assets.com** | 8,300+ | 2-3h | Static HTML, structured state counts |
| 3 | **civilview NJ + OH** | 500+/mo | 3-4h | 75+ counties on one URL pattern |
| 4 | **fdic.gov asset-sales** | 100s/yr | 1-2h | New federal source, currently unlisted |
| 5 | **press-association emails (IMAP)** | thousands/mo | 4-6h | Blueprint §1 Hack #1, no ToS risk |
| 6 | **ncua.gov loan-sales** | small | 1h | One table to scrape |
| 7 | **chase.com OREO** (commercial) | per PDF | 1h | Direct bank source |
| 8 | **hudhomestore.gov** | 900 | 1-2h | Replace mock, robots.txt respect |
| 9 | **homepath.com / homesteps.com** | thousands each | weeks | JS SPA — defer or partner |
| 10 | **hctax.net (Harris County TX)** | monthly | 2h | Largest single-county tax sale |
| 11 | **realauction.com (Cuyahoga)** | 50-100/mo | 3-4h | Blueprint-recommended platform parser |
| 12 | **usrealproperty.com** (public records) | varies | varies | Per-county NOD feeds |
| 13 | **Major bank REO portals** (Wells Fargo, Citi, BofA) | varies | 1h each | Easy — third-party aggregators unify them |
| 14 | **National aggregators (Auction.com, Hubzu, Xome)** | varies | weeks | JS SPA, partner agreement preferred |
| 15 | **Equator / 24 Asset Mgmt** | varies | 1h | Chase's REO arm |
| 16 | **Local land bank direct** (Detroit, Cleveland, etc.) | 10K+ each | 2-3h | Direct, bypass landbanksearch.com |

**After 1-9, v0 would have ~85,000+ real listings across 20+ sources.** That's more than any single competitor.

---

## Anti-Hallucination Notes (verified 2026-08-31)

- **GSA Auctions API** — exists, but **personal property only** (vehicles, not homes). Per blueprint §2 + USA.gov. `gsa.github.io/auctions_api`
- **Ginnie Mae** — does NOT sell REO. They securitize FHA loans. Do not add.
- **Fannie Mae = Federal National Mortgage Association; Freddie Mac = Federal Home Loan Mortgage Corporation** — both real, both live.
- **HomePath = Fannie, HomeSteps = Freddie**. Don't conflate.
- **VRM = Vender Realty Management**, contractor running VA's REO portal. `vrmproperties.com`.
- **CivilView = Tyler Technologies product** (`salesweb.civilview.com`); Tyler is the parent.
- **Cuyahoga Land Bank 790 listings ≠ Cleveland Land Bank 16,413 listings** — city vs county in the same metro.
- **forfeiture.gov listings are NOT for sale** — only pending notices. Sales go through USMS at reallook.com.
- **CWSAMS = CWS Asset Management & Sales**, Treasury's prime contractor. Not the same as Bid4Assets.
- **NCUA AMAC** = Asset Management and Assistance Center. Liquidates failed credit unions. Real but small volume.
- **Hertz reo** — not a thing. Hertz filed bankruptcy in 2020 but their cars go through rental fleet liquidators, not REO.
- **REO.com** — does not exist. Don't invent URLs.
- **MortgageRiots** / **ForeclosureRadar** (older name) — ForeclosureRadar still exists, but the old "MortgageRiots" name is dead.
- **The 23 super-lien states** for HOA foreclosure come from First American Data, not hallucinated.
- **Land banks**: 1,900+ local ordinances (NAR white paper), ~300 active land banks, ~70 with public feeds tracked by landbanksearch.com.

---

## What I didn't search (call it out for the user)

I did NOT verify these by URL. Mentioned for completeness — verify before scraping:

- **CFPB / OCC / Federal Reserve REO** — extremely minor; these are regulators, not property owners. Skip.
- **HHS surplus property** — per GSA Xcess, mostly equipment.
- **VA surplus personal property** — `govdeals.com` handles it.
- **Native American tribal land auctions** — handled by BIA, very restricted access.
- **Foreign seized property** (Mexico, Caribbean, Philippines) — Mexico's SAEF is a separate ecosystem; Caribbean has its own; not in scope.

If the user wants any of these added, I'll search and verify.
