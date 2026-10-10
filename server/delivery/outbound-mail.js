'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mailConfig(env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.RESEND_FROM || '').trim();
  return {
    configured: Boolean(apiKey && from && EMAIL.test(from)),
    apiKey,
    from,
  };
}

function mailIsConfigured(env = process.env) {
  return mailConfig(env).configured;
}

function isEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 320 && EMAIL.test(email) ? email : null;
}

function outboxFile(options = {}, env = process.env) {
  if (options.outboxDir) return path.join(path.resolve(options.outboxDir), 'outbox.jsonl');
  if (env.PROPERTY_MAIL_OUTBOX_DIR) return path.join(path.resolve(env.PROPERTY_MAIL_OUTBOX_DIR), 'outbox.jsonl');
  return path.resolve(process.cwd(), '.cache/mail-outbox/outbox.jsonl');
}

function appendOutbox(record, options = {}, env = process.env) {
  const file = outboxFile(options, env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  return file;
}

/**
 * Send one message through Resend when both secrets are set.
 * Otherwise append the message to the local outbox and report delivery local.
 * Never reports sent unless Resend returns 2xx.
 */
async function sendOutboundMail({ to, subject, text, html, kind }, options = {}) {
  const env = options.env || process.env;
  const recipient = isEmail(to);
  const safeSubject = String(subject || '').replace(/\r|\n/g, ' ').trim().slice(0, 200);
  const safeText = String(text || '').slice(0, 20_000);
  if (!recipient || !safeSubject || !safeText) {
    return { delivery: 'unavailable', sent: false, reason: 'invalid-message' };
  }
  const record = { kind: kind || 'outbound', to: recipient, subject: safeSubject, text: safeText, queuedAt: new Date().toISOString() };
  const cfg = mailConfig(env);
  if (!cfg.configured) {
    try {
      appendOutbox(record, options, env);
      return { delivery: 'local', sent: false, reason: 'not-configured' };
    } catch (error) {
      return { delivery: 'unavailable', sent: false, reason: String(error?.message || error || 'outbox-failed') };
    }
  }
  const fetchImpl = options.fetchImpl || fetch;
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: [recipient],
        subject: safeSubject,
        text: safeText,
        ...(html ? { html: String(html).slice(0, 40_000) } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      appendOutbox({ ...record, resendStatus: response.status }, options, env);
      return { delivery: 'local', sent: false, reason: `http-${response.status}` };
    }
    const body = await response.json().catch(() => ({}));
    return { delivery: 'sent', sent: true, id: body.id || null };
  } catch (error) {
    try { appendOutbox({ ...record, error: String(error?.message || error || 'request-failed') }, options, env); } catch { /* keep the failure */ }
    return { delivery: 'local', sent: false, reason: 'request-failed' };
  }
}

module.exports = {
  appendOutbox,
  isEmail,
  mailConfig,
  mailIsConfigured,
  sendOutboundMail,
};
