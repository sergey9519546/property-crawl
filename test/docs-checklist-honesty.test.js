'use strict';

// test/docs-checklist-honesty.test.js
//
// Four documents each grew their own "still open" table, so the same item was
// listed as open in one file and closed in another. PRODUCT_GAPS.md carried
// three rows under Still open whose own status column read "Closed 2026-09-27",
// and every doc hand-cited a seed count that had already drifted.
//
// docs/COMPLETION_CHECKLIST.md is now the single source of truth. This test is
// why it stays one: it fails if the open list re-acquires a closed row, if a
// hand-cited number disagrees with what gen-context computes, or if an absorbed
// doc starts behaving like a status source again.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CHECKLIST = path.join(ROOT, 'docs', 'COMPLETION_CHECKLIST.md');
const ABSORBED = ['docs/OPEN_RESIDUALS.md', 'docs/PRODUCT_GAPS.md', 'docs/ULTRAPLAN.md', 'docs/RELEASE_RUNBOOK_ZERO_COST.md'];

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Strip comments so a guard never matches the prose explaining itself - the
// fourth time today that has bitten.
const codeLines = (s) => s
  .split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\/\*|\*|<!--)/.test(l));

test('the consolidated checklist exists and is the declared source of truth', () => {
  assert.ok(fs.existsSync(CHECKLIST), 'docs/COMPLETION_CHECKLIST.md must exist');
  const doc = read('docs/COMPLETION_CHECKLIST.md');
  assert.match(doc, /single source of truth/i);
  for (const absorbed of ABSORBED) {
    assert.ok(doc.includes(absorbed), `the checklist must name ${absorbed} as absorbed`);
  }
});

test('each absorbed doc points at the checklist instead of acting as a status source', () => {
  for (const absorbed of ABSORBED) {
    const body = read(absorbed);
    assert.match(
      body,
      /COMPLETION_CHECKLIST\.md/,
      `${absorbed} must point readers at the single checklist; a doc that silently keeps its own "still open" table is how this rotted`
    );
  }
});

test('the open work list contains no row that claims to be closed', () => {
  // The specific rot: rows filed under Still open whose status column said
  // Closed 2026-09-27. In the open table, a row must not carry that.
  const doc = read('docs/COMPLETION_CHECKLIST.md');
  const start = doc.indexOf('## Open work, in dependency order');
  assert.ok(start > -1, 'the open-work section must exist');
  const end = doc.indexOf('## Blocked outside this repo');
  const openTable = doc.slice(start, end === -1 ? undefined : end)
    .split(/\r?\n/)
    .filter((l) => /^\|\s*\d+\s*\|/.test(l));
  assert.ok(openTable.length > 0, 'the open table must have rows');
  for (const row of openTable) {
    assert.doesNotMatch(
      row,
      /\bClosed\b/i,
      `an open row claims to be closed: ${row.slice(0, 110)}`
    );
  }
});

test('the hand-cited seed count matches what gen-context computes', () => {
  const { computeFacts } = require('../scripts/gen-context');
  const facts = computeFacts();
  const doc = read('docs/COMPLETION_CHECKLIST.md');
  const cited = [...doc.matchAll(/\|\s*Seed listings[^|]*\|\s*\*\*(\d+)\*\*\s*\|/g)].map((m) => Number(m[1]));
  assert.ok(cited.length > 0, 'the checklist must cite the seed count');
  for (const n of cited) {
    assert.equal(
      n,
      facts.seedListingCount,
      `the checklist says ${n} seed listings; gen-context computes ${facts.seedListingCount}. Do not hand-cite a drifting number - transcribe it.`
    );
  }
});

test('the checklist declares the source limits as policy, not backlog', () => {
  // These are the three the owner called out explicitly. If one is promoted to
  // a backlog row, that is a policy regression being tracked as work.
  const doc = read('docs/COMPLETION_CHECKLIST.md');
  for (const source of ['gsa', 'irs', 'hud']) {
    assert.ok(doc.includes(`\`${source}\``), `the checklist must name ${source} as a source limit`);
  }
  assert.match(doc, /robots exclusion/i);
  assert.match(doc, /0 real-estate auction cards|NOT_CLEAN/i);
  assert.match(doc, /nationwide.*not promoted/i);
});

test('the checklist keeps one "do not do" list and the owner constraints survive', () => {
  const doc = read('docs/COMPLETION_CHECKLIST.md');
  const doNotDo = doc.slice(doc.indexOf('## Do not do'));
  assert.ok(doNotDo.length > 0, 'the do-not-do section must exist');

  // The four rules that were duplicated across every source doc, all of which
  // were load-bearing rather than stylistic.
  assert.match(doNotDo, /Do not promote `gsa`/);
  assert.match(doNotDo, /green unit gate/);
  assert.match(doNotDo, /hand-cite counts/);
  assert.match(doNotDo, /second status document/i);

  // The constraints restated by the owner. Backticks around the term are fine;
  // requiring adjacency would only test my own punctuation.
  assert.match(doc, /continue-on-error`?\s*is not release evidence/i);
  assert.match(doc, /do not weaken auth/i);
  assert.match(doc, /do not expose a production key/i);
});

test('a second status document is not quietly created alongside this one', () => {
  // The failure mode was four parallel sources; a fifth would be the same bug.
  const candidates = fs.readdirSync(path.join(ROOT, 'docs'))
    .filter((n) => /^(OPEN|TODO|BACKLOG|ULTRAPLAN|PLAN|RESIDUAL|GAPS)/i.test(n));
  for (const name of candidates) {
    const rel = `docs/${name}`;
    if (ABSORBED.includes(rel)) continue;
    const body = read(rel);
    assert.match(
      body,
      /COMPLETION_CHECKLIST\.md/,
      `${rel} looks like a second status source; point it at the checklist or fold it in`
    );
  }
});
test('the checklist does not quote prune numbers the ledger does not contain', () => {
  // The ledger in reports/pruned-listings.json is rewritten on every --apply,
  // so any count hard-cited here describes a run that no longer exists. That
  // is how "3,337 removed, 3,202 kept" ended up describing neither the run
  // before it nor the run after it.
  const ledgerPath = path.join(ROOT, 'reports', 'pruned-listings.json');
  assert.ok(fs.existsSync(ledgerPath), 'the prune ledger is missing; inventory state is unrecorded');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const doc = read('docs/COMPLETION_CHECKLIST.md');

  const cited = new Set();
  for (const m of doc.matchAll(/(\d[\d,]*)\s+removed/gi)) cited.add(m[1].replace(/,/g, ''));
  for (const m of doc.matchAll(/(\d[\d,]*)\s+(?:remaining|kept)\b/gi)) cited.add(m[1].replace(/,/g, ''));

  const actual = new Set([String(ledger.removedCount), String(ledger.totalAfter)]);
  for (const number of cited) {
    assert.ok(
      actual.has(number),
      `the checklist cites "${number}" removed/kept, which the current ledger does not contain ` +
      `(ledger: ${ledger.removedCount} removed, ${ledger.totalAfter} remaining). ` +
      'Point at reports/pruned-listings.json instead of restating a run that has been overwritten.'
    );
  }
});
