'use strict';

// Member accounts: one row per email, linked to a Stripe customer, carrying the
// subscription state the Stripe webhook last reported. Postgres when the API is
// connected to one, else a locked JSON file (same write pattern as saved hunts).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ACCOUNT_ID = /^acct_[a-f0-9]{24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
const ENTITLED_STATUSES = new Set(['active', 'trialing']);
const DEFAULT_FILE = path.resolve(__dirname, '../../.cache/accounts.json');

class AccountError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL.test(email)) throw new AccountError('ACCOUNT_EMAIL_INVALID', 'A valid email is required');
  return email;
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const newId = () => `acct_${crypto.randomBytes(12).toString('hex')}`;

function isEntitled(account, now = Date.now()) {
  if (!account || !ENTITLED_STATUSES.has(account.subscriptionStatus)) return false;
  if (!account.currentPeriodEnd) return true;
  return Date.parse(account.currentPeriodEnd) > now;
}

function publicAccount(account, now = Date.now()) {
  if (!account) return null;
  return {
    id: account.id,
    email: account.email,
    stripeCustomerId: account.stripeCustomerId || null,
    subscriptionStatus: account.subscriptionStatus || null,
    currentPeriodEnd: account.currentPeriodEnd || null,
    entitled: isEntitled(account, now),
  };
}

// ---- file backend -------------------------------------------------------

