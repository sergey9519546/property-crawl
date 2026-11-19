'use strict';

/**
 * Local durable storage for beta forms.
 * Resend is used when configured. Otherwise a webhook may forward the record.
 * Delivery is sent only after Resend returns 2xx, and forwarded only after a webhook returns 2xx.
 */

const fs = require('node:fs');
const path = require('node:path');
const { isEmail, mailIsConfigured, sendOutboundMail } = require('../../server/delivery/outbound-mail');

const SecuritySanitizer = require('../../server/security/sanitizer');

const pgPools = new Map();

function getPgPool(databaseUrl) {
  if (!databaseUrl) return null;
  if (!pgPools.has(databaseUrl)) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => {
      console.error('[form-submissions] Idle PostgreSQL client error:', err?.message || err);
    });
    pgPools.set(databaseUrl, pool);
  }
  return pgPools.get(databaseUrl);
}

function shouldUsePostgres(env = process.env, options = {}) {
  if (env.PROPERTY_INVENTORY_BACKEND === 'memory') return false;
  return Boolean(options.pgPool || String(env.DATABASE_URL || '').trim());
}

function allowLocalFallback(env = process.env) {
  return env.NODE_ENV === 'test'
    || env.PROPERTY_INVENTORY_BACKEND === 'memory'
    || (env.NODE_ENV !== 'production' && !String(env.DATABASE_URL || '').trim());
}

