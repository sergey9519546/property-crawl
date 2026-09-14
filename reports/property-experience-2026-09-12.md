# Property evidence and walkthrough follow-up — September 12, 2026

Later verification and the replacement of the blank iframe are recorded in
[the subsequent release-gap follow-up](discovery-followup-2026-09-12.md).
The disk and viewer limitations below describe this earlier checkpoint.

## Delivered

The canonical API now exposes a document evidence contract on listing detail and
property dossiers. The current production UI build serves a dedicated Documents
section, navigation link, observed labels, access states and reference timestamps.
Auction terms and the document panel share that contract. Empty evidence, unknown
evidence and conflicting captured lists remain distinct. Identical lists are not
displayed twice. Unsafe links cannot become clickable document references.

ServiceLink collection now preserves its actual publisher document array. A new
canonical canary completed with 5,635 accepted records, zero rejected, 57 fetched
pages and a cleared terminal checkpoint. Run:
`ee60da06-cc38-4eb6-a19e-66d371e0a43c`.

Database readback found 6,170 stored live ServiceLink projections, 5,193 with
nonempty document arrays and zero with explicitly observed empty arrays. The
remaining 977 have unknown document evidence. Stored inventory includes prior
records preserved across collection; it is not the same as this run's count.
Browser verification of `servicelink:a1cVO000009C2wvYAC` showed eight actual
publisher document links and the same count in auction terms. Links were not
treated as downloaded, reviewed or publicly accessible files.

Discovery filters and hunts now consider both document provenance containers.
PostgreSQL tests cover 48 combinations of nullable document flags and missing,
empty, nonempty or malformed containers with explicit expected outcomes. Hunt
snapshots combine document identifiers so newly captured references can produce
document-change events.

The property page now recognizes an exact HUD eGIS case URL bound to the same
publisher record ID. Browser verification on the main preview confirmed that
`HUD-011-516864` no longer receives the false unverified-snapshot disclosure and
offers the exact publisher link. General HUD queries and mismatched cases remain
rejected.

## Alternative street imagery

The canonical property-image API supports `mode=alternatives`, using current
source-observed coordinates without a Google key or geocoding dependency. It
queries a fixed Panoramax catalog endpoint, bounds radius to 100 m and returned
items to ten, and preserves license, contributor, distance and capture date.
Antimeridian queries use at most two bounded boxes. Missing numeric values stay
unknown. Proprietary or unsupported licenses do not produce display candidates.

The UI checks this path when Google lookup or the interactive Google viewer
fails. Eligible directional photos retain a directional label; they cannot become
360 panoramas. The iframe URL is constructed from a fixed provider origin and
validated picture identity. No nearby imagery and provider failure remain
different API outcomes. Browser verification exercised the real no-coverage
fallback on the HUD property, with retry and map controls available.

A live Manhattan control returned ten STAC items with CC-BY-SA-4.0 metadata.
The adapter found three directional frames within 100 m at the first returned
coordinate and correctly returned no eligible 360 panorama. The probe exposed
the actual `geovisio:producer` attribution field, which is now supported.
This establishes one live provider contract, not nationwide imagery coverage.

The public viewer loaded the control's directional imagery and sequence controls
when opened directly. The local iframe control stayed blank (`about:blank`) in
the in-app browser. Successful embedding is therefore not verified; the visible
Open Panoramax link remains the alternative. The upstream direct viewer also
logged JavaScript errors while displaying its controls. This remains a release
gap for a seamless embedded walkthrough.

Primary provider references used:

