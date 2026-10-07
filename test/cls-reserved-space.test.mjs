// test/cls-reserved-space.test.js
//
// Regression guard for the two late-arriving blocks on /listings.
//
// CLS was 0.1091 there, over Google's 0.1 threshold, and the layout-shift
// entries named both causes precisely:
//
//   0.066  the pagination bar dropped 20px when the "N of M on this page
//          publish an opening amount" line appeared from nothing, taking the
//          pagination with it
//   0.043  the runtime-mode banner returned null until /api/health answered,
//          then appeared and shoved the whole page down 65px
//
// Both are the same shape: an element that is absent on first paint and present
// a moment later. Neither is a bug in how they render; each is a block that
// fails to reserve its own space.
//
// After the fix: 0.0370, from the pagination bar alone, which is left in place
// deliberately -- it is a conditional block, and reserving a permanent empty
// row for it would cost more than the 0.037 it is worth.
//
// A source-level guard, because there is no DOM test runner in this project.
// It asserts the two space reservations exist and, importantly, that the
// pending banner state is a real element rather than a null return.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const WORKBENCH = 'src/components/listings/discovery-workbench.tsx';
const BANNER = 'src/components/site/data-mode-banner.tsx';

test('the inventory-honesty line is always rendered, not popped in', () => {
  const src = read(WORKBENCH);
  const honesty = src.match(/<p[^>]*data-testid="inventory-honesty"[\s\S]{0,400}?<\/p>/);
  assert.ok(honesty, 'could not locate the inventory-honesty line');

  // The structural signature of the bug was the element sitting on the true
  // branch of a ternary, i.e. `cond ? (<p .../>) : null`. Matching the opening
  // side alone was too weak -- an earlier revision of this guard passed while
  // the element was still conditional. Anchor on the CLOSING side, which no
  // conditional form can avoid and no unconditional one contains.
  const after = src.slice(src.indexOf(honesty[0]) + honesty[0].length, src.indexOf(honesty[0]) + honesty[0].length + 40);
  assert.doesNotMatch(after, /^\s*\)\s*:\s*null/,
    `${WORKBENCH}: the honesty line is still the true branch of a ternary, so it still appears from nothing`);

  // And it must carry placeholder text for the pre-load state, which is what
  // keeps the line's height stable.
  assert.match(honesty[0], /Checking published amounts/,
    `${WORKBENCH}: the pre-load state must render placeholder text, not nothing`);
});

test('the runtime-mode banner reserves its box before the health probe answers', () => {
  const src = read(BANNER);
  assert.doesNotMatch(src, /if\s*\(\s*dismissed\s*\|\|\s*health\s*===\s*undefined\s*\)\s*return\s+null/,
    `${BANNER}: returning null while the probe is in flight is what pushed the page down 65px`);
  assert.match(src, /data-testid="data-mode-banner-pending"/,
    `${BANNER}: there must be a pending state that occupies the banner's box`);
  assert.match(src, /Checking runtime mode/,
    `${BANNER}: the pending state should say what it is doing rather than showing nothing`);
});

test('pending and real banner reserve the same height', () => {
  // A one-line placeholder against a two-line real message still moved the page
  // 24px, because the runtime-mode copy wraps at desktop widths. Every banner
  // state must claim two lines or the answer to the probe changes the geometry.
  const src = read(BANNER);
  const reserved = src.match(/min-h-\[65px\]/g) || [];
  const bannerStates = (src.match(/data-testid="data-mode-banner(-pending)?"/g) || []).length;
  assert.equal(reserved.length, bannerStates,
    `${BANNER}: all ${bannerStates} banner states must reserve the same height; found ${reserved.length}`);
});

test('the results grid reserves a viewport while the first fetch is in flight', () => {
  // The third instance of this shape, and by far the largest.
  //
  // Measured with a layout-shift observer on the production build: CLS was
  // 0.419, and a single entry at t=1151ms accounted for 0.4513 of it. The
  // loading placeholder is `mt-5 grid place-items-center p-16` -- 185px tall.
  // The grid that replaces it renders 48 cards across three columns and is
  // about 12,400px tall. So the filter row above it moved down inside the
  // viewport, and the pagination below it went from y=768 to y=13,000, which
  // is out of the viewport entirely.
  //
  // Reserving a full viewport is what keeps both out of view for the whole
  // load. The earlier fixes above reserve 65px and a line of text, because
  // those blocks really are that small; this one cannot be, because the content
  // it stands in for is not bounded until the response arrives.
  const src = read(WORKBENCH);
  const placeholder = src.match(/<div className="mt-5 grid[^"]*place-items-center[^"]*">/);
  assert.ok(placeholder, 'could not locate the results-grid loading placeholder');
  assert.match(
    placeholder[0],
    /min-h-screen/,
    `${WORKBENCH}: the placeholder must reserve a viewport. At 185px it left the `
      + `pagination inside the viewport while a 12,400px grid was about to arrive`,
  );
});

