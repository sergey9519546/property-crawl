'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('Layout CLS: Listing media and thumbnail containers enforce explicit aspect ratios', () => {
  const thumbSrc = read('src/components/listings/listing-thumbnail.tsx');
  assert.match(
    thumbSrc,
    /aspect-\[4\/3\]|aspect-video|aspect-square/,
    'ListingThumbnail must declare explicit aspect ratio to prevent CLS'
  );

  const propImgSrc = read('src/components/listings/property-image.tsx');
  assert.match(
    propImgSrc,
    /aspect-\[4\/3\]|aspect-video|aspect-square/,
    'PropertyImage must declare explicit aspect ratio to prevent CLS'
  );
});

test('Layout CLS: Discovery map container enforces explicit height reservation', () => {
  const mapSrc = read('src/components/listings/discovery-map.tsx');
  assert.match(
    mapSrc,
    /min-h-|h-\[|h-full/,
    'DiscoveryMap must declare height reservation to prevent layout shift upon maplibre initialization'
  );
});

test('Accessibility (a11y): Split-Pane review interface includes keyboard listener and ARIA controls', () => {
  const splitPaneSrc = read('src/components/workspace/review-split-pane.tsx');

  // Verify keyboard navigation listener
  assert.match(splitPaneSrc, /addEventListener\(['"]keydown['"]/);
  assert.match(splitPaneSrc, /removeEventListener\(['"]keydown['"]/);

  // Verify accessible button names
  assert.match(splitPaneSrc, /aria-label="Previous Notice"/);
  assert.match(splitPaneSrc, /aria-label="Next Notice"/);
});

test('Accessibility (a11y): Triage chips enforce accessible list semantics and hidden icons', () => {
  const triageChipsSrc = read('src/components/listings/triage-chips.tsx');
  assert.ok(triageChipsSrc.length > 0);

  // The chip container must have an accessible name
  assert.match(triageChipsSrc, /aria-label="Listing triage flags"/);
  // Decorative icons must be hidden from screen readers
  assert.match(triageChipsSrc, /aria-hidden/);
  // Text label must be visible
  assert.match(triageChipsSrc, /<span>\{chip\.label\}<\/span>/);
});

test('Due Diligence Binder: component is mounted on listing detail page with accessible landmarks', () => {
  const listingPageSrc = read('src/app/listings/[id]/page.tsx');
  assert.match(listingPageSrc, /<DueDiligenceChecklist listing=\{listing\} \/>/, 'DueDiligenceChecklist must be mounted on listing detail page');

  const checklistSrc = read('src/components/terminal/due-diligence-checklist.tsx');
  assert.match(checklistSrc, /aria-labelledby="due-diligence-heading"/, 'Checklist section must declare accessible heading landmark');
  assert.match(checklistSrc, /window\.print\(\)/, 'Checklist must support one-click bidding binder print');
  assert.match(checklistSrc, /Interactive Lien Waterfall & Surplus Proceeds Simulator/, 'Checklist must embed interactive debt waterfall simulator');
});

test('Listing page logic: no invented lien amounts, no false junior-lien alarm', () => {
  const src = read('src/components/terminal/due-diligence-checklist.tsx');
  assert.doesNotMatch(src, /150_000|3_500|100_000/, 'waterfall inputs must not be prefilled with invented amounts');
  assert.match(src, /\^\(\?:high\|critical\)\$/, 'lien warning must be gated on detector risk high/critical');
  assert.match(src, /\^SENIOR_LIEN_RISK/, 'lien warning must honor the SENIOR_LIEN_RISK detector warning');
  assert.doesNotMatch(src, /\(\?:junior\|second/, 'free-text junior/second regex must not drive the warning');
});

test('Listing page logic: watchlist toggle saves to device storage for signed-out visitors', () => {
  const src = read('src/components/listings/listing-watchlist-toggle.tsx');
  assert.match(src, /perfectproperty:saved-listings/, 'must share the /listings grid device key');
  const toggleBody = src.slice(src.indexOf('async function toggle'));
  const beforeAuthed = toggleBody.slice(0, toggleBody.indexOf('if (busy)'));
  assert.doesNotMatch(beforeAuthed, /requestUnlock/, 'signed-out branch must not call requestUnlock');
});