function createFileBackend(filePath = process.env.PROPERTY_ACCOUNTS_PATH || DEFAULT_FILE) {
  const resolved = path.resolve(filePath);
  const load = () => {
    if (!fs.existsSync(resolved)) return { version: 1, accounts: [], loginTokens: [] };
    const store = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    if (store?.version !== 1 || !Array.isArray(store.accounts) || !Array.isArray(store.loginTokens)) {
      throw new Error('Invalid account store; existing data was preserved');
    }
    if (!Array.isArray(store.webhookEvents)) store.webhookEvents = [];
    return store;
  };
  // ponytail: whole-file lock, fine for a beta's account volume; Postgres when it grows.
  const mutate = (fn) => {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    const lockPath = `${resolved}.lock`;
    let lock;
    try { lock = fs.openSync(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new AccountError('ACCOUNT_STORE_BUSY', 'Account store is busy; retry', 503);
      throw error;
    }
    const temporary = `${resolved}.${crypto.randomUUID()}.tmp`;
    try {
      const store = load();
      const value = fn(store);
      store.loginTokens = store.loginTokens.filter((t) => !t.usedAt && Date.parse(t.expiresAt) > Date.now());
      fs.writeFileSync(temporary, JSON.stringify(store), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, resolved);
      return value;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      fs.closeSync(lock);
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    }
  };
  const now = () => new Date().toISOString();
  return {
    kind: 'file',
    async get(id) { return load().accounts.find((a) => a.id === id) || null; },
    async getByCustomer(customerId) { return load().accounts.find((a) => a.stripeCustomerId === customerId) || null; },
    async upsertByEmail(email) {
      return mutate((store) => {
        let account = store.accounts.find((a) => a.email === email);
        if (!account) {
          account = { id: newId(), email, stripeCustomerId: null, subscriptionId: null, subscriptionStatus: null, currentPeriodEnd: null, createdAt: now(), updatedAt: now() };
          store.accounts.push(account);
        }
        return account;
      });
    },
    async update(id, fields) {
      return mutate((store) => {
        const account = store.accounts.find((a) => a.id === id);
        if (!account) return null;
        Object.assign(account, fields, { updatedAt: now() });
        return account;
      });
    },
    async addLoginToken(tokenHash, email, expiresAt) {
      mutate((store) => { store.loginTokens.push({ tokenHash, email, expiresAt, usedAt: null }); });
    },
    async useLoginToken(tokenHash) {
      return mutate((store) => {
        const token = store.loginTokens.find((t) => t.tokenHash === tokenHash);
        if (!token || token.usedAt || Date.parse(token.expiresAt) <= Date.now()) return null;
        token.usedAt = now();
        return token.email;
      });
    },
    async hasWebhookEvent(eventId) {
      if (!eventId) return false;
      const store = load();
      return Array.isArray(store.webhookEvents) && store.webhookEvents.some((e) => e.id === eventId);
    },
    async releaseWebhookEvent(eventId) {
      if (!eventId) return { released: false };
      return mutate((store) => {
        const before = (store.webhookEvents || []).length;
        store.webhookEvents = (store.webhookEvents || []).filter((e) => e.id !== eventId);
        return { released: store.webhookEvents.length < before };
      });
    },
    async recordWebhookEvent(eventId, eventType) {
      if (!eventId) return { duplicate: false };
      return mutate((store) => {
        if (!Array.isArray(store.webhookEvents)) store.webhookEvents = [];
        const existing = store.webhookEvents.find((e) => e.id === eventId);
        if (existing) return { duplicate: true };
        store.webhookEvents.push({ id: eventId, type: eventType || 'unknown', receivedAt: now() });
        if (store.webhookEvents.length > 2000) {
          store.webhookEvents = store.webhookEvents.slice(-2000);
        }
        return { duplicate: false };
      });
    },
  };
}

// ---- postgres backend ---------------------------------------------------

const COLUMNS = `id, email, stripe_customer_id AS "stripeCustomerId", subscription_id AS "subscriptionId",
  subscription_status AS "subscriptionStatus", current_period_end AS "currentPeriodEnd"`;

function createPgBackend(pool) {
  let ready = null;
  // Same DDL as migration 029, so an un-migrated database still works.
  const ensure = () => (ready ||= pool.query(fs.readFileSync(path.resolve(__dirname, '../db/migrations/029_accounts.sql'), 'utf8')).catch((error) => { ready = null; throw error; }));
  const row = (r) => r && { ...r, currentPeriodEnd: r.currentPeriodEnd ? new Date(r.currentPeriodEnd).toISOString() : null };
  const one = async (sql, params) => { await ensure(); return row((await pool.query(sql, params)).rows[0]) || null; };
  const FIELD_COLUMNS = { stripeCustomerId: 'stripe_customer_id', subscriptionId: 'subscription_id', subscriptionStatus: 'subscription_status', currentPeriodEnd: 'current_period_end' };
  return {
    kind: 'postgres',
    get: (id) => one(`SELECT ${COLUMNS} FROM accounts WHERE id=$1`, [id]),
    getByCustomer: (customerId) => one(`SELECT ${COLUMNS} FROM accounts WHERE stripe_customer_id=$1`, [customerId]),
    upsertByEmail: (email) => one(`INSERT INTO accounts(id,email) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING ${COLUMNS}`, [newId(), email]),
    async update(id, fields) {
      const keys = Object.keys(fields).filter((k) => FIELD_COLUMNS[k]);
      if (!keys.length) return this.get(id);
      const sets = keys.map((k, i) => `${FIELD_COLUMNS[k]}=$${i + 2}`).join(',');
      return one(`UPDATE accounts SET ${sets}, updated_at=NOW() WHERE id=$1 RETURNING ${COLUMNS}`, [id, ...keys.map((k) => fields[k])]);
    },
    async addLoginToken(tokenHash, email, expiresAt) {
      await ensure();
      await pool.query('DELETE FROM account_login_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL');
      await pool.query('INSERT INTO account_login_tokens(token_hash,email,expires_at) VALUES($1,$2,$3)', [tokenHash, email, expiresAt]);
    },
    async useLoginToken(tokenHash) {
      await ensure();
      const r = await pool.query('UPDATE account_login_tokens SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW() RETURNING email', [tokenHash]);
      return r.rows[0]?.email || null;
    },
    async hasWebhookEvent(eventId) {
      if (!eventId) return false;
      await ensure();
      const r = await pool.query('SELECT 1 FROM stripe_webhook_events WHERE id=$1', [eventId]);
      return (r.rowCount || 0) > 0;
    },
    async releaseWebhookEvent(eventId) {
      if (!eventId) return { released: false };
      await ensure();
      const r = await pool.query('DELETE FROM stripe_webhook_events WHERE id=$1', [eventId]);
      return { released: (r.rowCount || 0) > 0 };
    },
    async recordWebhookEvent(eventId, eventType) {
      if (!eventId) return { duplicate: false };
      await ensure();
      const r = await pool.query(
        'INSERT INTO stripe_webhook_events(id, event_type) VALUES($1, $2) ON CONFLICT(id) DO NOTHING RETURNING id',
        [eventId, eventType || 'unknown']
      );
      return { duplicate: (r.rowCount || 0) === 0 };
    },
  };
}

// ---- service --------------------------------------------------------------

function createAccountService({ backend, now = () => Date.now() } = {}) {
  return {
    backend,
    async issueLoginToken(rawEmail) {
      const email = normalizeEmail(rawEmail);
      const token = crypto.randomBytes(32).toString('base64url');
      await backend.addLoginToken(hashToken(token), email, new Date(now() + LOGIN_TOKEN_TTL_MS).toISOString());
      return { token, email };
    },
    async consumeLoginToken(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new AccountError('ACCOUNT_LINK_INVALID', 'This sign-in link is invalid or expired', 401);
      const email = await backend.useLoginToken(hashToken(token));
      if (!email) throw new AccountError('ACCOUNT_LINK_INVALID', 'This sign-in link is invalid or expired', 401);
      return publicAccount(await backend.upsertByEmail(email), now());
    },
    async get(id) {
      if (!ACCOUNT_ID.test(id || '')) return null;
      return publicAccount(await backend.get(id), now());
    },
    async linkCustomer(id, customerId) {
      if (!ACCOUNT_ID.test(id || '') || !/^cus_[A-Za-z0-9]+$/.test(customerId || '')) throw new AccountError('ACCOUNT_INVALID', 'Invalid account or customer');
      return publicAccount(await backend.update(id, { stripeCustomerId: customerId }), now());
    },
    // Apply a Stripe subscription state. The account is found by customer id,
    // or by the checkout's client_reference_id the first time.
    async applySubscription({ accountId, customerId, subscriptionId, status, currentPeriodEnd }) {
      if (!/^cus_[A-Za-z0-9]+$/.test(customerId || '')) throw new AccountError('ACCOUNT_INVALID', 'customerId is required');
      let account = await backend.getByCustomer(customerId);
      if (!account && ACCOUNT_ID.test(accountId || '')) account = await backend.get(accountId);
      if (!account) throw new AccountError('ACCOUNT_NOT_FOUND', 'No account for this customer', 404);
      const periodEnd = Number.isFinite(currentPeriodEnd) ? new Date(currentPeriodEnd * 1000).toISOString() : null;
      return publicAccount(await backend.update(account.id, {
        stripeCustomerId: customerId,
        ...(subscriptionId ? { subscriptionId } : {}),
        subscriptionStatus: typeof status === 'string' ? status.slice(0, 40) : null,
        currentPeriodEnd: periodEnd,
      }), now());
    },
    async hasWebhookEvent(eventId) {
      return backend.hasWebhookEvent ? backend.hasWebhookEvent(eventId) : false;
    },
    async releaseWebhookEvent(eventId) {
      return backend.releaseWebhookEvent ? backend.releaseWebhookEvent(eventId) : { released: false };
    },
    async recordWebhookEvent(eventId, eventType) {
      return backend.recordWebhookEvent ? backend.recordWebhookEvent(eventId, eventType) : { duplicate: false };
    },
  };
}

function accountServiceFor(database, options = {}) {
  const backend = database?.isPg && database.pool ? createPgBackend(database.pool) : createFileBackend(options.filePath);
  return createAccountService({ backend, now: options.now });
}

module.exports = {
  ACCOUNT_ID,
  AccountError,
  accountServiceFor,
  createAccountService,
  createFileBackend,
  createPgBackend,
  isEntitled,
  normalizeEmail,
};
