'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { prepareListingForPersistence } = require('../../server/db/client');

function storedStatus(status) {
  return prepareListingForPersistence({ id: 'status-probe', status }).status;
}

test('persistence keeps a recorded sale and a finished auction apart', () => {
  for (const sold of ['sold', 'Sold to 3rd Party', 'Auctioned - Sold to 3rd Party']) {
    assert.equal(storedStatus(sold), 'sold', sold);
  }
  for (const closed of ['closed', 'Auction is closed', 'Auctioned - Pending Results', 'Auctioned - Reverted to Beneficiary', 'post-auction', 'post auction', 'postauction']) {
    assert.equal(storedStatus(closed), 'closed', closed);
  }
  for (const unknown of ['foreclosed', 'unsold', '', null, '   ']) {
    assert.equal(storedStatus(unknown), 'unknown', String(unknown));
  }
  assert.equal(storedStatus('pending'), 'pending');
  assert.equal(storedStatus('STAYED_BANKRUPTCY'), 'stayed');
  assert.equal(storedStatus('active'), 'active');
  assert.equal(storedStatus('Purchased - 3rd Party'), 'sold');
  assert.equal(storedStatus('Purchased - Plaintiff'), 'closed');
  assert.equal(storedStatus('Reverted to Plaintiff'), 'closed');
  assert.equal(storedStatus('Dismissed'), 'cancelled');
  assert.equal(storedStatus('Settled'), 'cancelled');
  assert.equal(storedStatus('Bankruptcy'), 'stayed');
  assert.equal(storedStatus('Auction Begins: Nov 23, 2026'), 'scheduled');
  assert.equal(storedStatus('Redeemed'), 'cancelled');
  assert.equal(
    prepareListingForPersistence({ id: 'status-probe-2', status: 'scheduled', lifecycleStatus: 'Redeemed' }).status,
    'cancelled',
  );
  assert.equal(
    prepareListingForPersistence({ id: 'status-probe-3', status: 'unknown', lifecycleStatus: 'Auction Begins: Nov 23, 2026' }).status,
    'scheduled',
  );
  assert.equal(storedStatus('Status: Active'), 'active');
  assert.equal(
    prepareListingForPersistence({ id: 'status-probe-4', status: 'unknown', lifecycleStatus: 'Status: Active' }).status,
    'active',
  );
  assert.equal(storedStatus('WRIT EXPIRED'), 'cancelled');
  assert.equal(storedStatus('Bankuptcy'), 'stayed');
  assert.equal(storedStatus('On Hold'), 'stayed');
  assert.equal(storedStatus('DEFENDANT 1ST 4 WEEK ADJ'), 'adjourned');
  assert.equal(storedStatus('Auction Ends: Nov 24, 2026'), 'active');
  assert.equal(
    prepareListingForPersistence({ id: 'status-probe-5', status: 'scheduled', lifecycleStatus: 'DEFENDANT 1ST 4 WEEK ADJ' }).status,
    'adjourned',
  );
});
