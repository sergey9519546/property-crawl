# Federal Register notice evidence collector

`server/sources/federal-register.js` reads a bounded set of recent Federal Register **notices** containing the term `real property`. It is an evidence and discovery intake, not a listing collector. A notice can describe a meeting, rule, policy, or a possible disposition; it never establishes that a property is currently available.

The collector calls the public, unauthenticated [Federal Register API v1](https://www.federalregister.gov/developers/documentation/api/v1) endpoint `GET /api/v1/documents.json`. The request stays on the fixed `https://www.federalregister.gov` host and uses these documented query parameters:

- `conditions[term]=real property`
- `conditions[publication_date][gte]` for the bounded lookback
- `conditions[type][]=NOTICE`
- `order=newest`, `page=1`, and `per_page`

It requests one page only: 10 documents over the last 30 days by default, capped at 20 documents and 366 days. It uses `fetchTextWithPolicy` and a `ScraperCircuitBreaker`; it does not fetch a notice's HTML, PDF, JSON detail endpoint, or any links included in the response.

For every result with an exact Federal Register HTTPS document URL, it calls `submitEvidence` with `sourceId: "federal-register"`, `kind: "json"`, the API metadata, and the notice `html_url`. The durable source-intake queue records it as `needs_review`. The saved record preserves the document number, title, abstract, publication/effective dates, agencies, and links, with one of these classifications:

- `possible_real_property_disposition` when the returned title or abstract includes sale/disposition language.
- `real_property_notice_requires_review` for every other matching notice.

Both classifications are notice-only leads and include `inventoryStatus: "notice_only_not_an_active_property_listing"`. A reviewer must examine the official notice and any controlling source before treating it as a sale or inventory opportunity. The Federal Register's API documentation also distinguishes its display information from official legal publication; use [govinfo.gov](https://www.govinfo.gov/) where legal-status confirmation is needed.

Run a bounded intake manually:

```powershell
node scripts/collect-federal-notices.js --per-page 5 --days-back 30
```

Pass `--store path/to/source-intake.json` to use a separate review queue. The command prints only the query URL, counts, classifications, and exact notice references; it creates no listings and makes no availability assertion.

## Observed smoke run

On 2026-09-05T12:25:39Z, the bounded command above ran against the public API with `--per-page 5 --days-back 30`. The API returned five matching notices; all five were admitted to the local review queue and none was classified as a possible disposition. This is expected for a broad `real property` discovery term and is evidence that the collector stores leads for review, not proof that an available federal property was found.
