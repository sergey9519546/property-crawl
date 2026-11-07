'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const { isPrivateOrLocalHost } = require('../scrapers/scrapling-bridge');

const MAX_CHANGES = 20;
const DEFAULT_TIMEOUT_MS = 5000;

function webhookTargetError(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return 'invalid_url';
  }
  if (url.protocol !== 'https:') return 'https_required';
  if (url.username || url.password) return 'credentials_not_allowed';
  if (url.port && url.port !== '443') return 'port_not_allowed';
  const host = url.hostname.toLowerCase();
  if (
    host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.localhost')
    || isPrivateOrLocalHost(host)
  ) return 'private_host';
  return null;
}

/**
 * Resolve DNS exactly once and validate every resolved address before any
 * socket is opened. The resolved records are returned so the transport can
 * pin them: resolving again at connect time would reopen the DNS-rebinding
 * TOCTOU this pre-check exists to close.
 */
async function resolveAndValidate(hostname, lookup) {
  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { reason: 'dns_failed', records: null };
  }
  if (!Array.isArray(records) || records.length === 0) return { reason: 'dns_failed', records: null };
  for (const record of records) {
    if (isPrivateOrLocalHost(record?.address)) return { reason: 'private_resolution', records: null };
  }
  return { reason: null, records };
}

async function resolutionError(hostname, lookup) {
  return (await resolveAndValidate(hostname, lookup)).reason;
}

/**
 * Connect only to the pinned records that passed the resolution pre-check.
 * The node:http/node:https lookup option hands the stack exactly those
 * addresses, so a rebinded answer can never be dialed. The original Host
 * header and TLS servername/SNI are preserved from the publisher URL, and
 * the response is wrapped into a fetch-like shape the caller already knows.
 */
function pinnedFetch(url, records, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const requestOptions = {
      hostname: url.hostname,
      port: Number(url.port) || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { ...(headers ?? {}), host: url.hostname },
      agent: false,
      lookup: (_hostname, _options, callback) => {
        callback(null, records.map((record) => ({ address: record.address, family: record.family })));
      },
    };
    if (isHttps) requestOptions.servername = url.hostname;

    let settled = false;
    const req = (isHttps ? https : http).request(requestOptions, (res) => {
      const responseHeaders = {};
      for (const [key, value] of Object.entries(res.headers ?? {})) {
        responseHeaders[String(key).toLowerCase()] = value;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({
          status: res.statusCode ?? 0,
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          url: url.href,
          headers: {
            get: (name) => responseHeaders[String(name).toLowerCase()],
          },
          text: () => Promise.resolve(Buffer.concat(chunks).toString('utf8')),
        });
      });
      res.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    });

    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    if (signal) {
      const onAbort = () => {
        const abortError = new Error('The operation was aborted.');
        abortError.name = 'AbortError';
        req.destroy(abortError);
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    req.end(body);
  });
}

async function postWebhook(rawUrl, body, options = {}) {
  const reason = webhookTargetError(rawUrl);
  if (reason) return { delivery: 'refused', sent: false, reason };
  const url = new URL(String(rawUrl).trim());
  const lookup = options.lookup || dns.lookup;
  const { reason: resolutionReason, records } = await resolveAndValidate(url.hostname, lookup);
  if (resolutionReason === 'dns_failed') return { delivery: 'unavailable', sent: false, reason: resolutionReason };
  if (resolutionReason) return { delivery: 'refused', sent: false, reason: resolutionReason };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await pinnedFetch(url, records, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      return { delivery: 'refused', sent: false, reason: 'redirect_refused', status: response.status };
    }
    if (response.status >= 200 && response.status < 300) {
      return { delivery: 'sent', sent: true, status: response.status };
    }
    return { delivery: 'unavailable', sent: false, reason: 'http_status', status: response.status };
  } catch (error) {
    return {
      delivery: 'unavailable',
      sent: false,
      reason: error?.name === 'AbortError' ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(timer);
  }
}

function changeRows(events) {
  return events.slice(0, MAX_CHANGES).map((event) => ({
    id: event.id,
    type: event.type,
    listingId: event.listingId || null,
    address: event.address || null,
    sourceId: event.sourceId || null,
    sourceUrl: event.sourceUrl || null,
    observedAt: event.observedAt || null,
    message: event.message || null,
  }));
}

