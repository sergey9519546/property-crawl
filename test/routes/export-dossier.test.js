'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const handleExport = require('../../server/routes/export');
const { markdownDossier } = handleExport;

test('Export Route: markdownDossier formats institutional markdown dossier with zero fabrication', () => {
  const sampleListing = {
    id: 'TX-HARRIS-900',
    address: '1402 Preston St',
    city: 'Houston',
    county: 'Harris',
    state: 'TX',
    zip: '77002',
    source: 'sheriff',
    caseNumber: '2025-CV-88902',
    openingBid: 145000,
    assessed: 210000,
    estLow: 220000,
    estHigh: 240000,
    dealScore: 82,
    saleDate: '2026-12-01',
    saleTime: '10:00 AM',
    saleTimezone: 'CST',
    plaintiff: 'Bank of America, N.A.',
    defendant: 'John Doe',
    deposit: '$5,000 Cashier Check',
    redemptionDays: 180,
    seniorLienRisk: 'Standard judicial priority',
    sourceUrl: 'https://harrisclerk.tx.us/foreclosures/900',
    sourceObservedAt: '2026-11-01T12:00:00Z',
    cashToCloseDetails: {
      model: 'explicit-cash-requirements-v2',
      totalAcquisitionCost: 152000,
      registrationFunds: 5000,
      creditedDeposit: 5000,
      buyersPremium: 0,
      sheriffPoundage: 2000,
      transferTax: 0,
      delinquentTaxes: 4500,
      settlementCosts: 500,
      cashDueAtSettlement: 147000,
      missingInputs: [],
    },
  };

  const md = markdownDossier(sampleListing);

  assert.match(md, /# DISTRESSED ASSET DOSSIER: 1402 Preston St/);
  assert.match(md, /Harris Co\., TX/);
  assert.match(md, /\*\*Docket \/ Case #:\*\* 2025-CV-88902/);
  assert.match(md, /\*\*Opening Bid:\*\* \$145,000/);
  assert.match(md, /\*\*County Assessed Value:\*\* \$210,000/);
  assert.match(md, /\*\*Triage Deal Score:\*\* 82\/99/);
  assert.match(md, /\*\*Statutory Redemption Window:\*\* 180 days post-sale/);
  assert.match(md, /\*\*Total Acquisition Cash:\*\* \$152,000/);
  assert.match(md, /\*\*Cash Due at Settlement:\*\* \$147,000/);
  assert.match(md, /26 U\.S\.C\. § 7425/);
});

test('Export Route: markdownDossier handles missing financial values truthfully without inventing data', () => {
  const bareListing = {
    id: 'MINIMAL-1',
    address: 'Undisclosed Parcel',
    source: 'landbank',
  };

  const md = markdownDossier(bareListing);

  assert.match(md, /# DISTRESSED ASSET DOSSIER: Undisclosed Parcel/);
  assert.match(md, /\*\*Opening Bid:\*\* Not published/);
  assert.match(md, /\*\*County Assessed Value:\*\* Not published/);
  assert.match(md, /\*\*Supported Valuation Range:\*\* Unbenchmarked/);
  assert.match(md, /\*\*Triage Deal Score:\*\* Unrated/);
  assert.match(md, /\*\*Statutory Redemption Window:\*\* No post-sale redemption published/);
  assert.match(md, /\*\*Settlement Status:\*\* `unresolved`/);
  assert.match(md, /\*\*Total Acquisition Cash:\*\* Not published/);
});
