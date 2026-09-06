# Source Atlas attachment reading

Reviewed attachment: `C:/Users/serge/Downloads/Property_Intelligence_Source_Atlas_VERIFIED_2026-09-05.docx` (171,273 bytes). Review date: 2026-09-05. This is an offline document review, not a new verification of publishers, endpoints, licensing, laws, or commercial claims. The document's operational instructions are quoted or summarized as document content; none were executed. Read `CONTEXT.md` for project context; no application changes or external requests were made.

## Assessment

The atlas is a broad source-discovery registry and a useful architecture/control brief. Its most important distinction is that a live page does not establish a claimed capability, production access, completeness, or reuse rights. Its title's “VERIFIED” label should remain an attributed statement by the document author. The attached file contains summarized audit outcomes rather than reproducible HTTP captures, browser evidence, schema samples, or raw audit logs.

The source registry is not 501 production integrations or 501 independent databases. It includes government datasets, commercial products, point-lookup portals, local record-request routes, community discovery references, tools, calculators, duplicated source families, and derived-signal ideas. The document explicitly acknowledges these distinctions.

## Internally checked facts

Parsed the DOCX package and all 31 tables, including all registry rows, crosswalks, and the audit ledger. Extracted document text is preserved in `atlas-extracted.txt` beside this report.

- The registry contains **501 rows with 501 unique IDs**, spanning IDs 1–501. Newer IDs are inserted into thematic sections rather than appearing entirely in numerical order.
- The appendix contains **557 URL audit rows**. Its outcome counts match the front scorecard exactly: **430 CONFIRMED - HTTP; 89 CORROBORATED - browser/search; 17 REPLACED; 21 INCONCLUSIVE - blocked**.
- The source-level distribution below independently matches the front distribution and sums to 501.
- The DOCX contains **728 hyperlink relationship targets**. **110 registry URL display cells and 139 resolved/replacement display cells contain ellipses**, but most link targets retain full URLs. A plain-text extraction must not be used as the canonical URL inventory. One relationship target actually contains a placeholder: `https://sonomacounty.gov/.../search-our-records`.
- **24 appendix rows have no source-ID mapping** (an em dash). Examples include the capitalized Apollo.io/Auction.com variants, Hunter.io, EstateSales.net, Homes.com, Legacy.com, Land.com, and several community routes. Thus the source-to-URL mapping is not complete for every row.
- The appendix counts distinct **cited strings**, not deduplicated canonical endpoints. For example, Apollo.io/apollo.io and Auction.com/auction.com have separate rows.
- The package contains no embedded screenshots, media evidence, or attached raw audit files. Its author metadata says OpenAI; created/modified metadata both say 2013-12-23, inconsistent with the stated 2026 audit date and likely inherited template metadata. Metadata therefore does not independently authenticate audit timing.

### Source-status distribution

| Status | Count |
|---|---:|
| VERIFIED - official | 167 |
| VERIFIED - first-party | 101 |
| VERIFIED - scope limited | 61 |
| LIVE SOURCE - claim limited | 60 |
| LOCAL ROUTE - verify jurisdiction | 50 |
| DISCOVERY ONLY | 16 |
| VERIFIED SOURCE - dynamic claim | 14 |
| INCONCLUSIVE - access blocked | 10 |
| LOCAL ROUTE - verify provider | 3 |
| RETIRED/REPLACED | 2 |
| REPLACED - first-party | 2 |
| REPLACED - official | 2 |
| VERIFIED - access restricted | 1 |
| REPLACED - official alternative | 1 |
| BROKEN/UNVERIFIED | 1 |
| REPLACED - publisher route | 1 |
| VERIFIED - member restricted | 1 |
| VERIFIED - academic | 1 |
| WITHDRAWN - dead citation | 1 |
| RESTRICTED/CASE-SPECIFIC | 1 |
| RESTRICTED/HISTORICAL | 1 |
| LOCAL/PROGRAM ROUTE | 1 |
| LOCAL/MEMBER ROUTE | 1 |
| RETIRED/REPLACED - unofficial mirrors | 1 |
| LOCAL ROUTE - verified example | 1 |
| **Total** | **501** |

