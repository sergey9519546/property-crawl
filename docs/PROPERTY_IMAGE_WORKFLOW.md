# Property-image workflow

## Selection order

1. Collect the exact publisher record, with its record ID, URL, observation time, and extraction evidence. A generic portal URL is not a listing URL.
2. Extract photos from that record's property gallery, not every image on the page. Treasury address-matched images, IRS asset-photo fields, and GSA gallery slides have dedicated extraction rules. Keep at most 12 gallery images.
3. Validate HTTPS URLs, source-record correspondence, and provenance. Reject stock-house hosts, logos, placeholders, documents, map tiles, private network destinations, and stale mismatched photo evidence.
4. If no accepted publisher photo exists, request Street View metadata through `/api/property-image?listingId=...&mode=metadata`. The endpoint looks up the canonical record; callers cannot supply arbitrary addresses, image URLs, or panorama IDs.
5. Accept source-backed coordinates, or obtain one exact, non-partial rooftop geocode matching street number, street, state, ZIP, and country. Broad city/county matches and derived snapshot coordinates do not qualify.
6. Require an outdoor panorama within the configured distance threshold (default 35 metres). Point the camera toward the matched property location. No match means unavailable, not a nearby random house.
7. Serve image bytes through the same-origin endpoint with bounded response size, timeouts, MIME/magic validation, concurrency limits, rate limits, and provider circuit breakers. The Google key stays server-side.
8. Display the image without cropping its attribution. Label Street View as street-level context, with capture date and matching distance. This does **not** prove that the visible facade is the parcel; users must compare it with the source record. If imagery fails, show retry/unavailable states and an explicitly qualified map instead of stock photography.

Publisher-photo preference is based on accepted record evidence, not an image-search similarity score. A URL passing extraction checks is not a visual guarantee; source errors or stale photos remain possible. The current integration deliberately does not search arbitrary image engines or guess CDN asset IDs.

## Local operation

Run both processes. For a preview without outbound scraper runs, set the API flag explicitly:

```powershell
$env:RUN_REAL_SCRAPERS='0'
npm run dev:api
# In a second terminal:
npm run dev
```

The UI, health, listing-backed enrichment, exports, sources, and scraper telemetry use the canonical Node API via `PROPERTY_API_URL`. Backend outages return an explicit unavailable response; only separately labeled UI demos may remain visible. Snapshot records are not silently promoted to freshly observed listings.

Store `GOOGLE_MAPS_API_KEY` in ignored `.env.local` or the deployment secret store. Enable Street View Static API and, for address-only records, Geocoding API on that same Google Cloud project. Use a restricted server key, set quota/budget controls, and rotate keys shared in chat before production. Never put this key in `NEXT_PUBLIC_*` or an image tag.

Street View metadata and image bytes are not persisted in the listing database or snapshots. In-flight browser metadata requests are deduplicated only until completion. Respect the provider's display, attribution, and storage policies.

## Collection controls

- The data-refresh command opts into network collection with `npm run refresh-data:real`. The API server normally starts scheduled collection outside tests; set `RUN_REAL_SCRAPERS=0` to keep a preview offline, or `1` to explicitly enable it. Fixture and historical-only collectors do not qualify as live inventory.
- Manual runs require `SCRAPER_ADMIN_TOKEN`. Use a Bearer token supplied by the operator; the Next proxy never invents admin credentials. `X-Async: true` lets an authorized run finish in the backend without holding a UI request open.
- Check `/api/scrapers/health` for zero-yield drift, failures, and media rejection reasons. A failed collector must not erase previously retained source records.
- Node's socket-level rate limit is a shared budget behind the Next proxy. Production needs a trusted edge with per-client limits; arbitrary forwarded-IP headers are not trusted. The isolated browser load test uses its own explicit budget.
- Retained source observations survive persistence only when the exact source URL, publisher, record ID, timestamp, and record kind remain valid. Missing evidence stays unverified.

## Validation and honest limits

### Bounded, durable local collection

