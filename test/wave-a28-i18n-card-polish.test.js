'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadTsMessageObject(relPath, exportName, stripImport = false) {
  let raw = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  if (stripImport) {
    raw = raw.replace(/^import\s+type\s+[\s\S]*?;\s*/m, '');
  }
  raw = raw
    .replace(/type\s+DeepWiden[\s\S]*$/, '')
    .replace(new RegExp(`export\\s+const\\s+${exportName}(?:\\s*:\\s*Messages)?\\s*=`), `module.exports.${exportName} =`)
    .replace(/\s+as\s+const\s*;/, ';');
  const mod = { exports: {} };
  vm.runInNewContext(raw, { module: mod, exports: mod.exports });
  return mod.exports[exportName];
}

function getByPath(obj, dotPath) {
  return dotPath.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);
}

test('Wave A28: en, hy, and ru share all new localization keys with non-empty translations', () => {
  const en = loadTsMessageObject('src/lib/i18n/messages/en.ts', 'enMessages');
  const hy = loadTsMessageObject('src/lib/i18n/messages/hy.ts', 'hyMessages', true);
  const ru = loadTsMessageObject('src/lib/i18n/messages/ru.ts', 'ruMessages', true);

  const requiredPaths = [
    'detailUi.approxUpsetEstimate',
    'detailUi.qualifiedUpsetNote',
    'detailUi.executionJudgmentLabel',
    'detailUi.nearbyCompsSubtitle',
    'detailUi.nearbyCompsSubjectFallback',
    'detailUi.nearbyCompsEmpty',
    'detailUi.nearbyCompsEmptyHint',
    'detailUi.nearbyCompsFailedLoad',
    'detailUi.nearbyCompsAddressNotPub',
    'detailUi.nearbyCompsDistanceAway',
    'detailUi.nearbyCompsNearby',
    'detailUi.nearbyCompsScoreLabel',
    'detailUi.nearbyCompsAreaLabel',
    'detailUi.nearbyCompsSqFtUnit',
    'detailUi.nearbyCompsNotPublished',
    'detailUi.enrichmentRefreshedStatus',
    'detailUi.enrichmentAdapterSingular',
    'detailUi.enrichmentAdapterPlural',
    'detailUi.enrichmentInMs',
    'detailUi.enrichmentListingSingular',
    'detailUi.enrichmentListingPlural',
    'detailUi.enrichmentSourceSingular',
    'detailUi.enrichmentSourcePlural',
    'detailUi.enrichmentAcrossWord',
    'workspacePages.researchRecordLabel',
    'workspacePages.researchRevisionLabel',
    'researchB2.rcOperatorRequiredForQueue',
    'bidSheetPage.preWire.leadHours',
    'bidSheetPage.paymentMethods.wire',
    'bidSheetPage.paymentMethods.credit_card_hold',
    'bidSheetPage.paymentMethods.cashiers_check',
    'bidSheetPage.paymentMethods.certified_funds',
    'bidSheetPage.targets.walkAwayAria',
    'underwritePage.plaintiffLabel',
    'underwritePage.plaintiffPlaceholder',
    'underwritePage.sourceOptions.unspecified',
    'underwritePage.sourceOptions.sheriff',
    'underwritePage.sourceOptions.civilview',
    'underwritePage.sourceOptions.trustee',
    'underwritePage.sourceOptions.taxDeed',
    'underwritePage.sourceOptions.hud',
    'underwritePage.sourceOptions.fannie',
    'underwritePage.sourceOptions.freddie',
    'underwritePage.sourceOptions.va',
    'underwritePage.sourceOptions.usda',
    'underwritePage.sourceOptions.gsa',
    'underwritePage.sourceOptions.treasury',
    'underwritePage.sourceOptions.irs',
    'underwritePage.citationLabels.caseNumber',
    'underwritePage.citationLabels.judgment',
    'underwritePage.citationLabels.openingBid',
    'underwritePage.citationLabels.apn',
    'underwritePage.citationLabels.occupancy',
  ];

  for (const dotPath of requiredPaths) {
    const enVal = getByPath(en, dotPath);
    const hyVal = getByPath(hy, dotPath);
    const ruVal = getByPath(ru, dotPath);

    assert.equal(typeof enVal, 'string', `en missing string at ${dotPath}`);
    assert.ok(enVal.trim().length > 0, `en empty string at ${dotPath}`);
    assert.equal(typeof hyVal, 'string', `hy missing string at ${dotPath}`);
    assert.ok(hyVal.trim().length > 0, `hy empty string at ${dotPath}`);
    assert.equal(typeof ruVal, 'string', `ru missing string at ${dotPath}`);
    assert.ok(ruVal.trim().length > 0, `ru empty string at ${dotPath}`);
  }
});

test('Wave A28: discovery-card.tsx renders prior/peak bid strikethrough and never reads listing.raw', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/listings/discovery-card.tsx'), 'utf8');
  assert.ok(src.includes('peakOpeningBid'), 'discovery-card.tsx must check peakOpeningBid');
  assert.ok(src.includes('initialOpeningBid'), 'discovery-card.tsx must check initialOpeningBid');
  assert.ok(src.includes('bid !== null && bid > 0 && priorRaw !== null && Math.round(priorRaw) > Math.round(bid)'), 'discovery-card.tsx must guard openingBid > 0 and rounded prior > openingBid');
  assert.ok(src.includes('<del className="ml-1.5 text-xs font-normal text-ink-3 line-through">'), 'discovery-card.tsx must render semantic <del> strikethrough with Evidence Ink token');
  assert.equal(/\blisting\.raw\b/.test(src), false, 'discovery-card.tsx must never reference listing.raw');
});

test('Wave A28: workspace-shell.tsx removes dead label: "Reviews" property', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/workspace/workspace-shell.tsx'), 'utf8');
  assert.equal(src.includes('label: "Reviews"'), false, 'workspace-shell.tsx must not contain dead label: "Reviews" property');
  assert.ok(src.includes('label: nav.reviews'), 'workspace-shell.tsx must use localized nav.reviews');
});
