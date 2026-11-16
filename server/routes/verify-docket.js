const db = require('../db/client');
const Validator = require('../security/validation');
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

  const checkedAt = new Date().toISOString();
  const attachedCaseNumber = cleanText(
    params.caseNumber || listing?.caseNumber || listing?.provenance?.sourceFacts?.caseNumber || '',
    80
  ) || null;
  const officialEvidence = collectAttachedDocketEvidence(listing, checkedAt);
  const logs = [
    `[${checkedAt.slice(11, 19)}] Evidence audit opened for ${address}.`
  ];

  if (officialEvidence.length > 0) {
    logs.push(`[${checkedAt.slice(11, 19)}] Attached ${officialEvidence.length} publisher docket/notice reference(s) from listing provenance.`);
  }

  const lookupRequested = params.lookup === true || params.lookup === 'true' || params.lookup === '1';
  const lookupEnabled = Boolean(options.courtlistenerClient)
    || lookupRequested
    || process.env.COURTLISTENER_VERIFY_DOCKET === '1';

  let caseNumber = attachedCaseNumber;
  if (lookupEnabled) {
    const queryTerm = attachedCaseNumber
      || cleanText(listing?.defendant, 100)
      || `${address} ${county} ${state}`;
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
        const evidenceUrl = cleanText(candidate.sourceUrl || candidate.provenance?.exactSourceUrl || '', 500);
        if (!evidenceUrl || officialEvidence.some((e) => e.url === evidenceUrl)) continue;
        if (!caseNumber) {
          const matchedCase = cleanText(candidate.provenance?.sourceFacts?.caseNumber || candidate.caseNumber || '', 80);
          if (matchedCase) caseNumber = matchedCase;
        }
        officialEvidence.push({
          label: cleanText(
            candidate.provenance?.sourceFacts?.documents?.[0]?.label
              || (caseNumber ? `CourtListener docket ${caseNumber}` : 'CourtListener federal docket'),
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

  const missingEvidence = [
    ...(officialEvidence.length === 0 ? ['Official court docket response'] : []),
    'Recorded lien and mortgage instruments',
    'County tax balance statement',
    'Bankruptcy-stay search result'
  ];

  const hasPartialDocket = officialEvidence.length > 0;
  const verificationState = hasPartialDocket ? 'partial_docket_evidence' : 'official_source_required';
  const statusReason = hasPartialDocket
    ? 'Partial court/notice evidence is attached, but recorded lien instruments, county tax balance, and live bankruptcy-stay clearance remain unverified.'
    : 'No official court, recorder, treasurer, or bankruptcy connector is configured for this jurisdiction.';

  if (!hasPartialDocket) {
    logs.push(`[${checkedAt.slice(11, 19)}] No official ${county} County court response is attached.`);
  }
  logs.push(`[${checkedAt.slice(11, 19)}] No recorder, tax, or full title clearance evidence was received.`);
  logs.push(`[${checkedAt.slice(11, 19)}] Result remains UNVERIFIED. No legal conclusion was generated.`);

  return res.status(200).json({
    verified: false,
    verificationState,
    checkedAt,
    address,
    county,
    state,
    caseNumber: hasPartialDocket || attachedCaseNumber ? caseNumber : null,
    status: 'unverified',
    statusReason,
    openingBid: listing?.openingBid ?? null,
    saleDate: listing?.saleDate ?? null,
    plaintiff: listing?.plaintiff ?? null,
    defendant: listing?.defendant ?? null,
    titleIntegrity: hasPartialDocket
      ? 'PARTIAL DOCKET REFERENCE ONLY — official title, tax & lien clearance required'
      : 'UNVERIFIED — official title evidence required',
    seniorLien: null,
    taxDelinquency: null,
    redemptionWindow: null,
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
