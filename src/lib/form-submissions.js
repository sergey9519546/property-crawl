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

function formatContactNotificationHtml(fields, receivedAt) {
  const safeName = sanitize(fields.name || 'Anonymous User', 100);
  const safeEmail = sanitize(fields.email || 'None Provided', 100);
  const safeMessage = sanitize(fields.message || '', 5000).replace(/\n/g, '<br>');
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #0f172a;">
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
 * @param {{ webhookUrl?: string, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, outboxDir?: string }} [options]
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
    const operatorInbox = isEmail(env.OPERATOR_EMAIL || env.CONTACT_TO || env.RESEND_TO);
    const recipient = kind === 'newsletter' ? isEmail(fields.email) : (operatorInbox || isEmail(fields.email));
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
  formatContactNotificationHtml,
  persistFormSubmission,
  removeNewsletterEmail,
  resetFormSubmissionsForTests,
  sanitize,
  submissionDir,
};
