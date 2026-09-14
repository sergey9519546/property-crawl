'use strict';

const { DISTRESS_LIFECYCLE_STAGES, STAGE_IDS, isStageId } = require('./lifecycle');

/**
 * Per-source overrides for the distress lifecycle map.
 *
 * The category-based default lives in `lifecycle.js` (`sourceKinds` per
 * stage). Sources whose actual stage coverage diverges from their category
 * default — or that publish across multiple stages — are listed here so the
 * mapping is explicit and reviewable. Listing a source here means "the
 * category default does not apply; use these stages verbatim".
 *
 * Sources that produce only parcel-level evidence with no distress-stage
 * signal are pinned to UNKNOWN so the lifecycleBySource map covers every
 * catalog source.
 */
const LIFECYCLE_OVERRIDES = Object.freeze({
  // Foreclosure auction platforms — explicit trustee vs. sheriff vs. marketplace split
  'servicelink': Object.freeze(['TRUSTEE_SALE_SCHEDULED', 'AUCTION_SCHEDULED', 'REO_LISTED']),
  'civilview': Object.freeze(['FORECLOSURE_SCHEDULED', 'TAX_DEFAULTED']),
  'bid4assets': Object.freeze(['FORECLOSURE_SCHEDULED', 'AUCTION_SCHEDULED', 'TAX_DEFAULTED']),
  'ohio-sheriff-sale': Object.freeze(['FORECLOSURE_SCHEDULED']),
  'county-trustee-sale': Object.freeze(['TRUSTEE_SALE_SCHEDULED', 'FORECLOSURE_SCHEDULED']),
  'realauction': Object.freeze(['TAX_DEFAULTED', 'AUCTION_SCHEDULED']),

  // Seizure channels often surface seized (pre-foreclosure) property that may
  // also reach the REO pipeline.
  'us-marshals': Object.freeze(['PRE_FORECLOSURE', 'REO_ACQUIRED']),
  'real-look': Object.freeze(['PRE_FORECLOSURE', 'REO_ACQUIRED', 'REO_LISTED']),

  // Marketplace inventory covers live auctions plus already-acquired REO stock.
  'auction-dot-com': Object.freeze(['AUCTION_SCHEDULED', 'REO_LISTED']),
  'hubzu': Object.freeze(['AUCTION_SCHEDULED', 'REO_LISTED']),
  'xome': Object.freeze(['AUCTION_SCHEDULED', 'REO_LISTED']),
  'mls-licensed-feed': Object.freeze(['AUCTION_SCHEDULED', 'REO_LISTED']),

  // Federal Register covers every kind of real-property notice; broad discovery.
  'federal-register': Object.freeze([
    'PRE_FORECLOSURE', 'FORECLOSURE_FILED', 'FORECLOSURE_SCHEDULED',
    'AUCTION_SCHEDULED', 'REO_ACQUIRED', 'REO_LISTED', 'TAX_DEFAULTED'
  ]),
  // County-level public notices; broader than federal but still no REO inventory.
  'jurisdiction-public-notices': Object.freeze([
    'PRE_FORECLOSURE', 'FORECLOSURE_FILED', 'FORECLOSURE_SCHEDULED', 'TAX_DEFAULTED'
  ]),

  // Evidence and discovery sources that need explicit pinning.
  'county-assessor': Object.freeze(['TAX_DEFAULTED']),
  'pacer-bankruptcy': Object.freeze(['FORECLOSURE_FILED']),
  'state-court-dockets': Object.freeze(['FORECLOSURE_FILED']),
  'county-recorder-nod': Object.freeze(['PRE_FORECLOSURE']),
  'courtlistener': Object.freeze(['FORECLOSURE_FILED']),
  'ca-controller-tax-sale': Object.freeze(['TAX_DEFAULTED']),
  'mers-servicerid': Object.freeze(['PRE_FORECLOSURE']),

  // Post-sale recovery is not itself a distress stage; pin to UNKNOWN.
  'excess-funds': Object.freeze(['UNKNOWN']),
  // Aggregate vacancy is area context, not a per-property distress signal.
  'hud-usps-vacancy': Object.freeze(['UNKNOWN'])
});

function stagesFromCategory(category) {
  if (!category) return [];
  const out = [];
  for (const stageId of STAGE_IDS) {
    if (stageId === 'UNKNOWN') continue;
    const kinds = DISTRESS_LIFECYCLE_STAGES[stageId].sourceKinds;
    if (kinds.includes(category)) out.push(stageId);
  }
  return out;
}

function getStagesForSource(sourceEntry) {
  if (!sourceEntry || typeof sourceEntry !== 'object') return ['UNKNOWN'];
  const id = sourceEntry.id;
  if (id && Object.prototype.hasOwnProperty.call(LIFECYCLE_OVERRIDES, id)) {
    const override = LIFECYCLE_OVERRIDES[id];
    const filtered = (override || []).filter((stageId) => isStageId(stageId));
    return filtered.length > 0 ? [...filtered] : ['UNKNOWN'];
  }
  const fromCategory = stagesFromCategory(sourceEntry.category);
  if (fromCategory.length > 0) return fromCategory;
  return ['UNKNOWN'];
}

function lifecycleBySourceFromCatalog(catalog) {
  const out = {};
  if (!Array.isArray(catalog)) return out;
  for (const entry of catalog) {
    if (!entry || !entry.id) continue;
    out[entry.id] = Object.freeze(getStagesForSource(entry));
  }
  return out;
}

module.exports = {
  getStagesForSource,
  lifecycleBySourceFromCatalog,
  LIFECYCLE_OVERRIDES
};
