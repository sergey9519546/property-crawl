'use strict';

/**
 * Distress lifecycle enum (P1 — competitive intel synthesis 2026-09-13 §8).
 *
 * Each stage describes a discrete point in the foreclosure / tax / REO
 * pipeline that a property may be in when a catalog source observes it.
 * Stages are intentionally coarse: they are a triage vocabulary for the
 * source network, not a per-record state machine.
 *
 * `sourceKinds` lists the catalog source categories that emit this stage by
 * default. Per-source overrides live in `source-lifecycle.js`.
 *
 * This enum is independent from `mapDistressStage(source, saleDate)` in
 * `server/scrapers/normalization.js`. That function reduces a single observed
 * listing to one of five triage buckets for the listing API; this enum
 * describes which lifecycle stages a publisher may surface across its feed.
 */

const DISTRESS_LIFECYCLE_STAGES = Object.freeze({
  PRE_FORECLOSURE: Object.freeze({
    label: 'Pre-foreclosure',
    description: 'Notice of default or notice of sale recorded by the recorder or servicer; borrower still in default, sale not yet scheduled.',
    sourceKinds: ['title_evidence', 'government_seizure', 'public_notice']
  }),
  FORECLOSURE_FILED: Object.freeze({
    label: 'Foreclosure filed',
    description: 'Judicial foreclosure complaint, lis pendens, or bankruptcy filing recorded; case is open in court.',
    sourceKinds: ['court_record', 'public_notice']
  }),
  FORECLOSURE_SCHEDULED: Object.freeze({
    label: 'Foreclosure scheduled',
    description: 'Sheriff or judicial foreclosure sale has a published sale date and bidder instructions.',
    sourceKinds: ['foreclosure_auction', 'public_notice']
  }),
  TRUSTEE_SALE_SCHEDULED: Object.freeze({
    label: 'Trustee sale scheduled',
    description: 'Nonjudicial trustee sale scheduled under deed of trust; trustee or county publisher has posted notice.',
    sourceKinds: ['foreclosure_auction']
  }),
  AUCTION_SCHEDULED: Object.freeze({
    label: 'Auction scheduled',
    description: 'Third-party marketplace auction is open and accepting bidder registration.',
    sourceKinds: ['marketplace', 'foreclosure_auction', 'public_notice']
  }),
  REO_ACQUIRED: Object.freeze({
    label: 'REO acquired',
    description: 'Title transferred to a lender or government entity following a foreclosure or forfeiture auction.',
    sourceKinds: ['government_reo', 'government_seizure']
  }),
  REO_LISTED: Object.freeze({
    label: 'REO listed',
    description: 'Lender- or agency-owned property is actively listed for sale through a public marketplace.',
    sourceKinds: ['government_reo', 'government_surplus', 'land_bank', 'marketplace']
  }),
  TAX_DEFAULTED: Object.freeze({
    label: 'Tax defaulted',
    description: 'Tax delinquency recorded with the county; tax lien or tax-deed sale may follow on the published calendar.',
    sourceKinds: ['tax_sale', 'title_evidence', 'public_notice']
  }),
  UNKNOWN: Object.freeze({
    label: 'Unknown',
    description: 'Distress stage cannot be inferred from the source category alone; requires parcel-level evidence or a per-record override.',
    sourceKinds: []
  })
});

const STAGE_IDS = Object.freeze(Object.keys(DISTRESS_LIFECYCLE_STAGES));

function isStageId(value) {
  return typeof value === 'string' && STAGE_IDS.includes(value);
}

module.exports = { DISTRESS_LIFECYCLE_STAGES, STAGE_IDS, isStageId };
