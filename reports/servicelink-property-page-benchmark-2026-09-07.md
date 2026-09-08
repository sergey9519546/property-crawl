# ServiceLink property-page benchmark — 247 S Carmelina Ave

Date: September 7, 2026 (America/Los_Angeles; some source timestamps render as September 8 UTC)

Reference: [ServiceLink Auction — 247 S Carmelina Ave](https://www.servicelinkauction.com/property-details/247-s-carmelina-ave-los-angeles-90049-ca-united-states-tps)

Local comparison: `http://localhost:3103/listings/servicelink%3Aa1c3k000004S9j7AAC`

## Scope and evidence standard

The live reference page was inspected while signed out in a separate background browser tab at the default desktop viewport (1280 × 720) and at 390 × 844. The audit exercised controls that only change the local page state: gallery navigation, Gallery/Map/Street View switching, one Street View step, market subpanels, auction disclosure expansion, responsive menus, and access-gated entry points. It did not sign in, create an account, submit interest, favorite a property, send mail or chat, bid, upload, or enter contact information. The two gated Property Report controls were clicked only far enough to establish that they open the sign-in modal; no restricted document was downloaded.

“Observed” below means visible page text, DOM state, or a control outcome in this session. It does not establish how ServiceLink’s Angular application or private backend is implemented. Publisher-displayed tax, public-record, comp, school, and location data should remain attributed to the publisher page unless separately corroborated against an official source.

## Reference experience

### Page frame, identity, and navigation

- Desktop header: ServiceLink Auction logo; Listings menu; Auction calendar; Support menu; inline global search; Sign Up; Sign In.
- Listings menu: All homes for sale, Bank-owned, Foreclosure, Newly foreclosed, Short sale.
- Support menu: Contact us, Blog, Financing.
- Global search expands inline to a city/state-style search field and search button.
- Breadcrumbs are interactive: Home → California → Los Angeles → 90049 → 247 S Carmelina Ave.
- Share is a signed-out `mailto:` link with a prefilled subject/body containing the exact URL, address, property type, county, occupancy, beds, baths, square feet, lot size, and year built. The mail client was not opened.
- Mobile replaces the desktop navigation with a hamburger. Its expanded navigation retains Listings, Auction calendar, Support, Sign In, and Sign Up. Breadcrumbs wrap across lines; desktop Share is absent from the inspected mobile state.
- The footer adds listing-category links, support links, app-store badges, social links, legal/privacy/licensing links, Equal Housing attribution, and contact/help surfaces. A chat launcher is persistent. Chat was not started.

### Hero gallery and geographic context

- Three publisher-hosted JPEGs are present. Prev/next controls update the counter from `1/3` through `3/3` and wrap the active carousel item.
- The hero includes a favorite heart, a `Hot property` badge, and persistent Gallery / Map view / Street view mode controls.
- Clicking the active photo, including the annotated third image, did not open a lightbox. No gallery download control or photo-fullscreen control was found. Google Map and Street View provide their own fullscreen controls.
- Map view is a Google map centered on a single orange marker near `34.053787, -118.480018`. It exposes Map/Satellite layers, keyboard and camera controls, fullscreen, “Open this area in Google Maps,” terms, and map-error reporting.
- Street view opens Google imagery at `12401 Shady Dr, Los Angeles`, near the property coordinate rather than asserting verified frontage. It provides east/west Shady Dr navigation arrows, click-to-walk behavior, pan/zoom/fullscreen, Google attribution, “View on Google Maps,” show-on-map, and problem reporting. One eastward step changed the panorama and coordinates, confirming that the viewer is navigable.
- The reference page does not disclose capture date or distance from the matched property coordinate in its own chrome.

### Property identity and safety

- Address: `247 S Carmelina Ave`, `Los Angeles · CA · 90049 · Los Angeles County`.
- Program badge: Foreclosure.
- Headline facts: 4 bed, 4 bath, 3,304 sq ft.
- Property details: Single family home; 4 bed; 4 bath; 3,304 sq ft; built 1926; 7,796 sq ft lot; occupied.
- A red, high-prominence warning says the property is occupied, no person may enter, and entering may constitute trespassing.
- The four section links are Property, Market analysis, Neighborhood, and Documents. They navigate one long page whose sections remain present, rather than swapping the whole dossier out of the DOM.

### Auction card and foreclosure workflow

- Program: Foreclosure; “Live event conducted by ServiceLink Auction.”
- Status: `Active - postponed`.
- Sale: October 5, 2026 at 11:00 AM.
- Sale location: courtyard at 400 Civic Center Plaza, Pomona, CA 91766.
- The first “What to bring” item says 100% of funds are due at sale in cashier’s checks payable to the bidder as a natural person, not a legal entity.
- View more / View less reveals the second preparation item, linking to ServiceLink’s official [What to bring to a foreclosure auction](https://help.servicelinkauction.com/en/articles/3326631-what-to-bring-to-foreclosure-auction) article.
- Foreclosure contact: Idea Law Group, `(877) 353-2146` via a `tel:` link.
- Submit Interest opens the same sign-in modal described below; no interest form is available anonymously and nothing was submitted.
- At desktop width, the auction card remains in a right column beside the property content. Its ancestor uses the class `sticky-bid`, but computed positioning was `relative` in the observed 1280 × 720 state, so persistent sticky behavior was not verified. On mobile it moves inline immediately after the hero/address and before the safety warning and content sections.

### Market analysis

Comparable sales is the default subpanel. It loaded ten rows after an initial transient “Data unavailable at this time” state. The table fields are number, proximity, address, sale date, price, price per square foot, square feet, room, beds, baths, year built, and lot size. Observed examples range from 0.04 to 0.19 miles and include 242 S Carmelina Ave ($4.46M, sold August 17, 2022) and 12308 9th Helena Dr ($11.7M, sold February 14, 2023). “Read More” is sign-in gated.

County tax and assessment shows:

- Assessment year 2022.
- Assessed land $3,363,771; improvements $105,117; total $3,468,888.
- Total tax $21,580.30; rate-code area `0-067`; delinquent year 2021; APN `4405-037-002`.
- Value year, tax year, homeowner exemption, tax exemptions, and subdivision name are shown as unavailable (`--`).
- “Read More” is sign-in gated.

Public record shows a publisher-displayed detail grid: lot 7,796 sq ft; 4 baths; central heat; wood construction; 4 beds; built 1926; A/C yes; 3,304 sq ft building area; pool yes. Buildings, garage, style, room count, stories, basement, roof, partial bath, units, cars, fireplace, and exterior walls are `--`. “Read More” is sign-in gated.

No mortgage, payment, bid, or cash-to-close calculator was present on this property page. “Financing” appears only as a support/navigation destination.

### Neighborhood

- Commute Score is present but sign-in gated.
- Walk Score®, Transit Score®, and Bike Score® labels are visible, but the signed-out page displayed no numeric values in this session.
- Nearby Schools is sign-in gated. The anonymous table exposes only headers: School, Grades, GreatSchools rating, Distance, Student count, Ratio. No rows were rendered while signed out.
- The UI names Walk Score and GreatSchools, but the session did not expose a separate methodology/source panel. Treat these as named third-party labels, not verified coverage or values.

### Documents, disclaimer, and authentication

- The Documents section says documents are available for this address and renders two separate controls, both labeled `Property Report`. They have no anonymous `href`, duplicate the same DOM id, and are indistinguishable by visible name while signed out.
- Either Property Report control opens authentication before download. The anonymous session therefore proves two gated document entries, not their file names, contents, versions, official status, or URLs.
- The public [Bidder Terms and Conditions PDF](https://www.servicelinkauction.com/assets/documents/Bidder-Terms-and-Conditions.pdf) is separately linked from the disclaimer and does have a direct URL.
- The disclaimer says property information is informational, may be sourced from governmental or quasi-governmental entities, may be incomplete or inaccurate, and requires independent due diligence and public-record review.
- The shared sign-in modal contains Email address, Password with reveal control, Forgot password, Remember me, disabled-until-valid Sign In, and Sign Up. It repeats a property-information/condition disclaimer.
- This same modal was observed from favorite, Submit Interest, Commute Score, Nearby Schools, a market/public-record “Read More,” and Property Report. No account action was taken.

### Recommended properties

- A Recommended properties carousel follows the dossier. Twelve cards were present in the DOM during inspection.
- Cards include program/status badges, address and county, bed/bath/area, property type, occupancy, starting or estimated opening bid when published, auction timing, a detail link, and an independent favorite control.
- The visible inventory mixed foreclosure and newly foreclosed listings across multiple states. Previous/Next buttons navigate the carousel. On mobile the same cards remain carousel content.

## Local application comparison

The canonical local page is materially stronger than the reference for provenance, research discipline, and Street View disclosure, but it does not yet reproduce the publisher page’s most important auction facts and media.

### Current local strengths

- Exact publisher link, source-observed timestamp, evidence timeline, raw-snapshot access, file-integrity disclosure, opportunity-signal ledger, research questions, and modeled-research labeling.
- Desktop auction card is explicitly `lg:sticky lg:top-8`; mobile moves the card inline below media. The latest intended navigation is one inline Back to results action above the title.
- `ListingMedia` now renders the three exact-record publisher photos, a Map tab, and Street View with explicit loading/unavailable states.
- The Google Exterior Walkthrough is working on desktop and mobile. It rendered the same nearby Shady Dr panorama, allowed walking and camera movement, supplied Google controls and attribution, and included a Return to property action.
- The local disclosure adds what ServiceLink omits: July 2022 capture date, 26 m starting distance from the matched property location, and an explicit statement that street context is not verified frontage. This is the right truth standard. It supports nearby-coverage fallback and does not justify a nationwide-imagery claim.
- Missing normalized fields are usually rendered as Not published / Not established instead of invented values. The page avoids bidding and payment controls and hands the user to the exact publisher record.

### Parity matrix

| Capability | ServiceLink reference | Local canonical page | Gap / disposition |
|---|---|---|---|
| Publisher identity and display label | ServiceLink Auction | Customer-facing UI deliberately displays `Public Auction Network`; collector evidence identifies ServiceLink Auction | Intended boundary: retain the neutral UI label while preserving original publisher identity and exact URLs in stored evidence |
| Address/location | Street address plus city/state/ZIP/county | Street address now leads once, with city/state/ZIP/county on the location line | Parity reached without losing the exact stored address |
| Gallery | 3 publisher photos, arrows, count | 3 exact-record publisher photos, arrows, count | Parity reached; local provenance disclosure is stronger |
| Gallery fullscreen/download | No gallery fullscreen/download observed | No gallery fullscreen/download | Parity already; do not invent this requirement |
| Map | Google marker and Map/Satellite controls | Map tab is now available from accepted exact-record coordinates | Functional parity reached with a different public map renderer |
| Street walkthrough | Walkable Google Street View, no distance/capture disclosure | Walkable Google Embed plus capture date, 26 m distance, fallback, and Return | Local is stronger; retain disclosures and coverage limits |
| Hot/favorite | Hot badge; favorite requires ServiceLink account | No hot badge; local watchlist requires private-workspace unlock | Watchlist gate is acceptable; Hot needs an explicit source field before display |
| Share | Prefilled email share | No share action | Low priority; add Web Share/copy-link only if product need is confirmed |
| Occupancy safety | Prominent occupied/trespass warning | Hero notice says `Occupied · No interior access`, attributes it to the publisher, and links the decision to source verification | Critical access state is now prominent without inventing a trespass quote |
| Auction status/date/time | Active-postponed; Oct 5, 2026, 11 AM | Known date/time now leads the card when opening amount is absent; full lifecycle status is an amber badge | Parity reached for captured fields |
| Sale location | Courtyard address in auction card | Full-width, left-aligned sale location appears in desktop and mobile cards | Parity reached for captured field |
| Funds/eligibility | 100% cashier’s checks; natural-person payee | Cash-only `Yes` and financing `No` are shown as publisher facts; opening amount and deposit remain compact explicit gaps | Preserve unknown money fields until payment text is captured |
| Foreclosure contact | Idea Law Group and phone | Attorney Not published | Needs a separately observed public-detail field; do not infer from feed absence |
| Property facts | Includes lot size and occupancy | Omits 7,796 sq ft lot despite source/raw evidence | Extend normalized facts and render the lot size |
| Comparable sales | 10 publisher-displayed rows; deeper data gated | Explicit “no comp evidence captured” | Preserve current fail-closed state until exact comp provenance is collected |
| Tax/assessment | Assessed values, tax, APN, delinquent year; deeper data gated | Assessed value Not published | Optional enrichment; distinguish publisher-displayed data from official county evidence |
| Public-record facts | Heat, construction, A/C, pool and many unknowns | Research dossier/public-record workflow, but these fields absent | Optional publisher snapshot; prefer official corroboration in dossier |
| Walk/schools | Provider labels but no anonymous values; controls auth-gated | ACS/local-context research may be available; no Walk Score/GreatSchools panel | Low parity value until licensed/available data exists |
| Documents | Two indistinguishable auth-gated Property Reports plus public terms PDF | Boolean-only evidence says the publisher reports documents available; no inventory/count is claimed without an array | Still model access state and observed labels/count separately; link publisher, do not mirror gated files |
| Recommended properties | 12-card carousel | None on property page | Add a canonical same-area/same-program query after higher-value auction facts |
| Section navigation | 4 anchors; mobile overflow menu | 5 horizontally scrollable anchors | Local is functional; consider active-section state, not a copy of duplicate-id/weak-tab semantics |
| Loading/error/auth states | Transient comp unavailable state; shared sign-in gate | Explicit photo/Street/map/evidence unknown and fallback states; workspace unlock | Local states are clearer; retain them and add document `auth_required` state |

## Ranked implementation recommendations

### Follow-on implementation completed during this audit

- The property route now fails closed when the canonical listing service cannot supply the record; it no longer substitutes the bundled marketing fixture or claims the record disappeared from an active feed.
- Address, media, known sale schedule, lifecycle badge, sale location, and occupied/access state now lead the desktop and mobile hierarchy. A missing opening amount is a compact row rather than the card headline.
- Repetitive unknown-only auction rows were replaced by observed terms plus one concise critical-gap notice. Publisher identifiers, evidence timing, market-empty state, and modeled scenarios are collapsed under clear disclosures.
- Section navigation is reduced to Overview, Auction, Research & history, and Scenarios. The single inline Back to results action remains above the title.

The remaining recommendations below retain their original priority but should be read against this completed state: items 1–2 are delivered for currently captured fields; item 3 is complete for the UI/address boundary but still needs a stored-raw versus exported-projection audit; item 4 still needs a richer document contract; and the gallery/map work in items 5–6 is now connected.

### P0 — high impact, low-to-medium effort

1. **Promote already captured auction facts into the hero card and terms section.** The canonical API already contains `tpsSaleTime`, `tpsSaleLocation`, `auctionMethod`, `clearedForSale`, `isCashOnly`, `isFinancible`, and `interiorAccessAvailable` in source evidence/raw snapshots. Extend the normalized listing contract where necessary, then render publisher-observed time, location, access, and funds requirements in `src/app/listings/[id]/page.tsx` and `src/components/listings/sale-mechanics.tsx`. Keep unknown values explicit and do not turn the cashier’s-check statement into bidding advice or a calculated cash-to-close amount.

2. **Add the occupied/no-entry safety callout near the title/media.** Use the publisher occupancy plus a separately captured `interiorAccessAvailable === false` signal. Render the warning prominently on desktop and mobile before research tools. `src/app/listings/[id]/page.tsx` owns placement; `src/components/listings/sale-mechanics.tsx` can retain the evidence-level copy.

3. **Preserve the publisher/display boundary and fix address display.** The neutral `Public Auction Network` label is an intentional customer-facing branding rule documented in `docs/reference-audit/verification.md`; it is not a parity defect. Keep `ServiceLink Auction` in immutable collector/database evidence and apply the neutral alias only at UI/export boundaries. The local API response observed through the web route contained an alias-transformed URL inside its exported raw string; that observation does not prove the underlying database raw value was changed, so compare stored raw evidence with the exported projection before changing serialization. Separately, render the street address once instead of repeating city/state/ZIP already present in `listing.address`. Relevant paths: `server/scrapers/servicelink.js`, `src/lib/source-display.ts`, export/serialization code, and the title/location block in `src/app/listings/[id]/page.tsx`.

4. **Make document evidence truthful at field level.** `hasDocuments: true` currently causes `SaleMechanics` to say “Publisher document inventory captured,” while the dossier says “Document inventory was not supplied.” Model at least `presence`, `observedCount`, `labels`, `access` (`public`, `auth_required`, `unknown`), `sourceRecordUrl`, and `observedAt`. For this record the defensible state is two publisher-displayed entries, label `Property Report`, auth required, content/URL unknown, plus a separate public bidder-terms link. Update `src/components/listings/sale-mechanics.tsx` and document rendering in `src/app/listings/[id]/page.tsx`; avoid copying gated files.

### P1 — high value, medium effort

5. **Collect the public publisher gallery with exact-record provenance.** `server/scrapers/servicelink.js` currently marks public listing media `not_collected`, while the live page exposes three publisher-hosted images and the dossier reports three references. Capture each public image URL with the exact ServiceLink detail URL, record id, publisher, observation time, and `source_extracted` verification. Existing `verifiedPublisherPhoto()` and `src/components/listings/listing-media.tsx` can then render the 3-photo carousel without weakening exact-address safeguards.

6. **Accept the map coordinate only after binding coordinate provenance.** The canonical API has the same coordinates used by the live ServiceLink map, but the local UI did not offer a Map tab. Store the publisher field path and observation record for latitude/longitude so `inspectMapLocation()` can accept them. Reuse the existing MapLibre/OpenFreeMap mode in `src/components/listings/listing-media.tsx`. Keep the live Google Exterior Walkthrough as-is, including capture date, start distance, coverage fallback, walking/panning, and Return to property.

7. **Expose lot size and other safe publisher facts.** Add 7,796 sq ft lot size to the normalized contract and property overview. Consider cash-only, financeable, access, sale-cleared, auction method, property/global/asset ids, and sale-time fields. Each must retain publisher field path and observation timestamp. Do not fill the attorney from a generic source label; Idea Law Group was observed on the public detail page and needs its own detail-page evidence.

8. **Add publisher-market panels only with visible provenance and freshness.** A compact accordion for publisher-displayed comps, assessment/tax, and public-record facts would close a major discovery gap. Label it “Displayed by ServiceLink” with observed time, then place official county evidence beside it when available. Keep `PropertyIntelligence` as the corroboration layer. Do not call these official county values merely because the publisher disclaimer says governmental sources may be used.

### P2 — useful, lower priority or higher dependency

9. **Add related properties from the canonical inventory.** Query same county/state/program, exclude the current id, and render a small responsive carousel/grid after the dossier. Reuse the existing listing-thumbnail/media primitives and canonical source-link policy. Avoid hard-coded recommendations.

10. **Add copy-link/native-share rather than reproducing the email-only share.** This is a product convenience, not a core auction-data gap. Include exact source attribution in shared text. Do not trigger an external mail client without a user click.

11. **Defer Walk Score/GreatSchools parity.** The signed-out reference exposes names and empty headers, while actual values are account-gated. Add neighborhood providers only when licensing, attribution, coverage, and unknown states are clear. The local dossier’s source-labeled area context is more useful than empty imitation.

12. **Do not duplicate ServiceLink’s sign-in/interest flow.** PerfectProperty is a discovery and triage layer. Keep Save to watchlist behind the local workspace lock and route Submit Interest/bidding/payment activity to the exact publisher page. A clearly labeled “Open publisher to submit interest” link is enough if the CTA is needed.

## Product judgment

The best reference pattern is the page hierarchy: publisher photos and geography first, urgent access warning near the decision point, auction mechanics in a persistent card, then facts, market context, neighborhood, documents, and related inventory. The local application should borrow that hierarchy while preserving its stronger provenance and uncertainty model.

The most valuable immediate release is therefore: preserve the intentional neutral display label while keeping original publisher evidence intact; normalize street address and lot size; surface the already captured 11:00 AM sale time, Pomona courthouse location, cash/access signals, and a factual occupied/access-unavailable notice; make the two auth-gated document entries truthful; then connect the three exact-record publisher photos and accepted coordinate to the existing media component. The verified Google walkthrough is already at or above functional parity and should keep its capture-distance and coverage disclosures.