function notifyEvents(evaluation) {
  const events = Array.isArray(evaluation?.newEvents) ? evaluation.newEvents : [];
  return events.filter((event) => event && (event.type === 'new_match' || event.type === 'material_change'));
}

async function notifyHuntWebhook(hunt, evaluation, options = {}) {
  const url = typeof hunt?.webhookUrl === 'string' ? hunt.webhookUrl.trim() : '';
  if (!url) return { delivery: 'skipped', sent: false, reason: 'no_webhook' };
  if (evaluation?.baselineCreated) return { delivery: 'skipped', sent: false, reason: 'baseline' };
  const changes = notifyEvents(evaluation);
  if (!changes.length) return { delivery: 'skipped', sent: false, reason: 'no_changes' };
  return postWebhook(url, {
    event: 'hunt.changes',
    huntId: hunt.id,
    huntName: hunt.name || hunt.label || null,
    evaluatedAt: evaluation?.evaluatedAt || null,
    counts: {
      newMatch: evaluation?.counts?.newMatch ?? changes.filter((event) => event.type === 'new_match').length,
      materialChange: evaluation?.counts?.materialChange ?? changes.filter((event) => event.type === 'material_change').length,
    },
    changes: changeRows(changes),
    truncated: changes.length > MAX_CHANGES,
  }, options);
}

// Email twin of the hunt webhook: same change set, sent via outbound-mail
// (Resend when RESEND_API_KEY is set, local outbox file otherwise).
async function notifyHuntEmail(hunt, evaluation, options = {}) {
  const to = typeof hunt?.notifyEmail === 'string' ? hunt.notifyEmail.trim() : '';
  if (!to) return { delivery: 'skipped', sent: false, reason: 'no_email' };
  if (evaluation?.baselineCreated) return { delivery: 'skipped', sent: false, reason: 'baseline' };
  const changes = notifyEvents(evaluation);
  if (!changes.length) return { delivery: 'skipped', sent: false, reason: 'no_changes' };
  const { sendOutboundMail } = require('./outbound-mail');
  const name = hunt.name || hunt.label || 'Saved hunt';
  const lines = changeRows(changes).map((c) => `- ${c.type === 'new_match' ? 'New match' : 'Changed'}: ${c.address || c.listingId || 'listing'}${c.message ? ` (${c.message})` : ''}${c.sourceUrl ? `\n  ${c.sourceUrl}` : ''}`);
  if (changes.length > MAX_CHANGES) lines.push(`...and ${changes.length - MAX_CHANGES} more.`);
  return sendOutboundMail({
    to,
    kind: 'hunt-alert',
    subject: `${name}: ${changes.length} change${changes.length === 1 ? '' : 's'}`,
    text: `${name} found ${changes.length} change${changes.length === 1 ? '' : 's'}.\n\n${lines.join('\n')}\n\nVerify every record at its source before bidding.`,
  }, options.mail || {});
}

async function notifySavedSearchWebhook(search, listings, options = {}) {
  const url = String(search?.filters?.webhookUrl || search?.webhookUrl || '').trim();
  if (!url) return { delivery: 'skipped', sent: false, reason: 'no_webhook' };
  const matches = Array.isArray(listings) ? listings.filter((listing) => listing && listing.id) : [];
  if (!matches.length) return { delivery: 'skipped', sent: false, reason: 'no_matches' };
  return postWebhook(url, {
    event: 'saved_search.matches',
    searchId: search.id,
    label: search.label || null,
    matchCount: matches.length,
    matches: matches.slice(0, MAX_CHANGES).map((listing) => ({
      id: listing.id,
      address: listing.address || null,
      city: listing.city || null,
      state: listing.state || null,
      source: listing.source || null,
      sourceUrl: listing.sourceUrl || null,
      openingBid: listing.openingBid ?? null,
    })),
    truncated: matches.length > MAX_CHANGES,
  }, options);
}

module.exports = {
  notifyHuntEmail,
  notifyHuntWebhook,
  notifySavedSearchWebhook,
  postWebhook,
  webhookTargetError,
};
