'use strict';

class PublicRecordError extends Error {
  constructor(code, message) { super(message); this.name = 'PublicRecordError'; this.code = code; }
}

async function fetchOfficialJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new PublicRecordError('NETWORK_UNAVAILABLE', 'Public-record lookup is unavailable.');
  const controller = new AbortController();
  const timeoutMs = Math.max(100, Math.min(15000, Number(options.timeoutMs) || 8000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const maxBytes = Math.max(1024, Math.min(8 * 1024 * 1024, options.maxBytes || 4 * 1024 * 1024));
  try {
    const response = await fetchImpl(url.toString(), {
      signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json, application/geo+json' },
    });
    if (!response.ok) throw new PublicRecordError('SOURCE_HTTP_ERROR', `Official source returned HTTP ${response.status}.`);
    if (Number(response.headers?.get?.('content-length')) > maxBytes) {
      throw new PublicRecordError('SOURCE_TOO_LARGE', 'Official source response exceeds the lookup limit.');
    }
    let body;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { await reader.cancel(); throw new PublicRecordError('SOURCE_TOO_LARGE', 'Official source response exceeds the lookup limit.'); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } else {
      // Supports deterministic injected test responses as well as older fetch implementations.
      body = await response.json();
      if (Buffer.byteLength(JSON.stringify(body)) > maxBytes) throw new PublicRecordError('SOURCE_TOO_LARGE', 'Official source response exceeds the lookup limit.');
    }
    if (body?.error || body?.errors) throw new PublicRecordError('SOURCE_REJECTED_QUERY', 'Official source rejected the lookup.');
    return body;
  } catch (error) {
    if (error instanceof PublicRecordError) throw error;
    if (controller.signal.aborted) throw new PublicRecordError('SOURCE_TIMEOUT', 'Official source lookup timed out.');
    // Do not expose upstream URLs, request keys, HTML bodies, or thrown messages.
    throw new PublicRecordError('SOURCE_UNAVAILABLE', 'Official source could not return valid data.');
  } finally { clearTimeout(timeout); }
}

function nonnegative(value) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cleanText(value, max = 300) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text && text.length <= max && !/[\u0000-\u001f]/.test(text) ? text : null;
}

module.exports = { PublicRecordError, fetchOfficialJson, nonnegative, cleanText };
