# Discovery and exterior walkthrough verification

The local application runs at http://localhost:3103 with the canonical Node API at http://127.0.0.1:3102 and PostgreSQL/PostGIS in advanced mode. Checks ran September 7 Pacific time (some captured timestamps are September 8 UTC).

## Browser verification

- The discovery grid, CA filter, URL state, calendar and clustered map use the canonical query. Selecting a map cluster zoomed into smaller clusters and property points.
- Property dossiers show dated archive evidence, document links and bound raw snapshots. Archive import times remain distinct from fresh source observations.
- The duplicate branded property header was removed. On the IRS Statesboro detail page, the rendered DOM has one header and one home-brand link; Back to results sits above the property title and preserves the supplied results URL. TypeScript passed after the change.
- Every dossier offers an Exterior Walkthrough tab. Selecting it invokes the canonical metadata endpoint; the app does not prefetch Google content or cache completed metadata.
- At 247 S Carmelina Ave, Los Angeles, Google returned a starting panorama 26.1 metres from the matched location, captured July 2022. One observed uncached lookup took 470 ms; this is a single observation, not a latency guarantee.
- The official Maps Embed viewer visibly rendered the panorama. Browser checks exercised clockwise camera rotation, a connected street arrow, and Return to property. Google attribution and native controls remained visible. The starting camera can depict an adjacent road or building; property frontage is not verified by proximity alone.
- A 390×844 browser check found and corrected a clipped mobile footer. Walkthrough mode expands to 440px on small screens; a second screenshot confirmed visible starting capture date, distance, Google attribution and media tabs. The browser viewport was restored afterward.
- At 12481 Moonbeam Meadow Way, Potter Valley, Google returned no panorama within the bounded 500-metre search. The UI shows unavailable coverage and an official Maps address-search link. The Panoramax town-scale check also found no images; no full-coverage claim is made.

## Final layout and integration pass

- Discovery now leads with a compact search form, state/county/type filters, active filter chips, and an expandable set of advanced filters. Mobile search and primary filters use less vertical space. One export action remains, and protected saving/exporting opens the workspace unlock flow. Saved-search changes link to Hunts rather than the global source-collection inbox.
- Document availability has distinct Available, None reported, and Unknown controls. Browser selection of Unknown returned filtered listings with the correct URL state. Saved searches retain canonical discovery filters, while existing rule-based hunts remain compatible. A linked saved hunt selects and focuses its detail; discovery criteria cannot accidentally be replaced through the legacy editor.
- The property detail has one shared navigation bar. On mobile, known opening amount and reported sale timing appear above the gallery. Sale status, access restrictions, source attribution, and missing critical terms remain visible. Scoring, all recorded facts, raw media details, and source history are expandable secondary content; conflicts and changes remain easy to find.
- Publisher gallery navigation advanced from photo 1/3 to 2/3 on the Carmelina record. The property map rendered its marker and controls. A regression discovered during integration was fixed: an explicitly requested exterior walkthrough can complement publisher photos. Automatic image fallback still prefers the publisher gallery. The final live browser check rendered the native Google panorama, its controls, July 2022 capture information, and the 26-metre starting-distance disclosure.
- Sources no longer renders a structured coverage object as a React child. It formats completion, accepted/rejected/discovered counts, and scope into text. Root independently opened the loaded page at 390×844: 49 source workflows, 15 registered collectors, live change cards, and the collapsed 501-reference atlas rendered without the React object error or `[object Object]` text. Registration counts remain distinct from operational coverage.
- The Sources heading is now **Source coverage**, with a short explanation and compact counters. Collection changes precede the collapsed coverage-setup reference list. Shared mobile navigation exposes all five sections without horizontal scrolling.
- The preview uses its own `.next-discovery-preview` output. Another development process in this checkout can keep using `.next` without taking down this preview.

Final integrated checks: TypeScript and an isolated Next production build passed. The focused media, query, cursor, and hunt regression run passed 53/53 tests; the server API suite passed 21/21 after updating its legacy caller-ID watchlist expectation to the authenticated workspace contract. The live HTTP smoke test additionally passed saved-discovery-filter matching parity, alongside readiness, authentication isolation, watchlist persistence, hunt lifecycle, export parity, and cursor parity. The build needed filesystem access outside the sandbox to write its existing trace file; it completed successfully without changing the running preview.

`node --env-file=.env.local scripts/discovery-http-smoke.js` passed against the running local API and Next UI. It verifies readiness, anonymous and spoofed private-state denial, workspace login, isolated watchlist save/read/remove, unique hunt creation/evaluation/read/delete, filtered export parity, and cursor pagination. It keeps credentials and session cookies out of logs and removes its disposable entities. An inventory revision change during live collection is handled with a bounded refresh.

The broad regression log `.cache/discovery-regression-final.log` records 232 tests: 229 passed, zero failed and three optional checks skipped. Real PostgreSQL lease/restart, evidence and 10,050-record hunt acceptance ran separately from the optional legacy checks. Final media/proxy checks passed 23/23; database projection checks passed 5/5; TypeScript and the final Next production build passed.

The archive replay reused all 5,900 catalog snapshots, wrote zero new snapshots, and rejected zero records. The 100,000-row performance results and host specifications are in `reports/discovery-acceptance-2026-09-07.md`. National source promotion decisions are in `reports/discovery-national-core-2026-09-07.md`.

## Configuration and limits

The final document-filter check also ran directly against PostgreSQL: all three buckets passed for a nine-case matrix combining nullable/true/false columns with missing, empty, and nonempty document evidence. SQL and the canonical memory matcher agreed in every case. After the API reload, the complete live HTTP smoke test passed again.

The user-supplied Maps key was configured only in the ignored local environment. The browser viewer uses explicit public Maps configuration; there is no implicit fallback from a private server key. No new Google key was created. Deployment should use API- and referrer-restricted browser credentials; cloud restrictions were not changed during this configuration.

Automatic approval review rejected transmitting an exact local property coordinate to Panoramax. Only town/city-scale public probes and known-covered public controls were used. The research report records this limitation and distinguishes ordinary adjacent photos from verified 360 panoramas.
