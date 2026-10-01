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
 * Resolved, and kept as an explicit empty exception list.
 *
 * hud-usps-vacancy was the one genuine inconsistency: the scheduler collected
 * it under the key 'hud-usps-vacancy' and SOURCE_HOSTS already listed it, but
 * the catalog entry declared adapterKey: null and access 'licensed'. The null
 * made the entry unjoinable - cadence fell back to 24h instead of the declared
 * 2160h for a quarterly dataset, no access policy or robots exclusion applied,
 * and source-network refused operator-triggered runs.
 *
 * The entry described the RESTRICTED HUD User product, but the collector's
 * default service root is the public HUD GIS Open Data mirror and
 * sanitizeServiceRoot falls back to it, so default collection never needed an
 * entitlement. The entry was corrected to access 'public' with its own
 * adapterKey; the restricted product is now documented as the opt-in upgrade
 * an entitled operator reaches through HUD_USPS_VACANCY_SERVICE_ROOT.
 *
 * The set is intentionally empty and must STAY empty: a new scheduled source
 * without a resolvable adapterKey now fails the suite above.
 */
const KNOWN_UNJOINABLE = new Set();

// True when a module actually provides a collector, i.e. something callable at
// the scraper interface. Checked by loading the module rather than by reading
// its text: a comment mentioning scrapeFeed() is not an adapter, and a
// hand-maintained exclusion list rots the moment a helper lands beside the
// scrapers. Support modules (scraper-interface, auto-throttle,
// circuit-breaker, run-report, telemetry, validation, collection-scope, ...)
// all live in the same directory and are correctly excluded.
function providesScraper(file) {
  let mod;
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    mod = require(file);
  } catch (_) {
    return false;
  }
  if (!mod) return false;
  const hasFeed = (value) =>
    Boolean(value)
    && (typeof value === 'function' ? typeof value.prototype?.scrapeFeed === 'function' : typeof value.scrapeFeed === 'function');
  if (hasFeed(mod)) return true;
  if (typeof mod === 'function') return false;
  return Object.values(mod).some(hasFeed);
}

function scheduledSources() {
  const modules = [...schedulerSrc.matchAll(/require\('\.\/([a-z0-9-]+)'\)/g)].map((m) => m[1]);
  return [...new Set(modules)]
    .filter((m) => !SUPPORT_MODULES.has(m))
    .filter((m) => fs.existsSync(path.join(ROOT, 'server', 'scrapers', `${m}.js`)))
    .filter((m) => providesScraper(path.join(ROOT, 'server', 'scrapers', `${m}.js`)))
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
  // test would notice if a default changed. hud-usps-vacancy is the worked
  // example: it WAS unjoinable and reported 24h for a quarterly dataset.
  const lookup = (source) =>
    SOURCE_CATALOG.find((e) => e.adapterKey === source)?.workflow.cadenceHours || 24;
  assert.equal(lookup('landbank'),
    SOURCE_CATALOG.find((e) => e.adapterKey === 'landbank').workflow.cadenceHours);
  assert.equal(lookup('no-such-source'), 24, 'an unknown key must still fall back');
});

test('hud-usps-vacancy now joins and reports its real quarterly cadence', () => {
  const lookup = (source) =>
    SOURCE_CATALOG.find((e) => e.adapterKey === source)?.workflow.cadenceHours || 24;
  assert.equal(
    lookup('hud-usps-vacancy'),
    2160,
    'the entry is now joinable, so a quarterly dataset must not report the 24h default',
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
