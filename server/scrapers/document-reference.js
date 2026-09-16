// server/scrapers/document-reference.js
//
// Shared helper for adapters that don't natively expose a publisher document
// array (ServiceLink does) but DO have stable reference URLs that point at
// publisher pages which in turn list filings, parcel records, or other
// official artifacts. We surface those URLs as documents under
// provenance.sourceFacts.documents so the document-evidence pipeline
// (server/intelligence/document-evidence.js) treats them the same way.
//
// Each adapter should pass only the URLs it actually observed during the
// scrape; this helper is just a normalizer that validates URLs and stamps
// the observed timestamp. It never fabricates links.

const ALLOWED_KINDS = new Set(['docket', 'feature', 'parcel', 'filings', 'detail', 'reference']);

function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    return true;
  } catch (_) {
    return false;
  }
}

// Build a list of document references for provenance.sourceFacts.documents.
// Each input is { kind, url, label?, observedAt? }. Entries with non-HTTP
// URLs, missing URLs, or unknown kinds are dropped (the helper never
// fabricates; adapters that pass garbage get back a smaller list and a
// caller-facing warning).
//
// `observedAt` defaults to the call-supplied timestamp, then `now`. The
// document-evidence pipeline later compares it against the listing's
// observedAt to decide whether the document counts as live evidence.
function buildDocumentReferences(entries, { observedAt = null, now = () => new Date().toISOString() } = {}) {
  if (!Array.isArray(entries)) return [];
  const fallbackObservedAt = observedAt || now();
  const out = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const kind = typeof entry.kind === 'string' ? entry.kind.toLowerCase() : 'reference';
    if (!ALLOWED_KINDS.has(kind)) continue;
    if (!isHttpUrl(entry.url)) continue;
    out.push({
      kind,
      url: entry.url,
      label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 200) : null,
      observedAt: typeof entry.observedAt === 'string' ? entry.observedAt : fallbackObservedAt,
      accessState: typeof entry.accessState === 'string' ? entry.accessState : 'public'
    });
  }
  return out;
}

module.exports = {
  ALLOWED_KINDS,
  buildDocumentReferences,
  isHttpUrl
};
