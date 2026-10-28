'use strict';

// Real-engine coverage for the pieces mock pools cannot prove: the accounts
// Postgres backend, the Stripe webhook idempotency ledger (including two
// simultaneous deliveries), subscription cancellation revoking entitlement, and
// the document_reviews.content_hash round trip.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { startEmbeddedPostgres } = require('../../server/db/pglite-pool');
const { migrate } = require('../../scripts/discovery-migrate');
const { createAccountService, createPgBackend } = require('../../server/accounts/store');
const { createDocumentReviewStore } = require('../../server/intelligence/document-review-store');

const BOOT_TIMEOUT_MS = 120_000;

test('accounts, webhook ledger, cancellation and review hash on a real engine', { timeout: BOOT_TIMEOUT_MS * 2 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-accounts-pg-'));
  const db = await startEmbeddedPostgres({ dataDir });
  try {
    await migrate(db.pool);
    const service = createAccountService({ backend: createPgBackend(db.pool) });

    // Magic link creates the account once and cannot be replayed.
    const { token } = await service.issueLoginToken('Payer@Example.com');
    const account = await service.consumeLoginToken(token);
    assert.equal(account.email, 'payer@example.com');
    await assert.rejects(() => service.consumeLoginToken(token), /invalid or expired/);

    // First checkout event finds the account by client_reference_id; active entitles.
    const future = Math.floor(Date.now() / 1000) + 86400;
    const active = await service.applySubscription({ accountId: account.id, customerId: 'cus_PG1', subscriptionId: 'sub_PG1', status: 'active', currentPeriodEnd: future });
    assert.equal(active.entitled, true);

    // Cancellation revokes entitlement (found by customer id, no accountId needed).
    const canceled = await service.applySubscription({ customerId: 'cus_PG1', status: 'canceled', currentPeriodEnd: future });
    assert.equal(canceled.entitled, false);
    assert.equal((await service.get(account.id)).entitled, false);

    // Ledger: first record wins, repeats are duplicates.
    assert.equal(await service.hasWebhookEvent('evt_pg_1'), false);
    assert.deepEqual(await service.recordWebhookEvent('evt_pg_1', 'customer.subscription.updated'), { duplicate: false });
    assert.equal(await service.hasWebhookEvent('evt_pg_1'), true);
    assert.deepEqual(await service.recordWebhookEvent('evt_pg_1', 'customer.subscription.updated'), { duplicate: true });

    // Two simultaneous deliveries: exactly one claims the event.
    const raced = await Promise.all([
      service.recordWebhookEvent('evt_pg_race', 'x'),
      service.recordWebhookEvent('evt_pg_race', 'x'),
    ]);
    assert.equal(raced.filter((r) => r.duplicate === false).length, 1, 'exactly one concurrent delivery may claim the event');

    // A released claim can be taken again (failed apply -> Stripe retry is processed).
    assert.deepEqual(await service.releaseWebhookEvent('evt_pg_race'), { released: true });
    assert.deepEqual(await service.recordWebhookEvent('evt_pg_race', 'x'), { duplicate: false });

    // Document review keeps its content hash across a persist/reload.
    const hash = 'a'.repeat(64);
    const store = createDocumentReviewStore({ pool: db.pool, storePath: null });
    store.map.set('L1~0', { listingId: 'L1', documentIndex: 0, status: 'approved', reviewer: 'op', revision: 1, contentHash: hash });
    assert.equal(await store.persistAsync(), true);
    const reloaded = createDocumentReviewStore({ pool: db.pool, storePath: null });
    await reloaded.loadPg();
    assert.equal(reloaded.map.get('L1~0').contentHash, hash);
    const column = await db.pool.query("SELECT content_hash FROM document_reviews WHERE id = 'L1~0'");
    assert.equal(column.rows[0].content_hash, hash, 'hash is stored in its own column, not only the JSON payload');
  } finally {
    await db.pool.end();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
