# Alachua County evidence pilot

The pilot compares reviewed tax-deed case imports with official county parcel records. It does not scrape a current auction inventory or add imported cases to listings automatically.

## Official sources and verified scope

- [County tax-deed page](https://alachuacounty.us/Depts/Clerk/TaxDeeds/Pages/TaxDeedSales.aspx) links the designated [case portal](https://alachua.realtdm.com) and [auction portal](https://alachua.realtaxdeed.com). Their live inventory/API contracts have not been verified by this implementation.
- [Clerk List of Lands instructions](https://www.alachuaclerk.org/civil/taxlands.cfm) identifies the explicit public-purchase case status and requires obtaining the current cost from the clerk. Historical sold/escheated archives are not live inventory.
- [Official county parcel layer](https://maps.alachuacounty.us/server/rest/services/Hosted/ParcelsACGM/FeatureServer/0?f=pjson) publishes the field contract. Queries use the fixed endpoint, intact parcel ID, a ten-record bound, and WGS84 geometry. Full or truncated results remain ambiguous.
- [Census county reference](https://tigerweb.geo.census.gov/tigerwebmain/Files/acs26/tigerweb_acs26_county_fl.html) identifies Alachua as GEOID `12001`. The existing statewide cadastral source uses its separate Florida DOR namespace, `fl-dor:11`.

## Operator workflow

Capture actual current county case records and their original documents. Create a JSON array with one object per case:

```json
[
  {
    "publisherRecordId": "REPLACE_WITH_REAL_RECORD_ID",
    "caseNumber": "REPLACE_WITH_REAL_CASE_NUMBER",
    "rawParcelIds": ["REPLACE_WITH_INTACT_APN"],
    "status": "REPLACE_WITH_EXACT_PUBLISHED_STATUS",
    "sourceUrl": "REPLACE_WITH_EXACT_HTTPS_CASE_URL",
    "observedAt": "2026-09-05T10:00:00.000Z",
    "advertisedPropertyType": null,
    "publishedOpeningBid": null,
    "publishedCosts": {
      "taxesSinceAuction": null,
      "deedIssuanceAndRecording": null,
      "documentaryStamps": null,
      "otherPublishedCosts": null
    },
    "documents": [
      {
        "type": "notice",
        "title": "REPLACE_WITH_DOCUMENT_TITLE",
        "url": "REPLACE_WITH_EXACT_OFFICIAL_DOCUMENT_URL",
        "sha256": null
      }
    ],
    "saleDate": null
  }
]
```

These are placeholders, not example opportunities. Record URLs must be on the county-designated case or auction host and contain the publisher record ID as a complete path segment or query value. Homepage/search URLs cannot replace exact case URLs. Document links must remain on an official county, clerk, property-appraiser, or county-designated portal host. A reviewed link means that the document belongs to the case; it does not approve every statement inside the document as a verified fact. Unknown portal routes or unavailable exact record links need manual research; do not invent them. Retain source documents with the original intake workflow, and review each extracted field against its document before approval.

```text
node scripts/source-intake.js submit --source alachua-tax-deeds --url ACTUAL_COUNTY_EXPORT_OR_CASE_URL --captured-at ACTUAL_ISO_CAPTURE_TIME --kind json --file cases.json
node scripts/source-intake.js list --source alachua-tax-deeds --include-content
node scripts/source-intake.js review --id RETURNED_INTAKE_ID --decision approve --reviewer OPERATOR
node scripts/collect-public-records.js --alachua-intake RETURNED_INTAKE_ID --output county-review.json
node scripts/collect-public-records.js --alachua-intake RETURNED_INTAKE_ID --lookup-parcels --limit 5 --output county-review-with-parcels.json
```

The first pilot command performs no network requests. The second explicitly permits up to five distinct parcel queries; the hard maximum is twenty. `--store FILE` selects the intake store for local work. Network failures and exhausted budgets remain visible per case. Existing evidence remains in the intake store. Source intake approvals alone do not convert cases into live listing inventory.

## Evidence and signals

`buildAlachuaPilot(packetId, options)` loads a stored approved JSON packet, validates its content hash, dates, source identity, document references, published costs, and parcel IDs, then returns reviewed case evidence. It never fetches submitted case or document URLs. The exact county API is the only network target. Every record exposes `sourceRef: {sourceId, recordId}` so later case and hunt events can remain stable when a listing alias changes.

The pilot reconstructs `statusHistory` from valid Alachua packets captured no later than the selected packet and approved no later than the selected packet’s review. It retains observation time, exact source reference, packet ID, and the published status text. Invalid historical packets are omitted and reported under `historyCoverage.ignoredPackets`; they cannot poison the selected approved record. A transition into the explicit public-availability status is tagged `material_status_change`. Repeated timestamps or unchanged status text do not become a claimed status change. Conflicting statuses with the same observation time are retained in `statusConflicts` and produce a review issue instead of an invented sequence.

The `second_chance_review` lead requires the exact explicit “List of Lands – Available for Public” status and an observation within 24 hours. It does not infer availability from a passed date, infer a new transition from one observation, or reuse the old opening bid as a current quote. Current availability and current purchase cost remain unresolved pending publisher confirmation.

`purchaseTerms` keeps the old auction opening bid, taxes since auction, deed/recording costs, documentary stamps, other published costs, and current quote in separate fields. The clerk’s List of Lands instructions identify the types of cost that contribute to a purchase, while the exact amounts remain property evidence. Missing amounts stay `null`. The current quote stays `null` and `requires_current_clerk_quote` until a separate current quote workflow is reviewed. Scheduled-auction deposits and deadlines are program terms for a different transaction path and are not applied to a List of Lands purchase.

The structure-description discrepancy requires an exact matched parcel and an imported vacant-land/lot description conflicting with recorded buildings and heated area. Both evidence dates and assessment year are retained. This is a research lead; it does not establish current condition, habitation, occupancy, or legal rental units. An exact match also returns a `parcelMaps` reference containing the county query provenance, source geometry, and official property-appraiser link when the layer supplies one.

County planning facts preserve jurisdiction and links. County rules apply only to the layer's explicit unincorporated jurisdiction code. Wetland code `4` indicates unincorporated location, not a clean site. Missing/unknown wetland codes require review. Subdivision-potential and utility-distance fields are intentionally omitted until their definitions and units are verified. Assessor values remain separate from market value and debt. Owner/mailing data are not used to infer occupancy or resolve beneficial ownership.

`buildPublicRecordEvidence` independently adds `countyParcel` for a source-observed, explicitly Alachua-scoped parcel ID, while retaining the statewide `parcel` result. The intake pilot itself is a CLI/backend workflow; it is not a new customer page or automatic alert subscription.

Validation: `node --test test/alachua-pilot.test.js test/public-records.test.js test/source-catalog.test.js`.
