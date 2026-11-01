# Recent-work audit and next-track assessment — 2026-10-31

This is a dated audit receipt and planning rationale. Active work belongs in
[`docs/COMPLETION_CHECKLIST.md`](../docs/COMPLETION_CHECKLIST.md).

## Assessment

The recent work adds substantial useful capability, but the claim that the
system has no remaining defects is unsupported. Track 1 needs date/provenance
corrections and live source qualification. Tracks 2 and 3 have landed as code,
but several pieces are isolated libraries; some defaults violate the project's
unknown-data rules. Repair and integrate these before expanding into Track 4.

Passing the current suites establishes regression coverage within their
assertions. The additional runtime controls below demonstrate important behavior
those assertions do not reject.

## Scope and method

- Code baseline: `081278d1d2a91d2f7c4a0188094c1fb2092a5797`
  (2026-10-23 audit-fix commit), through
  `1203730a69b018bcfa27946aa5aaeb271bb4b66c` (2026-10-31).
- Scope inventory: **47 commits, 325 changed files, 35,937 insertions and 5,505
  deletions**. The adjacent `07-change-inventory-2026-10-31.json` records every
  commit and changed path. These are dated diff totals, not product metrics.
- Reviewed the change inventory across all workstreams, the governing strategy,
  checklist and historical audit artifacts, Antigravity's reports and latest
  transcript, and the current implementation. Deep runtime controls concentrate
  on consequential data-truth paths and the newest Tracks 1–3. This is not a
  claim that every changed line or every live publisher was individually tested.
- Initial checkout: clean `main`, matching the locally recorded `origin/main`.
  No remote fetch was needed to establish the local audit target. A push receipt
  exists in Antigravity's transcript; this audit does not infer deployed code
  from that push.
- During verification, concurrent edits appeared in
  `reports/release-gate-snapshot-2026-10-21-trust.md` and
  `reports/SESSION_REPORT_2026-10-22.md`. They were preserved. Runtime code stayed
  at the audited SHA during the checks; final documentation is a working-tree
  addition rather than a new certified release.

## Where Antigravity left off

The relevant session is
`C:/Users/serge/.gemini/antigravity/brain/57e4d6c3-5b5e-4962-838e-1e1038325b12/`.

| Evidence | What it establishes |
|---|---|
| `MASTER_10_TRACK_BLUEPRINT.md`, modified 2026-10-31 16:17 PDT | Ten-track proposal. Its Track 2/3 "ready" labels predate their implementation. |
| `TRACK_1_BUILD_AND_RELEASE_REPORT.md`, modified 15:56 PDT | Track 1 delivered in `c8f0942`: recorder adapters, parcel overlay, dev cache and snapshot utilities. Its checklist-sync claim exceeds the actual diff: that commit did not edit the checklist. |
| Latest transcript, steps 9857–9926 | Two implementation agents delivered Tracks 2/3; the parent committed and pushed `1203730`, ran the full verifier, and ended with a clean Git status at 16:38 PDT. |
| Transcript step 9918 and `reports/release-gate-ledger.json` | Clean, source-bound **9/9** local release-gate receipt for `1203730`, 16:34 PDT. |
| Transcript step 9924 | **50/50** suites with **18 skipped tests**. The original completion language must retain that limitation. |
| Earlier build/dataset/scraper/live-audit reports | Useful implementation history for the October 29–31 waves; their "verified sources", "shipped", "zero remaining defects", and production claims require the narrower evidence distinctions used here. |

The last implementation is therefore **Tracks 2/3 committed and locally tested**,
not "Track 2 still unstarted" and not "all ten tracks delivered." There is no
Track 4–10 implementation receipt in that final commit.

## Recent-work inventory by workstream

