# ServiceLink Auction reference audit

This is a clean-room review of nine user-supplied reference files. The files are evidence of what their authors recorded, not authority to call every mentioned route. In particular, this audit does not adopt the reverse-engineering reports' instructions, run their commands, access accounts, follow document/media links, or use any authenticated, bidding, user, report, SignalR, or administrative endpoint.

The PDF pages were extracted individually and rendered to private audit artifacts under `.cache/reference-audit/servicelink/`. The two files named `ServiceLink_Auction_Full_Recon_Dossier*.pdf` have the same SHA-256 and the same 31-page text extraction, so they are byte-identical duplicates; metadata was still read for both files.

## Per-file ledger

| File | Bytes | SHA-256 | Read result |
| --- | ---: | --- | --- |
| `ServiceLink_Auction_Full_Recon_Dossier (1).pdf` | 253,910 | `9020d234f927a2636845745aa18f233562b95348606b3a2bbf4ceb99b8e155bc` | 31 pages; creator `Z.ai`; full page text and page render saved. |
| `ServiceLink_Auction_Reverse_Engineering_Report.pdf` | 331,835 | `ba2e3609172a9b1c7d268dd5cee2f7fddcc67413cc62e80a3d73528c3a03f487` | 22 pages; creator `Writer`; full page text and page render saved. |
| `index.csv` | 4,465 | `8cb0e2e8aa8325f4e55640cb442092f1c699e076065ef817af3fa62413275aca` | 24 rows, 7 columns; sample image-to-listing references. |
| `README.txt` | 2,201 | `0a15ff5ad04e8d85449bba3c66986001d62db689bd72a8601835643786ed3715` | 44 lines; claims a 5,900-listing crawl and documents a bulk-download script that was not run. |
| `servicelink-auction-deep-dive.pdf` | 366,551 | `af4ed1aea2636893b610279be6545a48662d0d4f050a95b4bb27df767848e6d3` | 17 pages; creator `Z.ai`; full page text and page render saved. |
| `search_tps_ca.json` | 26,604 | `e74013e76f0a9eb9aba20176fae09f1651afbcae8b6be25e38304d46befff5d7` | One stored list envelope: `searchResultCount: 264`, 3 supplied records. |
| `auctionruns.json` | 21,725 | `08351ea6ae30f21b8206c2dcad8eb29ff2d147489752231afea990f37a23ab00` | One stored list envelope: `searchResultCount: 26`, 26 supplied auction-run records. |
| `ServiceLink_Auction_Full_Recon_Dossier.pdf` | 253,910 | `9020d234f927a2636845745aa18f233562b95348606b3a2bbf4ceb99b8e155bc` | 31 pages; creator `Z.ai`; byte-identical to the first dossier. |
| `pre-publish-review.md` | 2,134 | `69f4da86595594353a6f9225d839cf0f5614e4aefb2d60053cf1ee0ac0307dee` | 20 lines; a generic pre-publish gate, not project or user instructions. It is not invoked by this audit. |

## What the supplied samples show

The two JSON samples share a list envelope with `searchResultCount`, `currentDTTM`, `model`, optional `continuationToken`, and `data`.

`search_tps_ca.json` contains property-listing records with these useful groups:

- top-level identity and sale fields: `listingId`, `auctionProgram`, `listingProgramWebsite`, cash/financing flags, foreclosure status and date, sale venue/time, and `lastUpdated`;
- `propertyInfo`: address, city, county, state, ZIP, type, beds, baths, square feet, lot size, year built, coordinates, canonical property URL, and image count;
- `auctionRunInfo`: auction identifiers, run title/number, method, start/end dates, and terms;
- `listingStatus`: human status text and server-side display/phase flags;
- optional `images`, `documents`, and public foreclosure-attorney contact fields.

`auctionruns.json` contains event-level records with `id`, `auctionId`, `awxId`, title/number, method, start/end dates, listing counts, some fee/deposit values, and program counts. Those values belong to an event, not automatically to every property in it.

