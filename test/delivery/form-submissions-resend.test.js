'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  persistFormSubmission,
  formatContactNotificationHtml,
} = require('../../src/lib/form-submissions');

test('Form Inbound Delivery: formats safe HTML notification with sanitized inputs', () => {
  const fields = {
    name: 'Jane Doe <script>alert(1)</script>',
    email: 'jane@example.com',
    message: 'Interested in your enterprise beta.\nPlease contact me.',
  };
  const html = formatContactNotificationHtml(fields, '2026-10-20T20:00:00.000Z');

  assert.ok(html.includes('Jane Doe <script>alert(1)</script>')); // sanitized string slice
  assert.ok(html.includes('jane@example.com'));
  assert.ok(html.includes('Interested in your enterprise beta.<br>Please contact me.'));
  assert.ok(html.includes('New Inbound Contact Inquiry'));
});

test('Form Inbound Delivery: delivers contact inquiry to operator inbox when Resend configured', async () => {
  const tmpOutbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-outbox-'));
  const testEnv = {
    RESEND_API_KEY: 're_test_key_1234567890',
    RESEND_FROM: 'alerts@perfectproperty.app',
    OPERATOR_EMAIL: 'operator@perfectproperty.app',
  };

  let dispatchedRequest = null;
  const mockFetch = async (url, options) => {
    dispatchedRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'msg_resend_test_123' }),
    };
  };

  const fields = {
    name: 'Bob Underwriter',
    email: 'bob@investments.com',
    message: 'We underwrite 50 dockets/week in Ohio and need API access.',
  };

  const result = await persistFormSubmission('contact', fields, {
    env: testEnv,
    fetchImpl: mockFetch,
    outboxDir: tmpOutbox,
  });

  assert.equal(result.ok, true);
  assert.equal(result.delivery, 'sent');
  assert.ok(dispatchedRequest);
  assert.equal(dispatchedRequest.body.to[0], 'operator@perfectproperty.app');
  assert.equal(dispatchedRequest.body.from, 'alerts@perfectproperty.app');
  assert.ok(dispatchedRequest.body.subject.includes('Bob Underwriter'));
  assert.ok(dispatchedRequest.body.html.includes('bob@investments.com'));
  assert.ok(dispatchedRequest.body.html.includes('Ohio'));

  fs.rmSync(tmpOutbox, { recursive: true, force: true });
});

test('Form Inbound Delivery: falls back cleanly to local JSONL when unconfigured', async () => {
  const testEnv = {}; // No RESEND_API_KEY

  const fields = {
    name: 'Local Lead',
    email: 'local@example.com',
    message: 'Testing local persistence when mail is unconfigured.',
  };

  const result = await persistFormSubmission('contact', fields, {
    env: testEnv,
  });

  assert.equal(result.ok, true);
  assert.equal(result.delivery, 'local');
  assert.ok(result.storedPath);
  assert.ok(fs.existsSync(result.storedPath));
});
