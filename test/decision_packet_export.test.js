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

  // Underwriting: Cash to Close
  const c = packet.underwriting.cashToClose;
  assert.ok(c.totalAcquisitionCost > 55000);
  assert.equal(c.creditedDeposit, 5000);
  assert.equal(c.netCashDueAtSettlement, c.totalAcquisitionCost - 5000);

  // Operator Sign-Off
  const d = packet.dispositionSignOff;
  assert.equal(d.decision, 'BID');
  assert.equal(d.maxAllowableOffer, 75000);
  assert.equal(d.operatorId, 'operator-101');
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
  assert.match(md, /## 3\. Comprehensive Cash-to-Close Schedule/);
  assert.match(md, /## 5\. Operator Due Diligence Sign-Off/);
  assert.match(md, /\*\*Disposition Decision\*\*: \*\*`UNDERWRITE`\*\*/);
});
