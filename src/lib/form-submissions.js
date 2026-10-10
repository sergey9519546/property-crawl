'use strict';

/**
 * Local durable storage for beta forms.
 * Resend is used when configured. Otherwise a webhook may forward the record.
 * Delivery is sent only after Resend returns 2xx, and forwarded only after a webhook returns 2xx.
 */

const fs = require('node:fs');
const path = require('node:path');
const { isEmail, mailIsConfigured, sendOutboundMail } = require('../../server/delivery/outbound-mail');

const DEFAULT_DIR = path.resolve(process.cwd(), '.cache/form-submissions');

function submissionDir() {
  return process.env.PROPERTY_FORM_SUBMISSIONS_DIR
    ? path.resolve(process.env.PROPERTY_FORM_SUBMISSIONS_DIR)
    : DEFAULT_DIR;
}

function sanitize(value, max) {
  return String(value ?? '').replace(/\r/g, '').trim().slice(0, max);
}

function appendJsonl(kind, payload) {
  const dir = submissionDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${kind}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, 'utf8');
  return file;
}

async function forwardWebhook(url, payload) {
  if (!url) return { forwarded: false, reason: 'no-endpoint' };
  try {
    const response = await fetch(url, {
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
 * @param {{ webhookUrl?: string }} [options]
 */
async function persistFormSubmission(kind, fields, options = {}) {
  const receivedAt = new Date().toISOString();
  const record = { kind, receivedAt, ...fields };
  let storedPath = null;
  let storeError = null;
  try {
    storedPath = appendJsonl(kind, record);
  } catch (error) {
    // Containers without a writable cache must not 500 marketing forms.
    storeError = String(error?.message || error || 'store-failed');
  }
  const env = options.env || process.env;
  let forward = { forwarded: false, reason: 'no-endpoint' };
  let mail = null;
  if (mailIsConfigured(env)) {
    const operatorInbox = isEmail(env.CONTACT_TO || env.RESEND_TO);
    const recipient = kind === 'newsletter' ? isEmail(fields.email) : (operatorInbox || isEmail(fields.email));
    const subject = kind === 'newsletter' ? 'PerfectProperty list' : 'Contact form stored';
    const text = kind === 'newsletter'
      ? 'This address was saved for the operator list. This note is the delivery receipt.'
      : `A contact message was stored for the operator.\nFrom: ${fields.name || ''}\nEmail: ${fields.email || ''}\n\n${fields.message || ''}`;
    if (recipient) {
      mail = await sendOutboundMail({ to: recipient, subject, text, kind }, { env, fetchImpl: options.fetchImpl, outboxDir: options.outboxDir });
    }
  } else {
    const webhookUrl = options.webhookUrl
      || (kind === 'newsletter'
        ? env.NEWSLETTER_ENDPOINT || env.NEWSLETTER_WEBHOOK_URL || ''
        : env.CONTACT_ENDPOINT || env.CONTACT_WEBHOOK_URL || '');
    forward = await forwardWebhook(webhookUrl, record);
  }
  const delivery = mail?.delivery === 'sent'
    ? 'sent'
    : forward.forwarded
      ? 'forwarded'
      : storedPath || mail?.delivery === 'local'
        ? 'local'
        : 'unavailable';
  return {
    ok: Boolean(storedPath) || forward.forwarded || mail?.sent === true,
    kind,
    receivedAt,
    storedPath,
    storeError,
    delivery,
    forward,
    mail,
  };
}

function removeNewsletterEmail(email) {
  const normalized = isEmail(email);
  if (!normalized) return { removed: 0 };
  const file = path.join(submissionDir(), 'newsletter.jsonl');
  if (!fs.existsSync(file)) return { removed: 0 };
  const lines = fs.readFileSync(file, 'utf8').split(/\n/).filter((line) => line.length > 0);
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
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, kept.length ? `${kept.join('\n')}\n` : '', 'utf8');
  fs.renameSync(temporary, file);
  return { removed };
}

function resetFormSubmissionsForTests(kind) {
  const dir = submissionDir();
  const file = path.join(dir, `${kind}.jsonl`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = {
  DEFAULT_DIR,
  appendJsonl,
  persistFormSubmission,
  removeNewsletterEmail,
  resetFormSubmissionsForTests,
  sanitize,
  submissionDir,
};
