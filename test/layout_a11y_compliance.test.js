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
