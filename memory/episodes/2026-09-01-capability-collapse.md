# Episode — 2026-09-01 Capability Collapse Executed (T3.2 complete)

**Date**: 2026-09-01
**Branch**: system-upgrade-workflow
**Task**: Delete the 28 generic GCP/BigQuery/SEO cloud-pack skills

## Decision

Deleted 28 skills from `.agents/skills/` (34 → 6). The prior session created 3
project-native skills but deferred deletion pending owner approval; approval was
given this session.

**Deleted** (generic Google cloud pack, publisher: google, no project usage trace):
bigquery-ai-ml, bigquery-bigframes, bigquery-data-transfer-service, bigquery-graph,
bigquery-sql, building-data-apps, data-autocleaning, dataform-bigquery, dbt-bigquery,
discovering-gcp-data-assets, enforcing-resource-attribution, federate-lakehouse-catalog,
gcloud-auth-verification, gcp-composer-troubleshooting, gcp-data-pipelines, gcp-dataflow,
gcp-managed-airflow-dag-authoring, gcp-managed-airflow-migrations,
gcp-managed-airflow-recommendations, gcp-pipeline-orchestration,
gcp-pipeline-resource-provisioning, gcp-spark, gcs-security-assessment,
google-cloud-storage-basics, managing-python-dependencies, ml-best-practices,
notebook-guidance, accidental-data-loss-prevention (also generic — gsutil/gcloud/Spanner).

**Kept** (6, all project-native or agent-meta):
property-scraper-engineering, foreclosure-title-intelligence, listing-normalization,
deal-scoring, agent-verification, skill-repair.

## Measured win

Router on the query "normalize listing data into canonical contract":
- **Before** (34 skills): 11 candidates tied at score 5 ("data", "into" matched
  generic GCP descriptions) → recommendation "ask", human had to disambiguate.
- **After** (6 skills): deterministic pick of `listing-normalization` (score 5,
  dominates runner-up 2x).

"Delete beats index": no router tuning was needed — precision improved by
removing dead capability, not by adding logic.

## Test changes

- `test/agent-system.test.js` scenario 1: ambiguous-query probe changed from
  `route('bigquery data pipeline')` (now zero candidates post-deletion) to
  `route('legal title scrape')` — verified to yield 2 ranked candidates
  (recommendation "ask"), preserving the ranking assertion's purpose.

## Verification

- skills-doctor: 0 dups, 0 empty dirs, 0 stale bundles
- agent-system.test.js: 10/10 pass
- gen-skills-index --check: current (6 skills indexed)
- Full verify: 14/17 (same 3 pre-existing infra failures as before deletion —
  suites 9-11 need `next` in node_modules; unchanged, so deletion broke nothing)