- [Official viewer setup](https://docs.panoramax.fr/web-viewer/)
- [Official viewer URL parameters](https://docs.panoramax.fr/web-viewer/03_URL_settings/)
- [STAC API](https://docs.panoramax.fr/backend/api/api/)
- [Per-instance picture licenses](https://docs.panoramax.fr/backend/install/settings/#pictures-license)

## Verification and runtime

- Document, PostgreSQL parity, dossier, evidence and worker-harness tests: 44 passed.
- Google and Panoramax provider/client tests: all 32 passed after the final
  producer-field regression fix.
- HUD source-link tests: six targeted/existing checks passed.
- Production build and TypeScript passed. Context and diff checks passed.
- Browser checked the document navigation and actual eight-link property,
  unknown HUD document state, HUD source binding, and unavailable imagery path.
  The mobile document layout had no horizontal overflow; browser error log was empty.
- The main preview on port 3103 now serves `.next-sources-verify`, replacing the
  older build. API port 3102 uses PostgreSQL in advanced mode.
- The Sources page rendered its full coverage results without the prior React
  object-child crash and correctly showed the idle worker as needing attention.
- Source coverage now presents the exact jurisdiction recorded by an operational
  run. CivilView's nested run filters render `NJ · county ID 20` unless the
  publisher supplied a county name; the page does not broaden that result to
  statewide or national coverage. HUD state arrays render as their explicit
  state list, and unknown scope objects remain an unavailable-scope message.
- The earlier `.next-sources-verify` artifact predates this scope formatter and
  must not be used as verification of it. A fresh inactive-preview build
  completed in `.next-discovery-preview` at 15:43 with an explicit parsed
  `.env.local`, `NEXT_DISCOVERY_PREVIEW=1`, `NEXT_VERIFY_BUILD=1`, and
  `PROPERTY_API_URL=http://127.0.0.1:3102`. Its Sources client chunk contains
  `county ID` and has no old `Configured source scope` formatter. TypeScript
  and the pure scope formatter tests passed. The build required the project
  Inter font fetch from Google Fonts.
- Post-restart inventory: 8,455 records, observed revision `114132`.
- A real isolated PostgreSQL worker check ran five canonical iterations and a
  ten-second lease-expiry/takeover. All completed, active-lease takeover was
  rejected, inventory stayed zero, and the isolated schema was dropped.

The worker check uses an offline synthetic coordinator and lasts about eleven
seconds. It does not verify sustained publisher collection or production
heartbeat renewal. Continuous collection remains stopped. Local free space was
1,059,024,896 bytes at the final runtime check, below the 1 GiB collection
reserve; the guard remains enabled and recurring collection remains stopped.

## Final UI hierarchy review

The workspace routes use one shared navigation bar. Discovery cards keep a 4:3
media frame and put the opening amount and sale date ahead of freshness,
evidence completeness, documents, and modeled score. Property detail keeps the
auction summary and exact publisher action ahead of the longer research panels.

The Sources cards now keep multi-jurisdiction scope details behind a short native
disclosure. A release gate is shown as approval pending only after a completed
operational sweep; a registered collector with no completed run remains labeled
as not run. A completed canary at two of two clean runs still says approval is
pending until the backend reports it approved.

Opening Street View from the photo or map state now enters the walkthrough panel
immediately. Provider lookup, the embedded viewer, the Panoramax fallback, retry,
and property-map recovery therefore stay in one media surface. The final browser
pass must confirm this transition with both an available Google fixture and a
Google-unavailable/Panoramax fixture at desktop and 390 px widths.

## Remaining full-release requirements

Sustained dedicated-worker operation and production deployment remain unverified.
Wave 2 still requires jurisdiction-specific source gates. GSA access-policy and
historical-ID reconciliation remain open. Non-ServiceLink document extraction,
document content review, broader imagery coverage/performance, remaining market
features, and the full responsive discovery/export/hunt acceptance pass remain.
This milestone is not a claim that the original platform goal is complete.

The Sources page still needs a browser pass against live operational run payloads
after the collection worker records them. The formatter has unit coverage for
the current nested CivilView and HUD scope contracts, but no collection result is
being claimed from this build alone.

For compact Sources cards, multi-jurisdiction run scopes now show a recorded
jurisdiction count and provide the full recorded code list in a native
disclosure. This preserves the exact scope at narrow widths without presenting
the list as statewide or nationwide coverage. A collector whose latest observed
sweep is complete but still awaits recurring-run approval is labeled “Approval
pending” and explains its clean-run progress instead of being described as a
partial sweep.
