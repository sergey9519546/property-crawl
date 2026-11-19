const db = require('../db/client');
const Validator = require('../security/validation');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');
const { CourtListenerScraper } = require('../scrapers/courtlistener');

function cleanText(value, maxLength = 240) {
  return Validator.stripControlChars(String(value == null ? '' : value)).trim().slice(0, maxLength);
}

function collectAttachedDocketEvidence(listing, checkedAt) {
  if (!listing || typeof listing !== 'object') return [];
  const sourceFacts = listing.provenance && listing.provenance.sourceFacts
    ? listing.provenance.sourceFacts
    : {};
  const docs = Array.isArray(sourceFacts.documents) ? sourceFacts.documents : [];
  const seen = new Set();
  const evidence = [];

  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    const url = cleanText(doc.url || doc.exactSourceUrl || '', 500);
    const kind = cleanText(doc.kind || '', 60).toLowerCase();
    const label = cleanText(doc.label || doc.title || '', 180);
    if (!url || (!/docket|court|legal|notice/i.test(kind) && !/docket|court|legal\s+notice/i.test(label))) {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    evidence.push({
      label: label || 'Attached court or legal notice record',
      url,
      fetchedAt: cleanText(doc.fetchedAt || doc.observedAt || listing.sourceObservedAt || checkedAt, 64)
    });
  }

  const docketUrl = cleanText(sourceFacts.docketUrl || listing.docketUrl || '', 500);
  if (docketUrl && !seen.has(docketUrl)) {
    seen.add(docketUrl);
    evidence.push({
      label: 'Publisher-referenced court docket',
      url: docketUrl,
      fetchedAt: cleanText(listing.sourceObservedAt || checkedAt, 64)
    });
  }

  return evidence;
}

function tokenizeAddressMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function isMatchingDocketCandidate(candidate, { caseNumber, defendant, address }) {
  if (!candidate || typeof candidate !== 'object') return false;
  const candidateCase = cleanText(candidate.provenance?.sourceFacts?.caseNumber || candidate.caseNumber || '', 80).toLowerCase();
  if (caseNumber && candidateCase && candidateCase.includes(caseNumber.toLowerCase())) {
    return true;
  }
  const haystack = `${candidate.address || ''} ${candidate.defendant || ''} ${candidate.plaintiff || ''} ${candidate.raw || ''}`.toLowerCase();
  if (defendant) {
    const defTokens = tokenizeAddressMatch(defendant);
    if (defTokens.length > 0 && defTokens.every((t) => haystack.includes(t))) return true;
  }
  const addrTokens = tokenizeAddressMatch(address).slice(0, 3);
  return addrTokens.length >= 2 && addrTokens.every((t) => haystack.includes(t));
}

