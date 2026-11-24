'use strict';

const { US_STATE_NAMES } = require('../db/us-state-query');

/**
 * Deterministic "Here's the Catch" one-liner — computed from fields the record
 * actually carries. Zero LLM calls, zero fabrication, $0 cost.
 *
 * Rules (in priority order):
 *   1. CRITICAL/HIGH title risk → first warning, stripped of the SHOUT label prefix
 *   2. Statutory redemption > 0 days → "X-day redemption window"
 *   3. Senior lien risk (non-low) → "senior-lien risk: <level>"
 *   4. No opening bid published
 *   5. No sale date published
 *   6. Occupancy flag
 *   7. No deposit terms
 *   8. Fallback: "Opening bid {amount}, no valuation range published" or clean
 *
 * Returns a single plain-text sentence (< 160 chars) or null when the record
 * carries no actionable catch signals.
 */

function money(n) {
  return `$${Math.round(Number(n)).toLocaleString('en-US')}`;
}

// A bare two-letter code reads badly inside a sentence -- "OR law" parses as the
// conjunction. Spell the state out when the code is one we know, and fall back to
// whatever the record carried rather than inventing a name.
function stateLabel(value) {
  const code = optText(value);
  if (!code) return 'State';
  if (/^[A-Z]{2}$/.test(code)) {
    const name = US_STATE_NAMES[code];
    if (name) return name;
  }
  return code;
}

function optNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function optText(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t && !/^(?:—|unknown|n\/a)$/i.test(t) ? t : null;
}

function isInformationalTitleNote(warning) {
  return /^(?:SENIOR FORECLOSURE|TAX SALE PRIORITY):/i.test(String(warning || '').trim());
}

function titleWarningSeverity(warning) {
  const upper = String(warning || '').toUpperCase();
  if (/CRITICAL TITLE DEFECT|BANKRUPTCY AUTOMATIC STAY|CONDEMN|DEMOLITION/.test(upper)) return 1;
  if (/FEDERAL TAX LIEN|\bIRS\b|26 U\.S\.C\.|DEFECTIVE JOINDER|OMITTED PARTY/.test(upper)) return 2;
  if (/PACE ASSESSMENT|MUNICIPAL|HOA SUPER-PRIORITY|CODE ENFORCEMENT/.test(upper)) return 3;
  if (/UNCONFIRMED LIEN PRIORITY|NORTH CAROLINA 10-DAY UPSET BID/.test(upper)) return 4;
  if (/STATUTORY REDEMPTION/.test(upper)) return 5;
  return 6;
}

/**
 * @param {object|null} [listing] - normalized listing row (null tolerated)
 * @param {string[]} [titleWarnings] - from arbitrateTitleRisk().titleWarnings
 * @param {string} [riskLevel] - from arbitrateTitleRisk().riskLevel
 * @returns {string|null}
 */
