'use strict';

const dns = require('node:dns').promises;
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

async function resolutionError(hostname, lookup) {
  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return 'dns_failed';
  }
  if (!Array.isArray(records) || records.length === 0) return 'dns_failed';
  for (const record of records) {
    if (isPrivateOrLocalHost(record?.address)) return 'private_resolution';
  }
  return null;
}

async function postWebhook(rawUrl, body, options = {}) {
  const reason = webhookTargetError(rawUrl);
  if (reason) return { delivery: 'refused', sent: false, reason };
  const url = new URL(String(rawUrl).trim());
  const lookup = options.lookup || dns.lookup;
  const resolved = await resolutionError(url.hostname, lookup);
  if (resolved === 'dns_failed') return { delivery: 'unavailable', sent: false, reason: resolved };
  if (resolved) return { delivery: 'refused', sent: false, reason: resolved };

  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.href, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
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
  notifyHuntWebhook,
  notifySavedSearchWebhook,
  postWebhook,
  webhookTargetError,
};