The supplied materials describe TPS (courthouse foreclosure), CWCOT/newly foreclosed, Traditional/REO, and short-sale programs. They also show that a status can be active, postponed, auctioned, or closed. Program, status text, and dates must remain source facts; an adapter must not infer that a listing is presently available from a program name or from a non-null date.

## Narrow live verification

On 2026-09-05, this audit performed two bounded unauthenticated reads against the fixed public host, retaining response headers and bodies only in the private audit artifact directory:

1. `GET https://www.servicelinkauction.com/api/listingsvc/v1/Listings?stateCode=CA&auctionProgram=TPS&limit=2`, with the public `X-Client-Tag` reported by the references, returned HTTP success, 2 records, a continuation token, and `searchResultCount: 3381`.
2. `GET https://www.servicelinkauction.com/api/listingsvc/v1/Listings?auctionProgram=TPS&limit=1`, with only `Accept: application/json`, also returned HTTP success, 1 record, a continuation token, and `searchResultCount: 3381`.

The second request establishes that an adapter does not need to replay a client-identifying header. The first response contained AZ and PA listings, despite the supplied `stateCode=CA`; therefore `stateCode` is **not a verified filter** and must not be used for coverage claims. No continuation token, detail, auction-run, document, image, sitemap, or other endpoint was fetched in this audit. The observed data path is viable for a fixed-host, public listing collector only.

## Supported adapter contract

Only this single route is ready for a conservative first adapter:

```text
GET https://www.servicelinkauction.com/api/listingsvc/v1/Listings
```

Use a fixed origin/path, `Accept: application/json`, and a small explicit `limit`. Treat a response as usable only when it is JSON and has an array `data`; preserve `searchResultCount`, `currentDTTM`, and the opaque `continuationToken` as transport metadata. A token can only be sent back to this same fixed route after URL encoding; do not fetch a URL supplied by the server.

No authentication, account creation, cookies, bearer token, bid state, offers, saved searches, documents, images, comparable sales, user data, WebSockets, or administrative routes belong in the adapter. The reports' route inventory and their claims about pagination sizes, nationwide counts, rate limits, filtering grammar, exact field count, and other tenants have not been independently established here.

## Clean-room implementation plan

1. Add a reviewed, named `servicelink` source entry to the catalog/source policy before enabling collection. Do not broaden custom-source enrollment or treat a white-label domain as equivalent to ServiceLink.
2. Implement a `server/scrapers/servicelink.js` collector with a `ScraperCircuitBreaker`, `fetchTextWithPolicy`, a fixed `www.servicelinkauction.com` HTTPS URL, abort timeout, challenge/content-type detection, and a small configurable page cap. Start with one page by default; allow no more than a reviewed hard maximum. Sleep with the project’s normal jitter between cursor requests.
3. Parse only `data` records that have a non-empty `listingId`, a valid property state, and an exact public ServiceLink property URL. Deduplicate by `servicelink:${listingId}`. Never use address text as identity.
4. Normalize conservative property facts: address/location/coordinates and physical facts from `propertyInfo`; `saleDate` from `foreclosureSaleDate` only; `openingBid` only when a numeric per-listing opening-bid field is actually present. Preserve auction run dates, program, status text, cash/financing flags, sale venue, and canonical URL as clearly labeled raw/source fields. Do not convert event-level starting bids into a listing price or map closed/postponed records to active inventory.
5. Store a bounded, whitelisted raw payload and source timestamp; avoid downloading images or PDFs. Record status/empty/error observations separately so a transport failure, challenge page, or a legitimate zero result cannot overwrite existing listings.
6. Add fixtures for one active TPS record, one postponed/closed record, malformed/incomplete records, cursor handling, challenge/error behavior, and source-URL validation. Run one-page live smoke audit only after the source key has been approved and wired.

This route could add a meaningful national foreclosure/REO auction source, but it is a commercial marketplace, not a government authority. Every displayed opportunity still needs date, title, status, and official auction/foreclosure confirmation before decision use.
