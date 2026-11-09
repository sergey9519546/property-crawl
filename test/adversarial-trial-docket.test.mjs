import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { evaluateAdversarialDocket } from '../src/lib/adversarial-docket.ts';
import {
  createCase,
  updateCase,
  getCase,
  listCases,
  buildPacket,
  packetToMarkdown,
} from '../server/intelligence/research-cases.js';

test('clean institutional first mortgage yields verified defense verdict', () => {
  const listing = {
    id: 'prop_clean_first_mtg_001',
    state: 'OH',
    county: 'Cuyahoga',
    plaintiff: 'JPMorgan Chase Bank, N.A.',
    seniorLienRisk: 'low',
    seniorLienWarning: null,
    redemptionDays: 0,
    occupancy: 'Vacant',
    deposit: '$5,000 cashier check',
    openingBid: 125000,
    parcelKey: 'parcel_39035_10203040',
    apn: '102-03-040',
  };

  const docket = evaluateAdversarialDocket(listing);

  assert.equal(docket.verdict, 'verified');
  assert.equal(docket.fatalCount, 0);
  assert.equal(docket.recommendedDecision, 'pursue');
  assert.ok(docket.headline.includes('DEFENSE VERIFIED'));
  assert.equal(docket.defenseCount, 4);

  // Check the defense points
  const subExt = docket.defensePoints.find((p) => p.id === 'defense-1-subordinate-extinguishment');
  assert.ok(subExt);
  assert.equal(subExt.status, 'verified');
  assert.ok(subExt.finding.includes('Senior 1st mortgage holder'));

  const cadastral = docket.defensePoints.find((p) => p.id === 'defense-2-cadastral-match');
  assert.ok(cadastral);
  assert.equal(cadastral.status, 'verified');
  assert.ok(cadastral.finding.includes('102-03-040'));
});

test('subordinate junior lienholder foreclosure triggers fatal disqualifier and pass recommendation', () => {
  const listing = {
    id: 'prop_junior_lien_trap_002',
    state: 'NJ',
    county: 'Essex',
    plaintiff: 'Second Horizon Home Equity Trust',
    seniorLienRisk: 'critical',
    seniorLienWarning: 'SENIOR_LIEN_RISK: Subordinate 2nd mortgage foreclosure; prior 1st deed survives',
    openingBid: 45000,
    deposit: '$10,000 certified funds',
  };

  const docket = evaluateAdversarialDocket(listing);

  assert.equal(docket.verdict, 'fatal');
  assert.equal(docket.fatalCount, 1);
  assert.equal(docket.recommendedDecision, 'pass');
  assert.ok(docket.recommendedReasonCodes.includes('title_risk_unresolved'));
  assert.ok(docket.headline.includes('FATAL TITLE DISQUALIFIER'));

  const seniorPt = docket.prosecutionPoints.find((p) => p.id === 'prosecution-1-senior-lien');
  assert.ok(seniorPt);
  assert.equal(seniorPt.status, 'disqualified');
  assert.equal(seniorPt.isFatal, true);
  assert.ok(seniorPt.finding.includes('FATAL TITLE TRAP'));
  assert.ok(seniorPt.statute.includes('Restatement (Third) of Property (Mortgages) § 7.1'));
});

test('active debtor bankruptcy stay triggers fatal disqualifier citing 11 U.S.C. § 362', () => {
  const listing = {
    id: 'prop_bankruptcy_stay_003',
    state: 'CA',
    county: 'Los Angeles',
    plaintiff: 'Wells Fargo Bank',
    bankruptcy: {
      active: true,
      petitionDate: '2026-10-15',
    },
    openingBid: 320000,
  };

  const docket = evaluateAdversarialDocket(listing);

  assert.equal(docket.verdict, 'fatal');
  assert.ok(docket.fatalCount >= 1);
  assert.equal(docket.recommendedDecision, 'pass');
  assert.ok(docket.recommendedReasonCodes.includes('title_risk_unresolved'));
  assert.ok(docket.recommendedReasonCodes.includes('missing_sale_terms'));

  const bkPt = docket.prosecutionPoints.find((p) => p.id === 'prosecution-3-bankruptcy-stay');
  assert.ok(bkPt);
  assert.equal(bkPt.status, 'disqualified');
  assert.equal(bkPt.isFatal, true);
  assert.ok(bkPt.statute.includes('11 U.S.C. § 362(a)'));
  assert.ok(bkPt.finding.includes('void ab initio'));
});

test('federal IRS tax lien notice triggers 120-day carry modeling and conditional pass', () => {
  const listing = {
    id: 'prop_irs_tax_lien_004',
    state: 'FL',
    county: 'Miami-Dade',
    source: 'irs',
    plaintiff: 'Internal Revenue Service (26 U.S.C. § 7425)',
    openingBid: 180000,
    seniorLienRisk: 'moderate',
  };

  const docket = evaluateAdversarialDocket(listing);

  assert.equal(docket.verdict, 'conditional');
  assert.equal(docket.recommendedDecision, 'inbox');
  assert.ok(docket.recommendedReasonCodes.includes('title_risk_unresolved'));
  assert.equal(docket.statutoryCarryDays, 120);

  const irsPt = docket.prosecutionPoints.find((p) => p.id === 'prosecution-2-irs-lien');
  assert.ok(irsPt);
  assert.equal(irsPt.status, 'caution');
  assert.ok(irsPt.statute.includes('26 U.S.C. § 7425(d)'));
  assert.ok(irsPt.finding.includes('120-day federal redemption'));
});

