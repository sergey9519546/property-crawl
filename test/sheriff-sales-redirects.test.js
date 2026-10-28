'use strict';

// test/sheriff-sales-redirects.test.js
//
// Verifies that legacy /sheriff-sales, /sheriff-sales/[state], and
// /sheriff-sales/[state]/[county] routes permanently redirect to their
// canonical counterparts under /states.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('sheriff-sales index route permanently redirects to canonical /states', () => {
  const pagePath = path.join(ROOT, 'src/app/sheriff-sales/page.tsx');
  assert.ok(fs.existsSync(pagePath), 'sheriff-sales index route must exist');
  const content = fs.readFileSync(pagePath, 'utf8');

  assert.match(content, /import\s*\{\s*permanentRedirect\s*\}\s*from\s*["']next\/navigation["']/);
  assert.match(content, /permanentRedirect\(["']\/states["']\)/);
});

test('sheriff-sales state route permanently redirects to canonical /states/[state]', () => {
  const pagePath = path.join(ROOT, 'src/app/sheriff-sales/[state]/page.tsx');
  assert.ok(fs.existsSync(pagePath), 'sheriff-sales state route must exist');
  const content = fs.readFileSync(pagePath, 'utf8');

  assert.match(content, /import\s*\{\s*permanentRedirect\s*\}\s*from\s*["']next\/navigation["']/);
  assert.match(content, /permanentRedirect\(`\/states\/\$\{encodeURIComponent\(state\.toUpperCase\(\)\)\}`\)/);
});

test('sheriff-sales county route permanently redirects to canonical /states/[state]/[county]', () => {
  const pagePath = path.join(ROOT, 'src/app/sheriff-sales/[state]/[county]/page.tsx');
  assert.ok(fs.existsSync(pagePath), 'sheriff-sales county route must exist');
  const content = fs.readFileSync(pagePath, 'utf8');

  assert.match(content, /import\s*\{\s*permanentRedirect\s*\}\s*from\s*["']next\/navigation["']/);
  assert.match(content, /permanentRedirect\(`\/states\/\$\{encodeURIComponent\(state\.toUpperCase\(\)\)\}\/\$\{encodeURIComponent\(county\)\}`\)/);
});
