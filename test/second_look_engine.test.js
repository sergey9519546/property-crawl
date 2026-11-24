'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DISTRESS_STAGES,
  detectLifecycleStage,
  evaluateLifecycleTransition,
} = require('../server/intelligence/distress-lifecycle');

const {
  evaluateSecondLookTriggers,
} = require('../server/intelligence/second-look');

test('detects statutory foreclosure lifecycle stages from text and metadata', () => {
  assert.equal(
    detectLifecycleStage({ status: 'Active' }, 'Notice of sale: 11 U.S.C. § 362 automatic stay entered'),
    DISTRESS_STAGES.STAYED_BANKRUPTCY
  );

  assert.equal(
    detectLifecycleStage({ state: 'NC' }, 'Foreclosure sale held; open for 10-day upset bid under G.S. 45-21.27'),
    DISTRESS_STAGES.SOLD_UPSET_WINDOW
  );

  assert.equal(
    detectLifecycleStage({ saleDate: '11/04/2026' }, 'Sheriff Sale continued to future date; adjourned'),
    DISTRESS_STAGES.ADJOURNED
  );

  assert.equal(
    detectLifecycleStage({ saleDate: '11/04/2026' }, 'Notice of Sheriff Sale of Real Estate'),
    DISTRESS_STAGES.SCHEDULED_AUCTION
  );
});

test('evaluates material lifecycle transition when bankruptcy stay is lifted', () => {
  const prior = {
    lifecycleStage: DISTRESS_STAGES.STAYED_BANKRUPTCY,
    openingBid: 120000,
  };

  const fresh = {
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    openingBid: 120000,
  };

  const transition = evaluateLifecycleTransition(prior, fresh);
  assert.equal(transition.isMaterialChange, true);
  assert.ok(transition.changes.some((c) => c.type === 'BANKRUPTCY_STAY_LIFTED'));
});