function computeCatchSummary(listing = {}, titleWarnings = [], riskLevel = null) {
  const record = listing && typeof listing === 'object' ? listing : {};
  const bid = optNum(record.openingBid);
  const estLow = optNum(record.estLow);
  const estHigh = optNum(record.estHigh);
  const redemption = optNum(record.redemptionDays);
  const seniorLien = optText(record.seniorLienRisk);
  const occupancy = optText(record.occupancy);
  const saleDate = optText(record.saleDate);
  const deposit = optText(record.deposit);
  const judgment = optNum(record.judgment);

  // 1. Critical/High title risk — exclude purely informational priority notes,
  // sort by severity, strip "LABEL: " prefix, and keep the highest-severity sentence.
  if ((riskLevel === 'CRITICAL' || riskLevel === 'HIGH') && titleWarnings.length > 0) {
    const actionable = titleWarnings
      .filter((w) => typeof w === 'string' && w.trim() && !isInformationalTitleNote(w))
      .sort((a, b) => titleWarningSeverity(a) - titleWarningSeverity(b));
    const first = actionable.find(w =>
      !/^STATUTORY REDEMPTION/.test(w) &&
      !/^HOA SUPER-PRIORITY/.test(w)
    ) || actionable[0];
    if (first) {
      const stripped = first.replace(/^[A-Z0-9][A-Z0-9 ''\u2013\u2014\/().§-]*:\s*/, '').trim();
      const truncated = stripped.length > 155 ? stripped.slice(0, 152) + '…' : stripped;
      return truncated;
    }
  }

  const sourceKey = String(record.source || '').trim().toLowerCase();
  const hasFederalTaxLien = /internal revenue|federal tax lien/i.test(`${record.seniorLienRisk || ''} ${titleWarnings.join(' ')}`);
  const isFederalReo = ['hud', 'gsa', 'usda', 'fannie', 'freddie', 'fdic', 'va'].includes(sourceKey) && !hasFederalTaxLien;

  // 2. Statutory redemption (suppressed for federal/agency REO unless IRS lien applies)
  if (!isFederalReo && redemption !== null && redemption > 0) {
    const state = stateLabel(record.state);
    return `${state} law: up to ${Math.round(redemption)}-day statutory redemption window — the former owner may reclaim after sale.`;
  }

  // 3. Senior-lien risk (non-low)
  if (seniorLien && !/^(low|none)$/i.test(seniorLien)) {
    return `Senior-lien risk flagged as "${seniorLien.toLowerCase()}" — liens ahead of this sale may survive it; title search required.`;
  }

  // 4. No opening bid / asking price
  if (bid === null || bid <= 0) {
    if (judgment !== null && judgment > 0) {
      return `No opening bid published — court judgment ${money(judgment)}; the upset price is announced on sale day.`;
    }
    if (isFederalReo) {
      return 'No asking price published in the federal disposition feed — confirm list price on the agency portal.';
    }
    const rawPostponements = optNum(
      record.trajectory?.priorPostponements
      ?? record.provenance?.sourceFacts?.priorPostponements
      ?? record.priorPostponements
    );
    const priorPostponements = rawPostponements !== null && rawPostponements >= 2 ? Math.floor(rawPostponements) : 0;
    const isOccupied = Boolean(
      occupancy && /occupied/i.test(occupancy) && !/\b(?:un|not|non[- ]?)occupied\b/i.test(occupancy)
    );
    if (priorPostponements >= 2 || isOccupied) {
      const occLower = isOccupied ? occupancy.toLowerCase() : null;
      if (priorPostponements >= 2 && isOccupied) {
        const detailed = `No opening amount published — ${priorPostponements} prior postponements, reported ${occLower}; price unknown until sale day.`;
        return detailed.length < 160
          ? detailed
          : `No opening amount published — ${priorPostponements} prior postponements, reported occupied; price unknown until sale day.`;
      }
      if (priorPostponements >= 2) {
        return `No opening amount published — ${priorPostponements} prior postponements; price unknown until sale day, confirm terms.`;
      }
      const detailed = `No opening amount published — reported ${occLower} (no interior access); price unknown until sale day.`;
      return detailed.length < 160
        ? detailed
        : 'No opening amount published — reported occupied (no interior access); price unknown until sale day.';
    }
    return 'No opening amount published — price unknown until sale day; confirm before bidding.';
  }

  const hasPublishedRange = estLow !== null && estHigh !== null && estLow > 0 && estHigh >= estLow;
  const isNominalBid = bid > 0 && bid <= 500 && !hasPublishedRange;
  const bidLead = isNominalBid ? `Nominal ${money(bid)} starting bid (reserve undisclosed)` : `Opening bid ${money(bid)}`;

  // 5. No sale date
  if (!saleDate) {
    return isNominalBid ? `${bidLead} — no sale date is published yet.` : `${bidLead} but no sale date is published yet.`;
  }

  // 6. Occupancy flag
  if (!occupancy) {
    return isNominalBid
      ? `${bidLead}, sale ${saleDate}. Occupancy not disclosed — budget for eviction.`
      : `${bidLead}, sale ${saleDate}. Occupancy not disclosed — assume no interior access and budget for possible eviction.`;
  }
  if (/occupied/i.test(occupancy) && !/\b(?:un|not|non[- ]?)occupied\b/i.test(occupancy)) {
    return isNominalBid
      ? `${bidLead}, sale ${saleDate}. Reported ${occupancy.toLowerCase()} — no interior access.`
      : `${bidLead}, sale ${saleDate}. Reported ${occupancy.toLowerCase()} — expect no interior access and possible eviction cost.`;
  }

  // 7. No deposit terms
  if (!deposit) {
    return isNominalBid
      ? `${bidLead}, sale ${saleDate}. Deposit terms not published.`
      : `${bidLead}, sale ${saleDate}. Deposit terms not published — many sales require certified funds on sale day.`;
  }

  // 8. No valuation range (clean but no comparables)
  if (estLow === null || estHigh === null) {
    return isNominalBid
      ? `${bidLead} on ${saleDate}; no valuation range — obtain independent comps.`
      : `Opens at ${money(bid)} on ${saleDate}; no published valuation range — obtain independent comps before bidding.`;
  }

  return null;
}

module.exports = { computeCatchSummary };
