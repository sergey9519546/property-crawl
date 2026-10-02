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