test('evaluates material lifecycle transition on opening bid reductions', () => {
  const prior = {
    openingBid: 100000,
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const fresh = {
    openingBid: 75000,
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const transition = evaluateLifecycleTransition(prior, fresh);
  assert.equal(transition.isMaterialChange, true);

  const priceChange = transition.changes.find((c) => c.type === 'PRICE_REDUCED');
  assert.ok(priceChange);
  assert.equal(priceChange.discountPercent, 25);
  assert.equal(priceChange.from, 100000);
  assert.equal(priceChange.to, 75000);
});

test('second-look triggers re-open passed case when material price drop occurs', () => {
  const mockCase = {
    id: 'case_018f9e20a1bc724090123456',
    state: 'pass',
    listingSnapshot: {
      openingBid: 100000,
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
    reconsideration: {
      openingBid: { mode: 'changed' },
    },
  };

  const freshListing = {
    openingBid: 80000,
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const evaluation = evaluateSecondLookTriggers(mockCase, freshListing);
  assert.equal(evaluation.shouldTrigger, true);
  assert.equal(evaluation.recommendedState, 'inbox');
  assert.match(evaluation.primaryReason, /Opening bid reduced/);
});

test('second-look triggers fire when bankruptcy stay lifts on passed case', () => {
  const mockCase = {
    id: 'case_018f9e20a1bc724090123457',
    state: 'pass',
    listingSnapshot: {
      lifecycleStage: DISTRESS_STAGES.STAYED_BANKRUPTCY,
    },
  };

  const freshListing = {
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    saleDate: '12/10/2026',
  };

  const evaluation = evaluateSecondLookTriggers(mockCase, freshListing);
  assert.equal(evaluation.shouldTrigger, true);
  assert.match(evaluation.primaryReason, /Bankruptcy stay was lifted/);
});

test('second-look does NOT trigger when no material facts change', () => {
  const mockCase = {
    id: 'case_018f9e20a1bc724090123458',
    state: 'pass',
    listingSnapshot: {
      openingBid: 100000,
      saleDate: '11/04/2026',
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
  };

  const freshListing = {
    openingBid: 100000,
    saleDate: '11/04/2026',
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const evaluation = evaluateSecondLookTriggers(mockCase, freshListing);
  assert.equal(evaluation.shouldTrigger, false);
});

test('evaluateOpportunitySignals parses trajectory and cumulative bid drop directly from sourceFacts', () => {
  const { evaluateOpportunitySignals } = require('../server/intelligence/signals');

  const listing = {
    id: 'test_trajectory_01',
    status: 'active',
    openingBid: 75000,
    saleDate: '2026-11-20',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=987',
    sourceFacts: {
      priorPostponements: 3,
      statutoryStayExhausted: true,
      priorOpeningBid: 100000,
    },
  };

  const evalResult = evaluateOpportunitySignals(listing);
  assert.equal(evalResult.trajectory.priorPostponements, 3);
  assert.equal(evalResult.trajectory.statutoryStayExhausted, true);
  assert.equal(evalResult.trajectory.cumulativeBidDropPct, 25);
});

test('second-look triggers raise JUNIOR_LIEN_SURVIVING_MORTGAGE alert when junior mortgage or HELOC drops price', () => {
  const mockCase = {
    id: 'case_018f9e20a1bc724090123499',
    state: 'pass',
    listingSnapshot: {
      openingBid: 120000,
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
    reconsideration: {
      openingBid: { mode: 'changed' },
    },
  };

  const freshListing = {
    openingBid: 45000,
    plaintiff: 'Discover Home Equity Line of Credit',
    state: 'OH',
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const evaluation = evaluateSecondLookTriggers(mockCase, freshListing);
  assert.equal(evaluation.shouldTrigger, true);
  assert.equal(evaluation.recommendedState, 'inbox');
  assert.ok(evaluation.alerts.includes('JUNIOR_LIEN_SURVIVING_MORTGAGE'));
  assert.ok(evaluation.triggerEvents.some((e) => e.type === 'JUNIOR_LIEN_SURVIVING_MORTGAGE'));
  assert.match(evaluation.primaryReason, /JUNIOR_LIEN_SURVIVING_MORTGAGE/);
  assert.equal(evaluation.titleRisk.firstMortgageSurvives, true);
});

test("second-look triggers raise JUNIOR_LIEN_SURVIVING_MORTGAGE on mechanic's lien price drop", () => {
  const mockCase = {
    id: 'case_018f9e20a1bc724090123500',
    state: 'pass',
    listingSnapshot: {
      openingBid: 95000,
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
  };

  const freshListing = {
    openingBid: 25000,
    plaintiff: "Buckeye Foundation & Masonry Contractors Mechanic's Lien Foreclosure",
    state: 'OH',
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const evaluation = evaluateSecondLookTriggers(mockCase, freshListing);
  assert.equal(evaluation.shouldTrigger, true);
  assert.ok(evaluation.alerts.includes('JUNIOR_LIEN_SURVIVING_MORTGAGE'));
  assert.ok(evaluation.triggerEvents.some((e) => e.type === 'JUNIOR_LIEN_SURVIVING_MORTGAGE'));
  assert.equal(evaluation.titleRisk.firstMortgageSurvives, true);
});

test('second-look triggers flag IRS_REDEMPTION_WINDOW_ACTIVE under 26 U.S.C. § 7425(d)', () => {
  const mockCase = {
    id: 'case_018f9e20a1bc724090123501',
    state: 'pass',
    listingSnapshot: {
      openingBid: 100000,
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
    reconsideration: {
      titleRisk: { operator: 'irs_redemption_active' },
    },
  };

  const freshListing = {
    openingBid: 95000,
    plaintiff: 'PNC Bank, N.A.',
    raw: 'United States of America, Internal Revenue Service, by virtue of Federal Tax Lien recorded under 26 U.S.C. § 7425.',
    state: 'OH',
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const evaluation = evaluateSecondLookTriggers(mockCase, freshListing);
  assert.equal(evaluation.shouldTrigger, true);
  assert.ok(evaluation.flags.includes('IRS_REDEMPTION_WINDOW_ACTIVE'));
  assert.ok(evaluation.triggerEvents.some((e) => e.type === 'IRS_REDEMPTION_WINDOW_ACTIVE'));
  assert.match(evaluation.primaryReason, /26 U\.S\.C\. § 7425\(d\)/);
});

test('second-look triggers flag HOA_SUPER_PRIORITY_RISK in NV and FL states', () => {
  const mockCaseNv = {
    id: 'case_018f9e20a1bc724090123502',
    state: 'pass',
    listingSnapshot: {
      openingBid: 50000,
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
    reconsideration: {
      titleRisk: { operator: 'hoa_super_priority' },
    },
  };

  const freshListingNv = {
    openingBid: 15000,
    plaintiff: 'Summerlin North Community Association',
    state: 'NV',
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const evalNv = evaluateSecondLookTriggers(mockCaseNv, freshListingNv);
  assert.equal(evalNv.shouldTrigger, true);
  assert.ok(evalNv.flags.includes('HOA_SUPER_PRIORITY_RISK'));
  assert.ok(evalNv.triggerEvents.some((e) => e.type === 'HOA_SUPER_PRIORITY_RISK' && e.state === 'NV'));

  const mockCaseFl = {
    id: 'case_018f9e20a1bc724090123503',
    state: 'pass',
    listingSnapshot: {
      openingBid: 80000,
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
    reconsideration: {
      titleRisk: { operator: 'hoa_super_priority' },
    },
  };

  const freshListingFl = {
    openingBid: 40000,
    plaintiff: 'Boca Pointe Homeowners Association, Inc.',
    state: 'FL',
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const evalFl = evaluateSecondLookTriggers(mockCaseFl, freshListingFl);
  assert.equal(evalFl.shouldTrigger, true);
  assert.ok(evalFl.flags.includes('HOA_SUPER_PRIORITY_RISK'));
  assert.ok(evalFl.triggerEvents.some((e) => e.type === 'HOA_SUPER_PRIORITY_RISK' && e.state === 'FL'));
});

test('research-cases engine evaluates titleRisk reconsideration conditions for junior liens, IRS, and HOA', (t) => {
  const cases = require('../server/intelligence/research-cases');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'second-look-title-'));
  const filePath = path.join(tempDir, 'research-cases.json');
  t.after(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  const baseListing = {
    id: 'prop-second-look-01',
    address: '100 Main St, Columbus, OH 43215',
    state: 'OH',
    county: 'Franklin',
    city: 'Columbus',
    zip: '43215',
    source: 'civilview',
    sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=1001',
    sourceObservedAt: '2026-11-01T12:00:00.000Z',
    status: 'Scheduled',
    openingBid: 150000,
    saleDate: '2026-12-15',
    raw: 'Test notice civilview listing text for title risk second look.',
    provenance: { origin: 'live', observed: true, publisher: 'CivilView Franklin', recordId: '1001', observedAt: '2026-11-01T12:00:00.000Z' },
  };

  const created = cases.createCase({ listing: baseListing }, { filePath, now: '2026-11-01T12:00:00.000Z' }).case;
  assert.equal(created.workspaceState, 'inbox');

  // Pass with junior lien condition
  const passedJunior = cases.updateCase(created.id, {
    expectedRevision: 1,
    state: 'pass',
    reasonCodes: ['title_risk_unresolved'],
    reconsideration: {
      mode: 'any',
      conditions: [{ field: 'titleRisk', operator: 'junior_lien_surviving_mortgage' }],
    },
  }, { filePath, now: '2026-11-02T12:00:00.000Z' });
  assert.equal(passedJunior.workspaceState, 'pass');

  // Update listing with a junior mortgage plaintiff and price drop
  const juniorListing = {
    ...baseListing,
    openingBid: 35000,
    plaintiff: 'Discover Home Equity Line of Credit HELOC',
    sourceObservedAt: '2026-11-03T12:00:00.000Z',
    provenance: { ...baseListing.provenance, observedAt: '2026-11-03T12:00:00.000Z' },
  };

  const reloadedJunior = cases.createCase({
    listing: juniorListing,
    origin: { type: 'material_change', changedFields: ['openingBid', 'plaintiff'], changes: { openingBid: { previous: 150000, current: 35000 } } },
  }, { filePath, now: '2026-11-03T12:05:00.000Z' }).case;

  assert.equal(reloadedJunior.reconsiderationRequired, true);
  assert.equal(reloadedJunior.latestTrigger.titleRiskAlert, 'JUNIOR_LIEN_SURVIVING_MORTGAGE');
  assert.ok(reloadedJunior.latestTrigger.alerts.includes('JUNIOR_LIEN_SURVIVING_MORTGAGE'));

  // Pass with IRS active flag condition
  const passedIrs = cases.updateCase(created.id, {
    expectedRevision: reloadedJunior.revision,
    state: 'pass',
    reasonCodes: ['title_risk_unresolved'],
    reconsideration: {
      mode: 'any',
      conditions: [{ field: 'titleRisk', operator: 'irs_redemption_active' }],
    },
  }, { filePath, now: '2026-11-04T12:00:00.000Z' });

  const irsListing = {
    ...baseListing,
    hasIrsLien: true,
    plaintiff: 'First National Bank',
    sourceObservedAt: '2026-11-05T12:00:00.000Z',
    provenance: { ...baseListing.provenance, observedAt: '2026-11-05T12:00:00.000Z' },
  };

  const reloadedIrs = cases.createCase({
    listing: irsListing,
    origin: { type: 'material_change', changedFields: ['hasIrsLien'] },
  }, { filePath, now: '2026-11-05T12:05:00.000Z' }).case;

  assert.equal(reloadedIrs.reconsiderationRequired, true);
  assert.equal(reloadedIrs.latestTrigger.irsRedemptionActive, true);
  assert.ok(reloadedIrs.latestTrigger.flags.includes('IRS_REDEMPTION_WINDOW_ACTIVE'));

  // Packet includes title risk alerts in markdown
  const packet = cases.buildPacket(created.id, { filePath });
  assert.equal(packet.case.latestTrigger.irsRedemptionActive, true);
  const md = cases.packetToMarkdown(packet);
  assert.match(md, /IRS_REDEMPTION_WINDOW_ACTIVE/);
});

test('second-look supports dropped_by_pct, bid_to_assessed_lte, within_days, gte, and sqft rules', () => {
  const dropCase = {
    id: 'case_018f9e20a1bc724090123510',
    state: 'pass',
    listingSnapshot: {
      openingBid: 100000,
      assessedValue: 200000,
      sqft: 1800,
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
    reconsideration: {
      openingBid: { operator: 'dropped_by_pct', value: 15 },
    },
  };
  const shallowDrop = evaluateSecondLookTriggers(dropCase, {
    openingBid: 92000,
    assessedValue: 200000,
    sqft: 1800,
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  });
  assert.equal(shallowDrop.shouldTrigger, false);

  const deepDrop = evaluateSecondLookTriggers(dropCase, {
    openingBid: 80000,
    assessedValue: 200000,
    sqft: 1800,
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  });
  assert.equal(deepDrop.shouldTrigger, true);

  const ratioCase = {
    id: 'case_018f9e20a1bc724090123511',
    state: 'pass',
    listingSnapshot: {
      openingBid: 150000,
      assessedValue: 200000,
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
    reconsideration: {
      openingBid: { operator: 'bid_to_assessed_lte', value: 50 },
    },
  };
  const ratioPass = evaluateSecondLookTriggers(ratioCase, {
    openingBid: 95000,
    assessedValue: 200000,
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  });
  assert.equal(ratioPass.shouldTrigger, true);

  const windowAndSqftCase = {
    id: 'case_018f9e20a1bc724090123512',
    state: 'pass',
    listingSnapshot: {
      sqft: 1600,
      saleDate: '2026-12-20',
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
    reconsideration: {
      mode: 'all',
      conditions: [
        { field: 'saleDate', operator: 'within_days', value: 14 },
        { field: 'sqft', operator: 'gte', value: 1500 },
      ],
    },
  };
  const windowEval = evaluateSecondLookTriggers(windowAndSqftCase, {
    sqft: 1650,
    saleDate: '2026-11-25',
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  }, { now: '2026-11-15T00:00:00.000Z' });
  assert.equal(windowEval.shouldTrigger, true);

  const gteBidCase = {
    id: 'case_018f9e20a1bc724090123513',
    state: 'pass',
    listingSnapshot: { openingBid: 40000, lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION },
    reconsideration: { openingBid: { operator: 'gte', value: 60000 } },
  };
  assert.equal(
    evaluateSecondLookTriggers(gteBidCase, { openingBid: 65000, lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION }).shouldTrigger,
    true
  );
});

test('second-look prevents isJuniorLien inside priceChange from bypassing failing openingBid criteria', () => {
  const gatedCase = {
    id: 'case_018f9e20a1bc724090123514',
    state: 'pass',
    listingSnapshot: {
      openingBid: 120000,
      lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
    },
    reconsideration: {
      openingBid: { mode: 'lte', threshold: 40000 },
    },
  };

  const freshAboveThreshold = {
    openingBid: 80000,
    plaintiff: 'Discover Home Equity Line of Credit HELOC',
    state: 'OH',
    lifecycleStage: DISTRESS_STAGES.SCHEDULED_AUCTION,
  };

  const evalResult = evaluateSecondLookTriggers(gatedCase, freshAboveThreshold);
  assert.equal(evalResult.shouldTrigger, false);
  assert.ok(evalResult.alerts.includes('JUNIOR_LIEN_SURVIVING_MORTGAGE'));
});

test('applySecondLookReconsideration preserves reconsiderationRequired and latestTrigger, and action=second-look scans paginated pass cases', async () => {
  const { applySecondLookReconsideration } = require('../server/intelligence/second-look');
  const { createCase, updateCase, getCase, listCases } = require('../server/intelligence/research-cases');
  const { createScrapersHandler } = require('../server/routes/scrapers');
  const { Writable } = require('node:stream');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'second-look-persist-'));
  const filePath = path.join(tmpDir, 'research-cases.json');
  try {
    const sampleListing = {
      id: 'CIV-NJ-TEST-SL-1',
      source: 'civilview',
      state: 'NJ',
      county: 'Bergen',
      city: 'Hackensack',
      address: '10 Test Way, Hackensack, NJ 07601',
      propType: 'Single Family',
      status: 'scheduled',
      openingBid: 100000,
      saleDate: '2026-10-01',
      raw: 'Source record 99999',
      sourceUrl: 'https://salesweb.civilview.com/Sales/SaleDetails?PropertyId=99999',
      sourceObservedAt: '2026-09-01T12:00:00.000Z',
      provenance: {
        origin: 'live',
        observed: true,
        recordKind: 'source_record',
        publisher: 'CivilView',
        recordId: '99999',
        observedAt: '2026-09-01T12:00:00.000Z',
      },
    };
    const created = createCase({ listing: sampleListing, origin: { type: 'manual' } }, { filePath }).case;
    const passed = updateCase(created.id, {
      state: 'pass',
      expectedRevision: created.revision,
      reasonCodes: ['opening_bid_too_high'],
      reconsideration: { mode: 'any', conditions: [{ field: 'openingBid', operator: 'changed' }] },
    }, { filePath });

    assert.throws(
      () => updateCase(created.id, {
        state: 'pass',
        expectedRevision: passed.revision,
        reasonCodes: ['opening_bid_too_high'],
        reconsideration: { mode: 'any', conditions: [{ field: 'toString', operator: 'eq', value: 'x' }] },
      }, { filePath }),
      (err) => err && err.name === 'ResearchCaseError',
    );

    const droppedListing = { ...sampleListing, openingBid: 75000, sourceObservedAt: '2026-09-10T12:00:00.000Z' };
    const outcome = applySecondLookReconsideration(created.id, droppedListing, { filePath });
    assert.equal(outcome.triggered, true);

    const reloaded = getCase(created.id, { filePath }).case;
    assert.equal(reloaded.state, 'inbox');
    assert.equal(reloaded.reconsiderationRequired, true);
    assert.ok(reloaded.latestTrigger && reloaded.latestTrigger.type === 'second_look_event');

    // Verify action=second-look route iterates listCases().items without crashing when no caseId is supplied
    const origPath = process.env.PROPERTY_RESEARCH_CASES_PATH;
    process.env.PROPERTY_RESEARCH_CASES_PATH = filePath;
    try {
      const handler = createScrapersHandler({
        env: { ...process.env, SCRAPER_ADMIN_TOKEN: 'sl-token' },
        database: { async getListingById() { return droppedListing; } },
      });
      let status = 200;
      let payload = null;
      const req = {
        method: 'POST',
        url: '/api/scrapers/run?action=second-look',
        headers: { authorization: 'Bearer sl-token' },
        body: {},
      };
      const res = {
        status(code) { status = code; return this; },
        json(obj) { payload = obj; return this; },
        setHeader() {},
      };
      await handler(req, res, new URL('http://localhost/api/scrapers/run?action=second-look'));
      assert.equal(status, 200);
      assert.equal(payload.status, 'completed');
      assert.equal(payload.action, 'second-look');
      assert.ok(listCases({}, { filePath }).items.length >= 1);
    } finally {
      if (origPath === undefined) delete process.env.PROPERTY_RESEARCH_CASES_PATH;
      else process.env.PROPERTY_RESEARCH_CASES_PATH = origPath;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
