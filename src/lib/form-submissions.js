'use strict';

/**
 * Local durable storage + optional webhook forwarding for beta forms.
 * Delivery is never claimed unless a webhook endpoint is configured.
 */

const fs = require('node:fs');
const path = require('node:path');

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
  const storedPath = appendJsonl(kind, record);
  const webhookUrl = options.webhookUrl
    || (kind === 'newsletter'
      ? process.env.NEWSLETTER_ENDPOINT || process.env.NEWSLETTER_WEBHOOK_URL || ''
      : process.env.CONTACT_ENDPOINT || process.env.CONTACT_WEBHOOK_URL || '');
  const forward = await forwardWebhook(webhookUrl, record);
  return {
    ok: true,
    kind,
    receivedAt,
    storedPath,
    delivery: forward.forwarded ? 'forwarded' : 'local',
    forward,
  };
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
  resetFormSubmissionsForTests,
  sanitize,
  submissionDir,
};
