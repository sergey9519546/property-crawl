'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SOURCE_CATALOG,
  SCHEDULED_ADAPTER_KEYS,
  getSource,
  summarizeCatalog,
  validateJurisdictionDiscoveryUrl
} = require('../server/sources/catalog');

test('source catalog has a complete, unique, safe contract', () => {
  assert.ok(SOURCE_CATALOG.length >= 40);
  const ids = new Set();
  for (const entry of SOURCE_CATALOG) {
    assert.match(entry.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(entry.id), `duplicate source id ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.label && entry.category && entry.coverage && entry.notes);
    assert.ok(['opportunity', 'evidence', 'discovery'].includes(entry.role));
    assert.ok(['public', 'account', 'licensed', 'jurisdiction'].includes(entry.access));
    assert.equal(new URL(entry.discoveryUrl).protocol, 'https:');
    assert.ok(entry.workflow.primary && entry.workflow.fallback);
    assert.ok(Number.isFinite(entry.workflow.cadenceHours) && entry.workflow.cadenceHours > 0);
    assert.ok(Array.isArray(entry.workflow.steps) && entry.workflow.steps.length >= 2);
    assert.ok(Array.isArray(entry.requiredEvidence) && entry.requiredEvidence.length >= 2);
    assert.ok(entry.adapterKey === null || SCHEDULED_ADAPTER_KEYS.includes(entry.adapterKey));
    assert.ok(entry.propertyLookup === undefined || typeof entry.propertyLookup === 'boolean');
  }
});

test('property lookup evidence sources are explicit, unscheduled, and retain their access constraints', () => {
  const florida = getSource('florida-statewide-parcels');
  const census = getSource('census-acs');
  const hudUsps = getSource('hud-usps-vacancy');

  assert.equal(florida.discoveryUrl, 'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0');
  assert.equal(florida.propertyLookup, true);
  assert.equal(florida.adapterKey, null);
  assert.equal(florida.access, 'public');
  assert.match(florida.workflow.primary, /fixed official FeatureServer/);

  assert.equal(census.propertyLookup, true);
  assert.equal(census.adapterKey, null);
  assert.equal(census.access, 'account');
  assert.ok(census.requiredEvidence.some((item) => /API key/i.test(item)));

  assert.equal(hudUsps.propertyLookup, undefined);
  assert.equal(hudUsps.adapterKey, null);
  assert.equal(hudUsps.access, 'licensed');
  assert.match(hudUsps.notes, /aggregate counts/i);
  assert.match(hudUsps.notes, /particular property is vacant/i);
});

test('current scheduler source coverage is explicit and historical sources remain unscheduled', () => {
  assert.deepEqual([...SCHEDULED_ADAPTER_KEYS].sort(), [
    'bid4assets', 'civilview', 'fannie', 'freddie', 'gsa', 'hud', 'irs',
    'landbank', 'marshals', 'servicelink', 'sheriff', 'treasury', 'usda', 'va'
  ]);
  assert.equal(getSource('fdic-asset-sales').adapterKey, null);
  assert.equal(getSource('county-trustee-sale').adapterKey, null);
  assert.equal(getSource('does-not-exist'), null);
  const summary = summarizeCatalog();
  assert.equal(summary.total, SOURCE_CATALOG.length);
  assert.equal(summary.scheduledAdapterKeys.length, SCHEDULED_ADAPTER_KEYS.length);
  assert.ok(summary.byRole.opportunity >= 25);
  assert.ok(summary.byRole.evidence >= 6);
});

test('jurisdiction enrollment URL validator is pure and rejects unsafe targets', () => {
  assert.deepEqual(validateJurisdictionDiscoveryUrl('https://county.example.gov/tax-sales?year=2026'), {
    isValid: true,
    error: null,
    url: 'https://county.example.gov/tax-sales?year=2026'
  });
  for (const input of [
    'http://county.example.gov/sale',
    'https://localhost/sale',
    'https://127.0.0.1/sale',
    'https://10.0.0.8/sale',
    'https://county.example.gov:8443/sale',
    'https://user:secret@county.example.gov/sale',
    'https://county.example.gov/sale#section'
  ]) {
    assert.equal(validateJurisdictionDiscoveryUrl(input).isValid, false, input);
  }
});
