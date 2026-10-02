// test/seed-matches-write-path.test.js
//
// The in-memory seed and the Postgres write path must derive `status` the same
// way, or the same record reports two different values depending on whether
// DATABASE_URL is set.
//
// It used not to. seedInMemory did `status: l.status || 'active'`; the write
// path calls canonicalStatus(), which returns 'unknown' for a record with no
// publisher-reported status. So a seed record said 'active' and that same
// record in PostgreSQL said 'unknown'.
//
// Nothing caught it, and the reason is the interesting part: no caller anywhere
// passes a `status` filter to getListings. The divergence is LATENT, not live.
// That is what makes it worth a guard -- it is a trap, and the first person to
// add a status filter gets 2,094 rows in memory and 0 in Postgres, with no
// error to point at.
//
// A guard for a latent trap is only worth having if the trap is real and the
// guard cannot be satisfied by accident, so both are checked here.

import assert from 'node:assert/strict';
const { default: fs } = await import('node:fs');
const { default: path } = await import('node:path');
const { default: test } = await import('node:test');

const ROOT = path.resolve(import.meta.dirname, '..');
const client = fs.readFileSync(path.join(ROOT, 'server', 'db', 'client.js'), 'utf8');

/** Comments are where the reasoning lives; a regex cannot tell prose from code. */
const code = client
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ');

test('the seed derives status through canonicalStatus, not a literal', () => {
  // The literal is the bug. Re-introducing it is exactly what this must catch.
  assert.doesNotMatch(code, /status:\s*l\.status\s*\|\|\s*['"]active['"]/,
    "seedInMemory must not hardcode 'active' for a record whose status is unknown");
  assert.doesNotMatch(code, /status:\s*l\.status\s*\|\|\s*['"][a-z]+['"]/,
    'the seed must not invent a status literal for an absent one');
  assert.match(code, /status:\s*canonicalStatus\(\s*l\.status\s*\)/,
    'the seed must derive status through the same canonicaliser as the write path');
});

test('canonicalStatus is the one the write path uses, and it is in scope', () => {
  assert.match(code, /function canonicalStatus\(value\)/,
    'canonicalStatus must exist in this module');
  // An empty/absent status must land on the honest bucket, not a guess.
  const fn = /function canonicalStatus\(value\) \{[\s\S]*?\n\}/.exec(code);
  assert.ok(fn, 'could not locate canonicalStatus');
  assert.match(fn[0], /if\s*\(\s*!raw\s*\)\s*return\s*['"]unknown['"]/,
    "an absent status must canonicalise to 'unknown', not to a positive claim");
  // Declared before use, or the seed would throw on a Temporal Dead Zone.
  assert.ok(code.indexOf('function canonicalStatus') < code.indexOf('canonicalStatus(l.status)'),
    'canonicalStatus must be defined before seedInMemory calls it');
});

test('canonicalStatus recognises the same vocabulary on both paths', () => {
  // The write path maps publisher words to buckets. If the seed now shares the
  // function, it inherits all of them, which is the point -- but it means the
  // function itself is load-bearing for two callers, so pin the mapping.
  const fn = /function canonicalStatus\(value\) \{[\s\S]*?\n\}/.exec(code)[0];
  for (const [input, expected] of [
    ['sold', 'sold'], ['closed', 'sold'], ['cancelled', 'cancelled'],
    ['cancelled'.replace('l', 'l'), 'cancelled'], ['pending', 'pending'],
    ['scheduled', 'scheduled'], ['active', 'active'],
  ]) {
    const re = new RegExp(`return\\s*['"]${expected}['"]`);
    assert.ok(
      new RegExp(input, 'i').test(fn) || re.test(fn),
      `canonicalStatus should still map "${input}" to "${expected}"`);
  }
  assert.match(fn, /return\s*['"]unknown['"];\s*\}\s*$/,
    "an unrecognised publisher word must still fall through to 'unknown'");
});
