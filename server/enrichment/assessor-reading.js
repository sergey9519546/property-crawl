'use strict';

const { COUNTY_ARCGIS_REGISTRY } = require('./arcgis-parcels');

// Market comparison is allowed only where the registry field is the county's
// market figure, or a statutory fraction the assessor itself applies.
// Cook CERTIFIED_TOTAL is class-dependent. Clark TAX_VAL is taxable value.
// Bannock TOTAL_VAL has no confirmed ratio. Those counties return the raw
// figure and withhold the ratio.
const MARKET_CONVERSION = Object.freeze({
  'TX-BEXAR': Object.freeze({
    mode: 'market-figure',
    citation: 'Bexar CAD APPRAISED_VAL, compared 1:1 with the published opening amount.',
  }),
  'FL-ORANGE': Object.freeze({
    mode: 'market-figure',
    citation: 'Orange County Property Appraiser JUST_VAL, compared 1:1 with the published opening amount.',
  }),
  'OH-CUYAHOGA': Object.freeze({
    mode: 'taxable-fraction',
    taxableFraction: 0.35,
    citation: 'Ohio Rev. Code § 5715.01 assesses real property at 35 percent of true value. Market comparison = TOTAL_ASSESSED_VAL / 0.35.',
  }),
  'FL-ALACHUA': Object.freeze({
    mode: 'market-figure',
    citation: 'Alachua County Property Appraiser justvalue (F.S. § 193.011 Just Valuation), compared 1:1 with the published opening amount.',
  }),
  'TX-HARRIS': Object.freeze({
    mode: 'market-figure',
    citation: 'Harris County Appraisal District (HCAD) appraised value, compared 1:1 with the published opening amount pursuant to Tex. Tax Code § 23.01.',
  }),
  // Enrolled 2026-10-21 from live-verified endpoints; see
  // reports/assessor-enrollment-2026-10-21.md for the verification method.
  'OH-FRANKLIN': Object.freeze({
    mode: 'market-figure',
    citation: 'Franklin County Auditor TOTVALUEBASE (Base Total Value), compared 1:1 with the published opening amount. The layer carries the Ohio Rev. Code § 5715.01 taxable figure in a separate column (CNTTXBLVAL), so the base figure is the auditor\'s appraised value; sampled sale prices corroborate a market basis.',
  }),
  'OH-HAMILTON': Object.freeze({
    mode: 'market-figure',
    citation: 'Hamilton County Auditor market value (CAGIS MKT_TOTAL_VAL), compared 1:1 with the published opening amount. Ohio Rev. Code § 5715.01 assesses real property at 35 percent of true value; the CAGIS MKT_ fields carry the pre-fraction market figure.',
  }),
  'TX-TARRANT': Object.freeze({
    mode: 'market-figure',
    citation: 'Tarrant Appraisal District appraised value (APPRAISED_VALUE via the Fort Worth public parcels layer), compared 1:1 with the published opening amount pursuant to Tex. Tax Code § 23.01. Sampled 2026-roll records show APPRAISED_VALUE equal to MARKET_VALUE.',
  }),
});

const WITHHOLD = Object.freeze({
  'IL-COOK': 'Cook County CERTIFIED_TOTAL is class-dependent. The raw figure is shown. No market comparison is computed.',
  'NV-CLARK': 'Clark County TAX_VAL is taxable value, not market value. The raw figure is shown. No market comparison is computed.',
  'ID-BANNOCK': 'Bannock County TOTAL_VAL has no confirmed market ratio in this registry. The raw figure is shown. No market comparison is computed.',
  'NV-WASHOE': 'Washoe County TOTALASS is the assessed value; Nevada derives it from taxable value by the NRS 361.227 35 percent ratio, and the chain from full cash (market) value is not confirmed in this layer (TOTALAPR is present but its basis is unconfirmed). The raw figure is shown. No market comparison is computed.',
});

function dealScoreFromRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio < 0) return null;
  return Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)));
}

function interpretAssessorParcel({ countyKey, parcel, openingBid } = {}) {
  const config = countyKey ? COUNTY_ARCGIS_REGISTRY[countyKey] : null;
  if (!config) {
    return {
      enrolled: false,
      found: false,
      countyKey: null,
      evidenceClass: 'assessor-figure-v1',
      field: null,
      rawFigure: null,
      marketComparison: null,
      ratio: null,
      dealScore: null,
      citation: null,
      withheldReason: 'This county is not in the assessor registry.',
      isAppraisal: false,
    };
  }

  const total = Number(parcel?.assessedValue?.total);
  const rawFigure = Number.isFinite(total) && total > 0 ? total : null;
  const rule = MARKET_CONVERSION[countyKey] || null;
  let marketComparison = null;
  let citation = null;
  if (rawFigure !== null && rule?.mode === 'market-figure') {
    marketComparison = Math.round(rawFigure);
    citation = rule.citation;
  } else if (rawFigure !== null && rule?.mode === 'taxable-fraction') {
    marketComparison = Math.round(rawFigure / rule.taxableFraction);
    citation = rule.citation;
  }

  const bid = Number(openingBid);
  const bidOk = Number.isFinite(bid) && bid > 0;
  const ratio = marketComparison && bidOk ? bid / marketComparison : null;
  const dealScore = ratio !== null ? dealScoreFromRatio(ratio) : null;
  let withheldReason = null;
  if (!parcel) withheldReason = 'No parcel matched the published coordinates or APN.';
  else if (rawFigure === null) withheldReason = 'The assessor layer returned no positive total for the configured field.';
  else if (!rule) withheldReason = WITHHOLD[countyKey] || 'No market conversion is configured for this county.';
  else if (!bidOk) withheldReason = 'Opening amount is not published, so no bid-to-figure ratio is computed.';

  return {
    enrolled: true,
    found: Boolean(parcel) && rawFigure !== null,
    countyKey,
    countyName: config.name,
    endpoint: config.endpoint,
    field: config.assessedTotalField,
    apn: parcel?.canonicalApn || null,
    parcelKey: parcel?.canonicalApn
      ? (parcel?.countyFips ? `${parcel.countyFips}-${parcel.canonicalApn}` : parcel.canonicalApn)
      : null,
    landUse: parcel && parcel.landUse && parcel.landUse !== 'UNKNOWN' ? parcel.landUse : null,
    evidenceClass: 'assessor-figure-v1',
    rawFigure,
    marketComparison,
    citation,
    openingBid: bidOk ? bid : null,
    ratio: ratio !== null ? Math.round(ratio * 10000) / 10000 : null,
    dealScore,
    withheldReason: dealScore === null ? withheldReason : null,
    isAppraisal: false,
  };
}

module.exports = {
  MARKET_CONVERSION,
  interpretAssessorParcel,
  dealScoreFromRatio,
};