## Coverage and source roles

Part I covers assessor/ownership (32), recorder/deeds/mortgages (28), foreclosure/tax/government inventory (23), courts/distress/life events (41), skip tracing/contact (46), entity/corporate/FOIA (25), demographic/economic/mobility data (46), geospatial/environment/imagery (80), valuation/rents/listings (29), infrastructure/tools/discovery (30), and PropertyRadar competitive references (12). These headings total 392. Sections 12.1–12.7 add 105 entries across public inventory, manufactured housing, title, institutional portfolios, agriculture, water, infrastructure, neighborhood conditions, special registries, archives, geocoding, and monitoring; two final sections add four entries, producing 501.

Part I source IDs 61–83 are the closest direct listing-discovery sources: county foreclosure notices, Bid4Assets, tax-sale directories, excess-proceeds lists, HUD HomeStore, HomePath, HomeSteps, GSA Auctions, and Auction.com/Ten-X. Other relevant routes include land-bank and tax-forfeited inventory (381–382), sheriff lists (398), institutional surplus (397/408/409), manufactured-home title registries (389–392), recorder/title evidence (33–60, 399–406), and local notices (411). The atlas is much broader than an auction feed and does not itself provide a ServiceLink extraction specification.

## Architecture and recommendations stated by the document

**Part II, §§13–14:** Maps 12 product categories and 13 DIY field families to preferred sources and transforms. County assessor/GIS supplies parcel identity and characteristics; recorder/title records supply transfers and encumbrance evidence; courts/tax/sheriff supply events; licensed listing/contact sources supply their respective fields; agency geospatial data supplies contextual risk layers. Entity links require evidence-backed graph edges. Model outputs belong in separate fields from observed records.

The document says its corpus maps roughly **60–70 named field families**, not an actual complete 250-filter matrix. The current authoritative PropertyRadar filter export/UI inventory was not supplied, and §14 explicitly declines to invent the missing filters.

**Part III, §§15–17:** Describes an address-to-parcel workflow: normalize input, resolve APN/geometry, obtain assessor/tax/recorder evidence, check applicable loan/court sources, resolve entities, append permitted contacts, triangulate value/rent, attach risk/permit context, and retain contradictions and open questions. Bulk requests should target existing native records, stable keys, code dictionaries, defined geography/date range, fees, and delivery cadence. These are proposed workflows, not completed acquisitions.

**Part IV, §§18–19:** Offers ten analytic signals—quitclaim chains, servicing changes, exemption aging, unfinished permits, recurring violations, tax hardship, flood-map/claims context, lien sequences, vacancy mismatch, and entity-transfer networks. Each includes a failure mode. Particularly useful controls: a quitclaim is not proof of distress; a servicing transfer is not delinquency; a complaint is not a finding; aggregate vacancy is not a vacant-house determination; a registered agent is not beneficial ownership; original principal is not current debt.

**Part V, §20:** Describes access/reuse restrictions, suppression and consent records, sensitive-event controls, consumer-report restrictions, MLS licensing, area-versus-person distinctions, retention, and review. These are the document's operational/legal guidance, not independently checked legal conclusions in this review.

**Part VI, §§21–22:** Proposes daily/event-driven event capture; weekly auction/tax/land-bank review; monthly assessor/entity/contact/model checks; quarterly aggregate indicators; annual/as-released backfills; continuous source/terms governance. The proposed source schema includes publisher, canonical URL, geography/vintage, access/fees/quotas, schema and sample, stable keys, license/reuse, reliability, transform owner, tests/rollback, verification timestamp, and evidence artifact.

**Part VII, §§23–24:** Prioritizes jurisdictions instead of assuming nationwide normalization. Unsolved gaps include lawful contact matching, full MLS history, beneficial ownership, bulk document images, last-minute auction changes/outcomes, trustworthy predictive labels, and exact filter mapping. It calls for validating samples, quotas, eligibility, source/vendor identity, and current terms before implementation.

**Parts VIII–IX, §§25–26:** Supplies research queries and describes seven inherited text/Markdown inputs, none embedded in the DOCX. Community material is discovery evidence only. The provenance discussion explicitly withdraws unsupported precision and warns that historical search visibility is not permanent verification.

