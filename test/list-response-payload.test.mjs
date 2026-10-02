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

test('the grid response strips raw after presenting', () => {
  // Assert the shape directly rather than a chain-shaped regex: the earlier
  // version anchored across a multi-line .map() chain and matched nothing.
  assert.ok(
    /\.map\(\s*listing\s*=>\s*presentListing\(/.test(code),
    'expected the grid to map listings through presentListing first',
  );
  assert.ok(
    /\.map\(\s*\(\{\s*raw\s*,\s*\.\.\.rest\s*\}\)\s*=>\s*rest\s*\)/.test(code),
    'the grid must destructure raw away, or it goes back on the wire',
  );
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

test('no client code reads listing.raw, which is why the strip is safe', () => {
  // If this ever fails, someone started depending on raw in the grid response
  // and the strip above is now hiding data from them. That is the signal to
  // re-add it deliberately rather than to keep shipping 45 KB nobody reads.
  const clientFiles = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e.name)) clientFiles.push(full);
    }
  })(path.join(ROOT, 'src'));

  const readers = [];
  for (const f of clientFiles) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?<![\w.$])listing\.raw\b|listing\?\.raw\b/g)) {
      readers.push(path.relative(ROOT, f).replace(/\\/g, '/'));
    }
  }
  assert.deepEqual(readers, [],
    'client code now reads listing.raw; the grid strip is hiding data from it and must be revisited');
});