| Workstream | Material work present | Remaining acceptance issue |
|---|---|---|
| Accounts and commercial foundation | Account storage/migration, magic-link flow, Stripe subscriptions and webhook idempotency work | Existing code should be exercised through a member journey before adding a second billing/auth implementation; live billing and delivery remain unverified here. |
| Marketing, evidence UI and design system | Plain-language copy, palette rollout, shared tokens, evidence facts/gaps, detail/research improvements | Evidence styling can still overstate provenance; seven older audit concerns are not all resolved. |
| Security and database correctness | Production database precedence, Scrapy-ingest gates, SSRF hardening, batch caps, vault content binding/readback, unsupported-jurisdiction controls | Keep the focused regression coverage; verify hosted configuration, external PostGIS concurrency and restart behavior separately. |
| Sources and platform scraping | Catalog expansion, RealAuction AJAX, CivilView/AcclaimWeb/ServiceLink/Texas tax-sale work, JSON extraction, bot-challenge controls | Adapter linkage is not a successful collection or promoted jurisdiction. Recorder date truth needs repair. |
| Parcel and public-record enrichment | ArcGIS/APN/FIPS joins, assessor interpretation/harvest, local parcel index, polygon drawer, municipal feeds, HUD benchmarks | Source/date manifests and actual observed coverage remain essential; computed context must not become publisher facts. |
| Underwriting and exports | State/program rules, carry, reassessment, redemption scenarios, surplus calculations, scenario-bound decision packets | Unknown senior debt still becomes zero in the waterfall; legal rules and rent/HPI semantics need source-specific qualification. |
| Document review and notices | Multi-state email intake, vault evidence, verbatim spans, queue hydration and split-pane rendering | New Track 2 automatic low-confidence staging is not wired just because an existing review UI works. |
| Tracks 2/3 infrastructure | DOM fingerprinting, selector registry, hash-block helpers, typed DAG, trigger metrics, benchmark function | Finish scheduler/persistence/API integration and remove fabricated default outputs. |
| Build and verification | Turbopack tracing fix, context/schema/wiring guards and repeated release receipts | Current gate scope does not establish all product invariants, live collection, hosted deployment, or real-server database fencing. |

`CONTEXT.md` currently reports **288 catalog entries, 60 with adapters and 43
dispatched API paths**. Its source-status breakdown includes discovery/manual
routes. These counts do not mean 288 collectors or 60 live-qualified scopes.

## Findings and required controls

### A31-01 — P0: unknown senior debt is presented as zero

`src/lib/underwriting.ts:1243` accepts an omitted `seniorMortgageAmount`, defaults
it to zero for a junior foreclosure, and returns a favorable zero-debt summary.
`src/components/terminal/due-diligence-checklist.tsx:203` explicitly converts a
blank senior-balance input to zero. A runtime call with a $100,000 second-mortgage
bid and no senior balance returned effective acquisition cost $100,000,
`criticalAlert: null`, and "Zero surviving lien debt against the purchaser."

**Required:** distinguish unknown, an explicitly entered zero, and an observed
balance. With unknown senior debt, withhold a complete acquisition cost and
clear-title/zero-debt conclusion. Cover the interactive checklist and exported
decision view, including unknown title priority as distinct from known survival.

### A31-02 — P1: recorder dates become published auction dates

`server/scrapers/trustee.js:163` and `:306` use the recording date as `saleDate`.
`server/scrapers/adapters/harris-clerk-foreclosure.js:202` substitutes a calculated
eligible First Tuesday when the notice contains no sale date; the trustee then
serves it without a derived-date distinction. A mocked Maricopa notice of default
with only a recording date produced `saleDate: 2026-10-01` and a synthetic address
`Maricopa County Recorded Instrument 20260000001`.

These branches are jurisdiction/opt-in paths; this control does **not** establish
that such records are currently in production. They must be corrected before
promotion. Retain recording/posting/earliest-eligible dates in their own fields;
publish a sale date only from explicit sale evidence. Keep pre-foreclosure
filings as evidence unless they satisfy a separately approved listing contract.
Add captured, policy-permitted publisher fixtures and a scoped live canary.

### A31-03 — P1: the new DAG fabricates successful enrichment

`server/swarm/dag-orchestrator.js:58` supplies Orlando coordinates/FIPS when no
geocode result exists. Other default handlers supply 0.25 acres, fallback rents,
zero violations, and a default plaintiff. A Los Angeles input returned
`success: true`, `lat: 28.5383`, `lng: -81.3792`, `fips: 12095`, and 0.25 acres.
An unsupported rent ZIP can also receive the hardcoded rent ladder.

