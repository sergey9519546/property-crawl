'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

const { createCheckLadderHandler } = require('../../server/routes/check-ladder');

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

test('POST /api/check-ladder: non-POST methods return 405 with Allow header and OPTIONS returns 204', async () => {
  const handler = createCheckLadderHandler();

  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const res = captureRes();
    await handler({ method }, res);
    assert.equal(res.statusCode, 405, `${method} must return 405`);
    assert.equal(res.headers.allow, 'POST, OPTIONS');
    assert.equal(typeof res.payload.error, 'string');
  }

  const optRes = captureRes();
  await handler({ method: 'OPTIONS' }, optRes);
  assert.equal(optRes.statusCode, 204);
  assert.equal(optRes.headers.allow, 'POST, OPTIONS');
});

test('POST /api/check-ladder: rejects bad JSON, empty/oversize targets, invalid availableCapital, and invalid denominations with 400/413', async () => {
  const handler = createCheckLadderHandler();

  const badStream = Readable.from([Buffer.from('{not valid json')]);
  const badJsonRes = captureRes();
  await handler(Object.assign(badStream, { method: 'POST' }), badJsonRes);
  assert.equal(badJsonRes.statusCode, 400);
  assert.match(badJsonRes.payload.error, /invalid json/i);

  const oversizeStream = Readable.from([Buffer.from(JSON.stringify({ pad: 'x'.repeat(520 * 1024) }))]);
  const oversizeBodyRes = captureRes();
  await handler(Object.assign(oversizeStream, { method: 'POST' }), oversizeBodyRes);
  assert.equal(oversizeBodyRes.statusCode, 413);

  const invalidBodies = [
    {},
    { targets: [] },
    { targets: 'not-an-array' },
    { targets: Array.from({ length: 251 }, (_, i) => ({ id: `t-${i}`, openingBid: 50000 })) },
    { targets: [{ id: 't-1', openingBid: 50000 }], availableCapital: -500 },
    { targets: [{ id: 't-1', openingBid: 50000 }], availableCapital: Number.NaN },
    { targets: [{ id: 't-1', openingBid: 50000 }], availableCapital: 'not-a-number' },
    { targets: [{ id: 't-1', openingBid: 50000 }], availableCapital: true },
    { targets: [{ id: 't-1', openingBid: 50000 }], denominations: [] },
    { targets: [{ id: 't-1', openingBid: 50000 }], denominations: [1000, -500] },
    { targets: [{ id: 't-1', openingBid: 50000 }], denominations: [1000.5] },
    { targets: [{ id: 't-1', openingBid: 50000 }], denominations: Array.from({ length: 11 }, (_, i) => (i + 1) * 1000) },
  ];

  for (const body of invalidBodies) {
    const res = captureRes();
    await handler({ method: 'POST', body }, res);
    assert.equal(res.statusCode, 400, `Expected 400 for ${JSON.stringify(body).slice(0, 120)}`);
    assert.equal(typeof res.payload.error, 'string');
  }
});

test('POST /api/check-ladder: computes multi-property ladder separating ServiceLink pre-wire, CivilView at-gavel checks, and struck postponed targets', async () => {
  const fixedNow = new Date('2026-12-01T12:00:00.000Z');
  const handler = createCheckLadderHandler({ now: () => fixedNow });

  const targets = [
    {
      id: 'SL-PREWIRE-1',
      address: '100 Maple Ave, Tampa, FL',
      state: 'FL',
      source: 'servicelink',
      saleDate: '2026-12-10T15:00:00.000Z',
      maxBid: 100000, // 5% = $5,000 pre-wire (leadTimeHours=24)
      status: 'active',
    },
    {
      id: 'CIV-GAVEL-1',
      address: '548 Sandford Ave, Newark, NJ',
      state: 'NJ',
      county: 'Essex',
      source: 'civilview',
      saleDate: '2026-12-10T14:00:00.000Z',
      maxBid: 150000, // 20% = $30,000 at-gavel certified funds
      status: 'active',
    },
    {
      id: 'CIV-GAVEL-2',
      address: '212 Oak St, Paterson, NJ',
      state: 'NJ',
      county: 'Passaic',
      source: 'civilview',
      saleDate: '2026-12-10T14:00:00.000Z',
      maxBid: 80000, // 20% = $16,000 at-gavel certified funds (same peak day)
      status: 'active',
    },
    {
      id: 'CIV-STRUCK-1',
      address: '99 Elm St, Camden, NJ',
      state: 'NJ',
      county: 'Camden',
      source: 'civilview',
      saleDate: '2026-12-10T14:00:00.000Z',
      maxBid: 200000,
      status: 'Postponed',
    },
  ];

  const stream = Readable.from([
    Buffer.from(
      JSON.stringify({
        targets,
        availableCapital: 60000,
        denominations: [25000, 10000, 5000, 1000],
      })
    ),
  ]);
  const res = captureRes();
  await handler(Object.assign(stream, { method: 'POST' }), res);

  assert.equal(res.statusCode, 200);
  const data = res.payload;
  assert.equal(data.schema, 'perfectproperty.check-ladder.v1');
  assert.equal(data.generatedAt, '2026-12-01T12:00:00.000Z');

  assert.equal(data.summary.activeTargetCount, 3);
  assert.equal(data.summary.struckTargetCount, 1);
  assert.equal(data.summary.totalPreWireEscrowRequired, 5000);
  assert.equal(data.summary.peakAtGavelCheckRequired, 46000);
  assert.equal(data.summary.peakSaleDay, '2026-12-10');
  assert.ok(data.summary.checkLadderTotal >= 46000);
  assert.equal(data.summary.availableCapital, 60000);
  assert.equal(data.summary.feasible, true);
  assert.equal(data.summary.capitalShortfall, 0);

  assert.equal(data.preWireSchedule.length, 1);
  assert.equal(data.preWireSchedule[0].id, 'SL-PREWIRE-1');
  assert.equal(data.preWireSchedule[0].requiredDeposit, 5000);

  assert.equal(data.gavelTargets.length, 2);
  const gavelIds = data.gavelTargets.map((t) => t.id).sort();
  assert.deepEqual(gavelIds, ['CIV-GAVEL-1', 'CIV-GAVEL-2']);
  for (const gavelTarget of data.gavelTargets) {
    assert.ok(gavelTarget.subsetChecks.length >= 1);
    assert.equal(gavelTarget.tenderedAmount, gavelTarget.requiredDeposit);
  }

  assert.equal(data.struckTargets.length, 1);
  assert.equal(data.struckTargets[0].id, 'CIV-STRUCK-1');
  assert.match(data.struckTargets[0].struckReason, /postponed/i);
});
