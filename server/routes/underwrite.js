'use strict';

const { getHudSafmrBenchmark } = require('../enrichment/hud-safmr');
const { resolveCountyKey, STATEWIDE_ARCGIS_REGISTRY } = require('../enrichment/arcgis-parcels');
const { interpretAssessorParcel } = require('../enrichment/assessor-reading');
const { computePublicBenchmarkConsensus } = require('../enrichment/public-benchmark-consensus');
const { arbitrateTitleRisk } = require('../intelligence/title-risk-engine');
const { computeCatchSummary } = require('../intelligence/catch-summary');
const { buildPossessionDossier } = require('../intelligence/post-sale-possession');
const { US_STATE_NAMES } = require('../db/us-state-query');

const MAX_NOTICE_CHARS = 20000;
const MAX_ADDRESS_CHARS = 240;
const MAX_BODY_BYTES = 512 * 1024;

const TERRITORY_CODES = new Set(['VI', 'GU', 'AS', 'MP']);
const FEDERAL_REO_SOURCES = new Set(['hud', 'fannie', 'freddie', 'va', 'fdic', 'treasury', 'gsa', 'usda']);

function isValidStateCode(code) {
  return Boolean(code && /^[A-Z]{2}$/.test(code) && (Object.prototype.hasOwnProperty.call(US_STATE_NAMES, code) || TERRITORY_CODES.has(code)));
}

function cleanOptionalText(value, maxLen = 160) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxLen);
}

function parsePositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return null;
  const parsed = typeof value === 'number'
    ? value
    : Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseBedrooms(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) return null;
  return Math.floor(parsed);
}

function normalizeZip(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{5})(?:-\d{4})?$/);
  return match ? match[1] : null;
}

/**
 * Deterministic 1.20x DSCR rent-supported price ceiling from HUD SAFMR monthly rent.
 * Matches src/lib/underwriting.ts computeSafmrRentFloor defaults:
 * targetDscr=1.20, annualInterestRatePct=7.25, ltvPct=75, expenseRatio=0.35, loanTermYears=30.
 */
function computeSafmrRentFloor({
  monthlyRent,
  targetDscr = 1.20,
  annualInterestRatePct = 7.25,
  ltvPct = 75,
  expenseRatio = 0.35,
  loanTermYears = 30,
} = {}) {
  const rent = parsePositiveNumber(monthlyRent);
  if (rent === null) return null;
  if (
    !Number.isFinite(targetDscr) || targetDscr <= 0
    || !Number.isFinite(annualInterestRatePct) || annualInterestRatePct < 0
    || !Number.isFinite(ltvPct) || ltvPct <= 0 || ltvPct > 100
    || !Number.isFinite(expenseRatio) || expenseRatio < 0 || expenseRatio >= 1
    || !Number.isFinite(loanTermYears) || loanTermYears <= 0
  ) {
    return null;
  }

  const totalMonths = Math.round(loanTermYears * 12);
  if (totalMonths <= 0) return null;

  const noiMonthly = rent * (1 - expenseRatio);
  const maxMonthlyDebt = noiMonthly / targetDscr;
  const monthlyRate = (annualInterestRatePct / 100) / 12;

  let maxLoan;
  if (monthlyRate === 0) {
    maxLoan = maxMonthlyDebt * totalMonths;
  } else {
    const factor = Math.pow(1 + monthlyRate, totalMonths);
    if (!Number.isFinite(factor) || factor <= 1) return null;
    maxLoan = maxMonthlyDebt * ((factor - 1) / (monthlyRate * factor));
  }

  if (!Number.isFinite(maxLoan) || maxLoan < 0) return null;
  return Math.max(0, Math.floor(maxLoan / (ltvPct / 100)));
}

function makeVerifiedSpan(text, start, quote, value) {
  if (!quote || typeof start !== 'number' || start < 0) return null;
  const end = start + quote.length;
  if (end > text.length || text.slice(start, end) !== quote) {
    return null;
  }
  return {
    value,
    quote,
    start,
    end,
    verified: true,
  };
}