No production caller of this DAG was found: it is currently a library exercised
by tests. **Do not wire these defaults into the product.** Bind to real existing
providers with dependency injection; use null plus reason/source/date for absent
evidence. Validate ranges and nulls without `Number(null)` coercion. Propagate
required-dependency failures transitively and abort timed-out provider work.
Unknown municipal coverage must not become a clean code-enforcement finding.

### A31-04 — P1: DOM drift integration suppresses its own result

`server/scrapers/telemetry.js:179` evaluates new DOM drift, then `:191` overwrites
`driftDetected` with the older address/bid yield rule. The control returned
`driftReport.hasDrift: true` with `driftDetected: false`. In addition,
`server/scrapers/scheduler.js:376` supplies neither HTML nor the historical
baseline required to enter the new evaluation path.

**Required:** capture a bounded page/template fingerprint, store a versioned
baseline per source and scope, combine alarm conditions without overwriting, and
exercise scheduler → persisted telemetry → health/Source Radar. Baseline controls
must distinguish ordinary row-count changes, genuinely empty inventory, and a
layout/yield failure.

### A31-05 — P1: the evidence ledger is neither append-only storage nor integrated history

`server/scrapers/discovery-snapshots.js:315` overwrites `<recordId>.json` and
`<recordId>.md`; its generated ledger block defaults to index zero/genesis for
each observation. Two observations of one record used the same path, returned
block indices `[0, 0]`, and failed combined chain verification.
`server/discovery/evidence-ledger.js:253` rewrites the whole file;
`:266` loads corruption as `[]`. No collection call site of `recordSnapshot`
or persistence caller of the ledger was found outside their definitions/tests.

**Required:** choose the durable store and transaction/locking contract first;
append observations with stable content IDs, verify on load, quarantine corruption
without replacement, and test concurrent writers, restart and failed commits.
Bind exports to actual retained entries. A hash chain alone does not authenticate
the clock or detect a complete rewrite/truncated suffix without a trusted retained
head or external anchor. Describe it as tamper-evident within that threat model.

### A31-06 — P1: new benchmark "verification" includes assumed inputs

`server/enrichment/public-benchmark-consensus.js:118` silently supplies assessment
year 2020. An input with an assessed total of $200,000 and no assessment year
returned a $318,200 HPI-adjusted number and counted `fhfa_hpi` as verified.
`server/enrichment/hpi.js` re-exports `server/intelligence/fhfa-hpi.js`, whose state
series is a national table multiplied by fixed state weights, not imported
state-quarter observations. Counting inputs is evidence availability, not three
independent measurements agreeing on market value.

