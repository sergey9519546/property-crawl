'use strict';

// test/sources/catalog-adapter-join.test.js
//
// Pins the join between a collected source and its catalog entry.
//
// `adapterKey` is not decorative. It is the key three subsystems join on:
//
//   dossier.js / listings.js
//       find(entry => entry.adapterKey === listing.source)?.workflow.cadenceHours
//   source-network.js
//       collector.realScraperKeys.has(source.adapterKey)
//   catalog.js
//       getAccessPolicyForAdapter / getRobotsExclusionForAdapter
//
// So an entry with adapterKey: null is unjoinable: cadence silently falls back
// to 24h, no access policy or robots exclusion is applied, and an
// operator-triggered run is refused with "This source uses the evidence
// import workflow".
//
// Most of the catalog is null by design - 141 of 163 entries are evidence
// sources that are researched by hand, not scraped. Only sources the
// scheduler actually collects need a resolvable key. Two of the scheduled
// module names look like misses but are not: landbanksearch is required by
// filename while its listings carry source "landbank" (its adapterKey), and
// email-ingest / telemetry / validation / collection-scope are support
// modules, not sources.
//
// That leaves exactly one genuine inconsistency, recorded here rather than
// fixed: see the exception list below and the note on why it is not silently
// corrected. It needs a licensing decision, not a mechanical edit.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { SOURCE_CATALOG } = require('../../server/sources/catalog');

const ROOT = path.resolve(__dirname, '..', '..');
const schedulerSrc = fs.readFileSync(
  path.join(ROOT, 'server', 'scrapers', 'scheduler.js'),
  'utf8',
);

// Scheduled modules that are NOT publisher sources and have no catalog entry.
const SUPPORT_MODULES = new Set([
  'email-ingest',
  'telemetry',
  'validation',
  'collection-scope',
]);

// Adapter file name -> the source key its listings actually carry, when they
// differ. The scheduler requires the module by filename; the catalog join
// uses this.
const MODULE_TO_SOURCE = new Map([['landbanksearch', 'landbank']]);

/*
 * Scheduled sources whose catalog entry declares adapterKey: null.
 *
 * hud-usps-vacancy is the open one. Its catalog entry describes the LICENSED
 * HUD/USPS product: access 'licensed', requiredEvidence includes "registered-
 * user eligibility and sublicense", and the workflow says "Use only under
 * HUD/USPS registered-user eligibility". The scraper's own header says it
 * defaults to the PUBLIC HUD GIS open-data mirror, with
 * HUD_USPS_VACANCY_SERVICE_ROOT optionally pointing at a registered-user root.
 *
 * Setting adapterKey would make the system treat it as a normally collectable
 * adapter and apply the entry's access policy and robots handling - which is
 * the licensing question, not a mechanical fix. It currently produces no
 * live listings, so the degraded cadence is not user-visible yet.
 *
 * If this is resolved, move the id out of this list in the same commit that
 * changes the catalog, and the assertions below will confirm the join works.
 */
const KNOWN_UNJOINABLE = new Set(['hud-usps-vacancy']);

function scheduledSources() {
  const modules = [...schedulerSrc.matchAll(/require\('\.\/([a-z0-9-]+)'\)/g)].map((m) => m[1]);
  return [...new Set(modules)]
    .filter((m) => !SUPPORT_MODULES.has(m))
    .map((m) => MODULE_TO_SOURCE.get(m) || m);
}

test('the scheduled-source list is non-trivial', () => {
  assert.ok(scheduledSources().length >= 15, 'expected a real scheduled scraper set');
});

test('every scheduled source resolves through the catalog adapterKey join', () => {
  const adapterKeys = new Set(
    SOURCE_CATALOG.filter((e) => e.adapterKey).map((e) => e.adapterKey),
  );
  const unjoinable = scheduledSources().filter((s) => !adapterKeys.has(s));
  assert.deepEqual(
    unjoinable.filter((s) => !KNOWN_UNJOINABLE.has(s)),
    [],
    'a scheduled source has no catalog entry with that adapterKey, so its cadence '
      + 'silently falls back to 24h and its access policy / robots exclusion are skipped',
  );
});

test('the known-unjoinable exception list is accurate and still needed', () => {
  const adapterKeys = new Set(
    SOURCE_CATALOG.filter((e) => e.adapterKey).map((e) => e.adapterKey),
  );
  const scheduled = new Set(scheduledSources());
  for (const id of KNOWN_UNJOINABLE) {
    assert.ok(
      scheduled.has(id),
      `${id} is no longer scheduled, so the exception is stale - remove it`,
    );
    assert.ok(
      !adapterKeys.has(id),
      `${id} now resolves through adapterKey - remove the exception and record the decision`,
    );
    const entry = SOURCE_CATALOG.find((e) => e.id === id);
    assert.ok(entry, `${id} must exist in the catalog for this exception to make sense`);
  }
});

test('the cadence join really does fall back to 24h for an unjoinable source', () => {
  // Demonstrates the consequence rather than asserting it abstractly, so the
  // test would notice if a default changed.
  const lookup = (source) =>
    SOURCE_CATALOG.find((e) => e.adapterKey === source)?.workflow.cadenceHours || 24;
  assert.equal(lookup('hud-usps-vacancy'), 24);
  assert.equal(
    lookup('landbank'),
    SOURCE_CATALOG.find((e) => e.adapterKey === 'landbank').workflow.cadenceHours,
    'a joinable source must resolve its own declared cadence',
  );
});

test('the operator-triggered path refuses an unjoinable source', () => {
  // source-network.js gates on adapterKey before allowing a manual run, which
  // is why the exception is observable and not merely cosmetic.
  const src = fs.readFileSync(
    path.join(ROOT, 'server', 'routes', 'source-network.js'),
    'utf8',
  );
  assert.match(src, /if \(!source\?\.adapterKey \|\| !collector\.realScraperKeys\.has/);
});
