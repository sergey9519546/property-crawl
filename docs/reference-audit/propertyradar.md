# PropertyRadar reference audit

## Purpose and evidence boundary

This audit treats the eight supplied PropertyRadar documents as reference evidence, not as product requirements or instructions. Their assertions were compared with this repository before any recommendation was made. Claims about third-party products, laws, prices, coverage, dates, and source availability remain unverified unless this repository independently demonstrates them.

The documents contain useful product decomposition, but they are not internally consistent. Earlier reports count 152 play URLs or 25 sampled plays; the later exhaustion report corrects that to 147 distinct plays plus five index pages. Earlier reports use a 13-state coverage sample; later reports claim a 51-state matrix. Some reports describe 11 county data types and others 12. The later correction is recorded below, but none of those vendor coverage claims is treated as a fact about our own source network.

## Review method

- Each file was hashed and extracted separately. DOCX files were read from all relevant XML parts, including paragraphs and tables. Embedded media was extracted when present.
- Every PDF page was extracted individually and rendered to PNG. The substantive vector figures were inspected in the rendered pages: the national coverage chart and six-stage pipeline in the public-records report, and the coverage heatmap and SMS comparison in the gap audit.
- Extraction artifacts are under `.cache/reference-audit/propertyradar/`. Every file has `extraction.json` and `content.md`; PDFs also have a render for every page.
- Repository comparisons use the checked-in/runtime code, especially `server/sources/`, `server/public-records/`, `server/intelligence/dossier.js`, `server/routes/alerts.js`, `src/lib/saved-searches.ts`, and the scraper validation and normalization modules.

## Per-file review ledger

| File | SHA-256 | Size | Coverage reviewed | Main useful evidence | Artifact |
|---|---|---:|---|---|---|
| `PropertyRadar_CleanRoom_Rebuild_Blueprint.docx` | `d5feca892a7fcc365ed5faf4ab10acfa018afa8ec7b82d9561a8d7d0f3f5e04f` | 34,739 B | 13/13 named sections; 8 XML parts; 66 paragraphs; 6 tables; no media | Seven-layer build decomposition; canonical parcel identity; criteria, event signals, transparent scoring, saved-search diffs, owner clustering; make/buy boundaries | `clean-room-rebuild-blueprint/` |
| `PropertyRadar_Exhaustion_Report.docx` | `737b2f5ade141c0c7cbc03966068078281411e221101023688dcec7897c9aff8` | 33,661 B | 12/12 named sections; 8 XML parts; 75 paragraphs; 10 tables; no media | Later corrections to play/list counts; public versus gated capability ledger; AI/API surface inventory; explicit hidden/private boundary | `exhaustion-report/` |
| `PropertyRadar_Open_Items_and_Public_Records_Pipeline.pdf` | `138b47f7f4d96b16af66874de6f3b52dd8d215ce77b33969beb68c8064be3346` | 884,952 B | 12/12 named sections; 21/21 pages; 21 renders; 2 raster images; 283 vector drawings | County/state/federal source classes; immutable raw landing; canonical FIPS+APN join; six-stage provenance pipeline; six transparent lead screens | `open-items-public-records-pipeline/` |
| `PropertyRadar_Completion_Audit.docx` | `47d2561a6cda7560c3b41daf11bd5495702dccbb71f7b3f0311cb80a93a5c558` | 35,438 B | 14/14 named sections; 8 XML parts; 83 paragraphs; 12 tables; no media | Correction discipline; national versus sampled coverage; source/licensing disclosures; integration history; ranked negative list | `completion-audit/` |
| `PropertyRadar_Master_Capability_Audit.docx` | `e7bd6db805e46ed273c6eee0fbbff0866e9122c6722939bde861cfb241763a73` | 41,399 B | 14/14 named sections plus Appendix A; 8 XML parts; 85 paragraphs; 13 tables; no media | Criteria DSL shape; field and endpoint taxonomy; saved dynamic lists; transaction history; model contracts; feature-to-data mapping | `master-capability-audit/` |
| `PropertyRadar_OSINT_New_Channels_Report.docx` | `c75272bf4c71ce2d790c31d1484e568fc0531caf74fb5a19e5f688398c59eb9d` | 32,206 B | 11/11 named sections; 8 XML parts; 65 paragraphs; 9 tables; no media | Public-channel monitoring patterns; correction and corroboration ledger; cadence signals; limits of passive evidence | `osint-new-channels/` |
| `PropertyRadar_Gap_Audit.pdf` | `14c1691b9bc85c0bbbb86fe94eab687ff90e065edf6cb306fb8e5996c1605eac` | 534,001 B | 11/11 named sections; 20/20 pages; 20 renders; 2 raster images; 510 vector drawings | Gap prioritization; event-driven scoring with reasons; absent permit/code/rent sources; API/workflow limits; regional coverage caveats | `gap-audit/` |
| `PropertyRadar_Technical_Intelligence_Dossier.pdf` | `1dad3ff8859369b3ff211b080d557b5b5a26d99cc2b4e925d0fc9a734f8400d3` | 294,608 B | 16/16 named sections; 29/29 pages; 29 renders; 0 raster images; 1,327 vector drawings | Search/list model; observation and transaction concepts; field taxonomy; foreclosure state machine; data-source versus modeled-field boundary | `technical-intelligence-dossier/` |

