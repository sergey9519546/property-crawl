# Tracks 1–3 stabilization — 2026-10-31

This is an implementation and verification receipt. The active acceptance queue
remains in [`docs/COMPLETION_CHECKLIST.md`](../docs/COMPLETION_CHECKLIST.md).
The findings being repaired are in audit 07.

## Scope and shared-checkout state

Work began at `1203730`. During implementation a concurrent session created
`4d63434`, including the in-progress stabilization changes and the earlier audit
artifacts in its commit, despite its documentation-oriented title. That commit
was preserved. The remaining changes build on that combined tree; this pass did
not amend the concurrent commit. Verification therefore refers to the current
working implementation, not merely the scope suggested by its commit title.

## Implemented repairs

| Audit finding | Result and evidence |
|---|---|
| **A31-01 — unknown debt** | Missing, invalid and negative senior balances remain unknown. A junior foreclosure cannot emit a complete acquisition cost or zero-debt conclusion from a blank balance. Explicit zero remains distinct. Unknown taxes or priority also withhold the total. Foreclosing debt is not synthesized from the winning bid, and surplus remains null without that debt input. Positive known-balance controls retain their arithmetic. |
| **A31-02 — recorder dates/links** | Recording dates are retained separately; calculated First Tuesday eligibility is a separate field. Published sale dates require explicit notice evidence. Pre-foreclosure/default/certificate entries are retained as evidence rather than sale listings. Synthetic address fallbacks were removed. Exact record links must be captured from the publisher's HTML; recording/file IDs no longer manufacture detail URLs. A form shell without validated results fails qualification. |
| **A31-03 — DAG** | Removed Orlando/FIPS, acreage, rent, zero-violation and default-plaintiff substitutions. Defaults now reuse supplied records or call existing providers only when network work is explicitly enabled. Nullable outputs and unknown reasons survive dossier synthesis. Required failures propagate through skipped optional branches; optional failures preserve unknowns. Timeouts signal provider cancellation. The existing authorized property-intelligence route consumes the DAG without changing its cached public-record evidence contract or exposing private research to anonymous GETs. |
| **A31-04 — drift** | BaseScraper captures bounded structural fingerprints. The scheduler forwards them into per-scope, persisted telemetry baselines. DOM alarms are no longer overwritten by the old completeness rule. Identical repeated table rows do not create a layout-change alarm just because row count changed. Zero-yield collapse and restart/readback controls execute. |
| **A31-05 — ledger** | Snapshots use immutable content-addressed files, flushed before the ledger commit. The ledger appends JSON lines under an exclusive writer lock; existing prefixes cannot be replaced/truncated. Unreadable or partially written history blocks further writes and retains the original bytes. Four independent writer processes are tested for lost updates. The scheduler captures evidence before inventory writes; exports/dossiers verify the retained chain and snapshot digest before reporting a receipt. `/api/health` and scraper health expose the local evidence store's integrity and its filesystem-only durability limit. |
| **A31-06 — benchmarks** | No assumed assessment year or quarter. HPI trajectories require explicit, versioned state-quarter inputs and source metadata; the weighted national model is not an observed-series fallback. Candidate/unmatched parcel assessments are withheld. The returned fraction is explicitly input availability, not valuation consensus. HUD data is identified as historical FY2025 context; UI/export labels describe benchmarks and scenarios rather than guaranteed rent floors. |
| **A31-07 — earlier seven issues** | Title-risk flags never remove the title-research gap. Fact styling defaults to unverified unless provenance supports the field. Invalid/rolled-over dates remain unknown. County transport failure propagates as unavailable instead of a false 404; an authoritative empty result remains distinct. Case responses include explicit source-check timestamps/update metadata; the UI describes checking saved observations rather than contacting a publisher. Checklist storage accepts only known IDs and status enums and resets on listing changes. |
| **A31-08 — integration/verification** | The frozen presentation-selector registry is used by the extraction lane. Money, dates, identity and occupancy cannot relocate adaptively. Low-confidence captured documents are staged into the existing operator source-intake review workflow; staging does not approve or publish a listing. Scheduler-to-ledger-to-health, authorized dossier, and cached-research isolation controls run. The full verifier has a per-suite timeout. New regression files are explicitly wired into `test:stabilization`. Trigger outcome weights remain observational, not a claim of autonomous routing optimization. |

The ledger establishes local chain/snapshot integrity within its retained history.
It does **not** authenticate publisher timestamps, provide an external trusted
head, or prove persistence across a host redeploy. The API says so. A database
write failure may leave a genuine observation retained in the ledger without an
inventory update; evidence is not a claim that a listing transaction succeeded.

