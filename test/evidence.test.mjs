// Evidence ink rules (src/lib/evidence.ts): a missing value is always a gap,
// never a quiet blank, and the gap list never invents a contact.
import assert from 'node:assert/strict';
import test from 'node:test';
import { factText, findGaps, listingFactOrigin, restoreChecklistStatuses } from '../src/lib/evidence.ts';

test('factText treats empty, placeholder and non-positive money as unknown', () => {
  assert.equal(factText(null, 'money'), null);
  assert.equal(factText('', 'money'), null);
  assert.equal(factText(0, 'money'), null);
  assert.equal(factText(126000, 'money'), '$126,000');
  assert.equal(factText('—'), null);
  assert.equal(factText('Unknown'), null);
  assert.equal(factText('Not published'), null);
  assert.equal(factText('Occupied'), 'Occupied');
  assert.equal(factText('2026-10-27', 'date'), 'Oct 27, 2026');
  // An unparseable "date" goes through the text sentinels, so "TBD" stays a gap.
  assert.equal(factText('TBD', 'date'), null);
  assert.equal(factText('Not published', 'date'), null);
  assert.equal(factText('First Tuesday', 'date'), null);
  assert.equal(factText('not-a-real-date', 'date'), null);
  assert.equal(factText('2026-02-30', 'date'), null);
  assert.equal(findGaps({ id: 'x', saleDate: 'TBD', deposit: 'TBD' }).some((g) => g.key === 'saleDate'), true);
});

test('findGaps lists every empty fact, in the fixed priority order', () => {
  const gaps = findGaps({ id: 'x', seniorLienRisk: 'unknown' });
  assert.deepEqual(gaps.map((g) => g.key), ['occupancy', 'liens', 'deposit', 'redemption', 'openingBid', 'saleDate']);
});

test('findGaps drops facts the listing publishes', () => {
  const gaps = findGaps({
    id: 'x', occupancy: 'Vacant', seniorLienRisk: 'low', deposit: '10% certified funds',
    redemptionDays: 0, openingBid: 50000, saleDate: '2026-11-02',
  });
  assert.deepEqual(gaps.map(g => g.key), ['liens']);
});

test('findGaps links only the real notice, never an invented contact', () => {
  const withNotice = findGaps({ id: 'x', sourceUrl: 'https://example.gov/notice/1' });
  assert.equal(withNotice.find((g) => g.key === 'deposit').action.href, 'https://example.gov/notice/1');
  const without = findGaps({ id: 'x' });
  for (const gap of without) assert.doesNotMatch(gap.action.href, /^tel:|^mailto:/);
  assert.equal(without.find((g) => g.key === 'deposit').action.external, undefined);
});

test('pattern flags never close a lien research gap and provenance must be explicit', () => {
  for (const seniorLienRisk of ['low', 'high', 'critical', 'unknown']) assert.ok(findGaps({ id:'x', seniorLienRisk }).some(g=>g.key==='liens'));
  assert.equal(listingFactOrigin({}, 'openingBid'), 'unverified');
  assert.equal(listingFactOrigin({provenance:{origin:'live',observed:true}}, 'openingBid'), 'printed');
  assert.equal(listingFactOrigin({provenance:{origin:'live',observed:true,derivedFields:{openingBid:{model:'x'}}}}, 'openingBid'), 'unverified');
  assert.equal(listingFactOrigin({provenance:{origin:'snapshot',observed:true}}, 'openingBid'), 'unverified');
});

test('checklist storage rejects foreign IDs, malformed shapes and invalid statuses', () => {
  const defaults={a:'pending',b:'flagged'};
  for(const raw of ['broken','null','[]','42']) assert.deepEqual(restoreChecklistStatuses(raw,defaults),defaults);
  assert.deepEqual(restoreChecklistStatuses('{"a":"verified","b":"anything","foreign":"verified"}',defaults),{a:'verified',b:'flagged'});
  assert.deepEqual(restoreChecklistStatuses(null,{c:'pending'}),{c:'pending'});
});
