# Discovery release gaps: September 12 follow-up

## Direct street imagery

Replaced the blank Panoramax iframe with the provider's photo web component.
The loader uses the pinned 5.2.0 ESM photo entry and its pinned dependency map,
loaded only after an eligible alternative-imagery response. It shares one load
across instances, permits retry after failure, and bounds initialization and
photograph loading. Module download completion is not component readiness:
`customElements.whenDefined` must resolve, and the selected photograph's
`psv:picture-loaded` event must confirm display.

The application helper was exercised against a public Manhattan directional
sequence in a temporary local control. Photograph rendering, movement between
frames, removal, and reopening were observed. The host URL stayed unchanged.
The final ESM check and sequence navigation produced no new browser errors.
The earlier CommonJS `exports` error and iframe blank state are superseded by
this implementation. Nearby photos retain directional labels; this is not
evidence of nationwide 360 coverage or verified property frontage. The provider
legend stays visible, and surrounding metadata explicitly describes the starting
photo so navigation cannot silently inherit its distance/date as current facts.

The HUD property no-coverage path was also checked in the real app: it retained
retry, Google retry, and map controls without React errors. Its raw lifecycle
underscores have been replaced with spaces in the detail page.

Primary references: [viewer setup](https://docs.panoramax.fr/web-viewer/),
[PhotoViewer API](https://docs.panoramax.fr/web-viewer/reference/components/core/PhotoViewer/).

## CivilView county coverage

The adapter accepts an explicit published state/county identifier and emits a
stable scoped completeness report. A detail cap, failed request, rejection, or
unattempted summary prevents a complete result. Legacy priority samples cannot
qualify as complete jurisdiction coverage. Every attempt resets its report before
the first request, preventing an early failure from reusing prior success.

CivilView and coordinator checks passed 20 tests. These code checks alone do not
promote CivilView. The later canonical verification collected 24 Salem County
records per sweep but initially exposed a reporting bug: the sanitizer omitted
the county ID. After preserving the exact bounded ID, two new durable runs passed
for `state=NJ, countyId=20`, each with 24 discovered/accepted and zero rejected,
complete full sweeps, and no truncation. Root independently queried those rows;
see [the durable results](civilview-county-gate-2026-09-12.json). The corrected
scope hash excluded earlier state-only canaries. CivilView remains in canary
state with no promotion or recurring collection enabled. This verifies Salem
County coverage, not statewide or national coverage.

## Worker verification

The isolated PostgreSQL harness now tests active lease renewal as well as expiry
and recovery. It requires completed canonical iteration results and validates
programmatic arguments as strictly as CLI arguments.

A combined run completed in 20,890 ms: three completed worker iterations, one
expired-lease takeover (attempt two), and one active renewal rejecting competing
claims before and after the original expiry. Inventory stayed zero in the
isolated schema; the schema was dropped. This exercises real store operations,
but does not by itself prove the production worker's 120-second timer callback.
The later optional production-timer run closed that specific gap: the unchanged
worker called the real PostgreSQL renewal after 120,068 ms and extended the lease
by 120,123 ms. The run completed in 120,523 ms with zero listing changes and no
failures. Root reviewed the recorded result, reran all 11 harness tests, and
independently confirmed its isolated schema no longer exists. See
[the measured result](discovery-worker-timer-2026-09-12.json). This proves one
positive timer path; sustained operation, event-loop stalls, and actual renewal
failure behavior still need broader operational verification.

## Runtime and remaining gates

Inactive generated Next development/build caches were removed after validating
their paths and checking that no Next development process used them. The PG
database, archives, photos, and active preview artifacts were not deleted. Low
disk readiness was observed returning 503 while inventory remained queryable;
after space recovery readiness returned 200. Subsequent free-space observation
was approximately 26.9 GB. Recurring collection remains disabled.

The final viewer production build and TypeScript check passed. The preview on
3103 serves the latest verified build; canonical API remains on 3102.

## Integrated Sol and Terra follow-up

Astra reviewed both workers' changes before integration. CivilView now keeps
approximate upset amounts out of `openingBid`: raw text, amount, qualifier, and
publisher field remain in source facts and provenance. Only an explicitly labeled
opening/minimum bid can populate the opening amount. Raw sale date/time survives
alongside the normalized date. Root verification passed 22 CivilView/coordinator
tests after this correction.

Discovery cards identify the observed source record and describe completeness as
details available, avoiding the unsupported claim that missing details were never
published. Source Radar displays actual collection errors and guards malformed
error values before string operations. The rebuilt UI passed TypeScript and
production compilation. An initial sandboxed build could not fetch Google Fonts;
the network-enabled retry passed.

Browser verification confirmed the previously reported 1340 Ben Martin Drive
Street View image now fills a 4:3 frame without side gutters. Provider attribution,
capture date, and street-context labeling remain visible. Listings had no browser
errors; Terra also verified Source Radar at 375 by 800 pixels with specific failure
reasons and no console errors. This was a focused regression pass, not the full
responsive acceptance matrix.

Root reran 49 crawler-tool checks (including the installed Scrapling parser and
bounded Unbrowse handoff validation) and 35 street-imagery checks; all passed.

## Request-volume regression

Live verification found a detail-request storm from the Next process, exceeding
1,000 API detail requests per five seconds and exhausting the shared API budget.
Repeated card/calendar detail links now disable automatic prefetch; a React
request cache shares the bounded detail lookup between metadata and page content.
API image requests, general requests, and health probes have separate bounded
budgets, without trusting caller-supplied forwarded identity. The canonical HTTP
test exhausts each pool and verifies the others remain available. All 23 evidence
truth checks, including the new admission-policy tests, passed.

After rebuilding and restarting the Next process, the same runtime probe recorded
one inventory request for a listings reload, then one detail request and one
dossier request when opening a property, with no continuing request storm. The
final build also includes the calendar prefetch change. The temporary counting
probe was removed from the API launch configuration afterward.

Still required for full release: sustained worker operation and deployment,
Wave 2 live promotion gates, GSA access/identity reconciliation, broader imagery
coverage and performance, non-ServiceLink document extraction, remaining market
features, and the full responsive discovery/map/calendar/export/hunt acceptance
pass. This report records progress rather than a completed national release.
