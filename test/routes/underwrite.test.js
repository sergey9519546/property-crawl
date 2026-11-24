'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

const {
  createUnderwriteHandler,
  extractNoticeSignals,
  computeSafmrRentFloor,
} = require('../../server/routes/underwrite');

function captureRes() {
  return {
    statusCode: 200,
    payload: null,
    headers: {},
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      this.ended = true;
      return this;
    },
    send(body) {
      this.payload = body;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

const SAMPLE_NOTICE = [
  'COURT OF COMMON PLEAS, CUYAHOGA COUNTY, OHIO',
  'Case No. CV-25-994120',
  'Wells Fargo Bank, N.A. vs. Jane Doe',
  'Parcel ID: 101-22-045',
  'Final Judgment in the amount of $148,250.00.',
  'Opening Bid: $82,000.00.',
  'Property is currently tenant-occupied under month-to-month lease.',
].join('\n');

test('extractNoticeSignals: extracts docket, judgment, upset bid, APN, and occupancy with exact verbatim offsets', () => {
  const extracted = extractNoticeSignals(SAMPLE_NOTICE);
  assert.equal(extracted.present, true);
  assert.equal(extracted.fields.caseNumber, 'CV-25-994120');
  assert.equal(extracted.fields.judgment, 148250);
  assert.equal(extracted.fields.openingBid, 82000);
  assert.equal(extracted.fields.apn, '101-22-045');
  assert.equal(extracted.fields.occupancy, 'Tenant-Occupied');
  assert.ok(extracted.occupancyFlags.length >= 1);

  for (const [key, span] of Object.entries(extracted.citations)) {
    assert.equal(span.verified, true, `${key} citation must be verified`);
    assert.equal(
      SAMPLE_NOTICE.slice(span.start, span.end),
      span.quote,
      `${key} slice(start, end) must equal quote verbatim`
    );
  }
  for (const flag of extracted.occupancyFlags) {
    assert.equal(SAMPLE_NOTICE.slice(flag.start, flag.end), flag.quote);
  }
});

test('extractNoticeSignals: supports NJ Block/Lot format and bounds to 20,000 chars', () => {
  const prefix = 'A'.repeat(19995);
  const njNotice = 'Sheriff Foreclosure Docket # F-004321-24. Block 120, Lot 4.02. Upset Price: $195,000. Premises are vacant.';
  const njExtracted = extractNoticeSignals(njNotice);
  assert.equal(njExtracted.fields.caseNumber, 'F-004321-24');
  assert.equal(njExtracted.fields.apn, 'Block 120, Lot 4.02');
  assert.equal(njExtracted.fields.openingBid, 195000);
  assert.equal(njExtracted.fields.occupancy, 'Vacant');
  for (const span of Object.values(njExtracted.citations)) {
    assert.equal(njNotice.slice(span.start, span.end), span.quote);
  }

  const oversized = `${prefix} Case No. CV-99-12345`;
  const bounded = extractNoticeSignals(oversized);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.charCount, 20000);
  assert.equal(bounded.fields.caseNumber, null);
});

test('POST /api/underwrite: valid underwriting computes HUD SAFMR, 1.20x DSCR ceiling, assessor ratio, and zero fabricated estLow/estHigh/dealScore', async () => {
  const handler = createUnderwriteHandler({
    hudSafmrData: {
      areas: ['Cleveland, OH HUD Metro FMR Area'],
      zips: {
        '44115': [0, 950, 1100, 1350, 1700, 1950],
      },
      meta: { asOfFiscalYear: 'FY2025' },
    },
  });

  const res = captureRes();
  await handler({
    method: 'POST',
    body: {
      address: '1420 Prospect Ave E, Cleveland',
      state: 'OH',
      zip: '44115',
      county: 'Cuyahoga',
      beds: 3,
      assessed: 70000,
      source: 'sheriff',
      noticeText: SAMPLE_NOTICE,
    },
  }, res);

  assert.equal(res.statusCode, 200);
  const data = res.payload;
  assert.equal(data.schema, 'property-crawl.any-address-underwrite/v1');
  assert.ok(data.generatedAt);

  // Notice extraction filled missing fields
  assert.equal(data.inputSummary.caseNumber, 'CV-25-994120');
  assert.equal(data.inputSummary.judgment, 148250);
  assert.equal(data.inputSummary.openingBid, 82000);
  assert.equal(data.inputSummary.apn, '101-22-045');
  assert.equal(data.inputSummary.occupancy, 'Tenant-Occupied');
  assert.equal(data.inputSummary.fieldOrigins.openingBid, 'extracted_from_notice');

  // Strict Zero-Fabrication checks
  assert.equal(data.inputSummary.estLow, null);
  assert.equal(data.inputSummary.estHigh, null);
  assert.equal(data.inputSummary.dealScore, null);
  assert.equal(data.publicBenchmarks.consensus.estLow, null);
  assert.equal(data.publicBenchmarks.consensus.estHigh, null);
  assert.equal(data.publicBenchmarks.consensus.dealScore, null);
  assert.equal(data.publicBenchmarks.consensus.isAppraisal, false);

  // HUD SAFMR + 1.20x DSCR floor
  assert.equal(data.publicBenchmarks.hudSafmr.fairMarketRent, 1700);
  assert.equal(
    data.publicBenchmarks.safmrRentFloor120Dscr,
    computeSafmrRentFloor({ monthlyRent: 1700, targetDscr: 1.20 })
  );
  assert.ok(data.publicBenchmarks.safmrRentFloor120Dscr > 0);

  // Assessor reading for OH-CUYAHOGA (35% statutory fraction -> 70000 / 0.35 = 200000)
  assert.equal(data.publicBenchmarks.assessorReading.enrolled, true);
  assert.equal(data.publicBenchmarks.assessorReading.countyKey, 'OH-CUYAHOGA');
  assert.equal(data.publicBenchmarks.assessorReading.marketComparison, 200000);
  assert.equal(data.publicBenchmarks.assessorReading.isAppraisal, false);

  // Verbatim span check
  const bidCit = data.noticeExtraction.citations.openingBid;
  assert.equal(SAMPLE_NOTICE.slice(bidCit.start, bidCit.end), bidCit.quote);
});

test('POST /api/underwrite: caller-supplied structured fields are NOT overwritten by noticeText', async () => {
  const handler = createUnderwriteHandler();
  const res = captureRes();
  await handler({
    method: 'POST',
    body: {
      address: '100 Main St',
      state: 'OH',
      openingBid: 95000,
      judgment: 160000,
      caseNumber: 'CALLER-CASE-1',
      apn: 'CALLER-APN-9',
      occupancy: 'Vacant',
      noticeText: SAMPLE_NOTICE,
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.inputSummary.openingBid, 95000);
  assert.equal(res.payload.inputSummary.judgment, 160000);
  assert.equal(res.payload.inputSummary.caseNumber, 'CALLER-CASE-1');
  assert.equal(res.payload.inputSummary.apn, 'CALLER-APN-9');
  assert.equal(res.payload.inputSummary.occupancy, 'Vacant');
  assert.equal(res.payload.inputSummary.fieldOrigins.openingBid, 'supplied');
});

test('POST /api/underwrite: federal REO vs sheriff sale possession timelines and redemption rules differ accurately', async () => {
  const handler = createUnderwriteHandler();

  const hudRes = captureRes();
  await handler({
    method: 'POST',
    body: {
      address: '500 Woodward Ave, Detroit',
      state: 'MI',
      county: 'Wayne',
      source: 'hud',
      program: 'HUD REO',
      openingBid: 110000,
    },
  }, hudRes);

  const sheriffRes = captureRes();
  await handler({
    method: 'POST',
    body: {
      address: '500 Woodward Ave, Detroit',
      state: 'MI',
      county: 'Wayne',
      source: 'sheriff',
      openingBid: 110000,
    },
  }, sheriffRes);

  assert.equal(hudRes.statusCode, 200);
  assert.equal(sheriffRes.statusCode, 200);

  // Federal REO extinguishes former-owner foreclosure redemption (0 days)
  assert.equal(hudRes.payload.riskAndCarry.possessionTimeline.isPostForeclosureReo, true);
  assert.equal(hudRes.payload.riskAndCarry.possessionTimeline.saleType, 'reo');
  assert.equal(hudRes.payload.riskAndCarry.possessionTimeline.statutoryRedemptionDays, 0);
  assert.equal(hudRes.payload.riskAndCarry.titleRisk.statutoryRedemption.days, 0);

  // MI Sheriff sale carries 180-day statutory right of redemption (MCL 600.3240)
  assert.equal(sheriffRes.payload.riskAndCarry.possessionTimeline.isPostForeclosureReo, false);
  assert.equal(sheriffRes.payload.riskAndCarry.possessionTimeline.saleType, 'sheriff');
  assert.equal(sheriffRes.payload.riskAndCarry.possessionTimeline.statutoryRedemptionDays, 180);
  assert.equal(sheriffRes.payload.riskAndCarry.titleRisk.statutoryRedemption.days, 180);
  assert.match(sheriffRes.payload.riskAndCarry.catchSummary || '', /180-day statutory redemption/i);
});

test('POST /api/underwrite: reads raw stream JSON body and rejects invalid JSON with 400', async () => {
  const handler = createUnderwriteHandler();

  const okStream = Readable.from([Buffer.from(JSON.stringify({ address: '221B Baker St', state: 'FL' }))]);
  const okRes = captureRes();
  await handler(Object.assign(okStream, { method: 'POST' }), okRes);
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.payload.inputSummary.state, 'FL');

  const badStream = Readable.from([Buffer.from('{not valid json')]);
  const badRes = captureRes();
  await handler(Object.assign(badStream, { method: 'POST' }), badRes);
  assert.equal(badRes.statusCode, 400);
  assert.match(badRes.payload.error, /invalid json/i);
});

test('POST /api/underwrite: returns 400 on missing/invalid address or state', async () => {
  const handler = createUnderwriteHandler();

  const cases = [
    { address: '', state: 'OH' },
    { address: 'A'.repeat(241), state: 'OH' },
    { address: '123 Main St', state: '' },
    { address: '123 Main St', state: 'ZZ' },
    { address: '123 Main St', state: 'OHIO' },
  ];

  for (const body of cases) {
    const res = captureRes();
    await handler({ method: 'POST', body }, res);
    assert.equal(res.statusCode, 400, `Expected 400 for ${JSON.stringify(body)}`);
    assert.equal(typeof res.payload.error, 'string');
  }
});

test('non-POST methods return 405 and OPTIONS returns 204', async () => {
  const handler = createUnderwriteHandler();

  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const res = captureRes();
    await handler({ method }, res);
    assert.equal(res.statusCode, 405, `${method} must return 405`);
    assert.equal(typeof res.payload.error, 'string');
  }

  const optRes = captureRes();
  await handler({ method: 'OPTIONS' }, optRes);
  assert.equal(optRes.statusCode, 204);
});