Low-confidence staging uses the source-intake review surface. It does not force
an unresolved notice into the listing-backed document-review queue by inventing
an offering or listing identity.

## Live recorder checks and qualification limits

Read-only checks used the ordinary crawler identity, checked robots first, and
made no source promotion or inventory writes:

- **Maricopa:** the robots request returned **403**. Collection stopped at the
  policy check. No alternate identity or challenge bypass was attempted.
- **Harris:** robots allows the foreclosure application path. The old configured
  `/Foreclosure/Search` returned **404**. Its default entry point is now the
  county's actual
  [Foreclosures inquiry](https://www.cclerk.hctx.net/Applications/WebSearch/FRCL_R.aspx),
  which returned **200**. That response is a query form, with zero validated
  offering records. It is **not a clean canary**. The collector refuses to treat
  the form as proof of an empty inventory.

The parser tests' record anchors are explicitly synthetic unit fixtures. They
do not certify that a particular live record URL resolves. Live recorder
qualification requires a policy-permitted query and exact captured record
evidence before either jurisdiction can be promoted. Maricopa's policy access
and Harris's actual form/query workflow remain acceptance limits.

## Verification

The first broad run found three actionable issues: the new select needed an
explicit accessible name for its browser journey, the new test files needed
runner wiring, and the raw-payload honesty comment needed to stay next to the
new evidence call. These were corrected without removing the negative controls.

The added browser journey checks a blank senior balance, an explicit positive
balance, explicit zero and a return to blank. It verifies the incomplete/unknown
display and the known $300,000 scenario result.

Final checks on the combined working implementation:

| Check | Result | Local receipt |
|---|---|---|
| Full verifier, frozen runtime | **50/50 suites**, zero failed; **18 external-PostgreSQL tests skipped** (16 backend, 2 operations) | `.cache/stabilize-frozen-tree-verification.log` |
| Dedicated stabilization controls | **13/13**, zero skipped; includes four writer processes and scheduler/evidence/health integration | `.cache/stabilize-dedicated-final.log` |
| Meta guards | **177/177**, zero skipped | `.cache/stabilize-meta-final.log` |
| Explicit remainder coverage runner | **1996/1996**, zero skipped; three older Python files are surfaced as not executed by this runner | `.cache/stabilize-coverage-final.log` |
| Release gate | **9/9**: typecheck, generated context, schema mirrors, wiring, operations, parser, production smoke, build and full-stack embedded-database E2E | `.cache/stabilize-release-final.log`, `reports/release-gate-ledger.json` |
| Completion gate | **5/5**, all passed: changed-module loading, scrapers, unit, telemetry, and list-payload/underwriting-truth | `.cache/stabilize-completion-gate-final.log` |
| Documentation and generated-context checks | **12/12** documentation controls, current context digest, clean whitespace check | `.cache/stabilize-docs-final.log`, `node scripts/gen-context.js --check`, `git diff --check` |

The release gate reports `4d63434c295348fc65e7c95272603f9d6bb2781b`
with a **dirty working tree**. Its pass is local verification of that working
implementation, not a clean, source-bound release or deployment receipt. The
pre-gate runtime fingerprint covers 488 JavaScript/TypeScript files in `src/`
and `server/`, SHA-256
`72c0fb5c9cf873caf514382ec9da5980ebcd21a347eafa69c38f1abadc77f559`
(`.cache/stabilize-runtime-fingerprint.json`). The same fingerprint was confirmed
after all final gates: sorted slash-normalized relative paths followed by raw
file bytes, with no separators. Documentation is finalized after the runtime
freeze and checked separately. The logs are local, ignored artifacts;
this checked-in receipt preserves the outcomes and limitations.

## Acceptance gates still outside the local pass

1. **Real external PostgreSQL:** Docker Desktop was installed but its Linux
   engine never became available. Hidden-app startup, Desktop CLI startup/status,
   and service inspection did not produce an engine. The Windows service query
   also reported that `com.docker.service` was not installed. No external test
   database was configured. The 18 database-gated tests therefore remain skipped;
   embedded/local tests do not replace their row-lock and lease-fencing evidence.
2. **Hosted durability/configuration:** a mounted durable evidence directory,
   hosted backup/restore and deployed-SHA proof remain Track 6 acceptance work.
   The new local ledger is not represented as remotely durable.
3. **Recorder qualification:** the two live limits above remain unpromoted.
4. **Observed HPI data:** without an explicitly supplied observed state-quarter
   series and assessment period, the trajectory remains unknown. Enabling it by
   inventing or relabeling the old model is not an acceptable shortcut.

Tracks 4–10 have not been advanced. The immediate queue is the remaining
acceptance evidence above, followed by the dependency order in the checklist.
