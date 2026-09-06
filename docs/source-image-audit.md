# Property-source image audit

Audit date: 2026-09-04. This is an evidence report, not an image import. No
listing, cache, credential, or scraper output was changed.

## Scope and acceptance rule

The configured registry has 15 sources. The static canonical seed contains 585
records. The enabled local live overlay was read at `.cache/live-listings.json`:
it contains 48 valid, observed CivilView source records (updated
2026-09-04T21:40:26Z). In the default in-memory API configuration, that makes
633 records before any coincident-ID replacement: CivilView is 413 and every
other source retains the static count below.

An image is acceptable only when it is a publisher-detail gallery image, or a
secondary property-detail page whose full street address (number, direction,
street, unit, city, state, ZIP) exactly matches the canonical record. Case,
punctuation, and standard street-type abbreviations may differ; a different
unit, ZIP, city, state, search thumbnail, map/street view, suggested home, or
stock photo is rejected. Counts are samples, never a claim of whole-source
coverage.

## Confirmed authentic publisher media

| Source | Strictly verified sample | Detail page / field | Actual image URL(s) or gallery availability | Coverage |
| --- | --- | --- | --- | --- |
| USDA RD/FSA REO | `USDA-MS-6278` — 1687 Arnold Drive, Starkville, MS 39759 | [USDA detail](https://www.resales.usda.gov/resales/public/SFHPropertyDetail?id=6278&listingType=Foreclosure), list-table cell 0 `img[src]`; detail page labels it `Property Image 1684875633011-1.jpg` | `https://www.resales.usda.gov/SFH_INTRANET/1684875633011-1.jpg` | 1 of 15 confirmed. The static data already has publisher-hosted USDA URLs; exclude `No_Image.jpg`. |
| GSA Surplus | `GSA-726LA058501` — 2731 Chestnut Street, New Orleans, LA 70130 | [GSA detail](https://realestatesales.gov/asset-details/?property_id=41), gallery link says 18 Photos; extractor selector `img.slide-img` | Static canonical first image: `https://d2m3yrz4x1yefr.cloudfront.net/property_image/1764008220.3193836_Picture2.jpg`; page confirmed 18 publisher gallery photos | 1 of 3 confirmed. Extract up to 12 `slide-img` images from the exact GSA detail page. |

The USDA page independently displays the exact address and its property image.
The GSA page independently displays the exact address and an 18-photo gallery.
No other source was promoted to verified media merely because the seed contains
a `photo` field: the audit found those fields are largely Unsplash fixtures.

## Secondary candidate result

| Canonical source records | Candidate | Result |
| --- | --- | --- |
| `CIV-NJ-7-2129273608`, `CIV-NJ-7-2129335953` — 19 WEST PARK AVENUE, PARK RIDGE, NJ 07656 | [Compass 19 W Park Ave](https://www.compass.com/homedetails/19-W-Park-Ave-Park-Ridge-NJ-07656/14XBVX_pid/) | Address matches exactly (West/W, Avenue/Ave). The accessible page currently reports **1 of 1**, a Google Street View image—not a Compass property gallery. The strict `SecondaryMediaCollector` attempted the validated page once per record with its circuit breaker and jitter; both requests failed to fetch, and neither was accepted. Do not attach this candidate. |
| Static Bid4Assets sample only: `B4A-1307883` has incomplete city/ZIP and therefore cannot pass strict secondary matching | [Compass 43 E 2nd St](https://www.compass.com/homedetails/43-E-2nd-St-Boyertown-PA-19512/1LBJN8_pid/) | Page confirms 43 E 2nd St, Boyertown, PA 19512 and renders property images, but it cannot be attached to the incomplete Bid4Assets record. It may become eligible only after the primary record obtains city `Boyertown` and ZIP `19512`. Do not infer it from an address-only record. |

The previously noted Redfin candidate for 43 E 2nd St remains rejected: it returned
403 and was not retried or bypassed.

## Complete configured-source inventory and image path audit

| Source (records in static / current default API) | Bounded audit result | Authentic-image path or actionable fix |
| --- | --- | --- |
| Bid4Assets (92 / 92) | No complete-address sample in seed; current `photo` host is Unsplash. | Scraper already maps API `PhotoUrl ?? ImageUrl`; retain only a URL carried on the exact auction record with publisher provenance. Enrich city/ZIP before secondary discovery. |
| CivilView Sheriff (365 / 413) | 48 live source records inspected; 19 West Park has two distinct publisher IDs and both have `photo: null`. Detail pages are evidence pages, not image galleries. | No publisher-gallery path observed. Keep both records. Secondary collector is possible only for complete addresses, but require a real gallery and exact JSON-LD match; reject map/street-view-only pages. |
| Fannie Mae REO (6 / 6) | Seed images are Unsplash fixtures; no bounded live detail request made. | Investigate the exact HomePath property detail/API media fields; accept only page-bound listing gallery URLs, not a broker-search result. |
| FDIC REO (50 / 50) | Records generally lack full city/ZIP; seed images are Unsplash. | Source API maps `photoUrl ?? imageUrl`; require a record-specific FDIC detail URL and complete address. Historical closed-sale records are not suitable for speculative secondary galleries. |
| Freddie Mac REO (5 / 5) | Seed images are Unsplash fixtures; untested. | Existing normalizer accepts `photo`, `image`, or `imageUrl` from a specific HomeSteps property object. Capture only that exact property response. |
| GSA Surplus (3 / 3) | Verified 1 exact detail page; publisher gallery present. | Use existing `img.slide-img` detail selector and CloudFront image host check. |
| HUD Home (8 / 8) | Seed images are Unsplash fixtures; untested. | Audit one exact HUD case detail response for official media payloads before enabling. No generic HUD search-card images. |
| IRS Seized (4 / 4) | Seed images are Unsplash fixtures; no live auction detail sampled. | Existing exact-detail extraction is `.field--name-field-asset-photos img`, bounded to the asset-photo field. Use it after verifying current `/ad/<slug>` URLs (not legacy fixture `/auction/...` URLs). |
| Land Bank (13 / 13) | Seed hosts are ArcGIS context imagery and `thelandbank.org`; not accepted as property media. | `landbanksearch` card parser can retain only actual card/detail photo URLs with exact listed address. Reject ArcGIS basemap/parcel imagery. |
| US Marshals (4 / 4) | Seed images are Unsplash fixtures; untested. | Inspect exact RealLook/USMS property detail page, not USMS inventory/collection pages. Add a publisher-specific media selector only after one full-address sample succeeds. |
| Sheriff Sale (6 / 6) | Seed images are Unsplash fixtures; untested. | Sheriff notices commonly have no photos. Accept only county-auction property-detail galleries; never use a court notice logo or assessor map as a photo. |
| Treasury Forfeiture (4 / 4) | Seed images are Unsplash fixtures; no current exact Treasury page sampled. | Existing exact-detail selector is `img[alt=full-property-address]`; run only against current Treasury `/rp/<slug>.shtml` details, not CWS fixture URLs. |
| Trustee’s Sale (5 / 5) | Seed images are Unsplash fixtures; untested. | Notices often lack imagery. Require a trustee-auction detail page with an exact address; do not scrape county index-page thumbnails. |
| USDA RD/FSA REO (15 / 15) | Verified 1 exact detail; actual publisher image available. | Keep summary-table `cell[0] img[src]` with detail URL and reject `No_Image.jpg`. |
| VA REO (5 / 5) | Seed images are Unsplash fixtures; untested. | Existing normalizer has `photoUrl ?? imageUrl` but a code review shows `photoUrl` rather than canonical `photo` in one path; test a live VRM property response and map a record-specific gallery only after confirmation. |

## Operational recommendations

1. Promote only GSA and USDA samples to the publisher-media verification test
   set now. They have exact first-party detail-page evidence.
2. Keep CivilView at `no publisher image` unless a strictly matching secondary
   page exposes an actual property gallery. The two Park Ridge records must
   remain separate evidence records even if a future gallery is shared.
3. For IRS and Treasury, the extraction selectors are already narrowly scoped,
   but their static records are fixtures; first collect fresh, exact detail URLs
   under the existing circuit breaker with 250–750 ms jitter.
4. For every untested source, use one or two current exact detail samples per
   source. Stop immediately on 403, CAPTCHA, or challenge response and report
   coverage as unavailable rather than substituting stock or nearby-property
   images.

## Second-pass live discovery (bounded; still incomplete)

This follow-up checked a live, official source surface or one canonical detail
URL for every source that had remained untested. It does **not** turn any
result into a media attachment unless the full canonical address and image
asset can both be verified.

| Source | Discovery/detail attempt | Result and next safe action |
| --- | --- | --- |
| Bid4Assets | [Auction 1088513](https://www.bid4assets.com/auction/1088513), an official archived exact-detail sample | Page exposes an “Asset Due Diligence Browser” and numbered thumbnails for the full address 1716 N Church St, Decatur, IL 62526. This proves an auction-detail gallery path. For a current canonical record, retain `PhotoUrl`/`ImageUrl` only from its own `/auction/<id>` response; its primary address must include city/ZIP. |
| CivilView | Current local observed record `CIV-NJ-7-2129273608` exact CivilView detail URL; companion publisher ID `2129335953` | Both detail records are current source evidence and both report no image. No source gallery was discovered; no retry/bypass was attempted. |
| Fannie Mae / HomePath | Seed detail `https://www.homepath.fanniemae.com/property-details/6039182` | Browser marked this old seed URL unsafe/non-retryable, so no media claim. Search surfaced current HomePath search material that visibly uses listing-card photos, but no current exact canonical property detail was discovered. Refresh listings before selecting one detail sample. |
| Freddie Mac / HomeSteps | Seed detail `https://www.homesteps.com/property/664912` | Browser marked this old seed URL unsafe/non-retryable. No detail gallery accepted. Refresh current HomeSteps inventory and extract only a page-bound property response. |
| HUD Home | Seed detail `https://www.hudhomestore.gov/Property/PropertyDetails?caseNumber=095-551029` | Browser marked old detail URL unsafe/non-retryable. No gallery inference was made. Discover an active HUD case first, then inspect its official property-detail media request. |
| FDIC | Current FDIC data source is the closed-real-estate API; seed records lack complete locality fields | No record-specific public detail page/galleries discovered in this bounded pass. Historical API `photoUrl`/`imageUrl`, if present, must accompany a complete exact address and source detail URL. |
| GSA | [Property 41](https://realestatesales.gov/asset-details/?property_id=41) | Confirmed exact current publisher detail and 18 photos; already accepted above. |
| IRS | [Current IRS auction: 10 Kingsport Dr](https://www.irsauctions.gov/ad/seeking-guaranteed-bid-stunning-newport-ca-property) | Page exposes first-party “Image Gallery” and “Asset Photos” for exact 10 Kingsport Dr, Newport Coast, CA 92657-1501. Use `/ad/<slug>` and `.field--name-field-asset-photos img`; image URLs still need an in-page extraction pass before attachment. This is a usable collector detail URL, not coverage of fixture records. |
| Land Bank | `thelandbank.org`/ArcGIS hosts in seed checked from source provenance | The observed seed media is either ArcGIS context imagery or land-bank host content not tied to a complete exact address; neither was accepted. Need an active land-bank detail/card that publishes a full address and actual photo. |
| US Marshals | Official RealLook search returned current USMS offering documents, e.g. 817 Baker St, Fort Worth, TX 76104, but only PDF in bounded result | A PDF brochure is not an image gallery. No property-detail HTML gallery accepted. Stop at brochure; do not scrape PDF or substitute imagery. |
| Sheriff Sale | Seed county source URLs are collection/notice pages, not record-specific detail pages | No exact active property gallery located in the bounded official pass. Treat county notices as no-image unless the exact auction system offers a property-detail gallery. |
| Treasury | Current Treasury primary route is the official `treasury.gov/auctions/treasury/rp` detail-page scraper path | No new active non-GSA Treasury detail was discovered in this pass. Existing strict candidate is only `/rp/<slug>.shtml` with exact `img[alt=full-property-address]`; do not use legacy CWS fixture URLs. |
| Trustee’s Sale | Seed county trustee URLs are collection/notice pages | No record-specific gallery discovered. Treat as no-image until an exact trustee auction detail page is observed. |
| USDA | [USDA 6278 detail](https://www.resales.usda.gov/resales/public/SFHPropertyDetail?id=6278&listingType=Foreclosure) | Confirmed exact first-party property image; already accepted above. |
| VA / VRM | [Current VRM Virginia inventory](https://www.vrmproperties.com/Properties-For-Sale?currentPage=1&orderBy=default&state=VA); old seed `vrmproperties.com/property/VA-31-55291` was unsafe/non-retryable | The current VRM inventory has actual property cards (for example, 358 Lincoln St, Hampton, VA 23669), proving an official live media surface. It does not match an existing fixture record, so it cannot be attached. Discover the card’s exact detail URL and gallery only for a fresh matching record. |

Result: primary publisher images are verified for **2 of 15 source families**
(USDA and GSA). IRS, Bid4Assets, and VRM have confirmed current image-capable
surfaces but no new canonical-record attachment from this audit. The remaining
sources are explicitly unverified/no-gallery/blocked—not silently filled with
stock or secondary imagery.
