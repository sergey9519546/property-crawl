# Property image recovery

## Acceptance order

1. Prefer actual photos from the exact publisher record, with publisher-media provenance.
2. If absent, search the complete address for a secondary property detail page.
3. Require its main structured property entity to match the street number/name/direction, unit, city, state and ZIP. Only case, punctuation and common street/direction abbreviations are normalized; ZIP+4 is not silently truncated.
4. Extract images only from that matching entity's gallery, not search thumbnails, recommendations, generic page metadata, maps or Street View.
5. Save accepted secondary evidence separately. Do not change the auction source, price, status or address to make a photo match.

An unknown city, missing ZIP, different apartment or conflicting identity fails closed. Photos may be historical: a matching address does not verify capture date or present condition.

## Bounded recovery command

Run from the repository root, using a canonical record ID:

```powershell
node --env-file-if-exists=.env.local scripts/discover-property-images.js --id RECORD_ID --url https://www.compass.com/homedetails/EXACT_ADDRESS/EXACT_PROPERTY_ID/
```

Without `--url`, discovery uses a bounded public search request. The currently supported secondary providers are Compass, Redfin, Zillow and Realtor.com; each still needs an accessible structured gallery and exact identity. Search availability is not guaranteed. Batch discovery is limited to 1–10 complete-address records:

```powershell
node --env-file-if-exists=.env.local scripts/discover-property-images.js --limit 3
```

The collector checks at most four candidate detail pages per record, uses request timeouts and size caps, applies jitter, and stops requests to a provider after a 403 or bot challenge. It never bypasses access controls. Only a same-property canonical trailing-slash redirect is allowed.

Accepted evidence goes to `.cache/property-media.json` (or `PROPERTY_MEDIA_CACHE_PATH`) using a locked atomic write. The listing API attaches only entries that still match the current canonical address. Separate auction IDs stay separate. The feed and listing gallery show the actual photo provider and link to its exact property page. No search or scraping runs in the browser.

## Verified recovery on 2026-09-04

- GSA `GSA-726LA058501`: a fresh fetch of official property detail 41 parsed the exact 2731 Chestnut Street, New Orleans, LA 70130 record and 12 publisher gallery images. The validated observed record was merged into the local live cache, preserving the other 48 records. Its opening amount remains unknown; none was invented.
- USDA `USDA-MS-6278`: its historical/detail photo was discovered in the audit, but the bounded current Mississippi inventory check did not return that record. No fresh listing was fabricated or imported.
- Compass 19 W Park Ave: Street View-only candidate; no secondary gallery accepted.
- Compass 43 E 2nd St: real gallery discovered, but the corresponding Bid4Assets seed lacks a complete canonical city/ZIP. No images attached until the primary address is independently completed.

See [source-image-audit.md](source-image-audit.md) for the source-by-source evidence and remaining coverage gaps.

## Regression checks

```powershell
node --test test/secondary-property-media.test.js test/publisher-media.test.js test/gsa-usda-publisher-gallery.test.js
```

These cover exact identity, unrelated gallery rejection, unsafe URLs, challenge handling, canonical redirects, persistence revalidation, publisher gallery extraction and placeholder rejection. Fixtures prove behavior, not live publisher coverage.
