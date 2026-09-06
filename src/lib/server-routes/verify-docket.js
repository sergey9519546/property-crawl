const db = require('../../../server/db/client');
const Validator = require('../../../server/security/validation');

function cleanText(value, maxLength = 240) {
  return Validator.stripControlChars(String(value == null ? '' : value)).trim().slice(0, maxLength);
}

/**
 * Fail-closed docket evidence audit.
 *
 * This route deliberately does not infer case numbers, lien priority, taxes,
 * bankruptcy stays, or sale status. A future verified connector may populate
 * officialEvidence, but until then the only truthful answer is "unverified".
 */
async function handleVerifyDocket(req, res) {
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
  const missingEvidence = [
    'Official court docket response',
    'Recorded lien and mortgage instruments',
    'County tax balance statement',
    'Bankruptcy-stay search result'
  ];
  const statusReason = 'No official court, recorder, treasurer, or bankruptcy connector is configured for this jurisdiction.';
  const logs = [
    `[${checkedAt.slice(11, 19)}] Evidence audit opened for ${address}.`,
    `[${checkedAt.slice(11, 19)}] No official ${county} County court response is attached.`,
    `[${checkedAt.slice(11, 19)}] No recorder, tax, or bankruptcy evidence was received.`,
    `[${checkedAt.slice(11, 19)}] Result remains UNVERIFIED. No legal conclusion was generated.`
  ];

  return res.status(200).json({
    verified: false,
    verificationState: 'official_source_required',
    checkedAt,
    address,
    county,
    state,
    caseNumber: null,
    status: 'unverified',
    statusReason,
    openingBid: listing?.openingBid ?? null,
    saleDate: listing?.saleDate ?? null,
    plaintiff: listing?.plaintiff ?? null,
    defendant: listing?.defendant ?? null,
    titleIntegrity: 'UNVERIFIED — official title evidence required',
    seniorLien: null,
    taxDelinquency: null,
    redemptionWindow: null,
    officialEvidence: [],
    missingEvidence,
    logs,
    disclaimer: 'PerfectProperty has not verified this property against official legal records. Do not bid or make a title decision from this screen.',
    summaryMarkdown: `# Court-record evidence status

**Property**: ${address}, ${county} County, ${state}
**Status**: UNVERIFIED

No official court, recorder, tax, or bankruptcy response is attached. Confirm every legal fact directly with the relevant government office or qualified title professional before bidding.
`
  });
}

module.exports = handleVerifyDocket;
