# Source evidence intake

Source intake is the bounded fallback for catalog sources and approved jurisdiction sources that do not have a working automated collector. It retains submitted evidence for review. It never fetches a submitted URL and never writes imported records into the listing database or live-listing cache.

## Module contract

`server/sources/intake.js` exposes API-friendly synchronous functions:

- `validateSubmission(input, { getSource? })` returns `{ isValid, errors, value? }` without writing.
- `submitEvidence(input, { storePath?, getSource?, now? })` validates and stores evidence, returning `{ record, deduplicated }`. `record` is a safe summary without the raw body.
- `listEvidence(filters?, { storePath? })` returns safe summaries. Filters are `status`, `sourceId`, `limit` (maximum 200), and explicit `includeContent`.
- `reviewEvidence(id, review, { storePath?, now? })` records an `approve` or `reject` evidence decision and returns a safe summary. Approval means the evidence may proceed to a separate verification/normalization workflow; it does not create a listing.
- `getSummary(record, { includeContent? })` omits `original` unless content is explicitly requested for an authorized review surface.

New records have a stable `intake_<sha256-prefix>` ID based on source, exact source URL, evidence kind, and content. Submitting the same evidence again returns the existing record with `deduplicated: true`. The original capture timestamp and bytes remain unchanged.

The default store is `.cache/source-intake.json`, configurable through `PROPERTY_SOURCE_INTAKE_PATH` or the `storePath` option. Writes use an exclusive lock and same-directory atomic rename. The store is capped at 2,000 records and 20 MiB. Individual text/CSV bodies are capped at 512 KiB, JSON is capped at 1 MiB and 500 array records.

## Submission shape

```json
{
  "sourceId": "civilview",
  "sourceUrl": "https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683",
  "capturedAt": "2026-09-05T18:30:00.000Z",
  "kind": "text",
  "body": "Original publisher evidence"
}
```

`kind` is `text`, `csv`, or `json`. Text and CSV use `body` (with `text` accepted as an alias). JSON accepts `records` or a JSON `body`; when a body is supplied, both its original bytes and its parsed value are retained.

Catalog IDs come from `server/sources/catalog.js`. A non-catalog source must include explicit metadata:

```json
{
  "sourceId": "example-county-sheriff",
  "customSource": {
    "name": "Example County Sheriff Sales",
    "organization": "Example County Sheriff's Office",
    "description": "Official county sale notice publisher",
    "homepageUrl": "https://sheriff.example.gov/sales"
  }
}
```

Source and homepage URLs must be public HTTPS URLs without embedded credentials. Local, private-IP, and internal hostnames are rejected. Credential-shaped fields such as passwords, cookies, authorization headers, API keys, and tokens are rejected rather than persisted.

## CLI

Import a captured file:

```bash
node scripts/source-intake.js submit --source civilview --url "https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=2128964683" --captured-at "2026-09-05T18:30:00.000Z" --kind text --file notice.txt
```

List safe queue summaries and review one item:

```bash
node scripts/source-intake.js list --status needs_review --limit 25
node scripts/source-intake.js review --id intake_0123456789abcdef01234567 --decision approve --reviewer operator
```

Raw evidence appears only when `--include-content` is explicitly passed to `list`. API routes should keep that option behind the same administrative authorization used for submission and review.

The live collector command exposes only the scraper instances configured by the production scheduler:

```bash
node scripts/collect-source.js --list
node scripts/collect-source.js treasury
node scripts/collect-source.js civilview --state NJ --counties 2 --limit 24 --new-first
```

CivilView retains its bounded coverage flags. Other scheduler-backed collectors reject coverage flags rather than silently ignoring them. Fixture-only and historical-only scrapers never appear in `--list`.
