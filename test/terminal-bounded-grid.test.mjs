// test/terminal-bounded-grid.test.js
//
// Regression guard for the landing page's DOM size.
//
// The interactive terminal's results grid rendered the entire `filtered` array
// at once. Measured, in the hydrated page:
//
//     before   409,430 elements   43.3 MB of DOM   46,050 inline <svg>
//     after        3,911 elements    0.45 MB of DOM      371 inline <svg>
//
// Every card carries inline SVG icons, so the cost scaled with the whole
// inventory: an unfiltered load put 6,605 cards on the page at once.
//
// This was easy to miss because the page's LCP looked healthy at 392 ms. The
// cost is paid in HTML parse, style resolution, layout and every subsequent
// interaction -- not in first paint -- and it is paid on whatever device
// actually loads the page, not on localhost.
//
// The fix bounds the grid to PAGE_SIZE with a "Show more" control. This guard
// exists so the bound cannot quietly disappear, and so a future change that
// reintroduces an unbounded map has to argue with it.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = 'src/components/terminal/interactive-terminal.tsx';
const src = fs.readFileSync(path.join(ROOT, SRC), 'utf8');

test('the results grid renders a bounded slice, not the whole result set', () => {
  // The unbounded form was `{filtered.map((listing) => {`. If this ever comes
  // back, the page goes straight back to hundreds of thousands of nodes.
  assert.doesNotMatch(src, /\{\s*filtered\s*\.map\(/,
    `${SRC} maps the entire filtered array; render the bounded \`visible\` slice instead`);
  assert.match(src, /\{\s*visible\s*\.map\(/,
    `${SRC} must render the bounded slice`);
  assert.match(src, /filtered\.slice\(0,\s*visibleCount\)/,
    `${SRC} must build the bounded slice from filtered`);
});

test('the bound is a named, modest constant', () => {
  assert.match(src, /const PAGE_SIZE = (\d+);/,
    `${SRC} should declare PAGE_SIZE explicitly so the bound is visible`);
  const size = Number(src.match(/const PAGE_SIZE = (\d+);/)[1]);
  assert.ok(size > 0 && size <= 100,
    `PAGE_SIZE is ${size}; the point of the bound is lost at more than 100 cards`);
});

test('truncation is visible and reversible, not silent', () => {
  // A silently truncated grid would make listings unreachable. These two are
  // what keep the bound honest rather than a data-loss bug.
  assert.match(src, /Show\s*\{?[\s\S]{0,80}?more/i,
    `${SRC} must offer a control that reveals the next page`);
  assert.match(src, /Showing\s*\{[\s\S]{0,120}?of\s*\{[\s\S]{0,120}?match/i,
    `${SRC} must state how many of how many are shown`);
  assert.match(src, /setVisibleCount\(\(n\) => n \+ PAGE_SIZE\)/,
    `${SRC} must grow the window rather than jump to the end`);
});

test('changing filters resets the window instead of inheriting it', () => {
  // Otherwise a user who expanded to 600 results keeps 600 mounted after
  // narrowing to a filter that matches 3.
  assert.match(src, /useEffect\(\(\) => \{ setVisibleCount\(PAGE_SIZE\); \}, \[filters\]\)/,
    `${SRC} must reset visibleCount when the filters change`);
});
