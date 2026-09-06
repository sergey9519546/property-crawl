# Automated collector audit

Audited from the current scheduler and collector code on 2026-09-05. This is a
code-path audit, not a declaration that any upstream publisher was reachable or
had current inventory during this audit. A collector is only live after it
returns provenance-valid, source-observed records through the scheduler.

## Scheduler inventory

The initial audit covered 13 configured collectors: `treasury`, `gsa`, `irs`, `usda`,
`landbank`, `civilview`, `bid4assets`, `sheriff`, `hud`, `fannie`, `freddie`,
`va`, and `marshals`. FDIC is deliberately absent because its available
collector is historical/fixture-oriented. Trustee has no universal endpoint or
configured adapter.

| Collector | Current automated path | Coverage boundary | Failure/verification limitation |
| --- | --- | --- | --- |
| Treasury | Static Treasury real-property page plus detail pages | Current Treasury offerings | Detail fetch failures are logged; a property must parse from its exact page. |
| GSA | `realestatesales.gov` listing and asset-details pages | Current GSA real property | Sparse, slow, episodic inventory; personal-property APIs are out of scope. |
| IRS | IRS auction list and detail pages | Current IRS auction notices | Low volume; sale notice terms still control. |
| USDA | USDA SFH search form and detail pages | USDA SFH/FSA resales | State/form workflow; details and status must be rechecked. |
| Land Bank Search | Portal data and participating land-bank pages | Participating land banks only | Owning land-bank availability and program rules remain authoritative. |
| CivilView | County discovery, exact sale details, bounded county/detail traversal | Default target state is NJ; participating CivilView counties only | It has a structured `lastRunReport`; exact detail-page evidence is mandatory. |
| Bid4Assets | Sheriff-sales discovery and individual auction pages | Participating auction issuers | Marketplace record must retain issuer terms and identity. |
| Sheriff | Four named Ohio RealAuction sheriff sites, then a public-notices fallback | Cuyahoga, Franklin, Summit, Hamilton only | Current code can return an empty array after all county failures, so scheduler telemetry is needed before treating a zero as inventory absence. |
| HUD | DataGrid JSON pages, then HTML search fallback | All 50 states, DC, and PR by default; bounded by states/pages/concurrency config | Now has `lastRunReport` and throws when all state requests fail. Maintenance/challenge responses are not treated as empty. |
| Fannie | Search-service endpoint then HTML fallback | Eight hard-coded states, one page | Current failure handling can collapse upstream errors to `[]`; partner or licensed route remains preferable. |
| Freddie | API endpoint then HTML fallback | Eight hard-coded states, one page | Current failure handling can collapse upstream errors to `[]`; publisher access may change. |
| VA/VRM | State API endpoint then HTML fallback | Eight hard-coded states, one page | Current failure handling can collapse upstream errors to `[]`. |
| U.S. Marshals | USMS page then RealLook contractor fallback | Brokered/contractor disposition inventory | Current failure handling can collapse upstream errors to `[]`; individual broker records must retain USMS provenance. |

## HUD repair

The HUD collector previously requested only page 1, size 25, for eight
hard-coded states and swallowed both primary and fallback errors into an empty
array. HUD HomeStore's public homepage was checked on 2026-09-05 and displayed
an under-maintenance notice, so that behavior could have presented service
unavailability as zero HUD listings.

The revised collector:

- uses the full state/DC/PR set by default, or `HUD_STATES=OH,TX` for a
  focused run;
- bounds work with `HUD_MAX_STATES`, `HUD_MAX_PAGES_PER_STATE` (default 3),
  `HUD_PAGE_SIZE` (default 50), and `HUD_STATE_CONCURRENCY` (default 2);
- follows `aaData` and common DataGrid pagination totals, with a jitter between
  successive pages in one jurisdiction;
- exposes `lastRunReport` with state/page counts, fallback use, failures, and
  an `outcome` of `success`, `empty`, `partial_failure`, or `failed`;
- throws `HUD_UPSTREAM_UNAVAILABLE` when no state endpoint completes, rather
  than returning `[]`; and
- does not attempt HTML fallback after a circuit-breaker/WAF challenge.

The collector does not fetch user-submitted URLs. All request URLs are built
from the fixed HUD base URL and validated state codes.

## Next repairs, in priority order

1. Apply HUD-style run reports and all-failed errors to Fannie, Freddie, VA,
   Sheriff, and USMS before expanding their coverage.
2. Convert county sources into explicit enrollment records with official
   publisher domains and exact-record URL shape validation; do not make a
   nationwide county claim.
3. Add per-source runtime health to the API from scheduler telemetry, including
   `empty` versus `partial_failure` versus `failed`.
4. Treat a challenge wall, 403, zero-byte response, malformed payload, or
   source-policy rejection as a failed run, never an empty feed.

## Verification

`node --test test/source-collector-coverage.test.js` uses mocked publisher
DataGrid `aaData` and total-record response shapes. It verifies two-page
traversal, a genuine publisher zero-result response, a dual-endpoint upstream
failure, and a challenge wall that suppresses fallback traffic. It makes no
live HUD request.

The public-auction collector was subsequently registered and live-verified with five accepted records. The current scheduler has 14 property collectors. See [implementation verification](reference-audit/verification.md) for final counts and evidence.