Set `PROPERTY_LIVE_CACHE_PATH=.cache/live-listings.json` in `.env.local`. Run
`node --env-file-if-exists=.env.local scripts/collect-source.js civilview`
to collect one county and at most 12 exact detail pages. The audited CLI also
accepts `treasury` and `irs`. Run one collection command at a time. It validates
observed provenance and exact source URLs, atomically merges records into the
ignored local store, and never rewrites demo fixtures. Restart the Node API to
load the updated store; the UI's **Refresh live feed** button then reloads the
inventory. Use **Source-observed only** to exclude demo/unverified records.

For bounded discovery beyond the first county, run:

```powershell
node --env-file-if-exists=.env.local scripts/collect-source.js civilview --state NJ --counties 3 --limit 36 --new-first
```

County limits are 1–10 and detail-page limits are 1–120. `--new-first` visits
previously unseen publisher record IDs before retained records; it does not
discard refresh candidates or schedule future refreshes. Run without that flag
when refreshing existing observations. Collection reports distinguish discovered,
attempted, emitted, and unvisited records. Distinct publisher IDs remain distinct
records even when they share an address; these totals are not unique-property counts.

An exclusive store lock prevents concurrent collectors from overwriting each
other's results. A locked store fails explicitly. After a crashed process, remove
a stale `.lock` only after confirming no collector is still using the store.

The September 4 expansion visited 36 additional detail pages across three
counties, retaining 48 observed records in total. Of 252 discovered summaries,
216 remained unvisited under this run's limit. Thirty-five new records included
ZIP codes; none supplied accepted publisher photos. This remains a bounded
sample, not complete county or national coverage.

Feed cards now offer **Load Street View** for source-observed records with no
working publisher photo. They make no Google request until clicked. Metadata
requests have a 15-second deadline, and failures expose a retry state. Accepted
previews preserve the image attribution and display capture date, matching
distance, and a context-not-condition warning. Demo/unverified cards do not
receive this fallback. The detail viewer and feed share in-flight request
deduplication without persisting Google imagery or metadata.

Detail galleries try the remaining publisher URLs when an image fails. If all
publisher URLs fail, the viewer states that no substitute property photo is
shown and offers **Check Street View**. Missing-photo detail pages also wait for
this explicit action. Null, unavailable, and failed metadata responses never
trigger an image request. Browser regression tests cover these request boundaries
and attribution; gallery cycling itself currently has code-review coverage only.

The feed labels separate observed records sharing an exact complete normalized
address, city, state, and ZIP. Unit identifiers are retained. These display groups
do not merge records, infer parcel identity, or suppress individual source links.

After Geocoding was enabled on September 4, 2026, the reference-address probe
returned `OK`, with one non-partial rooftop match. A bounded CivilView run
collected 12 detail-backed records (from 85 discovered county records), all with
ZIP codes and exact detail URLs. No publisher photos were available in those
12 records. A live browser check for 19 West Park Avenue successfully displayed
Street View, captured September 2012 and 24 metres from the matched location.
The facade is blurred in Google's imagery: this is old street-level context,
not a verified current-condition property photograph. Do not attempt to remove
the privacy blur. These checks do not establish complete source coverage.

```powershell
npm run test:property-image
npm run test:scraper-reliability
npm test
```

The full suite includes mocked Google transport, publisher-gallery fixtures, invalid-address/distance rejection, API failure and retry behavior, mobile/keyboard media controls, source links, provenance persistence, and production build checks. Tests never need a real Google key or billable image requests. Live Postgres round-trips require `DATABASE_URL` and are otherwise explicitly skipped.

On September 4, 2026, a live Street View metadata probe for the user's ServiceLink reference address returned a panorama captured in May 2024. The corresponding Geocoding probe returned `REQUEST_DENIED` because that API was not activated. This check did not fetch live Google image bytes or prove facade identity. Targeted Treasury and IRS extraction checks returned source-matched images with HTTP 200; those were extraction checks, not a claim that the historical sales are currently active. No full live-source crawl is implied by these smoke checks.

Official references: [Street View metadata](https://developers.google.com/maps/documentation/streetview/metadata), [request parameters](https://developers.google.com/maps/documentation/streetview/request-streetview), [Street View policies](https://developers.google.com/maps/documentation/streetview/policies), [Maps API security](https://developers.google.com/maps/api-security-best-practices).