## Material claims and their evidence limits

The following are **the atlas's claims**, not externally verified facts from this review:

- NETR is a directory with uneven local online availability; QPublic/Beacon coverage is jurisdiction-specific (1, 28–32).
- ACRIS scope is four boroughs from 1966; ZTRAX has approved research access; MERS is not universal and may require borrower authorization; Fannie/Freddie lookups are borrower-facing (39–43, 55–56).
- PACER has the stated quarterly waiver threshold, per-page charges, and exceptions (84). The report does not independently establish current fees.
- OpenCorporates API limits are stated as 200/month and 50/day for qualifying open-data use (172), while other sections generally caution that quotas change.
- Regrid Starter is described as 25 lookups/day (2); Wisconsin V12 as 3.56 million records with Jan–May 2026 collection/mostly 2025 roll data (13); PropertyRadar trial as five days (477). These precise claims need dated first-party evidence before reliance.
- USPS Web Tools retirement is dated 2026-01-25 (472); EJScreen public removal February 2025 (485); HIFLD subcommittee retirement March 2026 (491). The review confirms these statements appear, not that the events happened.
- NFIP releases are redacted, HMDA/performance datasets are not title/contact files, Form 990 is not an unrestricted donor-name database, and CLU is not an open national parcel fabric (47–52, 186–187, 239–240, 413).
- The exact PropertyRadar “10 Sources of Property Data - 2025” citation is withdrawn (372); RealPhoneValidation's cited DNC capability remains unestablished (148).

The appendix gives generic successful-pass prose for all 430 HTTP confirmations, generic browser/search prose for 69 of 89 corroborations, generic replacement prose for all 17 replacements, and generic blocked prose for all 21 inconclusive URLs. Twenty corroboration rows have more specific notes. Links and outcome summaries support traceability but do not reproduce the described verification.

## Contradictions and implementation limits

1. **Verification strength is mixed.** Several “VERIFIED - official” rows retain shorthand capability claims with a generic caveat, while “scope limited” explicitly says the full claim was not established. Store route verification and capability verification as separate facts; never translate every VERIFIED label to production readiness.
2. **Part III loan lookup wording is broader than Part I restrictions.** Its “high-leverage unlocks” and address workflow mention Fannie/Freddie/MERS checks without restating borrower-use limits each time. The explicit row limitations should control any interpretation.
3. **The queue contains inherited wording.** §24 refers to “Validate” and “Conditional” labels that are absent from the reconciled distribution, and asks to replace ellipsized URLs even though most actual DOCX hyperlink targets are already complete. An importer should resolve relationships first.
4. **URL success and source capability are intentionally different.** RealPhoneValidation's original URL has a replacement to a homepage while the source remains BROKEN/UNVERIFIED; DocumentCloud/NumLookup likewise have replacement routes without established capabilities. This is a valid distinction, not proof the capabilities were repaired.
5. **Grouping sometimes conflates publisher roles.** Entries can bundle several products behind one URL; publisher labels include academic institutions under “official,” and some commentary pages under “first-party.” Preserve the actual issuer and source type instead of relying only on status text.
6. **There is at least one geographic ambiguity worth rechecking.** ID 70 is named “Orange County FL treasurer unclaimed” and points to `octreasurer.gov/unclaimedfunds`. The attachment alone does not establish the jurisdiction; do not infer Florida solely from the title.
7. **No records/schema/access checks are supplied for production.** The document's own backlog calls for sample files, quota/rights checks, field mappings, and tests. It cannot demonstrate that a specific feed currently contains complete, normalized, available properties or accurate auction outcomes.

## Recommended interpretation for orchestration

Use this attachment as a candidate source catalog and evidence-model design reference. Retain stable source IDs, full hyperlink targets, authored status/limitations, and dated claims. Keep catalog candidates distinct from implemented adapters and observed listing facts. A useful next implementation unit would be a small jurisdiction/source batch with a real sample, source evidence, schema mapping, allowed-access basis, and explicit observed-versus-inferred fields. That is a recommendation from this review, not an executed change or an inferred user authorization.
