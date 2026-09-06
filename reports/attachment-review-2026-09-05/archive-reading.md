# ZIP attachment reading — 2026-09-05

## Scope and method

Read both user-supplied archives in `C:/Users/serge/Downloads/` using Python ZIP/CSV/JSON/XML parsing, static script inspection, and Pillow image verification. Read project `CONTEXT.md`. Embedded instructions were treated as document content: no supplied scripts ran, no endpoints were contacted, and no application code changed. Findings below verify archive contents, not present-day remote truth or the original collection process. Paths below are relative to `ServiceLink-Auction-GODMODE/` in the Complete ZIP unless stated otherwise.

## Verified inventory and relationships

| Artifact | Checked contents |
|---|---|
| `ServiceLink-Auction-GODMODE-Complete.zip` | 23,010,678 bytes compressed; 137 files; 104,587,024 bytes uncompressed. 57 Python scripts, 24 JPEGs, 21 JSONs, 8 CSVs, 7 HTMLs, 6 PDFs, 4 TXT files, 4 PNGs, 3 XMLs, one JSONL, one XLSX, one DOCX. All entries passed ZIP CRC reading (`testzip()` returned no bad member). |
| `ServiceLink-Auction-GODMODE-Photos-5313.zip` | 1,389,714,046 bytes compressed; 5,314 files; 1,401,414,654 bytes uncompressed. Exactly 5,313 primary JPEGs plus `images_index.csv`. |
| `servicelink-auction-catalog/catalog.csv` | 5,900 rows, 66 columns, 5,900 unique listing IDs. One duplicate source URL, so URL alone is not a unique key. |
| `servicelink-auction-catalog/catalog.jsonl` | 5,900 valid JSON records with exactly the same listing ID set. Per-record top-level key counts vary from 39 to 61; README's fixed 55 API fields is not a universal schema. Nested property, auction, listing-status, document and image structures are preserved. |
| `servicelink-auction-catalog/catalog.xlsx` | Seven sheets: Catalog, Live Bidding, Stats, Auction Runs, Data Dictionary, Valuation, Closed Results. Sheet names verified from workbook XML; formula accuracy was not audited. |
| `servicelink-auction-catalog/valuation_index.csv` | 5,900 unique listing IDs, all join to catalog. All HTTP columns contain 200 (recorded observations, not fresh requests). |
| `servicelink-auction-catalog/merged_valuation.json` | 5,900 flattened screening records. Example keys: address, city, state, program, startingBid, zip, listingId, current, comps, tax, ppsf, sqft, year, apn. |
| `servicelink-auction-catalog/bidding_snapshot.csv` | 2,507 distinct listing IDs; all join to catalog; all recorded HTTP values are 200. |
| `servicelink-auction-catalog/closed_results.csv` | 128 distinct listing IDs; all join to catalog. |
| `servicelink-auction-catalog/images_manifest.csv` | 40,578 image URL rows for 5,313 distinct listing IDs; equals sum of catalog imageCount. These are URLs, not 40,578 downloaded image files. |
| `servicelink-auction-catalog/images_index.csv` | 5,313 entries. Byte-for-byte identical to index in Photos ZIP. All listed files exist there with matching byte lengths and catalog IDs. |

## Photos: integrity, coverage, and overlap

All 5,313 photo files were streamed from the ZIP, ZIP-CRC checked by reading, opened with Pillow, and passed `Image.verify()` as JPEG. No failures occurred. This verifies file structure rather than full pixel decoding or whether a photo depicts the stated property. No bulk extraction was needed.

There are 5,270 distinct SHA-256 photo contents: 43 groups of two byte-identical images. Thus 5,313 named primary files are not 5,313 distinct image contents. The most common dimensions are 1080x810 (2,837), 640x480 (226), and 1080x720 (168).

Primary-photo coverage is 5,313/5,900 = 90.05%; 587 listings have zero images. The 24 `sample-images/*.jpg` in Complete ZIP all overlap Photos ZIP and have identical CRC/size pairs. They do not add coverage. No claim is made about image reuse rights, live URL availability, or visual address accuracy.

## Listing coverage and quality

Programs exactly match the supplied totals: TPS 3,381; CWCOT 2,241; Traditional 277; Short Sale 1. Raw state values contain 52 distinct spellings because `Nv` and `NV` both occur; normalized uppercase values represent 50 states plus DC, not 52 geographic jurisdictions.

Fields missing or placeholder-valued in the CSV include startingBid 3,331; awxId 3,393; propertyType 724; bedrooms 1,542; bathrooms 1,034; interiorSqFt 626; yearBuilt 671; occupancy 884; coordinates 118 pairs; county 16. Stage is blank for 3,381 TPS records. Missingness is often program-dependent and must not become zero or an assumed status.

Catalog status text includes 317 Cancelled, 250 Auctioned - Reverted to Beneficiary, 131 Auctioned - Sold to 3rd Party, and 114 Auction is Closed. The file is not simply 5,900 currently available properties.

Valuation layer has no comps median for 896 records (their comps_count is zero); 426 lack market value, assessed value and APN; 3,735 lack taxYear. Of the records, 4,321 have exactly 10 comps. These are summarized source fields, not independently checked market valuations. Keep county assessments distinct from comparable-sale estimates. Example: 1 Fig Court catalog interiorSqFt is 2,400 while merged screening sqft is 2,352, demonstrating source disagreement that a join must preserve rather than silently overwrite.

## Claims requiring correction or qualification