async function persistFormSubmissionPg(pool, kind, fields, receivedAt) {
  const name = fields.name != null ? sanitize(fields.name, 200) : null;
  const email = fields.email != null ? sanitize(fields.email, 320).toLowerCase() : null;
  const company = fields.company != null ? sanitize(fields.company, 200) : null;
  const message = fields.message != null ? sanitize(fields.message, 5000) : null;
  await pool.query(
    `INSERT INTO form_submissions (kind, name, email, company, message, payload, received_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)`,
    [kind, name, email, company, message, JSON.stringify({ kind, receivedAt, ...fields }), receivedAt],
  );
  if (kind === 'newsletter') {
    const validEmail = isEmail(email);
    if (validEmail) {
      await pool.query(
        `INSERT INTO newsletter_subscribers (email, subscribed_at, updated_at)
         VALUES ($1, $2::timestamptz, $2::timestamptz)
         ON CONFLICT (email) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
        [validEmail, receivedAt],
      );
    }
  }
}
const DEFAULT_DIR = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SERVERLESS)
  ? path.join(require('node:os').tmpdir(), 'property-crawl-cache', 'form-submissions')
  : path.resolve(process.cwd(), '.cache/form-submissions');

function submissionDir() {
  return process.env.PROPERTY_FORM_SUBMISSIONS_DIR
    ? path.resolve(process.env.PROPERTY_FORM_SUBMISSIONS_DIR)
    : DEFAULT_DIR;
}

function sanitize(value, max) {
  return String(value ?? '').replace(/\r/g, '').trim().slice(0, max);
}

function formatContactNotificationHtml(fields, receivedAt) {
  const safeName = SecuritySanitizer.escapeHtml(sanitize(fields.name || 'Anonymous User', 100));
  const safeEmail = SecuritySanitizer.escapeHtml(sanitize(fields.email || 'None Provided', 100));
  const safeMessage = SecuritySanitizer.escapeHtml(sanitize(fields.message || '', 5000)).replace(/\n/g, '<br>');
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #0f172a;">
      <h2 style="font-size: 18px; font-weight: 700; margin-bottom: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 8px;">
        📬 New Inbound Contact Inquiry
      </h2>
      <p style="font-size: 13px; color: #64748b; margin-bottom: 16px;">
        Received at: <strong>${receivedAt}</strong>
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; color: #475569; width: 100px;"><strong>Name:</strong></td>
          <td style="padding: 8px 0; color: #0f172a;">${safeName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #475569;"><strong>Email:</strong></td>
          <td style="padding: 8px 0; color: #0f172a;"><a href="mailto:${safeEmail}" style="color: #2563eb;">${safeEmail}</a></td>
        </tr>
      </table>
      <div style="background-color: #f8fafc; border-left: 4px solid #0f172a; padding: 16px; border-radius: 4px; font-size: 14px; line-height: 1.6; color: #334155;">
        ${safeMessage}
      </div>
      <p style="margin-top: 24px; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 12px;">
        PerfectProperty Inbound Alert System • Secure Zero-Cost Production Tier
      </p>
    </div>
  `;
}

function appendJsonl(kind, payload) {
  const dir = submissionDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${kind}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, 'utf8');
  return file;
}

async function forwardWebhook(url, payload, fetchImpl = fetch) {
  if (!url) return { forwarded: false, reason: 'no-endpoint' };
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    return {
      forwarded: response.ok,
      status: response.status,
      reason: response.ok ? 'ok' : `http-${response.status}`,
    };
  } catch (error) {
    return { forwarded: false, reason: String(error?.message || error || 'forward-failed') };
  }
}

/**
 * @param {'contact'|'newsletter'} kind
 * @param {Record<string, unknown>} fields
 * @param {{ webhookUrl?: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, outboxDir?: string }} [options]
 */
async function persistFormSubmission(kind, fields, options = {}) {
  const env = options.env || process.env;
  const receivedAt = new Date().toISOString();
  const record = { kind, receivedAt, ...fields };
  let storedPath = null;
  let storedPg = false;
  let storeError = null;
  if (shouldUsePostgres(env, options)) {
    try {
      const pool = options.pgPool || getPgPool(String(env.DATABASE_URL || '').trim());
      await persistFormSubmissionPg(pool, kind, fields, receivedAt);
      storedPg = true;
    } catch (error) {
      storeError = String(error?.message || error || 'pg-store-failed');
    }
  } else if (allowLocalFallback(env)) {
    try {
      storedPath = appendJsonl(kind, record);
    } catch (error) {
      // Containers without a writable cache must not 500 marketing forms.
      storeError = String(error?.message || error || 'store-failed');
    }
  } else {
    storeError = 'DATABASE_URL_UNSET';
  }
  let forward = { forwarded: false, reason: 'no-endpoint' };
  let mail = null;
  const webhookUrl = options.webhookUrl
    || (kind === 'newsletter'
      ? env.NEWSLETTER_ENDPOINT || env.NEWSLETTER_WEBHOOK_URL || ''
      : env.CONTACT_ENDPOINT || env.CONTACT_WEBHOOK_URL || '');
  if (mailIsConfigured(env)) {
    const operatorInbox = isEmail(env.OPERATOR_EMAIL || env.CONTACT_TO || env.RESEND_TO);
    const recipient = kind === 'newsletter' ? isEmail(fields.email) : operatorInbox;
    const subject = kind === 'newsletter'
      ? 'PerfectProperty list subscription'
      : `New Inbound Contact Inquiry: ${fields.name || 'Anonymous'}`;
    const text = kind === 'newsletter'
      ? 'This address was saved for the operator list. This note is the delivery receipt.'
      : `A contact message was stored for the operator.\nFrom: ${fields.name || ''}\nEmail: ${fields.email || ''}\n\n${fields.message || ''}`;
    const html = kind === 'contact' ? formatContactNotificationHtml(fields, receivedAt) : null;
    if (recipient) {
      mail = await sendOutboundMail(
        { to: recipient, subject, text, html, kind },
        { env, fetchImpl: options.fetchImpl, outboxDir: options.outboxDir }
      );
    }
  }
  forward = await forwardWebhook(webhookUrl, record, options.fetchImpl);
  const delivery = mail?.delivery === 'sent'
    ? 'sent'
    : forward.forwarded
      ? 'forwarded'
      : storedPg
        ? 'postgres'
        : storedPath || mail?.delivery === 'local'
          ? 'local'
          : 'unavailable';
  return {
    ok: Boolean(storedPath || storedPg) || forward.forwarded || mail?.sent === true,
    kind,
    receivedAt,
    storedPath,
    storedPg,
    storeError,
    delivery,
    forward,
    mail,
  };
}

function removeNewsletterEmail(email, options = {}) {
  const normalized = isEmail(email);
  if (!normalized) return { removed: 0 };
  const env = options.env || process.env;
  if (shouldUsePostgres(env, options)) {
    const pool = options.pgPool || getPgPool(String(env.DATABASE_URL || '').trim());
    return pool.query('DELETE FROM newsletter_subscribers WHERE email = $1', [normalized])
      .then((res) => ({ removed: res?.rowCount || 0 }));
  }
  const file = path.join(submissionDir(), 'newsletter.jsonl');
  if (!fs.existsSync(file)) return { removed: 0 };
  const lockPath = `${file}.lock`;
  const acquireLock = () => fs.openSync(lockPath, 'wx', 0o600);
  let lock;
  try {
    lock = acquireLock();
  } catch (error) {
    if (error.code === 'EEXIST') {
      const staleLockMs = typeof options.staleLockMs === 'number' ? options.staleLockMs : 30_000;
      let stale = false;
      try { stale = Date.now() - fs.statSync(lockPath).mtimeMs > staleLockMs; } catch (_) {}
      if (stale) {
        try { fs.unlinkSync(lockPath); } catch (_) {}
        try { lock = acquireLock(); } catch (_) {}
      }
      if (lock === undefined) throw error;
    } else {
      throw error;
    }
  }
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    const lines = fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').split(/\n/).filter((line) => line.length > 0)
      : [];
    const kept = [];
    let removed = 0;
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (isEmail(row.email) === normalized) {
          removed += 1;
          continue;
        }
      } catch {
        // Keep a line that is not a newsletter record.
      }
      kept.push(line);
    }
    fs.writeFileSync(temporary, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
    fs.renameSync(temporary, file);
    return { removed };
  } finally {
    if (fs.existsSync(temporary)) {
      try { fs.unlinkSync(temporary); } catch (_) {}
    }
    if (lock !== undefined) fs.closeSync(lock);
    if (fs.existsSync(lockPath)) {
      try { fs.unlinkSync(lockPath); } catch (_) {}
    }
  }
}

function resetFormSubmissionsForTests(kind) {
  const dir = submissionDir();
  const file = path.join(dir, `${kind}.jsonl`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = {
  DEFAULT_DIR,
  appendJsonl,
  formatContactNotificationHtml,
  persistFormSubmission,
  removeNewsletterEmail,
  resetFormSubmissionsForTests,
  sanitize,
  submissionDir,
};
