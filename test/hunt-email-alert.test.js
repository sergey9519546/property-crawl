'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { notifyHuntEmail } = require('../server/delivery/webhook-notify');
const hunts = require('../server/intelligence/hunts');

const evaluation = {
  newEvents: [{ id: 'e1', type: 'new_match', address: '1 Main St', sourceUrl: 'https://example.gov/1' }, { id: 'e2', type: 'no_longer_matches' }],
};

test('hunt with notifyEmail queues one email listing only new/changed matches', async () => {
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hunt-mail-'));
  const result = await notifyHuntEmail({ name: 'OH under 60k', notifyEmail: 'a@b.co' }, evaluation, { mail: { outboxDir, env: {} } });
  assert.equal(result.delivery, 'local');
  const [line] = fs.readFileSync(path.join(outboxDir, 'outbox.jsonl'), 'utf8').trim().split('\n');
  const record = JSON.parse(line);
  assert.equal(record.to, 'a@b.co');
  assert.equal(record.subject, 'OH under 60k: 1 change');
  assert.match(record.text, /New match: 1 Main St/);
});

test('no email, baseline run, or no changes skip delivery', async () => {
  assert.equal((await notifyHuntEmail({}, evaluation)).reason, 'no_email');
  assert.equal((await notifyHuntEmail({ notifyEmail: 'a@b.co' }, { baselineCreated: true })).reason, 'baseline');
  assert.equal((await notifyHuntEmail({ notifyEmail: 'a@b.co' }, { newEvents: [] })).reason, 'no_changes');
});

test('hunt validation accepts, clears, and rejects notifyEmail', () => {
  assert.equal(hunts.validateHuntInput({ notifyEmail: ' a@b.co ' }, { partial: true }).value.notifyEmail, 'a@b.co');
  assert.equal(hunts.validateHuntInput({ notifyEmail: '' }, { partial: true }).value.notifyEmail, null);
  assert.equal(hunts.validateHuntInput({ notifyEmail: 'nope' }, { partial: true }).isValid, false);
});
