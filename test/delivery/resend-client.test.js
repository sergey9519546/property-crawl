'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sendDealAlert,
  sendHuntDigest,
  ResendClient,
  buildDealAlertContent,
  buildHuntDigestContent,
  RESEND_API_URL,
} = require('../../server/delivery/resend-client.js');

test('Resend Client: fails closed when RESEND_API_KEY is unset or empty', async () => {
  // Test sendDealAlert with empty/unset API key
  const alertResult = await sendDealAlert({
    to: 'investor@example.com',
    listing: { id: 'TX-101', address: '123 Main St', openingBid: 150000, dealScore: 82 },
    env: { RESEND_API_KEY: '' },
  });
  assert.deepEqual(alertResult, { delivered: false, reason: 'RESEND_API_KEY_UNSET' });

  // Test sendHuntDigest with empty/unset API key
  const digestResult = await sendHuntDigest({
    to: 'investor@example.com',
    huntName: 'Cuyahoga Foreclosures',
    matches: [{ id: 'OH-501', address: '456 Elm St', openingBid: 45000, dealScore: 78 }],
    env: { RESEND_API_KEY: '' },
  });
  assert.deepEqual(digestResult, { delivered: false, reason: 'RESEND_API_KEY_UNSET' });

  // Test ResendClient instance with empty key
  const client = new ResendClient({ apiKey: '' });
  const clientResult = await client.sendDealAlert({
    to: 'investor@example.com',
    listing: { id: 'FL-202' },
  });
  assert.deepEqual(clientResult, { delivered: false, reason: 'RESEND_API_KEY_UNSET' });
});

test('Resend Client: sendDealAlert builds high-contrast HTML email and dispatches successfully', async () => {
  let capturedUrl = null;
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_deal_alert_123' }),
    };
  };

  const sampleListing = {
    id: 'NJ-ESSEX-999',
    address: '742 Evergreen Terrace',
    city: 'Newark',
    county: 'Essex',
    state: 'NJ',
    openingBid: 125000,
    dealScore: 88,
    auctionDate: '2026-11-15',
    propType: 'Single Family',
  };

  const result = await sendDealAlert({
    to: 'target@hedgefund.com',
    listing: sampleListing,
    matchReason: 'Opening bid is 45% below assessed valuation',
    from: 'Alerts <alerts@perfectproperty.org>',
    apiKey: 're_mock_test_key_12345',
    fetchFn: mockFetch,
    appUrl: 'https://app.perfectproperty.org',
  });

  assert.equal(result.delivered, true);
  assert.equal(result.id, 'email_deal_alert_123');

  // Verify fetch payload
  assert.equal(capturedUrl, RESEND_API_URL);
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer re_mock_test_key_12345');
  assert.equal(capturedOptions.headers['Content-Type'], 'application/json');

  const payload = JSON.parse(capturedOptions.body);
  assert.deepEqual(payload.to, ['target@hedgefund.com']);
  assert.equal(payload.from, 'Alerts <alerts@perfectproperty.org>');
  assert.match(payload.subject, /742 Evergreen Terrace/);
  assert.match(payload.subject, /Score: 88\/99/);

  // Verify HTML contents
  assert.match(payload.html, /742 Evergreen Terrace/);
  assert.match(payload.html, /Essex County, Newark, NJ/);
  assert.match(payload.html, /\$125,000/);
  assert.match(payload.html, /88\/99/);
  assert.match(payload.html, /Opening bid is 45% below assessed valuation/);
  assert.match(payload.html, /https:\/\/app\.perfectproperty\.org\/listings\/NJ-ESSEX-999/);

  // Verify text contents
  assert.match(payload.text, /742 Evergreen Terrace/);
  assert.match(payload.text, /\$125,000/);
});

test('Resend Client: sendHuntDigest builds summary table and dispatches successfully', async () => {
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_hunt_digest_456' }),
    };
  };

  const matches = [
    { id: 'FL-01', address: '100 Ocean Dr', county: 'Miami-Dade', state: 'FL', openingBid: 280000, dealScore: 91 },
    { id: 'FL-02', address: '200 Palm Ave', county: 'Broward', state: 'FL', openingBid: 160000, dealScore: 74 },
  ];

  const result = await sendHuntDigest({
    to: 'acquisitions@realestatefund.com',
    huntName: 'South Florida Distress High Score',
    matches,
    apiKey: 're_mock_test_key_digest',
    fetchFn: mockFetch,
    appUrl: 'https://perfectproperty.org',
  });

  assert.equal(result.delivered, true);
  assert.equal(result.id, 'email_hunt_digest_456');

  const payload = JSON.parse(capturedOptions.body);
  assert.deepEqual(payload.to, ['acquisitions@realestatefund.com']);
  assert.match(payload.subject, /2 New Matches for "South Florida Distress High Score"/);
  assert.match(payload.html, /100 Ocean Dr/);
  assert.match(payload.html, /200 Palm Ave/);
  assert.match(payload.html, /\$280,000/);
  assert.match(payload.html, /91\/99/);
  assert.match(payload.text, /100 Ocean Dr/);
  assert.match(payload.text, /200 Palm Ave/);
});

test('Resend Client: handles HTTP error responses from Resend API cleanly', async () => {
  const mockFetchError = async () => ({
    ok: false,
    status: 422,
    json: async () => ({ message: 'The "to" field is invalid or blocked', name: 'validation_error' }),
  });

  const result = await sendDealAlert({
    to: 'invalid-email',
    listing: { id: 'TX-99' },
    apiKey: 're_valid_key',
    fetchFn: mockFetchError,
  });

  assert.equal(result.delivered, false);
  assert.equal(result.reason, 'RESEND_API_ERROR');
  assert.equal(result.status, 422);
  assert.match(result.error, /invalid or blocked/);
});

test('Resend Client: handles network fetch exceptions cleanly', async () => {
  const mockFetchThrow = async () => {
    throw new Error('Connection timeout to api.resend.com');
  };

  const result = await sendDealAlert({
    to: 'buyer@firm.com',
    listing: { id: 'TX-99' },
    apiKey: 're_valid_key',
    fetchFn: mockFetchThrow,
  });

  assert.equal(result.delivered, false);
  assert.equal(result.reason, 'NETWORK_ERROR');
  assert.match(result.error, /Connection timeout/);
});
