'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDecisionPacket,
  formatDecisionPacketMarkdown
} = require('../server/export/decision-packet');

test('Decision Packet: constructs complete forensic due diligence packet', () => {
  const listing = {
    id: 'SHERIFF-OH-CUY-4401',
    address: '1420 W 28th St',
    city: 'Cleveland',
    state: 'OH',
    county: 'Cuyahoga',
    zip: '44113',
    propType: 'Single Family',
    openingBid: 55000,
    caseNumber: 'CV-24-887123',
    saleDate: '2026-11-15',
    plaintiff: 'Wells Fargo Bank, N.A.',
    deposit: 5000,
    source: 'sheriff'
  };

  const operatorInput = {
    disposition: 'BID',
    maxAllowableOffer: 75000,
    operatorNotes: 'Clean senior judicial foreclosure. Excellent spread vs $120k macro valuation.',
    operatorId: 'operator-101'
  };

  const packet = buildDecisionPacket(listing, operatorInput);

  assert.ok(packet);
  assert.equal(packet.schemaVersion, 'decision-packet/v1');
  assert.ok(packet.packetId.startsWith('DP-SHERIFF-OH-CUY-4401-'));
  assert.equal(typeof packet.integrityChecksum, 'string');
  assert.equal(packet.integrityChecksum.length, 64); // SHA-256

  // Underwriting: Title Risk
  const t = packet.underwriting.titleRisk;
  assert.equal(t.canProceedWithBid, true);
  assert.equal(t.firstMortgageSurvives, false);

  // A published deposit and the state code are not fees.
  const untouched = packet.underwriting.cashToClose;
  assert.equal(untouched.buyersPremium, null);
  assert.equal(untouched.totalAcquisitionCost, null);
  assert.equal(untouched.creditedDeposit, null);
  assert.equal(untouched.netCashDueAtSettlement, null);

  const entered = buildDecisionPacket(listing, {
    ...operatorInput,
    registrationFunds: 500,
    creditedDeposit: 1000,
    buyersPremium: 0,
    sheriffPoundage: 0,
    transferTax: 0,
    delinquentTaxes: 0,
    settlementCosts: 0
  });
  const c = entered.underwriting.cashToClose;
  assert.equal(c.totalAcquisitionCost, 55000);
  assert.equal(c.creditedDeposit, 1000);
  assert.equal(c.netCashDueAtSettlement, 54000);
  assert.equal(c.cashDueAtSettlement, 54000);

  // Operator Sign-Off
  const d = packet.dispositionSignOff;
  assert.equal(d.decision, 'BID');
  assert.equal(d.maxAllowableOffer, 75000);
  assert.equal(d.operatorId, 'operator-101');
  assert.equal(packet.underwriting.macroValuation, null);
});

test('Decision Packet: flags junior lien foreclosure title defects', () => {
  const juniorListing = {
    id: 'SHERIFF-NJ-CAM-901',
    address: '22 Elm St',
    state: 'NJ',
    county: 'Camden',
    openingBid: 15000,
    plaintiff: 'Second Mortgage Servicing LLC / HELOC',
    source: 'sheriff'
  };

  const packet = buildDecisionPacket(juniorListing);
  const t = packet.underwriting.titleRisk;

  assert.equal(t.canProceedWithBid, false);
  assert.equal(t.firstMortgageSurvives, true);
  assert.equal(t.riskLevel, 'CRITICAL');
});

