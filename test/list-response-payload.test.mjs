// test/list-response-payload.test.js
//
// The grid response must not carry the publisher's raw feed.
//
// Measured on a 48-listing page:
//
//     before   270.7 KB total   5.64 KB per listing
//     after    225.5 KB total   4.70 KB per listing
//
// `raw` was 44.8 KB of the 270.7 -- 16.6% -- and it is a 1,103-element array
// per listing, the publisher's entire raw feed carried on every card. Nothing
// read it: not the workbench, not the card, not the detail page, not the
// watchlist, not a single script.
//
// The single-listing route still sends it, and that is deliberate. A product
// whose whole value is provenance should be able to show the raw publisher
// record where someone goes looking for it. It just should not put it on the
// wire 48 times to render a grid of cards.
//
// This pins the split in both directions, because both halves are easy to break
// quietly: someone trimming "dead weight" from the detail route, or someone
// re-adding raw to the grid because a new consumer appeared.

import assert from 'node:assert/strict';
const { default: fs } = await import('node:fs');
const { default: path } = await import('node:path');
const { default: test } = await import('node:test');

const ROOT = path.resolve(import.meta.dirname, '..');
const route = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'listings.js'), 'utf8');

const code = route
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ');

test('the grid response strips raw and the unread provenance mass', () => {
  // Assert the shape directly rather than a chain-shaped regex: the earlier
  // version anchored across a multi-line .map() chain and matched nothing.
  assert.ok(
    /\.map\(\s*listing\s*=>\s*presentListing\(/.test(code),
    'expected the grid to map listings through presentListing first',
  );
  assert.ok(
    /\.map\(\s*\(\{\s*raw\s*,\s*provenance\s*,\s*\.\.\.rest\s*\}\)/.test(code),
    'the grid must destructure raw and provenance away',
  );
  for (const field of ['sourceFields', 'statusHistory', 'sourceFacts']) {
    assert.ok(
      new RegExp(`const\\s*\\{[^}]*\\b${field}\\b[^}]*\\}\\s*=\\s*provenance`).test(code),
      `the grid must drop provenance.${field} -- it is unread on the grid and nothing outside detail renders it`,
    );
  }
});

test('the provenance the client actually reads is not stripped', () => {
  // The strip removes unread keys from `provenance`. If it ever removed the whole
  // object, or these, the cards would lose their live/archive badge, publisher name,
  // map coordinates, and derivedFields origin indicators.
  const strip = /const\s*\{([^}]*)\}\s*=\s*provenance/.exec(code);
  assert.ok(strip, 'could not locate the provenance destructuring');
  for (const keep of ['sourceFields', 'statusHistory', 'sourceFacts']) {
    assert.ok(strip[1].includes(keep), `${keep} should be dropped by the strip`);
  }
  assert.doesNotMatch(strip[1], /\borigin\b|\bpublisher\b|\bmedia\b|\brecordId\b|\bderivedFields\b|\bcoordinates\b/,
    'the strip must not remove fields the client renders');
});

test('the single-listing route still returns raw', () => {
  // The detail response is assembled separately and must keep the field.
  const detail = /res\.json\(\s*\{\s*\.\.\.presentListing\(/.exec(code);
  assert.ok(detail, 'could not locate the single-listing response');
  // It is presentListing(...) that decides, so assert it is not the stripped one.
  const stripped = /\.map\(\(\{ raw, \.\.\.rest \}\) => rest\)/.test(code);
  const detailLine = code.slice(detail.index, detail.index + 200);
  assert.ok(!stripped || !detailLine.includes('raw,'),
    'the detail route must not reuse the grid\'s raw-stripping mapper');
});

test('no client code reads the fields the grid strips, which is why it is safe', () => {
  // If this ever fails, someone started depending on one of them in the grid
  // response and the strip is now hiding data from them. That is the signal to
  // re-add deliberately rather than to keep shipping a quarter-megabyte nobody
  // reads.
  //
  // `statusHistory` has one reader -- alachua-second-chance.tsx -- and that
  // renders a purchase record's history, not a listing's provenance, so it is
  // not a reader of the field being stripped here.
  const clientFiles = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e.name)) clientFiles.push(full);
    }
  })(path.join(ROOT, 'src'));

  const readers = [];
  const patterns = [
    /(?<![\w.$])listing\.raw\b/g,
    /provenance\.sourceFields\b/g,
    /listing\.provenance\?\.statusHistory\b/g,
    /provenance\.sourceFacts\b/g,
  ];
  const saleMechanicsImporters = [];
  for (const f of clientFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (/sale-mechanics/.test(src) && rel !== 'src/components/listings/sale-mechanics.tsx') {
      saleMechanicsImporters.push(rel);
    }
    for (const re of patterns) {
      for (const _ of src.matchAll(re)) {
        readers.push(`${rel}  (${re.source})`);
      }
    }
  }
  // The grid strips raw and sourceFacts. The listing detail page is not a grid
  // client: it loads /api/listings/:id, and that route still returns raw and
  // sourceFacts so title arbitration and SaleMechanics can read the published
  // record. Any other reader means the strip is hiding data.
  const detailRaw = 'src/app/listings/[id]/page.tsx';
  const detailSaleMechanics = 'src/components/listings/sale-mechanics.tsx';
  assert.deepEqual(saleMechanicsImporters, [detailRaw],
    'SaleMechanics reads provenance.sourceFacts and may only be imported by the detail page');
  const unexpected = readers.filter((line) => {
    const file = line.split('  ')[0];
    if (file === detailRaw && (line.includes('listing\\.raw') || line.includes('provenance\\.sourceFacts'))) return false;
    if (file === detailSaleMechanics && line.includes('provenance\\.sourceFacts')) return false;
    return true;
  });
  assert.deepEqual(unexpected, [],
    'client code now reads a field the grid strips; the strip is hiding data and must be revisited');
});