/**
 * Deterministically extracts docket/case number, judgment amount, upset/opening bid,
 * APN / Block-Lot, and occupancy/tenant flags with verbatim character offsets.
 * Every returned citation satisfies noticeText.slice(start, end) === quote.
 */
function extractNoticeSignals(noticeText = '') {
  if (typeof noticeText !== 'string' || !noticeText.trim()) {
    return {
      present: false,
      truncated: false,
      charCount: 0,
      fields: {
        caseNumber: null,
        judgment: null,
        openingBid: null,
        apn: null,
        occupancy: null,
      },
      citations: {},
      occupancyFlags: [],
    };
  }

  const truncated = noticeText.length > MAX_NOTICE_CHARS;
  const text = noticeText.slice(0, MAX_NOTICE_CHARS);
  const citations = {};

  // 1. Docket / Case Number
  const caseMatch = text.match(
    /\b(?:case|docket|index|cause|civil\s+action)\s*(?:(?:no\.?|number|#)\s*[:#]?\s*|:\s*)([A-Za-z0-9](?=[A-Za-z0-9\-\/]*\d)(?:[A-Za-z0-9\-\/]{0,36}[A-Za-z0-9])?)/i
  );
  let caseNumber = null;
  if (caseMatch && caseMatch[1]) {
    const span = makeVerifiedSpan(text, caseMatch.index, caseMatch[0], caseMatch[1].trim());
    if (span) {
      caseNumber = span.value;
      citations.caseNumber = span;
    }
  }

  // 2. Judgment Amount
  const judgmentMatch = text.match(
    /\b(?:final\s+judgment|judgment(?:\s+amount)?|jdgmt|amount\s+due|total\s+debt|debt)\s*(?:in\s+the\s+amount\s+of|of|is|:|=)?\s*\$\s*([0-9,]+(?:\.[0-9]{1,2})?)/i
  );
  let judgment = null;
  if (judgmentMatch && judgmentMatch[1]) {
    const parsed = parsePositiveNumber(judgmentMatch[1]);
    if (parsed !== null) {
      const span = makeVerifiedSpan(text, judgmentMatch.index, judgmentMatch[0], parsed);
      if (span) {
        judgment = span.value;
        citations.judgment = span;
      }
    }
  }

  // 3. Upset / Opening Bid
  const bidMatch = text.match(
    /\b(?:opening\s+bid|minimum(?:\s+opening)?\s+bid|upset\s+(?:price|bid|amount)|starting\s+bid)\s*(?:of|is|:|=)?\s*\$\s*([0-9,]+(?:\.[0-9]{1,2})?)/i
  );
  let openingBid = null;
  if (bidMatch && bidMatch[1]) {
    const parsed = parsePositiveNumber(bidMatch[1]);
    if (parsed !== null) {
      const span = makeVerifiedSpan(text, bidMatch.index, bidMatch[0], parsed);
      if (span) {
        openingBid = span.value;
        citations.openingBid = span;
      }
    }
  }

  // 4. APN / Parcel ID / Block-Lot
  const apnMatch = text.match(
    /\b(?:APN|Assessor'?s?\s+Parcel\s+(?:No\.?|Number|ID|#)|Parcel\s*(?:ID|No\.?|Number|#)|Tax\s*(?:Map|Parcel|ID)|PIN)\s*[:#]?\s*([0-9A-Za-z](?=[0-9A-Za-z\-./]*\d)[0-9A-Za-z\-./]{0,39}[0-9A-Za-z])/i
  );
  const blockLotMatch = text.match(
    /\bBlock\s*[:#]?\s*([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)\s*[,;/]?\s*Lot\s*[:#]?\s*([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)/i
  );
  let chosenApnCandidate = null;
  if (apnMatch && blockLotMatch) {
    chosenApnCandidate = apnMatch.index <= blockLotMatch.index
      ? { match: apnMatch, value: apnMatch[1].trim() }
      : { match: blockLotMatch, value: `Block ${blockLotMatch[1].trim()}, Lot ${blockLotMatch[2].trim()}` };
  } else if (apnMatch) {
    chosenApnCandidate = { match: apnMatch, value: apnMatch[1].trim() };
  } else if (blockLotMatch) {
    chosenApnCandidate = { match: blockLotMatch, value: `Block ${blockLotMatch[1].trim()}, Lot ${blockLotMatch[2].trim()}` };
  }
  let apn = null;
  if (chosenApnCandidate) {
    const span = makeVerifiedSpan(
      text,
      chosenApnCandidate.match.index,
      chosenApnCandidate.match[0],
      chosenApnCandidate.value
    );
    if (span) {
      apn = span.value;
      citations.apn = span;
    }
  }

  // 5. Occupancy / Tenant Flags
  const occupancyPatterns = [
    {
      flag: 'Tenant-Occupied',
      priority: 1,
      regex: /\b(?:tenant[- ]occupied|occupied\s+by\s+(?:a\s+|the\s+)?tenants?|tenants?\s+in\s+possession|subject\s+to\s+(?:existing\s+)?(?:tenanc(?:y|ies)|leases?)|month[- ]to[- ]month\s+tenant|renter[- ]occupied)\b/gi,
    },
    {
      flag: 'Owner-Occupied',
      priority: 2,
      regex: /\b(?:owner[- ]occupied|occupied\s+by\s+(?:the\s+)?(?:former\s+)?owners?|defendants?\s+in\s+possession)\b/gi,
    },
    {
      flag: 'Vacant',
      priority: 4,
      regex: /\b(?:vacant(?:\s+(?:property|residence|dwelling|premises|lot))?|unoccupied|not\s+occupied|non[- ]?occupied)\b/gi,
    },
    {
      flag: 'Occupied',
      priority: 3,
      regex: /\b(?:property\s+is\s+occupied|premises\s+(?:are|is)\s+occupied|currently\s+occupied|occupied\s+premises|occupancy\s*[:\-]\s*occupied)\b/gi,
    },
  ];

  const occupancyFlags = [];
  const seenSpans = new Set();
  let primaryOccupancy = null;

  for (const spec of occupancyPatterns) {
    for (const match of text.matchAll(spec.regex)) {
      const start = match.index;
      const quote = match[0];
      const end = start + quote.length;
      const key = `${start}:${end}`;
      if (seenSpans.has(key)) continue;
      if (text.slice(start, end) !== quote) continue;
      seenSpans.add(key);
      const entry = { flag: spec.flag, quote, start, end, verified: true };
      occupancyFlags.push(entry);
      if (!primaryOccupancy || spec.priority < primaryOccupancy.priority) {
        primaryOccupancy = { ...entry, priority: spec.priority };
      }
    }
  }

  occupancyFlags.sort((a, b) => a.start - b.start);
  const occupancy = primaryOccupancy ? primaryOccupancy.flag : null;
  if (primaryOccupancy) {
    citations.occupancy = {
      value: primaryOccupancy.flag,
      quote: primaryOccupancy.quote,
      start: primaryOccupancy.start,
      end: primaryOccupancy.end,
      verified: true,
    };
  }

  return {
    present: true,
    truncated,
    charCount: text.length,
    fields: {
      caseNumber,
      judgment,
      openingBid,
      apn,
      occupancy,
    },
    citations,
    occupancyFlags,
  };
}

function readJsonBody(req) {
  if (req && req.body !== undefined) {
    if (typeof req.body === 'string') {
      if (!req.body.trim()) return Promise.resolve({ ok: true, body: {} });
      try {
        const parsed = JSON.parse(req.body);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return Promise.resolve({ ok: false, status: 400, error: 'JSON request body must be an object' });
        }
        return Promise.resolve({ ok: true, body: parsed });
      } catch {
        return Promise.resolve({ ok: false, status: 400, error: 'Invalid JSON request body' });
      }
    }
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString('utf8');
      if (!text.trim()) return Promise.resolve({ ok: true, body: {} });
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return Promise.resolve({ ok: false, status: 400, error: 'JSON request body must be an object' });
        }
        return Promise.resolve({ ok: true, body: parsed });
      } catch {
        return Promise.resolve({ ok: false, status: 400, error: 'Invalid JSON request body' });
      }
    }
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      return Promise.resolve({ ok: true, body: req.body });
    }
    return Promise.resolve({ ok: false, status: 400, error: 'JSON request body must be an object' });
  }

  if (!req || typeof req.on !== 'function') {
    return Promise.resolve({ ok: true, body: {} });
  }

  return new Promise((resolve) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        finish({ ok: false, status: 413, error: 'Request body too large' });
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        finish({ ok: true, body: {} });
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          finish({ ok: false, status: 400, error: 'JSON request body must be an object' });
          return;
        }
        finish({ ok: true, body: parsed });
      } catch {
        finish({ ok: false, status: 400, error: 'Invalid JSON request body' });
      }
    });
    req.on('error', () => {
      finish({ ok: false, status: 400, error: 'Failed to read request body' });
    });
  });
}