test('Decision Packet: renders print-ready Markdown dossier with checksum', () => {
  const listing = {
    id: 'TRSY-27-66-804',
    address: '88 Market St',
    city: 'Newark',
    state: 'NJ',
    county: 'Essex',
    openingBid: 120000,
    source: 'treasury'
  };

  const packet = buildDecisionPacket(listing, { disposition: 'UNDERWRITE' });
  const md = formatDecisionPacketMarkdown(packet);

  assert.match(md, /# FORECLOSURE DUE DILIGENCE DECISION PACKET/);
  assert.match(md, /\*\*Packet ID\*\*: `DP-TRSY-27-66-804/);
  assert.match(md, /\*\*Checksum \(SHA-256\)\*\*: `[0-9a-f]{64}`/);
  assert.match(md, /## 2\. Statutory Title Risk & Lien Survival Matrix/);
  assert.match(md, /Recorded redemption period\*\*: Not published/);
  assert.equal(packet.underwriting.titleRisk.statutoryRedemptionDays, null);
  assert.equal(packet.underwriting.municipalSurvivability.activeViolationsCount, null);
  assert.doesNotMatch(md, /No active title defect flags detected|Underwriting Recommendation|DO NOT BID/);
  assert.match(md, /## 3\. Cash requirement/);
  assert.match(md, /Not entered/);
  assert.doesNotMatch(md, /Online Marketplace Fee|24-48|Statutory Basis|BID CLEARABLE|Foreclosed & Wiped/);
  assert.match(md, /## 5\. Operator Due Diligence Sign-Off/);
  assert.match(md, /\*\*Disposition Decision\*\*: \*\*`UNDERWRITE`\*\*/);
});

test('Decision Packet: a marketplace source does not invent a buyer premium or a sign-off', () => {
  const packet = buildDecisionPacket({
    id: 'servicelink:nc-1',
    address: '84 Raven Rock Rd',
    city: 'Lillington',
    state: 'NC',
    openingBid: 126000,
    deposit: 5000,
    source: 'servicelink'
  });

  assert.equal(packet.property.openingBid, 126000);
  assert.equal(packet.underwriting.cashToClose.buyersPremium, null);
  assert.equal(packet.underwriting.cashToClose.sheriffPoundage, null);
  assert.equal(packet.underwriting.cashToClose.transferTax, null);
  assert.equal(packet.underwriting.cashToClose.settlementCosts, null);
  assert.equal(packet.underwriting.cashToClose.totalAcquisitionCost, null);
  assert.equal(packet.underwriting.cashToClose.netCashDueAtSettlement, null);
  assert.equal(packet.dispositionSignOff.decision, null);
  assert.equal(packet.dispositionSignOff.operatorNotes, '');
  assert.equal(packet.dispositionSignOff.operatorId, null);
  assert.equal(packet.dispositionSignOff.signedAt, null);

  const missingPrice = buildDecisionPacket({ id: 'no-price', state: 'NC' });
  assert.equal(missingPrice.property.openingBid, null);
  assert.equal(missingPrice.underwriting.cashToClose.totalAcquisitionCost, null);
  assert.doesNotThrow(() => formatDecisionPacketMarkdown(missingPrice));

  const published = buildDecisionPacket({
    id: 'published-redemption',
    state: 'NC',
    redemptionDays: 0
  });
  assert.equal(published.underwriting.titleRisk.statutoryRedemptionDays, 0);
  assert.match(formatDecisionPacketMarkdown(published), /0 days recorded in this dataset/);

  const stamped = buildDecisionPacket({
    id: 'stamped-redemption',
    state: 'NC',
    redemptionDays: 10,
    provenance: { derivedFields: { redemption: { model: 'state-statutory-rule-lookup-v1' } } }
  });
  assert.equal(stamped.underwriting.titleRisk.statutoryRedemptionDays, null);

  const withViolations = buildDecisionPacket({
    id: 'muni-1',
    state: 'FL',
    municipalViolations: [
      { violationType: 'Unsafe Electrical Wiring', status: 'OPEN', fineAmount: 1250 },
      { violationType: 'Resolved Trash Citation', status: 'CLOSED', fineAmount: 250 }
    ]
  });
  assert.equal(withViolations.underwriting.municipalSurvivability.activeViolationsCount, 1);
  assert.equal(withViolations.underwriting.municipalSurvivability.estimatedSurvivingLiability, 1250);

  assert.equal(packet.property.caseNumber, null);
  const md = formatDecisionPacketMarkdown(packet);
  assert.match(md, /\*\*Case \/ Docket #\*\* \| Not published/);
  assert.doesNotMatch(md, /Unassigned/);
  assert.match(md, /\*\*Auction Date\*\* \| Not published/);
});

test('Decision Packet Export Page: gates research case lookup on authenticated workspace session', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const exportPageSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'app', 'research', '[id]', 'export', 'page.tsx'),
    'utf8'
  );
  assert.match(exportPageSrc, /readWorkspaceSession/);
  assert.match(exportPageSrc, /workspaceSessionConfiguration/);
  assert.match(exportPageSrc, /'x-operator-token':\s*configuration\.credential/);
});

test('Decision Packet: propagates IRS 120-day tax lien redemption and recorded instrument priority into JSON and Markdown', () => {
  const irsListing = {
    id: 'SHERIFF-OH-IRS-501',
    address: '500 Euclid Ave',
    city: 'Cleveland',
    state: 'OH',
    county: 'Cuyahoga',
    openingBid: 80000,
    plaintiff: 'U.S. Bank National Association',
    raw: 'Foreclosure of mortgage recorded on March 14, 2019 in Book 4412, Page 889, Instrument No. 2019-0041982. Defendant United States of America (Internal Revenue Service) joined for federal tax lien.',
    source: 'sheriff'
  };

  const packet = buildDecisionPacket(irsListing);
  const t = packet.underwriting.titleRisk;
  assert.equal(t.hasIrsTaxLien, true);
  assert.equal(t.irsRedemptionDays, 120);
  assert.equal(t.riskLevel, 'HIGH');
  assert.ok(t.instrumentPriority);
  assert.equal(t.instrumentPriority.instrumentNumber, '2019-0041982');
  assert.deepEqual(t.instrumentPriority.bookPage, { book: '4412', page: '889' });
  assert.equal(t.instrumentPriority.recordedDate, 'March 14, 2019');

  const md = formatDecisionPacketMarkdown(packet);
  assert.match(md, /IRS phrase in the supplied record \(120-day redemption period\)/);
  assert.match(md, /Recorded Instrument Reference\*\*: Instrument #2019-0041982 · Book 4412, Page 889 · Recorded March 14, 2019/);
});