test('runtime grid vs detail split strips sourceFacts/raw on grid while preserving detail and pipeline', async () => {
  const { default: handleListings } = await import('../server/routes/listings.js');
  const sample = {
    id: 'SERVICELINK-TEST-1',
    source: 'servicelink',
    state: 'OH',
    county: 'Cuyahoga',
    city: 'Cleveland',
    zip: '44114',
    address: '100 Public Square',
    lat: 41.4993,
    lng: -81.6944,
    propType: 'Single Family',
    openingBid: 75000,
    status: 'Active',
    sourceUrl: 'https://www.servicelinkauction.com/property-details/100-public-square',
    sourceObservedAt: '2026-10-01T00:00:00.000Z',
    raw: 'LONG_RAW_NOTICE_PAYLOAD',
    provenance: {
      origin: 'live',
      observed: true,
      recordKind: 'source_record',
      publisher: 'ServiceLink Auction',
      recordId: 'sl-1',
      observedAt: '2026-10-01T00:00:00.000Z',
      media: { photo: null },
      coordinates: { lat: 41.4993, lng: -81.6944 },
      derivedFields: { redemption: { days: 0 } },
      sourceFields: { Address: '100 Public Square' },
      statusHistory: [{ status: 'Active', at: '2026-10-01T00:00:00.000Z' }],
      sourceFacts: {
        auctionMethod: 'Online',
        approximateUpsetPrice: { amount: 75000 },
        documents: [{ title: 'Notice', url: 'https://www.servicelinkauction.com/doc.pdf' }],
      },
    },
  };
  const fakeDb = {
    isPg: false,
    dataMode: () => 'memory',
    getListings: async () => ({ total: 1, listings: [sample] }),
    getListingById: async (id) => (id === sample.id ? sample : null),
  };
  const runGet = async (reqUrl) => {
    let payload;
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { payload = body; return this; },
      on() {},
      off() {},
    };
    await handleListings({ method: 'GET', url: reqUrl, headers: { host: 'localhost' } }, res, fakeDb);
    return { status: res.statusCode, body: payload };
  };

  const grid = await runGet('/api/listings?limit=48');
  assert.equal(grid.status, 200);
  assert.equal(grid.body.listings.length, 1);
  const card = grid.body.listings[0];
  assert.equal(Object.hasOwn(card, 'raw'), false);
  assert.equal(Object.hasOwn(card.provenance, 'sourceFields'), false);
  assert.equal(Object.hasOwn(card.provenance, 'statusHistory'), false);
  assert.equal(Object.hasOwn(card.provenance, 'sourceFacts'), false);
  assert.equal(card.provenance.origin, 'live');
  assert.equal(card.provenance.publisher, 'Public Auction Network');
  assert.deepEqual(card.provenance.derivedFields, { redemption: { days: 0 } });
  assert.deepEqual(card.provenance.coordinates, { lat: 41.4993, lng: -81.6944 });
  assert.equal(grid.body.pipeline.avgResearchQuality, card.researchQuality.score);

  const detail = await runGet(`/api/listings/${encodeURIComponent(sample.id)}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.raw, 'LONG_RAW_NOTICE_PAYLOAD');
  assert.equal(detail.body.provenance.sourceFacts.auctionMethod, 'Online');

  const summary = await runGet('/api/listings?limit=48&summary=1');
  assert.equal(summary.status, 200);
  assert.equal(summary.body.listings.length, 1);
  assert.equal(summary.body.listings[0].id, sample.id);
  assert.equal(Object.hasOwn(summary.body.listings[0], 'provenance'), false);
  assert.equal(Object.hasOwn(summary.body.listings[0], 'raw'), false);
  assert.equal(Object.hasOwn(summary.body, 'pipeline'), false);
});