test('occupied tenant status triggers PTFA 90-day eviction notice caution', () => {
  const listing = {
    id: 'prop_tenant_ptfa_005',
    state: 'PA',
    county: 'Philadelphia',
    occupancy: 'Tenant Occupied',
    plaintiff: 'PNC Bank, National Association',
    openingBid: 85000,
  };

  const docket = evaluateAdversarialDocket(listing);

  const ptfaPt = docket.prosecutionPoints.find((p) => p.id === 'prosecution-5-ptfa-occupancy');
  assert.ok(ptfaPt);
  assert.equal(ptfaPt.status, 'caution');
  assert.ok(ptfaPt.statute.includes('12 U.S.C. § 5220 (PTFA)'));
  assert.ok(ptfaPt.finding.includes('90-day notice'));
});

test('North Carolina upset bid or Alabama 180-day redemption triggers statutory holding lockup caution', () => {
  const ncListing = {
    id: 'prop_nc_upset_006',
    state: 'NC',
    county: 'Wake',
    plaintiff: 'Truist Bank',
    openingBid: 210000,
  };

  const ncDocket = evaluateAdversarialDocket(ncListing);
  const ncRedemption = ncDocket.prosecutionPoints.find((p) => p.id === 'prosecution-6-statutory-redemption');
  assert.ok(ncRedemption);
  assert.equal(ncRedemption.status, 'caution');
  assert.ok(ncRedemption.statute.includes('N.C.G.S. § 45-21.27'));

  const alListing = {
    id: 'prop_al_redemption_007',
    state: 'AL',
    county: 'Jefferson',
    redemptionDays: 180,
    openingBid: 95000,
  };

  const alDocket = evaluateAdversarialDocket(alListing);
  const alRedemption = alDocket.prosecutionPoints.find((p) => p.id === 'prosecution-6-statutory-redemption');
  assert.ok(alRedemption);
  assert.equal(alRedemption.status, 'caution');
  assert.ok(alRedemption.finding.includes('180-day statutory redemption'));
  assert.equal(alDocket.statutoryCarryDays, 180);
});

test('adversarial trial docket findings integrate cleanly into research case decision engine and packet exports', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adversarial-docket-case-'));
  const storePath = path.join(tempDir, 'research-cases.json');

  try {
    const observedAt = '2026-10-20T10:00:00Z';
    const rawListing = {
      id: 'prop_case_integration_008',
      address: '742 Evergreen Terrace',
      city: 'Columbus',
      state: 'OH',
      county: 'Franklin',
      zip: '43215',
      source: 'civilview',
      status: 'active',
      propType: 'Single Family',
      sqft: 1400,
      assessed: 150000,
      plaintiff: 'Second Horizon Subordinate Lending LLC',
      seniorLienRisk: 'critical',
      seniorLienWarning: 'Junior deed of trust; senior mortgage survives',
      openingBid: 65000,
      saleDate: '2026-12-01',
      raw: 'Published sheriff sale notice for 742 Evergreen Terrace. Second Horizon Subordinate Lending LLC foreclosing.',
      sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=7428964683',
      sourceObservedAt: observedAt,
      provenance: {
        origin: 'live',
        observed: true,
        recordKind: 'source_record',
        publisher: 'Franklin County Sheriff Civil Division',
        recordId: '7428964683',
        observedAt,
      },
    };

    // 1. Evaluate Adversarial Trial Docket
    const docket = evaluateAdversarialDocket(rawListing);
    assert.equal(docket.verdict, 'fatal');
    assert.equal(docket.recommendedDecision, 'pass');
    assert.deepEqual(docket.recommendedReasonCodes, ['title_risk_unresolved']);

    // 2. Create Research Case
    const created = createCase(
      {
        listing: rawListing,
        origin: { type: 'manual', observedAt: '2026-10-20T10:00:00Z' },
      },
      { filePath: storePath, now: '2026-10-21T12:00:00Z' }
    );
    assert.ok(created.case.id);
    assert.equal(created.case.state, 'inbox');

    // 3. Update Case with Adversarial Trial Docket findings
    const updated = updateCase(
      created.case.id,
      {
        expectedRevision: created.case.revision,
        state: docket.recommendedDecision,
        reasonCodes: docket.recommendedReasonCodes,
        note: docket.docketSummaryNote,
      },
      { filePath: storePath, now: '2026-10-21T12:05:00Z' }
    );

    assert.equal(updated.state, 'pass');
    assert.deepEqual(updated.decision.reasonCodes, ['title_risk_unresolved']);
    assert.ok(updated.decision.note.includes('Trial Docket Verdict: FATAL TITLE DISQUALIFIER'));
    assert.ok(updated.decision.note.includes('Senior 1st Deed of Trust Survival Trap'));

    // 4. Retrieve Case Detail and verify dossier workspace synchronization
    const retrieved = getCase(created.case.id, { filePath: storePath });
    assert.equal(retrieved.case.state, 'pass');
    assert.equal(retrieved.case.decision.state, 'pass');
    assert.deepEqual(retrieved.case.decision.reasonCodes, ['title_risk_unresolved']);

    // 5. Generate Evidentiary Decision Packet and verify trial findings
    const packet = buildPacket(retrieved.case.id, { filePath: storePath });
    assert.ok(packet.digest?.value);
    assert.equal(packet.case.state, 'pass');
    assert.deepEqual(packet.case.decision.reasonCodes, ['title_risk_unresolved']);
    assert.ok(packet.case.decision.note.includes('Trial Docket Verdict: FATAL TITLE DISQUALIFIER'));

    const markdown = packetToMarkdown(packet);
    assert.ok(markdown.includes('title\\_risk\\_unresolved') || markdown.includes('title_risk_unresolved'));
    assert.ok(markdown.includes('Trial Docket Verdict'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