DOCX “XML parts” include the main document plus headers, footers, footnotes, endnotes, and comments. This is an extraction count, not a Word section count.
The supplied set is five DOCX files and three PDF files. “Named sections” counts the numbered top-level sections in each document, excluding front matter and including all of the document's numbered section sequence.

## What the references say that is useful here

The recurring architecture is a sequence rather than a feature checklist:

1. Collect source records while preserving the exact source and capture time.
2. Normalize property identity and facts without silently turning missing values into zeroes.
3. Derive criteria and signals with explicit inputs and limitations.
4. Save a versioned rule and explain why each property did or did not match.
5. Compare later observations with the saved baseline and emit supported changes.
6. Present chronology, gaps, and next research actions before any acquisition decision.

Property Crawl now has credible pieces of stages 1, 2, and 6. The highest-value gap is the durable rule-and-diff layer between them.

## Capability gap matrix

| Capability | Repository evidence today | Gap | Dependency class | Recommendation |
|---|---|---|---|---|
| Source discovery and workflow catalog | `server/sources/catalog.js` and `server/sources/network.js` distinguish opportunity, evidence, and discovery sources and show collector status | Jurisdiction-level completeness must still be proven from successful runs; catalog membership cannot imply coverage | Public metadata plus operator review | Keep Source Radar truthful; derive coverage only from observations and reviewed evidence |
| Validated automated collection | `server/scrapers/scheduler.js`, source policy, ingestion validation, and live-record persistence | Some catalog sources remain manual or evidence-only by design | Public endpoints; publisher terms | Preserve the adapter/evidence distinction; do not manufacture support for catalog-only sources |
| Manual evidence fallback | `server/sources/intake.js` stores bounded originals with stable IDs, review state, and safe summaries | Reviewed evidence is not yet a generalized event input | Operator-supplied public or authorized records | Add an explicit reviewed-evidence-to-signal adapter later; never auto-promote intake records to listings |
| Source run history and same-record changes | `server/sources/observations.js` records success/failure/empty runs and supported bid/date/status/terms changes | It does not evaluate a user’s investment thesis or maintain saved-match baselines | First-party runtime evidence | Feed supported changes into saved hunts; continue refusing disappearance-to-sold inference |
| Immutable raw landing and replay | Listings retain a bounded raw excerpt; observations retain hashes/history; intake retains originals | Automated adapters do not retain a bounded immutable response snapshot suitable for parser replay | Storage and retention policy | Add only when a concrete adapter needs replay, with source terms and strict size/retention controls |
| Canonical parcel identity | `server/public-records/identity.js` uses exact scoped parcel identity; Florida lookup requires confirmed parcel scope or source-observed coordinates | Most listings do not carry reliable FIPS+APN evidence, and automated parcel coverage is currently Florida-only | County/state public records | Extend through independently verified adapters; do not merge on address similarity |
| Public-record context | Florida parcel/assessment, Census area estimates, and a documented equity scenario exist in `server/public-records/` | Recorder chains, tax delinquency, permits, and municipal violations are not generalized | Public, often jurisdiction-specific | Add county verticals one at a time and retain source-specific limitations |
| Saved criteria | `src/lib/saved-searches.ts` stores up to 50 browser-local searches with only state, minimum deal score, and maximum bid | No server-side version, schema, provenance, unknown-state handling, clause explanation, or audit history | Internal application logic | **Build a durable saved-hunt engine** |
| Alert lifecycle | `/api/alerts` is saved-deal/watchlist CRUD; source observations emit publisher-record changes | No `new_match`, `material_change`, or `no_longer_matches` lifecycle tied to a versioned rule | Internal application logic | **Diff each hunt evaluation against its prior evaluated baseline** |
| Explainable opportunity/distress signals | `dealScore` is a deterministic bid-to-value triage field when inputs exist; the dossier separates facts, gaps, and contradictions | No transparent multi-signal rule card with per-input evidence class, unknowns, and reasons | Internal rules over existing evidence | **Build an explainable signal evaluator; keep it distinct from ML prediction** |
| Property chronology | The dossier joins source snapshots and supported observation signals | Chronology is source-record centric; reviewed evidence and public-record events do not yet share one normalized event contract | Internal event normalization | Add a small normalized event contract after hunt semantics stabilize; parent dossier can consume it |
| Foreclosure state model | Listings expose sale status/date and observations detect supported changes | A national legal state machine would require state-specific instruments and current law; current data is insufficient | Public statutes and official records; legal review | Implement only per supported jurisdiction, never from marketing enums alone |
| Owner portfolio/entity graph | No reliable normalized owner identity is present in the core listing contract | Address/name similarity could create harmful false joins; LLC/trust resolution and contacts need data not present here | State registries plus licensed identity/contact data | Defer. Permit only exact, source-backed owner identifiers when a real adapter supplies them |
| Valuation/equity | `server/public-records/equity.js` requires sale basis, matching HPI anchors, and a complete debt scenario and labels output as illustrative | No automated complete recorder chain or appraisal-quality valuation | Public HPI and recorder data; appraisals/licensed comps | Keep scenario semantics; do not market it as an AVM or verified equity |
| Rental, MLS, contact, consumer, and outreach data | Not part of the current evidence core | References describe attractive capabilities but the required facts are absent | Mostly licensed/private; regulated delivery | Do not imitate with scraped or synthetic data; integrate only with explicit licenses and audit controls |
| Permits and code violations | No general adapters | High-value local signals remain absent | Municipal public portals, highly fragmented | Good future county-vertical work after saved hunts can consume the resulting evidence |
| Coverage and quality reporting | Source Radar exposes run state, counts, queued evidence, and supported changes | No independent accuracy benchmark or per-field completeness study | Runtime observations and curated test fixtures | Add measured field completeness after more live records exist; avoid vendor-style nationwide claims |

