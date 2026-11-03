# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are distressed-property investors, foreclosure auction buyers, legal underwriters, and real estate triage analysts seeking off-market deals through county sheriff sales, tax deed sales, trustee auctions, and federal dispositions (HUD, Fannie Mae, Freddie Mac, USDA, VA, IRS, Treasury, US Marshals, GSA).

## Product Purpose

PerfectProperty is an evidence-first discovery and triage engine for distressed and government-sold real estate. Its purpose is to surface high-spread opportunities while forensically exposing the hidden statutory catches—such as unexpired redemption windows, surviving senior tax liens, uninspected tenant occupancy, and non-negotiable cash-to-close deposit requirements—before buyers wire certified funds. Success means a buyer never bids on a property unaware of its legal or financial liabilities.

## Positioning

"Zillow for distressed property, with an AI that reads the fine print and tells you if each one is actually a deal — and what the catch is." Unlike generic MLS aggregators or opaque auction marketplaces that cosmetically mask liabilities to pump bid activity, PerfectProperty treats missing facts as liabilities and highlights the catch first.

## Operating Context

- County courthouse step auctions, online sheriff sales (e.g. CivilView, RealAuction, Bid4Assets), and federal forfeiture dockets.
- High-stakes, asymmetric financial environments where winning bids are binding and deposits are forfeited upon failure to close.
- Statutory redemption clocks (e.g., up to 180 or 365 days post-sale in states like AL, TN, NM) where former owners retain buy-back rights.
- Cashier's check and wire deposit deadlines requiring pre-auction title clearance.

## Capabilities and Constraints

- **Multi-source ingestion**: Ingests across 16 federal and county sources in two waves (Wave 1: Fannie, FDIC, Freddie, GSA, HUD, IRS, Marshals, Treasury, USDA, VA; Wave 2: Bid4Assets, CivilView, Landbank, ServiceLink, Sheriff, Trustee).
- **Zero-Fabrication Underwriting**: Never imputes `estLow`, `estHigh`, or ARV from opening bid or tax assessed value; requires explicit buyer assumptions when publisher valuations are absent.
- **Legal & ToS Guardrails ($0 Liability Moat)**: Discovery and triage layer only. Zero cold homeowner outreach (avoids TCPA and statutory foreclosure consultant liabilities like CA Civil Code § 1695). Never bypasses CAPTCHAs, never violates `robots.txt`, and never bot-scrapes press portals with liquidated damages.
- **Evidence-First Token Palette**: UI strictly speaks evidence tokens (`ink`, `paper`, `catch`, `yours`, `go`, `signature`).

## Brand Commitments

- **Evidence Ink Identity**: `#181529` midnight ink, `#f5f6f7` cool paper, `#a92e14` persimmon catch-wash, `#ffe24a` sunlit butter signature, and `#0b7a56` celadon green.
- **Color Grammar Rule**: Green is strictly prohibited from denoting "good deal" or "verified" (no distressed asset is safe by default); green is reserved exclusively for user actions and live feed indicators. Persimmon is reserved exclusively for liabilities, missing required terms, and the catch.
- **Honest Scarcity**: Gaps in source data are drawn as explicit unknown blocks rather than masked with empty dashes or omitted rows.

## Evidence on Hand

- Canonical Next.js 16 App Router UI in `src/` and Node HTTP API in `server/`.
- Seed inventory in `data.js` and live store in `.cache/live-listings.json`.
- Statutory distress catalog in `test/statutory-distress-catalog.test.js`.
- Title-risk engine and notice parser in `server/intelligence/`.
- Design token test suite in `test/design-tokens.test.mjs`.

## Product Principles

1. **A gap is drawn, not hidden**: A missing value occupies the same footprint as a published fact and is never collapsed. Empty space quietly reads as safe; a gap must look like a warning.
2. **Every value has an origin**: Values are visibly categorized as Printed (published by source), Yours (buyer-supplied estimate with pencil underline), or Unknown (persimmon hatch).
3. **Weakest-link derivation**: Any derived calculation is only as confident as its weakest input. If an estimate is typed, the output is "yours"; if an input is missing, the output is "unknown".
4. **Color is spent on evidence, not decoration**: Every color maps to evidence state, never aesthetic mood.
5. **No manufactured alpha**: Never equate "closed" with "sold", and never fabricate bidding competition countdowns.

## Accessibility & Inclusion

- WCAG 2.1 AA compliance across all buyer-facing surfaces.
- High contrast type ratio: body and placeholder text ≥ 4.5:1 (`text-ink-3` is minimum AA on `bg-paper`).
- Support for `forced-colors: active` using dashed `CanvasText` borders.
- Semantic HTML and full screen-reader label parity on interactive evidence elements.