**Required:** unknown assessment year yields no trajectory unless the buyer
explicitly supplies an assumption. Version real source files with retrieval date,
period, geography and digest. Preserve unobserved reasons and distinguish modeled
outputs from source observations. The existing FY2025 HUD data can be historical
context but needs an age indicator and update process. HUD describes FMRs as
estimated program benchmarks; they are not guaranteed rental income or a statutory
minimum rent. [HUD primary explanation and annual data](https://www.huduser.gov/portal/datasets/fmr.html).

### A31-07 — P1/P2: the seven earlier audit concerns remain incompletely resolved

| Earlier concern | Current evidence | Next acceptance test |
|---|---|---|
| Lien waterfall | A31-01 runtime reproduction | Unknown balance cannot produce zero-debt/full-cost result. |
| Evidence-gap logic | `src/lib/evidence.ts:61` removes the lien gap for any nonempty `seniorLienRisk`, including `low`; server dossier still always retains its title gap | Pattern flags, regardless of risk level, cannot close a title-evidence gap. |
| Fact provenance | `src/components/evidence/fact.tsx:19` defaults to `printed`; callers do not require a source-evidence class | A non-null derived/unverified value cannot acquire publisher-observed styling by omission. |
| County failure vs 404 | `src/app/states/[state]/[county]/page.tsx:43` catches API/DB failure as `[]`; `:121` converts it to `notFound()` | Unavailable inventory differs from a successfully resolved nonexistent county. |
| Source recheck semantics | `research-case.tsx:84` uses case revision to claim a newer source observation; backend revisions also change for added origins | Same source timestamp plus a new origin never claims new publisher evidence; returned source-check metadata is explicit. |
| Invalid date formatting | `src/lib/evidence.ts:21` returns arbitrary unparseable date text; control rendered `not-a-real-date` | Preserve a separate schedule-description field if useful; invalid dates remain unknown as dates. |
| Checklist persistence | `due-diligence-checklist.tsx:180` accepts any object and merges arbitrary values; old status state can carry across listing-key changes | Validate known IDs/enums and reset state when changing the listing; malformed/foreign data cannot change verification counts. |

The date-text behavior is partly intentional in an existing test (`First
Tuesday`); changing it requires separating schedule descriptions from dates,
not merely tightening parsing without a product contract.

### A31-08 — P1: integration and verification coverage are overstated

The new selector store has no collector caller; the DAG and public consensus
have no product caller. The established swarm CLI still uses
`scripts/swarm/orchestrator.js`. Trigger weights are updated by the new DAG but
do not alter its dispatch; no persistent routing integration was found. Automatic
low-confidence document-review staging from Track 2 is not delivered in
`1203730`.

Complete one existing user/collector path end to end before adding another
orchestrator. Add negative assertions for A31-01–07. Keep unit, browser,
embedded-database, external-PostGIS, source-canary and hosted checks separate.
The main verifier also uses unbounded `execSync` per suite, so a connection problem
can hold the entire run indefinitely; add a bounded suite timeout with actionable
diagnostics.

### A31-09 — P1: several "ready" roadmap items require correction

- **Track 4 LA recorder:** the county says its real-estate records and indexes
  are not available online. Replace a proposed public recorder scraper with a
  manual/request-based evidence workflow unless an authorized source is actually
  established. [LA County Recorder](https://www.lavote.gov/home/recorder/real-estate-records/general-info).
- **Track 4 GSA API:** the cited GSA Auctions route must not be treated as a
  demonstrated real-estate replacement for a robots-excluded site. GSA separates
  [personal-property auctions](https://www.gsa.gov/tools-overview/personal-property-disposal-and-auctions-tools)
  from [real-property disposition](https://www.gsa.gov/real-estate/real-property-disposition).
  Prove a suitable real-property feed and its terms before enrollment.
- **Track 7:** jurisdiction alone does not determine a foreclosure outcome.
  Require sale program, instrument priority, dates, notices and case evidence;
  missing predicates must remain unknown. Do not infer permission to proceed
  from a bankruptcy filing count or a pattern match.
- **Track 8:** flood-zone screening does not provide a flood-insurance premium;
  nearby EPA records do not establish parcel liability; terrain samples are not a
  survey. Require explicit coverage and uncertainty.
- **Track 9:** no clearing probabilities or expected returns without appropriately
  observed outcomes and disclosed assumptions. `closed` still does not mean sold.

### A31-10 — P2: status documents drifted again

The checklist's opening table still cited an October 22 tree, 163 catalog entries
and 42 paths before this audit, while generated context had 288 and 43. The
Antigravity blueprint still called Tracks 2/3 ready to build after their commit;
the historical roadmap still lists those modules as prospective. Historical
ServiceLink archive-pagination proposals also conflict with the checklist's
already-converged live sweep.

Update active status once, here via the canonical checklist, and preserve dated
historical receipts as history. Do not rerun a completed archive/sweep or promote
a source just to reconcile prose.

## Recommended sequence using Antigravity's track numbers

| Order | Track and current disposition | Concrete next deliverable and exit |
|---|---|---|
| First | **Stabilization across 1/2/3/7** | Fix A31-01/02/03/06 and older evidence-UI failures. Negative controls must pass through actual route/UI/export boundaries, with no invented facts. |
| Early parallel groundwork | **10 — fixtures and qualification first** | Captured permitted fixtures, per-source/scope evidence matrix, positive/negative control coverage. Automate intake proposals only; no automatic promotion or deletion. |
| Then | **2 — finish integration** | Persistent drift baselines and visible alarms; transactional append-only evidence records, corruption/restart/concurrency controls, verified export linkage; presentation-selector integration. |
| Then | **3 — replace fake defaults and integrate once** | Real provider handlers with typed nullable results, source/date provenance, timeout cancellation and failure propagation; one dossier path consumes the result. Keep trigger tuning observational until validated. |
| Before enabling unattended/live services | **6 — operational prerequisite** | Verify deployed SHA, health/dataMode, operator auth, storage durability, backup/restore and bounded collection restart. Stage delivery/billing secrets and endpoints only when the operator is ready; domain/counsel work remains external. |
| After source-truth repairs | **4 — bounded county expansion** | Start with one supported CivilView or already-built platform jurisdiction; add a captured fixture, explicit scope, two qualifying canaries, promotion receipt and real observed result. Remove LA/GSA assumptions above. |
| After durable delivery prerequisites | **5 — finish investor workflow** | Exercise existing member auth, saved hunts and exports; add a durable outbox, retries/idempotency, opt-in/unsubscribe, member isolation and a verified digest. Define the portfolio state machine before adding a board. |
| After source/legal evidence contract | **7 — validate title rules before breadth** | Primary-source rule manifest with effective dates, program predicates and unknown states; adversarial cases for priority, notice, redemption and stays. Start with verified target jurisdictions rather than another unsupported 50-state claim. |
| Later | **8 — environmental screening** | One FEMA screening adapter with geometry/coverage/error controls and dated source disclosure, then bounded EPA/USGS work. Keep premiums and legal conclusions outside inferred outputs. |
| After retained outcome history exists | **9 — analytical pilot** | Observed sale-outcome taxonomy and reconciliation, sample/coverage report, explicit scenario assumptions; only then empirical clearing analytics and escrow planning. |
| After ledger/retention contract | **10 — compaction remainder** | Dry-run content deduplication preserving all transitions and provenance, storage measurements, backup and restore proof. Destructive retention needs separately established scope. |

Suggested responsibility boundaries: underwriting/evidence UI owns A31-01/07;
source collection owns A31-02/04 and Track 4; provenance/storage owns A31-05;
enrichment owns A31-03/06; release/ops owns A31-08 and Track 6. These are planning
boundaries, not dispatched agents or an authorization to deploy/send/spend.

## Verification receipt and limits

- Fresh Track 2/3 module tests: **49 passed, 0 failed**.
- Fresh meta-guards: **177 passed, 0 failed**.
- Fresh remaining-coverage runner: **1,981 passed, 0 failed**.
- Final documentation checks: **12 passed, 0 failed**; generated context current,
  audit inventory JSON validated and `git diff --check` clean. The docs-only
  `verify:gate` fast unit gate also passed.
- Fresh full verifier: **50/50 suites passed, 0 failed, 18 database-gated tests
  skipped**. This includes the production build, local production-stack E2E and
  canonical browser suite. Run completed against the audited runtime code with
  concurrent historical-report edits present; it is not a clean-tree release
  receipt for the final documentation working tree.
- Existing source-bound release receipt: **9/9 for `1203730`**, from
  `reports/release-gate-ledger.json` and Antigravity's push transcript. This audit
  did not replace that receipt with a dirty-tree release claim.
- Runtime controls reproduced A31-01–06; these are observed failures of intended
  invariants even when the current regression tests pass.
- The initial sandboxed full run could not connect to its own localhost server
  (`EACCES`) and was stopped. A bounded diagnostic independently confirmed it;
  verification was rerun with localhost access. This was an environment failure,
  not recorded as an application regression.
- Docker's Linux engine was unavailable, and no external test database was
  configured. External-PostGIS concurrency/fencing evidence was not refreshed.
- The deployed health URL could not be retrieved by the web tool; a shell probe
  also failed DNS. Production availability, count, deployed SHA, secrets and
  durability remain **unverified from this session**, not inferred failed.
- No new live scraper sweep or source promotion was performed.

Local reproduction artifacts are under `.cache/audit-2026-10-31-*` and
`.cache/audit-controls-2026-10-31.*`; they are ignored scratch evidence and are
not durable release records. The observations above and the change inventory
preserve the useful results in the repository.