function parseRawPayload(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

/**
 * Extracts a strictly non-PII docket classification from a CourtListener candidate
 * or pre-normalized docket hit. Personal names (caseName, defendant, plaintiff,
 * party, attorney) are never included in the returned object.
 */
function classifyDocketCandidate(candidate, checkedAt = new Date().toISOString()) {
  if (!candidate || typeof candidate !== 'object') return null;
  const sourceFacts = candidate.provenance?.sourceFacts || {};
  const rawObj = parseRawPayload(candidate.raw);
  const courtId = cleanText(candidate.courtId || rawObj.court_id || sourceFacts.courtId || '', 24).toLowerCase() || null;
  const courtName = cleanText(candidate.courtName || rawObj.court || sourceFacts.courtName || '', 160) || null;
  const caseNumber = cleanText(
    sourceFacts.caseNumber || candidate.caseNumber || rawObj.docketNumber || candidate.docketNumber || '',
    80
  ) || null;
  const dateFiled = cleanText(candidate.dateFiled || rawObj.dateFiled || sourceFacts.dateFiled || '', 32) || null;
  const dateTerminated = cleanText(candidate.dateTerminated || rawObj.dateTerminated || sourceFacts.dateTerminated || '', 32) || null;
  const suitNature = cleanText(candidate.suitNature || rawObj.suitNature || '', 160);
  const cause = cleanText(candidate.cause || rawObj.cause || '', 160);
  const chapterSource = `${suitNature} ${cause} ${candidate.chapter || ''} ${rawObj.caseName || ''} ${candidate.address || ''}`;
  const chapterMatch = chapterSource.match(/\bchapter\s*(7|11|12|13)\b/i);
  const chapter = candidate.chapter ? cleanText(candidate.chapter, 8) : (chapterMatch ? chapterMatch[1] : null);
  const isBankruptcyCourt = Boolean(courtId && /^[a-z]{2,4}b$/i.test(courtId));
  const isBankruptcyText = /(?:bankruptcy|chapter\s*(?:7|11|12|13)|11\s*u\.?s\.?c\.?\s*§?\s*362|title\s*11)/i.test(
    `${suitNature} ${cause} ${sourceFacts.documents?.[0]?.label || ''}`
  );
  const isBankruptcy = typeof candidate.isBankruptcy === 'boolean'
    ? candidate.isBankruptcy
    : (isBankruptcyCourt || isBankruptcyText || Boolean(chapter));
  const isActive = typeof candidate.isActive === 'boolean'
    ? candidate.isActive
    : !dateTerminated;
  const docketIdNum = Number(candidate.docketId || rawObj.docket_id);
  const docketId = Number.isInteger(docketIdNum) && docketIdNum > 0 ? docketIdNum : null;
  const sourceUrl = cleanText(candidate.sourceUrl || candidate.provenance?.exactSourceUrl || '', 500) || null;
  const observedAt = cleanText(candidate.sourceObservedAt || candidate.observedAt || checkedAt, 64) || null;

  return {
    docketId,
    caseNumber,
    courtId,
    courtName,
    dateFiled,
    dateTerminated,
    isBankruptcy,
    chapter,
    isActive,
    sourceUrl,
    observedAt,
  };
}

/**
 * Aggregates classified docket hits into a non-PII summary safe for public routes.
 */
function summarizeDocketHits(dockets = [], { checkedAt = new Date().toISOString(), lookupExecuted = false } = {}) {
  const safeDockets = (Array.isArray(dockets) ? dockets : [])
    .map((d) => classifyDocketCandidate(d, checkedAt))
    .filter(Boolean);

  const bankruptcyDockets = safeDockets.filter((d) => d.isBankruptcy);
  const activeBankruptcyCount = bankruptcyDockets.filter((d) => d.isActive).length;
  const terminatedBankruptcyCount = bankruptcyDockets.length - activeBankruptcyCount;

  let status = 'not_checked';
  if (activeBankruptcyCount > 0) {
    status = 'active_bankruptcy_docket';
  } else if (bankruptcyDockets.length > 0) {
    status = 'terminated_bankruptcy_docket';
  } else if (safeDockets.length > 0) {
    status = 'civil_docket_match';
  } else if (lookupExecuted) {
    status = 'no_docket_hits';
  }

  return {
    status,
    checkedAt,
    lookupExecuted: Boolean(lookupExecuted),
    hitCount: safeDockets.length,
    bankruptcyHitCount: bankruptcyDockets.length,
    activeBankruptcyCount,
    terminatedBankruptcyCount,
    hasBankruptcyHit: bankruptcyDockets.length > 0,
    activeBankruptcyStaySignal: activeBankruptcyCount > 0,
    dockets: safeDockets,
  };
}

/**
 * Shared docket evidence + CourtListener lookup helper usable by both
 * `/api/verify-docket` and intelligence pipelines.
 */
async function auditDocketEvidence(listing = null, options = {}) {
  const checkedAt = options.checkedAt || new Date().toISOString();
  const address = cleanText(options.address || listing?.address, 240);
  const county = cleanText(options.county || listing?.county, 120);
  const state = cleanText(options.state || listing?.state, 2).toUpperCase();
  const attachedCaseNumber = cleanText(
    options.caseNumber || listing?.caseNumber || listing?.provenance?.sourceFacts?.caseNumber || '',
    80
  ) || null;

  const officialEvidence = collectAttachedDocketEvidence(listing, checkedAt);
  const logs = address
    ? [`[${checkedAt.slice(11, 19)}] Evidence audit opened for ${address}.`]
    : [];

  if (officialEvidence.length > 0) {
    logs.push(`[${checkedAt.slice(11, 19)}] Attached ${officialEvidence.length} publisher docket/notice reference(s) from listing provenance.`);
  }

  const lookupEnabled = Boolean(options.courtlistenerClient)
    || Boolean(options.lookup)
    || (options.env?.COURTLISTENER_VERIFY_DOCKET || process.env.COURTLISTENER_VERIFY_DOCKET) === '1';

  let caseNumber = attachedCaseNumber;
  const matchedDockets = [];
  let lookupExecuted = false;

  if (lookupEnabled && (address || attachedCaseNumber)) {
    lookupExecuted = true;
    const queryTerm = attachedCaseNumber
      || cleanText(listing?.defendant, 100)
      || `${address} ${county} ${state}`.trim();
    const client = options.courtlistenerClient || new CourtListenerScraper({
      query: queryTerm,
      maxRecords: 5,
      requestTimeoutMs: 6000
    });
    logs.push(`[${checkedAt.slice(11, 19)}] Querying CourtListener index for "${queryTerm}".`);
    try {
      const candidates = await client.scrapeFeed();
      const matched = (Array.isArray(candidates) ? candidates : []).filter((c) =>
        isMatchingDocketCandidate(c, {
          caseNumber: attachedCaseNumber,
          defendant: listing?.defendant,
          address
        })
      );
      for (const candidate of matched) {
        const classified = classifyDocketCandidate(candidate, checkedAt);
        if (classified) matchedDockets.push(classified);

        const evidenceUrl = cleanText(candidate.sourceUrl || candidate.provenance?.exactSourceUrl || '', 500);
        if (!evidenceUrl || officialEvidence.some((e) => e.url === evidenceUrl)) continue;
        if (!caseNumber) {
          const matchedCase = cleanText(candidate.provenance?.sourceFacts?.caseNumber || candidate.caseNumber || '', 80);
          if (matchedCase) caseNumber = matchedCase;
        }
        const fallbackLabel = classified?.isBankruptcy
          ? (caseNumber ? `CourtListener bankruptcy docket ${caseNumber}` : 'CourtListener federal bankruptcy docket')
          : (caseNumber ? `CourtListener docket ${caseNumber}` : 'CourtListener federal docket');
        officialEvidence.push({
          label: cleanText(
            candidate.provenance?.sourceFacts?.documents?.[0]?.label || fallbackLabel,
            180
          ),
          url: evidenceUrl,
          fetchedAt: cleanText(candidate.sourceObservedAt || checkedAt, 64)
        });
      }
      logs.push(
        matched.length > 0
          ? `[${checkedAt.slice(11, 19)}] Matched ${matched.length} CourtListener federal docket record(s).`
          : `[${checkedAt.slice(11, 19)}] No matching CourtListener federal docket record found.`
      );
    } catch (err) {
      logs.push(`[${checkedAt.slice(11, 19)}] CourtListener lookup failed cleanly (${cleanText(err?.message || 'error', 120)}).`);
    }
  }

  const docketSummary = summarizeDocketHits(matchedDockets, { checkedAt, lookupExecuted });

  return {
    checkedAt,
    address,
    county,
    state,
    caseNumber,
    officialEvidence,
    matchedDockets,
    docketSummary,
    logs,
  };
}

/**
 * Fail-closed docket evidence audit.
 *
 * Aggregates any verified docket references already attached to the listing and
 * optionally queries CourtListener when explicitly requested (`lookup=true` or
 * `COURTLISTENER_VERIFY_DOCKET=1`). Because municipal recorder, tax balance, and
 * county docket connectors may still be absent, `verified` remains `false`
 * unless all required evidence surfaces are present.
 */
async function handleVerifyDocket(req, res, options = {}) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const params = req.method === 'GET'
    ? Object.fromEntries(url.searchParams)
    : (req.body || {});

  const listingId = cleanText(params.listingId || params.id, 160);
  const listing = listingId ? await db.getListingById(listingId) : null;

  if (listingId && !listing) {
    return res.status(404).json({
      error: 'Listing not found',
      verified: false,
      verificationState: 'not_found'
    });
  }

  const address = cleanText(params.address || listing?.address, 240);
  const county = cleanText(params.county || listing?.county, 120);
  const state = cleanText(params.state || listing?.state, 2).toUpperCase();

  if (!address || !county || !/^[A-Z]{2}$/.test(state)) {
    return res.status(400).json({
      error: 'Address, county, and a valid two-letter state are required',
      verified: false,
      verificationState: 'invalid_request'
    });
  }

  const lookupRequested = params.lookup === true || params.lookup === 'true' || params.lookup === '1';
  const audit = await auditDocketEvidence(listing, {
    address,
    county,
    state,
    caseNumber: params.caseNumber,
    lookup: lookupRequested,
    courtlistenerClient: options.courtlistenerClient,
    env: options.env || process.env,
  });

  const { checkedAt, officialEvidence, docketSummary, logs } = audit;
  let { caseNumber } = audit;

  const missingEvidence = [
    ...(officialEvidence.length === 0 ? ['Official court docket response'] : []),
    'Recorded lien and mortgage instruments',
    'County tax balance statement',
    ...(docketSummary.lookupExecuted ? [] : ['Bankruptcy-stay search result'])
  ];

  const hasPartialDocket = officialEvidence.length > 0;
  const verificationState = hasPartialDocket ? 'partial_docket_evidence' : 'official_source_required';
  const statusReason = docketSummary.activeBankruptcyStaySignal
    ? 'CourtListener matched an active federal bankruptcy docket (potential 11 U.S.C. § 362 automatic stay), while recorded lien instruments and county tax balance remain unverified.'
    : hasPartialDocket
      ? 'Partial court/notice evidence is attached, but recorded lien instruments, county tax balance, and live bankruptcy-stay clearance remain unverified.'
      : 'No official court, recorder, treasurer, or bankruptcy connector is configured for this jurisdiction.';

  if (!hasPartialDocket) {
    logs.push(`[${checkedAt.slice(11, 19)}] No official ${county} County court response is attached.`);
  }
  logs.push(`[${checkedAt.slice(11, 19)}] No recorder, tax, or full title clearance evidence was received.`);
  logs.push(`[${checkedAt.slice(11, 19)}] Result remains UNVERIFIED. No legal conclusion was generated.`);

  // Gate personal-name / PII fields behind workspace authorization
  const env = options.env || process.env;
  const authorized = typeof requireWorkspaceIdentity.isAuthorized === 'function'
    ? requireWorkspaceIdentity.isAuthorized(req, env)
    : false;

  return res.status(200).json({
    verified: false,
    verificationState,
    checkedAt,
    address,
    county,
    state,
    caseNumber: hasPartialDocket || caseNumber ? caseNumber : null,
    status: 'unverified',
    statusReason,
    openingBid: listing?.openingBid ?? null,
    saleDate: listing?.saleDate ?? null,
    plaintiff: authorized ? (listing?.plaintiff ?? null) : null,
    defendant: authorized ? (listing?.defendant ?? null) : null,
    piiGated: !authorized,
    titleIntegrity: hasPartialDocket
      ? 'PARTIAL DOCKET REFERENCE ONLY — official title, tax & lien clearance required'
      : 'UNVERIFIED — official title evidence required',
    seniorLien: null,
    taxDelinquency: null,
    redemptionWindow: null,
    docketSummary,
    officialEvidence,
    missingEvidence,
    logs,
    disclaimer: 'PerfectProperty has not verified this property against official legal records. Do not bid or make a title decision from this screen.',
    summaryMarkdown: `# Court-record evidence status

**Property**: ${address}, ${county} County, ${state}
**Status**: UNVERIFIED (${verificationState})

${statusReason} Confirm every legal fact directly with the relevant government office or qualified title professional before bidding.
`
  });
}

module.exports = handleVerifyDocket;
module.exports.auditDocketEvidence = auditDocketEvidence;
module.exports.summarizeDocketHits = summarizeDocketHits;
module.exports.classifyDocketCandidate = classifyDocketCandidate;
