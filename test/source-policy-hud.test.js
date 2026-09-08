const test = require('node:test');
const assert = require('node:assert/strict');
const {inspectSourceRecordUrl} = require('../server/scrapers/source-policy');
const base = 'https://egis.hud.gov/arcgis/rest/services/cpdmaps/HudSfReo/MapServer/1/query';
function record(where, extra = {}) {
  return `${base}?${new URLSearchParams({where, outFields: '*', f: 'pjson', ...extra})}`;
}

test('HUD accepts a stable case-bound record on its exact official REO layer', () => {
  const result = inspectSourceRecordUrl('hud', record("CASE_NUM = '045-641868'"));
  assert.equal(result.isValid, true);
  assert.equal(new URL(result.url).hostname, 'egis.hud.gov');
});

test('HUD rejects whole-inventory queries, unrelated layers, lookalikes and duplicate selectors', () => {
  for (const url of [record('1=1'), record("CASE_NUM = '045-641868' OR 1=1"),
    record("CASE_NUM = '045-641868'", {callback: 'external'}),
    record("CASE_NUM = '045-641868'").replace('/MapServer/1/', '/MapServer/2/'),
    record("CASE_NUM = '045-641868'").replace('egis.hud.gov', 'egis.hud.gov.attacker.example'),
    `${record("CASE_NUM = '045-641868'")}&where=1%3D1`]) {
    assert.equal(inspectSourceRecordUrl('hud', url).isValid, false, url);
  }
});