test('the reserved placeholder is not smaller than the viewport it replaces', () => {
  // Guards the obvious future edit: someone trading min-h-screen for a fixed
  // height that is big enough at desktop and too small on a phone.
  const src = read(WORKBENCH);
  const placeholder = src.match(/<div className="mt-5 grid[^"]*place-items-center[^"]*">/);
  assert.ok(placeholder, 'could not locate the results-grid loading placeholder');
  const fixed = placeholder[0].match(/min-h-\[(\d+)px\]/);
  assert.equal(
    fixed, null,
    `${WORKBENCH}: a fixed pixel reservation (${fixed ? fixed[0] : ''}) does not `
      + `scale with the viewport, so the same page shifts on a smaller screen`,
  );
});

test('the score-sort honesty line is always rendered, not popped in', () => {
  // The same shape as the inventory-honesty line above, added later and missed
  // by the same reasoning: it was written as
  //
  //   {cond ? (<p data-testid="score-sort-honesty">…) : null}
  //
  // so it appeared from nothing when results landed. Its copy wraps to two
  // lines at desktop width, and the two lines are 68px -- exactly the residual
  // shift measured on /listings after the results grid reserved its viewport.
  //
  // This line was introduced to say that the default sort ranks nothing while
  // no record carries a modeled score. Making it honest about being checked is
  // not a cost: a placeholder is true, and reserving the box is the whole fix.
  const src = read(WORKBENCH);
  const honesty = src.match(/<p[^>]*data-testid="score-sort-honesty"[\s\S]{0,700}?<\/p>/);
  assert.ok(honesty, 'could not locate the score-sort-honesty line');

  // Anchor on the CLOSING side, for the reason spelled out in the guard above:
  // a conditional form can never contain an unconditional close.
  const after = src.slice(
    src.indexOf(honesty[0]) + honesty[0].length,
    src.indexOf(honesty[0]) + honesty[0].length + 40,
  );
  assert.doesNotMatch(after, /^\s*\)\s*:\s*null/,
    `${WORKBENCH}: the score-sort line is the true branch of a ternary, so it still appears from nothing`);

  assert.match(honesty[0], /data-testid="score-sort-honesty"/,
    `${WORKBENCH}: the line must keep its testid so other guards can find it`);
});

test('the results row layout does not depend on how long the honesty copy is', () => {
  // The fix above was necessary but not sufficient, and the way it failed is
  // worth recording.
  //
  // With both honesty lines always rendered and one line tall in every state,
  // the block's HEIGHT was already identical before and after load: 56px then,
  // 56px then. The row still grew from 56px to 108px, because the loaded
  // message is far longer than its placeholder. That widened the text column
  // just enough to push the filter controls past the container width and wrap
  // them onto a second row -- 52px of shift out of a block that had not
  // changed height by a pixel.
  //
  // A guard that only checks for reserved space would have passed while the
  // shift was still there. The property is that the column takes the leftover
  // width rather than the width its text needs.
  const src = read(WORKBENCH);
  const row = src.match(/<div className="mt-6 flex flex-wrap items-center justify-between gap-3">[\s\S]{0,1400}?<div className="([^"]*)">/);
  assert.ok(row, 'could not locate the results-row text column');
  assert.match(
    row[1],
    /min-w-0/,
    `layout must not be a function of sentence length; found text column class="${row[1]}"`,
  );
  assert.match(
    row[1],
    /flex-1/,
    `the text column must take the leftover width rather than its intrinsic width; found "${row[1]}"`,
  );
});

test('the pending state is distinguishable from the real banner', () => {
  // test/honest-empty-state.test.js reads data-testid="data-mode-banner". A
  // pending box reusing that id would let the guard pass on a placeholder that
  // says nothing about runtime mode.
  const src = read(BANNER);
  assert.ok(src.includes('data-testid="data-mode-banner-pending"'));
  const pendingBlock = src.slice(src.indexOf('data-testid="data-mode-banner-pending"'));
  assert.doesNotMatch(pendingBlock.slice(0, 200), /data-testid="data-mode-banner"\s/,
    'the pending state must not also carry the real banner testid');
});