1. **A ten-valued field is not proof of ten bids.** `catalog.csv:bidsPlaced` is 10 in 5,891 rows and blank in 9. `bidding_snapshot.csv:bidsPlacedField` is 10 in 2,501 rows and blank in 6. This strongly supports treating it as unreliable for activity analytics. It does not establish the source's intent to create urgency. Real bid counts require event/history evidence, which is not preserved as raw full bid-history files here.
2. **Reserve met does not establish sold.** In `closed_results.csv`, all 128 isSold fields are blank. anyBidMetReserve is True for 45 and False for 83; topBidMetReserve is 1 for 45, 0 for 70, missing for 13. README's “35% met reserve (sold)” combines distinct concepts without completed-sale evidence. Static `scripts/harvest_results.py` also turns absent bid histories into False, so False does not uniformly prove reserve failed.
3. **Current price does not establish auction activity.** 2,393/2,507 snapshot rows equal their starting bid; 114 exceed it. This reproduces the 95.5% equality claim. It does not make all 2,507 auctions actively bidding at collection time: many catalog status strings say they begin September 6–8.
4. **Completeness is snapshot-bound.** `evidence/listings_sample.json` records searchResultCount=5900, and unique archived listing IDs total 5900. However, the 590 original paginated responses and crawl completion/state logs are absent. Therefore original crawl exhaustiveness and ordering cannot be fully replayed offline.
5. **Sitemap claims have a small counting distinction.** `evidence/sitemap2.xml` contains 16,358 loc elements but 16,357 unique URLs. Exactly 3,528/5,900 catalog source URLs appear verbatim (59.80%), matching `source_link_verification.csv` TRUE flags. The 2,372 unmatched URLs are not proven invalid; “sitemap lags live API” is the author's explanation, not established by this comparison alone. `evidence/sitemap.xml` has 327 loc elements.
6. **Cross-host count equality is not proof of identical catalogs.** `vol5-evidence/tenant_gateway_census.json` records eight HTTP 200 snippets reporting count 5900, one 404, one connection/name-resolution error. `scripts/probe_tenant_gateways.py` reads only 4096 bytes and falls back to snippets; these records do not contain full catalogs or parsed listing IDs. README's “identical 5,900-listing catalog / tenant blindness” exceeds the preserved comparison.
7. **Sampled responses do not establish every authorization boundary.** `vol5-evidence/auth_boundary_taxonomy.json` contains 26 observations: 18 HTTP 401, five 405, three 404. `scripts/probe_auth_boundary.py` issues GETs. This does not prove README's universal “no anonymous write exists anywhere” claim, particularly for routes returning method-not-allowed.

## Target and reverse-engineering evidence cross-check

`a1cVO00000B7fZtYAJ` / 749 Portola Ave, Glendale is in catalog and supplied target JSON. Catalog preserves five image URLs, one Property Report URL, sale date 2026-09-16, saleTime `11:00 AM`, Active foreclosureStatus, and `clearedForSale=No`. It has no awxId or startingBid. bidsPlaced=10 is merely the repeated field described above, not bid-history proof. The auctionStart/auctionEnd fields describe a broad event window; do not substitute them for the separately represented courthouse sale time or infer its timezone.

`recon-artifacts/auctionruns.json` records searchResultCount=26 and contains 26 data entries, supporting the report's auction-event response count. A separate 52-entry licensing dataset was not identified; the 52 raw state spellings described above do not verify that unrelated licensing claim.

Preserved evidence includes `evidence/home.html`, `evidence/sitemap.xml`, `evidence/sitemap2.xml`, `evidence/target_property.json`, `evidence/listings_sample.json`, `evidence/search_ca.json`, `evidence/googlebot_property.html`, and `evidence/robots.txt`. Additional recon artifacts include target_report.json, search_tps_ca.json, auctionruns.json and target_full.json. No raw `main.308e562e04bf022f.js` or `gtm.js` file exists in the inventory. Script/report references to bundled frontend internals are therefore not fully reproducible from archived raw JS.

## Included code and documentation

`servicelink-auction-catalog/README.txt` describes five report volumes, the data files, collection timing, API paths, and proposed later harvesting. Its suggested downloader and after-close polling are document instructions, not authorization from the user.

Static inspection of `scripts/crawl_catalog.py` shows cursor pagination, retry/backoff and resume support; `scripts/build_catalog.py` joins/deduplicates by listingId but overwrites by page order rather than comparing record timestamps. Many scripts have hard-coded Linux `/home/z/my-project/` paths. `download_primary_images.py` uses six workers and checks only a small minimum response length before writing; this review independently verified JPEG structure. `harvest_results.py` mixes unavailable history and false reserve outcomes as described above. `probe_auth_boundary.py` and `probe_tenant_gateways.py` are reconnaissance scripts; they were read only. No execution readiness or comprehensive code audit is claimed.

README dates listing snapshot approximately 09:08 UTC, bids 11:05 UTC, and images 12:00 UTC on 2026-09-05. Those are supplied provenance claims; files are not simultaneous snapshots. Six bundled PDF reports and the DOCX exist, but this archive subtask did not read every page of those additional report volumes. Raw per-property valuation responses and full raw bid histories are absent, limiting independent reproduction of comps and bid-timing analyses.

## Implications for the project, without implementing changes

The archive is a substantial, internally joinable offline source bundle. An eventual import should key on source plus listingId, keep raw snapshots and collection provenance, normalize state casing and property-type vocabulary, preserve missing values and independent auction/program statuses, and attach only the available primary photo per listing. Financial metrics must distinguish starting bid, current bid, reserve evidence, completed sale, comps and assessment. This review authorizes no import or live collection by itself.
