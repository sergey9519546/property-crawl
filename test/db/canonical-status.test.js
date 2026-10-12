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
});
