'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sendOutboundMail, mailIsConfigured } = require('../server/delivery/outbound-mail');

test('outbound mail queues locally when Resend is not configured', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-mail-'));
  const result = await sendOutboundMail(
    { to: 'reader@example.com', subject: 'Saved locally', text: 'Not sent.', kind: 'newsletter' },
    { outboxDir: dir, env: {} },
  );
  assert.equal(result.sent, false);
  assert.equal(result.delivery, 'local');
  const lines = fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8').trim().split('\n');
  assert.equal(JSON.parse(lines[0]).to, 'reader@example.com');
  assert.equal(mailIsConfigured({}), false);
});

test('outbound mail reports sent only after Resend accepts the request', async () => {
  const calls = [];
  const result = await sendOutboundMail(
    { to: 'reader@example.com', subject: 'Receipt', text: 'Stored.', kind: 'newsletter' },
    {
      env: { RESEND_API_KEY: 're_test', RESEND_FROM: 'ops@example.com' },
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ id: 'email_1' }) };
      },
    },
  );
  assert.equal(result.delivery, 'sent');
  assert.equal(result.sent, true);
  assert.equal(result.id, 'email_1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.match(calls[0].init.headers.Authorization, /^Bearer re_test$/);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.from, 'ops@example.com');
  assert.deepEqual(payload.to, ['reader@example.com']);
});

test('a rejected Resend response is not reported as sent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-mail-'));
  const result = await sendOutboundMail(
    { to: 'reader@example.com', subject: 'Receipt', text: 'Stored.', kind: 'contact' },
    {
      outboxDir: dir,
      env: { RESEND_API_KEY: 're_test', RESEND_FROM: 'ops@example.com' },
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }),
    },
  );
  assert.equal(result.sent, false);
  assert.equal(result.delivery, 'local');
  assert.match(fs.readFileSync(path.join(dir, 'outbox.jsonl'), 'utf8'), /403/);
});