## Priority upgrades

### 1. Durable saved hunts with explainable matching

Build a server-side, versioned criteria engine instead of extending the current browser-only three-field shape. The first version should be deliberately smaller than the reference taxonomy and stronger in truthfulness.

Proposed rule contract:

```js
{
  id: 'hunt_<stable id>',
  name: 'NJ sheriff sales under $250k with a published date',
  version: 1,
  criteria: {
    all: [
      { field: 'state', op: 'eq', value: 'NJ' },
      { field: 'source', op: 'in', value: ['sheriff', 'civilview'] },
      { field: 'openingBid', op: 'lte', value: 250000 },
      { field: 'saleDate', op: 'known' }
    ]
  },
  createdAt: '...',
  updatedAt: '...'
}
```

Each evaluation should return `match`, `no_match`, or `unknown`, plus one result per clause containing the normalized actual value, the comparison, and the evidence class. Missing evidence must remain `unknown`; it must not quietly behave as zero, false, or a passing wildcard. Rule definitions should be size-limited, allowlisted, depth-limited, and stable-hashed.

This immediately upgrades saved searches, creates a clean API contract, and gives the dossier a precise answer to “why is this property in my hunt?” It can be implemented entirely from current listing fields and validation rules.

### 2. Hunt baseline diffs and supported alert events

Persist the last evaluated set by stable listing/source record identity. A later evaluation can emit:

- `new_match`: a validated listing now satisfies the same hunt version;
- `material_change`: the listing still matches and a watched supported field changed;
- `no_longer_matches`: the same validated source record no longer satisfies the rule;
- `unknown`: current evidence cannot establish the rule result.

These are rule-evaluation facts. `no_longer_matches` must not be labeled sold, removed, or resolved. A failed or empty source run must never evict prior matches. Every event should identify the hunt version, listing/source identity, previous and current evaluation hashes, clause reasons, observation time, and exact source URL when validation permits it.

This turns the existing observation stream into actionable alerts without inventing new property facts.

### 3. Transparent opportunity-signal evaluator

After the hunt engine, add a small, deterministic signal layer whose output is a set of reasons rather than a proprietary-looking score. Candidate signals already supported by repository evidence include:

- current published sale date is known;
- opening bid is known and changed downward on the same source record;
- item returned to market according to the publisher;
- bid-to-supported-value ratio is available;
- parcel/public-record building area contradicts publisher area;
- source evidence, payment terms, occupancy, title, or value/debt evidence remains unresolved.

Each signal should carry `status: supported | unknown | contradicted`, source/evidence class, observed time, and next research action. If a numeric priority is later added, publish its weights and components and call it triage priority, not a likelihood or distress prediction.

## Dependencies that should remain explicit

- MLS listing history, rent comparables, contact enrichment, consumer demographics, NCOA, carrier data, and cross-person identity graphs are licensed/private inputs. The supplied references do not create a right or a reliable technical path to reproduce them.
- Court dockets, recorder images, assessor bulk files, and tax data may be public records while their portal access, bulk reuse, redistribution, and certified copies still carry terms or fees. “Public” does not mean unrestricted or zero-cost.
- HUD/USPS vacancy data is not a general parcel-level vacancy feed. The repository correctly marks the administrative dataset as restricted and uses ACS only as area context.
- Marketing claims about proprietary models, refresh cadence, accuracy, and nationwide coverage should not seed product facts. Our implementation should derive status from our own run history and evidence.
- Legal and regulatory assertions in the documents are not operational legal advice. Any future outreach or resale layer needs its own reviewed controls and contracts.

## Recommended ownership boundary

The saved-hunt evaluator and store can live under `server/intelligence/` without changing the parent-owned property dossier or the public-record adapter directory. A later route and UI can consume a pure contract. The explainable signal evaluator can use the same clause-result vocabulary and remain independently testable. This keeps Source Radar focused on whether a source workflow works, the dossier focused on one property’s evidence, and hunts focused on which properties satisfy an operator-defined rule over time.