function sendOptionsOk(res) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Allow', 'POST, OPTIONS');
  }
  if (typeof res.status === 'function') res.status(204);
  if (typeof res.send === 'function') return res.send('');
  if (typeof res.end === 'function') return res.end();
  if (typeof res.json === 'function') return res.json({ ok: true });
  return undefined;
}

function createUnderwriteHandler(deps = {}) {
  const safmrLookup = deps.getHudSafmrBenchmark || getHudSafmrBenchmark;
  const countyKeyResolver = deps.resolveCountyKey || resolveCountyKey;
  const assessorInterpreter = deps.interpretAssessorParcel || interpretAssessorParcel;
  const titleRiskArbitrator = deps.arbitrateTitleRisk || arbitrateTitleRisk;
  const catchSummaryBuilder = deps.computeCatchSummary || computeCatchSummary;
  const possessionTimelineBuilder = deps.computePostSalePossessionTimeline
    || deps.buildPossessionDossier
    || buildPossessionDossier;
  const consensusBuilder = deps.computePublicBenchmarkConsensus || computePublicBenchmarkConsensus;
  const nowFn = typeof deps.now === 'function' ? deps.now : () => new Date();

  return async function handleUnderwrite(req, res) {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-store');
    }

    const method = String(req?.method || '').toUpperCase();
    if (method === 'OPTIONS') {
      return sendOptionsOk(res);
    }
    if (method !== 'POST') {
      if (typeof res.setHeader === 'function') {
        res.setHeader('Allow', 'POST, OPTIONS');
      }
      return res.status(405).json({ error: 'Method not allowed. Use POST /api/underwrite.' });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return res.status(parsedBody.status || 400).json({ error: parsedBody.error });
    }
    const body = parsedBody.body;

    // Validate address (non-empty string <= 240 chars)
    if (typeof body.address !== 'string') {
      return res.status(400).json({ error: 'address is required and must be a non-empty string of at most 240 characters' });
    }
    const address = cleanOptionalText(body.address, MAX_ADDRESS_CHARS + 1);
    if (!address || address.length > MAX_ADDRESS_CHARS) {
      return res.status(400).json({ error: 'address is required and must be a non-empty string of at most 240 characters' });
    }

    // Validate state (2-letter US state/territory code)
    const state = typeof body.state === 'string' ? body.state.trim().toUpperCase() : '';
    if (!isValidStateCode(state)) {
      return res.status(400).json({ error: 'state must be a valid 2-letter US state or territory code' });
    }

    const rawNoticeText = typeof body.noticeText === 'string' ? body.noticeText : '';
    const boundedNoticeText = rawNoticeText ? rawNoticeText.slice(0, MAX_NOTICE_CHARS) : '';
    const noticeExtraction = extractNoticeSignals(rawNoticeText);

    const county = cleanOptionalText(body.county, 120);
    const zip = normalizeZip(body.zip);
    const beds = parseBedrooms(body.beds);
    const safmrBedrooms = beds !== null ? beds : 2;

    const suppliedOpeningBid = parsePositiveNumber(body.openingBid);
    const suppliedJudgment = parsePositiveNumber(body.judgment);
    const assessed = parsePositiveNumber(body.assessed);
    const saleDate = cleanOptionalText(body.saleDate, 32);
    const sourceRaw = cleanOptionalText(body.source, 64);
    const source = sourceRaw ? sourceRaw.toLowerCase() : null;
    const program = cleanOptionalText(body.program ?? body.auctionProgram, 120);
    const rawSaleType = cleanOptionalText(body.saleType, 64);
    const plaintiff = cleanOptionalText(body.plaintiff, 160);
    const suppliedCaseNumber = cleanOptionalText(body.caseNumber, 80);
    const suppliedApn = cleanOptionalText(body.apn, 80);
    const suppliedOccupancy = cleanOptionalText(body.occupancy, 80);
    const suppliedParcel = body.parcel && typeof body.parcel === 'object' && !Array.isArray(body.parcel)
      ? body.parcel
      : null;

    // Fill missing structured fields from noticeExtraction ONLY when not explicitly supplied
    const caseNumber = suppliedCaseNumber ?? noticeExtraction.fields.caseNumber ?? null;
    const judgment = suppliedJudgment ?? noticeExtraction.fields.judgment ?? null;
    const openingBid = suppliedOpeningBid ?? noticeExtraction.fields.openingBid ?? null;
    const apn = suppliedApn ?? noticeExtraction.fields.apn ?? null;
    const occupancy = suppliedOccupancy ?? noticeExtraction.fields.occupancy ?? null;

    const fieldOrigins = {
      caseNumber: suppliedCaseNumber ? 'supplied' : (noticeExtraction.fields.caseNumber ? 'extracted_from_notice' : 'missing'),
      judgment: suppliedJudgment !== null ? 'supplied' : (noticeExtraction.fields.judgment !== null ? 'extracted_from_notice' : 'missing'),
      openingBid: suppliedOpeningBid !== null ? 'supplied' : (noticeExtraction.fields.openingBid !== null ? 'extracted_from_notice' : 'missing'),
      apn: suppliedApn ? 'supplied' : (noticeExtraction.fields.apn ? 'extracted_from_notice' : 'missing'),
      occupancy: suppliedOccupancy ? 'supplied' : (noticeExtraction.fields.occupancy ? 'extracted_from_notice' : 'missing'),
    };

    const isFederalReoSource = Boolean(source && FEDERAL_REO_SOURCES.has(source));
    const isReoProgram = Boolean(program && /\b(?:reo|hud\s*reo|bank\s*owned|federal\s*disposition)\b/i.test(program));
    const isPostForeclosureReo = isFederalReoSource || isReoProgram;
    const saleType = rawSaleType
      ? rawSaleType.toLowerCase()
      : (isPostForeclosureReo
          ? 'reo'
          : (source === 'tax-deed' || (program && /\btax\s*deed\b/i.test(program)))
              ? 'tax-deed'
              : (source === 'trustee' || (program && /\btrustee\b/i.test(program)))
                  ? 'trustee'
                  : 'sheriff');

    const countyKey = countyKeyResolver(state, county)
      || (STATEWIDE_ARCGIS_REGISTRY[state] ? `${state}-STATEWIDE` : null);

    const effectiveParcel = suppliedParcel || (assessed !== null ? {
      assessedValue: { total: assessed },
      countyKey,
      county: county || null,
      canonicalApn: apn || null,
    } : null);

    // Build synthetic normalized listing candidate with ZERO fabricated valuation fields
    const listing = {
      id: 'any-address-underwrite',
      address,
      state,
      county,
      zip,
      beds,
      openingBid,
      judgment,
      assessed,
      saleDate,
      source,
      auctionProgram: program,
      distressStage: isPostForeclosureReo ? 'reo' : null,
      saleType,
      plaintiff,
      caseNumber,
      apn,
      occupancy,
      parcel: effectiveParcel,
      estLow: null,
      estHigh: null,
      dealScore: null,
    };

    // 1. HUD SAFMR & 1.20x DSCR Rent Ceiling
    const hudSafmr = zip
      ? safmrLookup({
          zip,
          state,
          county,
          bedrooms: safmrBedrooms,
          ...(deps.hudSafmrData ? { benchmarksData: deps.hudSafmrData } : {}),
        })
      : null;

    const safmrRentFloor120Dscr = hudSafmr && Number(hudSafmr.fairMarketRent) > 0
      ? computeSafmrRentFloor({ monthlyRent: hudSafmr.fairMarketRent, targetDscr: 1.20 })
      : null;

    // 2. Assessor Reading (when assessed > 0 or parcel is supplied)
    const assessorReading = (assessed !== null || suppliedParcel !== null)
      ? assessorInterpreter({
          countyKey,
          parcel: effectiveParcel,
          openingBid: listing.openingBid || 0,
        })
      : null;

    // 3. Statutory Title Risk & Catch Summary & Post-Sale Possession Timeline
    const titleRisk = titleRiskArbitrator(listing, boundedNoticeText);
    listing.redemptionDays = titleRisk?.statutoryRedemption?.days ?? null;

    const catchSummary = catchSummaryBuilder(
      listing,
      Array.isArray(titleRisk?.titleWarnings) ? titleRisk.titleWarnings : [],
      titleRisk?.riskLevel || null
    );

    const basePossession = possessionTimelineBuilder(listing);
    const statutoryRedemptionDays = titleRisk?.statutoryRedemption?.days ?? null;
    const possessionTimeline = basePossession && typeof basePossession === 'object'
      ? {
          ...basePossession,
          isPostForeclosureReo,
          statutoryRedemptionDays,
          statutoryRedemptionLabel: titleRisk?.statutoryRedemption?.label ?? null,
        }
      : basePossession;

    // 4. Three-Way Public Benchmark Consensus
    const consensus = consensusBuilder(listing, {
      assessorReading,
      assessorParcel: effectiveParcel,
      hudSafmr,
    });

    const inputSummary = {
      address: listing.address,
      state: listing.state,
      county: listing.county,
      zip: listing.zip,
      beds: listing.beds,
      openingBid: listing.openingBid,
      judgment: listing.judgment,
      assessed: listing.assessed,
      saleDate: listing.saleDate,
      source: listing.source,
      program: listing.auctionProgram,
      saleType: listing.saleType,
      caseNumber: listing.caseNumber,
      apn: listing.apn,
      occupancy: listing.occupancy,
      estLow: null,
      estHigh: null,
      dealScore: null,
      fieldOrigins,
    };

    return res.status(200).json({
      schema: 'property-crawl.any-address-underwrite/v1',
      generatedAt: nowFn().toISOString(),
      inputSummary,
      publicBenchmarks: {
        hudSafmr,
        safmrRentFloor120Dscr,
        assessorReading,
        consensus,
      },
      riskAndCarry: {
        titleRisk,
        catchSummary,
        possessionTimeline,
      },
      noticeExtraction,
    });
  };
}

module.exports = createUnderwriteHandler;
module.exports.createUnderwriteHandler = createUnderwriteHandler;
module.exports.extractNoticeSignals = extractNoticeSignals;
module.exports.computeSafmrRentFloor = computeSafmrRentFloor;
