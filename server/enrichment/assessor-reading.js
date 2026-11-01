'use strict';

const { COUNTY_ARCGIS_REGISTRY, STATEWIDE_ARCGIS_REGISTRY } = require('./arcgis-parcels');

const FL_JUST_VALUE = Object.freeze({
  mode: 'market-figure',
  citation: 'Florida Property Appraiser Just Value (Fla. Stat. § 193.011 Just Valuation), compared 1:1 with the published opening amount.',
});

// Market comparison is allowed only where the registry field is the county's
// market figure, or a statutory fraction the assessor itself applies.
// Cook CERTIFIED_TOTAL is class-dependent. Clark TAX_VAL is taxable value.
// Bannock TOTAL_VAL has no confirmed ratio. Washoe has unconfirmed full-cash chain.
// Those counties return the raw figure and withhold the ratio.
const MARKET_CONVERSION = Object.freeze({
  // Texas CADs
  'TX-BEXAR': Object.freeze({
    mode: 'market-figure',
    citation: 'Bexar CAD APPRAISED_VAL, compared 1:1 with the published opening amount.',
  }),
  'TX-HARRIS': Object.freeze({
    mode: 'market-figure',
    citation: 'Harris County Appraisal District (HCAD) appraised value, compared 1:1 with the published opening amount pursuant to Tex. Tax Code § 23.01.',
  }),
  'TX-TARRANT': Object.freeze({
    mode: 'market-figure',
    citation: 'Tarrant Appraisal District appraised value (APPRAISED_VALUE via the Fort Worth public parcels layer), compared 1:1 with the published opening amount pursuant to Tex. Tax Code § 23.01. Sampled 2026-roll records show APPRAISED_VALUE equal to MARKET_VALUE.',
  }),

  // Arizona County Assessors. A.R.S. § 42-11001(6) makes full cash value the
  // assessor's market-value estimate and caps it at market value ("Full cash
  // value shall not be greater than market value regardless of the method
  // prescribed"), so comparing the opening amount against it leaves the discount
  // a conservative lower bound rather than an inflated one. Verified live against
  // the county's own recorded sales: FullCashValue runs at ~0.82 of recorded sale
  // price (median over ~16,000 dated 2023-2026 sales), while the taxed basis
  // (LimitedPropertyValue) reads ~0.37 - i.e. the field is a market-level figure,
  // not a taxable fraction. AssessedFullCashValue is the taxed basis and is
  // deliberately NOT used as market.
  'AZ-MARICOPA': Object.freeze({
    mode: 'market-figure',
    citation: 'Maricopa County Assessor FullCashValue, the statutory market-value estimate capped at market value by A.R.S. § 42-11001(6), compared with the published opening amount; because full cash value shall not be greater than market value the computed discount is a conservative lower bound. Sampled live at ~0.82 of recorded sale price across ~16,000 dated 2023-2026 sales (LimitedPropertyValue, the taxed basis, reads ~0.37).',
  }),
  // Same statutory basis as Maricopa (A.R.S. § 42-11001 is statewide), but this
  // layer carries no sale-price column, so the entry rests on the definition
  // alone — it must not borrow Maricopa's sampled ratio as if it were measured
  // here. The Pima layer keyed by this entry is Pima-only (sampled JURIS_OL
  // values are Pima jurisdictions).
  'AZ-PIMA': Object.freeze({
    mode: 'market-figure',
    citation: 'Pima County Assessor FCV, the statutory market-value estimate capped at market value by A.R.S. § 42-11001(6), compared with the published opening amount; because full cash value shall not be greater than market value the computed discount is a conservative lower bound. This layer publishes no sale-price column, so the entry rests on the statutory definition alone and is not sale-price corroborated.',
  }),
  // Mohave's layer is a naming trap: the column called TOTAL_FCV_VALUE is the
  // taxed basis (full cash value x the statutory assessment ratio, 0.10-0.15,
  // verified on 2,000 sampled parcels) and ASSESSED_FULL_CASH_VALUE duplicates
  // it. The real full cash value is FULL_CASH_VALUE, verified equal to
  // LANDVALUE + IMPVALUE on 2,000/2,000 sampled parcels and sampled at ~0.81 of
  // the county's own recorded 2025-2026 sale prices - the same market level as
  // Maricopa.
  'AZ-MOHAVE': Object.freeze({
    mode: 'market-figure',
    citation: 'Mohave County Assessor FULL_CASH_VALUE, full cash value under A.R.S. § 42-11001(6) (verified equal to LANDVALUE + IMPVALUE on 2,000 sampled parcels), compared with the published opening amount; because full cash value shall not be greater than market value the computed discount is a conservative lower bound. Sampled live at ~0.81 of recorded sale price across 2025-2026 dated sales. The layer column named TOTAL_FCV_VALUE is the taxed basis (full cash value x statutory assessment ratio) and is deliberately NOT used as market.',
  }),
  'AZ-YUMA': Object.freeze({
    mode: 'market-figure',
    citation: 'Yuma County Assessor TOTAL_FULL_CASH_VALUE (verified equal to LAND_FULL_CASH_VALUE + IMP_FULL_CASH_VALUE on 500 sampled parcels), full cash value under A.R.S. § 42-11001(6), compared with the published opening amount; because full cash value shall not be greater than market value the computed discount is a conservative lower bound. Sampled live at ~0.66 of recorded sale price across 2025-2026 dated sales and above 1.0 against older sales (valuation lag), so the figure tracks the market rather than a taxed fraction.',
  }),

  // Florida Property Appraisers (Fla. Const. art. VII, § 4; Fla. Stat. § 193.011 Just Valuation = 100% FMV)
  'FL-ORANGE': Object.freeze({
    mode: 'market-figure',
    citation: 'Orange County Property Appraiser JUST_VAL, compared 1:1 with the published opening amount.',
  }),
  'FL-ALACHUA': Object.freeze({
    mode: 'market-figure',
    citation: 'Alachua County Property Appraiser justvalue (F.S. § 193.011 Just Valuation), compared 1:1 with the published opening amount.',
  }),
  'FL-MIAMI-DADE': FL_JUST_VALUE,
  'FL-MIAMI DADE': FL_JUST_VALUE,
  'FL-BROWARD': FL_JUST_VALUE,
  'FL-PALMBEACH': FL_JUST_VALUE,
  'FL-PALM BEACH': FL_JUST_VALUE,
  'FL-HILLSBOROUGH': FL_JUST_VALUE,
  'FL-DUVAL': FL_JUST_VALUE,
  'FL-PINELLAS': FL_JUST_VALUE,
  'FL-LEE': FL_JUST_VALUE,
  'FL-POLK': FL_JUST_VALUE,
  'FL-BREVARD': FL_JUST_VALUE,
  'FL-VOLUSIA': FL_JUST_VALUE,
  'FL-SARASOTA': FL_JUST_VALUE,
  'FL-MANATEE': FL_JUST_VALUE,
  'FL-COLLIER': FL_JUST_VALUE,
  'FL-PASCO': FL_JUST_VALUE,
  'FL-SEMINOLE': FL_JUST_VALUE,
  'FL-MARION': FL_JUST_VALUE,
  'FL-OSCEOLA': FL_JUST_VALUE,
  'FL-ST. LUCIE': FL_JUST_VALUE,
  'FL-ST LUCIE': FL_JUST_VALUE,
  'FL-LAKE': FL_JUST_VALUE,
  'FL-ESCAMBIA': FL_JUST_VALUE,
  'FL-CHARLOTTE': FL_JUST_VALUE,
  'FL-CLAY': FL_JUST_VALUE,
  'FL-CITRUS': FL_JUST_VALUE,
  'FL-HERNANDO': FL_JUST_VALUE,
  'FL-MARTIN': FL_JUST_VALUE,
  'FL-OKALOOSA': FL_JUST_VALUE,
  'FL-SANTA ROSA': FL_JUST_VALUE,
  'FL-ST. JOHNS': FL_JUST_VALUE,
  'FL-ST JOHNS': FL_JUST_VALUE,
  'FL-BAY': FL_JUST_VALUE,
  'FL-BAKER': FL_JUST_VALUE,
  'FL-BRADFORD': FL_JUST_VALUE,
  'FL-FLAGLER': FL_JUST_VALUE,
  'FL-FRANKLIN': FL_JUST_VALUE,
  'FL-GADSDEN': FL_JUST_VALUE,
  'FL-HENDRY': FL_JUST_VALUE,
  'FL-HIGHLANDS': FL_JUST_VALUE,
  'FL-HOLMES': FL_JUST_VALUE,
  'FL-INDIAN RIVER': FL_JUST_VALUE,
  'FL-LAFAYETTE': FL_JUST_VALUE,
  'FL-LEON': FL_JUST_VALUE,
  'FL-OKEECHOBEE': FL_JUST_VALUE,
  'FL-PUTNAM': FL_JUST_VALUE,
  'FL-SUMTER': FL_JUST_VALUE,
  'FL-SUWANNEE': FL_JUST_VALUE,
  'FL-TAYLOR': FL_JUST_VALUE,
  'FL-UNION': FL_JUST_VALUE,
  'FL-WALTON': FL_JUST_VALUE,
  'FL-WASHINGTON': FL_JUST_VALUE,
  'FL-STATEWIDE': FL_JUST_VALUE,

  // Ohio County Auditors / Fiscal Officers (Ohio Rev. Code § 5715.01)
  'OH-CUYAHOGA': Object.freeze({
    mode: 'taxable-fraction',
    taxableFraction: 0.35,
    citation: 'Ohio Rev. Code § 5715.01 assesses real property at 35 percent of true value. Market comparison = TOTAL_ASSESSED_VAL / 0.35.',
  }),
  'OH-FRANKLIN': Object.freeze({
    mode: 'market-figure',
    citation: 'Franklin County Auditor TOTVALUEBASE (Base Total Value), compared 1:1 with the published opening amount. The layer carries the Ohio Rev. Code § 5715.01 taxable figure in a separate column (CNTTXBLVAL), so the base figure is the auditor\'s appraised value; sampled sale prices corroborate a market basis.',
  }),
  'OH-HAMILTON': Object.freeze({
    mode: 'market-figure',
    citation: 'Hamilton County Auditor market value (CAGIS MKT_TOTAL_VAL), compared 1:1 with the published opening amount. Ohio Rev. Code § 5715.01 assesses real property at 35 percent of true value; the CAGIS MKT_ fields carry the pre-fraction market figure.',
  }),
  'OH-SUMMIT': Object.freeze({
    mode: 'market-figure',
    citation: 'Summit County Fiscal Office market value (cntmarval), compared 1:1 with the published opening amount. Ohio Rev. Code § 5715.01 assesses real property at 35 percent of true value; the Fiscal Office cntmarval carries the pre-fraction true market value.',
  }),
  'OH-STARK': Object.freeze({
    mode: 'market-figure',
    citation: 'Stark County Auditor appraised total market value (APPRAISED_TOTAL_VALUE), compared 1:1 with the published opening amount pursuant to Ohio Rev. Code § 5715.01.',
  }),
  'OH-LAKE': Object.freeze({
    mode: 'taxable-fraction',
    taxableFraction: 0.35,
    citation: 'Lake County Auditor assessed value (A_VAL_TOTAL). Ohio Rev. Code § 5715.01 assesses real property at 35 percent of true value. Market comparison = A_VAL_TOTAL / 0.35.',
  }),
  'OH-MONTGOMERY': Object.freeze({
    mode: 'market-figure',
    citation: 'Montgomery County Auditor total market value, compared 1:1 with the published opening amount pursuant to Ohio Rev. Code § 5715.01.',
  }),
  'OH-LUCAS': Object.freeze({
    mode: 'market-figure',
    citation: 'Lucas County Auditor total market value, compared 1:1 with the published opening amount pursuant to Ohio Rev. Code § 5715.01.',
  }),
  'OH-BUTLER': Object.freeze({
    mode: 'market-figure',
    citation: 'Butler County Auditor total market value, compared 1:1 with the published opening amount pursuant to Ohio Rev. Code § 5715.01.',
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
  const isFlorida = Boolean(countyKey && countyKey.startsWith('FL-'));
  const config = countyKey ? (
    COUNTY_ARCGIS_REGISTRY[countyKey] ||
    (countyKey === 'FL-STATEWIDE' ? STATEWIDE_ARCGIS_REGISTRY?.FL : null) ||
    (MARKET_CONVERSION[countyKey] ? { name: countyKey, endpoint: null, assessedTotalField: 'JV' } : null) ||
    (isFlorida ? { name: `${countyKey} Property Appraiser`, endpoint: null, assessedTotalField: 'JV' } : null)
  ) : null;

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
  const rule = MARKET_CONVERSION[countyKey] || (isFlorida ? FL_JUST_VALUE : null);
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
