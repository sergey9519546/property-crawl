'use strict';

/**
 * Shared Pure-JS Statutory Foreclosure & Tax-Sale Fee Schedules.
 *
 * Consumed by both server/intelligence/cash-to-close.js (Node CJS) and
 * src/lib/underwriting.ts (browser/SSR TS) so sheriff poundage, clerk
 * auction fees, transfer taxes, buyer premiums, and recording baselines
 * never drift between backend packets and frontend simulators.
 */

const JURISDICTION_FEE_SCHEDULES = Object.freeze({
  FL: Object.freeze({
    state: 'FL',
    name: 'Florida',
    scheduleLabel: 'Florida Clerk Judicial Schedule (Fla. Stat. § 28.24 & § 201.02)',
    docStampRatePerThousand: 7.00,
    defaultSheriffPoundagePercent: 0.015,
    defaultRecordingFee: 100.00,
    defaultDepositPct: 0.05,
    settlementWindowHours: 24,
    notes: 'Fla. Stat. § 28.24(10) clerk fee (3% first $500 + 1.5% balance) + Fla. Stat. § 201.02 doc stamps ($0.70 per $100). Certified funds due within 24 hours.',
  }),
  PA: Object.freeze({
    state: 'PA',
    name: 'Pennsylvania',
    scheduleLabel: 'Pennsylvania Sheriff Statutory Schedule (42 Pa.C.S. § 21107 & 72 P.S. § 8102-C)',
    docStampRatePerThousand: 20.00,
    defaultSheriffPoundagePercent: 0.02,
    defaultRecordingFee: 150.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 720,
    notes: '2% standard transfer tax + 42 Pa.C.S. § 21107 sheriff poundage (2% up to $250k + 0.5% on excess). Balance due within 30 days of sale gavel.',
  }),
  NJ: Object.freeze({
    state: 'NJ',
    name: 'New Jersey',
    scheduleLabel: 'New Jersey Sheriff Statutory Schedule (N.J.S.A. 22A:4-8 & 46:15-7)',
    docStampRatePerThousand: 10.00,
    defaultSheriffPoundagePercent: 0.02,
    defaultRecordingFee: 120.00,
    defaultDepositPct: 0.20,
    settlementWindowHours: 720,
    notes: 'N.J.S.A. 22A:4-8 tiered poundage (6% first $5k, 4% next $15k, 2% over $20k; $150 min) + Realty Transfer Fee (~1.0% baseline). 20% deposit at sale; balance in 30 days.',
  }),
  OH: Object.freeze({
    state: 'OH',
    name: 'Ohio',
    scheduleLabel: 'Ohio Sheriff Statutory Schedule (ORC § 311.17 & § 319.54)',
    docStampRatePerThousand: 4.00,
    defaultSheriffPoundagePercent: 0.015,
    defaultRecordingFee: 80.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 720,
    notes: 'R.C. 319.54 conveyance fees ($4 per $1k) + R.C. 311.17 1.5% sheriff poundage. Balance due upon judicial confirmation of sale.',
  }),
  CA: Object.freeze({
    state: 'CA',
    name: 'California',
    scheduleLabel: 'California Non-Judicial Trustee Schedule (Cal. Civ. Code § 2924h & § 2924m; Rev. & Tax Code § 11911)',
    docStampRatePerThousand: 1.10,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 95.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 0,
    notes: 'Cal. Rev. & Tax. Code § 11911 documentary transfer tax. 100% certified funds required at gavel.',
  }),
  NC: Object.freeze({
    state: 'NC',
    name: 'North Carolina',
    scheduleLabel: 'North Carolina Judicial / Trustee Schedule (N.C.G.S. § 45-21.15 & § 105-228.30)',
    docStampRatePerThousand: 2.00,
    defaultSheriffPoundagePercent: 0.05,
    defaultRecordingFee: 64.00,
    defaultDepositPct: 0.05,
    settlementWindowHours: 240,
    notes: 'N.C.G.S. § 45-21.27 10-day upset-bid period. 5% deposit floor ($750 min).',
  }),
  TX: Object.freeze({
    state: 'TX',
    name: 'Texas',
    scheduleLabel: 'Texas Constable / Trustee Schedule (Tex. Civ. Prac. & Rem. Code)',
    docStampRatePerThousand: 0.00,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 50.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 4,
    notes: 'Texas Const. art. VIII § 29 $0 state transfer tax. 100% certified funds due at sale.',
  }),
  GA: Object.freeze({
    state: 'GA',
    name: 'Georgia',
    scheduleLabel: 'Georgia Non-Judicial Foreclosure Schedule (O.C.G.A. § 44-14-162 & § 48-6-1)',
    docStampRatePerThousand: 1.00,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 25.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 4,
    notes: 'O.C.G.A. § 44-14-162 non-judicial foreclosure under power of sale. First Tuesday auction; immediate payment.',
  }),
  IL: Object.freeze({
    state: 'IL',
    name: 'Illinois',
    scheduleLabel: 'Illinois Judicial Mortgage Foreclosure Schedule (735 ILCS 5/15-1507 & 35 ILCS 200/31-10)',
    docStampRatePerThousand: 1.50,
    defaultSheriffPoundagePercent: 0.01,
    defaultRecordingFee: 100.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 720,
    notes: '735 ILCS 5/15-1507 judicial foreclosure. Balance due upon judicial confirmation of sale.',
  }),
  NY: Object.freeze({
    state: 'NY',
    name: 'New York',
    scheduleLabel: 'New York Judicial Referee Schedule (RPAPL § 1354 & CPLR § 8003(b))',
    docStampRatePerThousand: 4.00,
    defaultSheriffPoundagePercent: 0.01,
    defaultRecordingFee: 150.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 720,
    notes: 'RPAPL § 1354 referee deed sale. 10% deposit at auction; 30 days to close with referee.',
  }),
  MI: Object.freeze({
    state: 'MI',
    name: 'Michigan',
    scheduleLabel: 'Michigan Sheriff Foreclosure Schedule (MCL § 600.2558 & § 207.525)',
    docStampRatePerThousand: 4.30,
    defaultSheriffPoundagePercent: 0.005,
    defaultRecordingFee: 30.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 0,
    notes: 'MCL § 600.3201 foreclosure by advertisement. $4.30/k transfer tax; 6-month statutory redemption applies.',
  }),
  NV: Object.freeze({
    state: 'NV',
    name: 'Nevada',
    scheduleLabel: 'Nevada Non-Judicial Trustee Schedule (NRS 107.080 & NRS 375.020)',
    docStampRatePerThousand: 3.90,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 75.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 0,
    notes: 'NRS 107.080 non-judicial trustee sale. NRS 375.020 transfer tax. 0-day post-sale redemption.',
  }),
  TN: Object.freeze({
    state: 'TN',
    name: 'Tennessee',
    scheduleLabel: 'Tennessee Deed of Trust Foreclosure Schedule (T.C.A. § 35-5-101 & § 67-4-409)',
    docStampRatePerThousand: 3.70,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 50.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 4,
    notes: 'T.C.A. § 35-5-101 deed of trust sale (0-day redemption if waived) vs. T.C.A. § 67-5-2701 tax sale (1-year statutory redemption with 12% interest).',
  }),
  WA: Object.freeze({
    state: 'WA',
    name: 'Washington',
    scheduleLabel: 'Washington State Non-Judicial & Tax Foreclosure Schedule (RCW 61.24 & RCW 82.45)',
    docStampRatePerThousand: 16.00,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 200.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 0,
    notes: 'RCW 61.24.040 non-judicial trustee sale (0-day redemption). RCW 84.64.080 tax foreclosure (30-day confirmation appeal window).',
  }),
  SC: Object.freeze({
    state: 'SC',
    name: 'South Carolina',
    scheduleLabel: 'South Carolina Statutory Schedule (S.C. Code Ann. § 12-24-10 & § 15-39-720)',
    docStampRatePerThousand: 3.70,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 50.00,
    defaultDepositPct: 0.05,
    settlementWindowHours: 48,
    notes: 'S.C. Code Ann. § 12-51-90 tax sale (1-year statutory redemption with 3-12% penalty). S.C. Code Ann. § 15-39-720 30-day upset bid period.',
  }),
  VA: Object.freeze({
    state: 'VA',
    name: 'Virginia',
    scheduleLabel: 'Virginia Non-Judicial Trustee Schedule (Va. Code Ann. § 55.1-320 & § 58.1-801)',
    docStampRatePerThousand: 3.33,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 65.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 0,
    notes: 'Va. Code Ann. § 55.1-320 deed of trust non-judicial foreclosure (0-day post-sale redemption).',
  }),
  IN: Object.freeze({
    state: 'IN',
    name: 'Indiana',
    scheduleLabel: 'Indiana Tax Sale & Judicial Schedule (Ind. Code § 6-1.1-25-1 & § 32-29-7-3)',
    docStampRatePerThousand: 0.00,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 35.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 24,
    notes: 'Ind. Code § 6-1.1-25-1 tax sale certificate (1-year statutory redemption with 10-15% penalty). Ind. Code § 32-29-7-3 judicial mortgage foreclosure.',
  }),
  MO: Object.freeze({
    state: 'MO',
    name: 'Missouri',
    scheduleLabel: 'Missouri Tax & Trustee Schedule (Mo. Rev. Stat. § 140.340 & § 443.410)',
    docStampRatePerThousand: 0.00,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 24.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 0,
    notes: 'Mo. Rev. Stat. § 140.340 tax sale (1-year statutory redemption with 10% interest). Mo. Rev. Stat. § 443.410 non-judicial trustee foreclosure.',
  }),
  AZ: Object.freeze({
    state: 'AZ',
    name: 'Arizona',
    scheduleLabel: 'Arizona Tax Certificate & Trustee Schedule (A.R.S. § 42-18153 & § 33-807)',
    docStampRatePerThousand: 0.00,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 30.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 0,
    notes: 'A.R.S. § 42-18153 tax certificate auction (3-year redemption with 16% interest). A.R.S. § 33-807 non-judicial trustee sale (0-day post-sale redemption).',
  }),
  MD: Object.freeze({
    state: 'MD',
    name: 'Maryland',
    scheduleLabel: 'Maryland Judicial Foreclosure Schedule (Md. Rule 14-207 & § 13-203)',
    docStampRatePerThousand: 5.00,
    defaultSheriffPoundagePercent: 0.00,
    defaultRecordingFee: 60.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 24,
    notes: 'Md. Code Tax-Prop. § 14-827 tax sale certificate auction (6-month statutory redemption). 0.5% state transfer tax.',
  }),
  AL: Object.freeze({
    state: 'AL',
    name: 'Alabama',
    scheduleLabel: 'Alabama Sheriff Statutory Schedule (Ala. Code § 12-19-90 & § 40-22-1)',
    docStampRatePerThousand: 1.00,
    defaultSheriffPoundagePercent: 0.015,
    defaultRecordingFee: 40.00,
    defaultDepositPct: 0.10,
    settlementWindowHours: 24,
    notes: 'Ala. Code § 40-22-1 deed tax ($1/k). Ala. Code § 6-5-248 180-day post-foreclosure statutory redemption for residential homestead (or 1 year otherwise).',
  }),
});

const DEFAULT_SCHEDULE = Object.freeze({
  state: 'US',
  name: 'Standard US Default',
  scheduleLabel: 'US Statutory Baseline (Not Yet Modeled)',
  docStampRatePerThousand: 5.00,
  defaultSheriffPoundagePercent: 0.00,
  defaultRecordingFee: 100.00,
  defaultDepositPct: 0.10,
  settlementWindowHours: 48,
  notes: 'Standard statutory baseline estimates.',
});

function computeStatutoryStateFees({
  purchasePrice,
  state,
  source = null,
  distressType = null,
  isTaxSale = null,
  isMarketplace = null,
} = {}) {
  const rawPrice = Number(purchasePrice);
  const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 0;
  const st = String(state || '').trim().toUpperCase();
  const src = String(source || '').trim().toLowerCase();
  const schedule = JURISDICTION_FEE_SCHEDULES[st] || DEFAULT_SCHEDULE;
  const supported = Boolean(JURISDICTION_FEE_SCHEDULES[st]);
  const marketplace = Boolean(isMarketplace || src === 'bid4assets' || src === 'servicelink');
  const isTax = Boolean(isTaxSale || distressType === 'tax_sale' || src.includes('tax'));
  const citations = [];

  const buyersPremium = marketplace && price > 0 ? Math.max(2500, Math.round(price * 0.05)) : 0;
  if (marketplace) {
    citations.push("Marketplace schedule assumption: 5% ($2,500 min) buyer's premium on portal auctions.");
  } else {
    citations.push("Direct government / court auction assumption: $0 marketplace buyer's premium.");
  }

  let sheriffPoundage = 0;
  let transferTax = 0;
  let defaultDepositPct = schedule.defaultDepositPct ?? 0.10;
  let scheduleLabel = supported
    ? schedule.scheduleLabel
    : `${st || 'State'} Statutory Baseline (Not Yet Modeled)`;

  if (price > 0) {
    switch (st) {
      case 'NJ': {
        const tier1 = Math.min(price, 5000) * 0.06;
        const tier2 = Math.max(0, Math.min(price - 5000, 15000)) * 0.04;
        const tier3 = Math.max(0, price - 20000) * 0.02;
        sheriffPoundage = Math.max(150, Math.round(tier1 + tier2 + tier3));
        transferTax = Math.round(price * 0.01);
        citations.push(
          'N.J.S.A. 22A:4-8: Sheriff commission 6% on first $5k, 4% on next $15k, 2% above $20k ($150 min).',
          'N.J.S.A. 46:15-7: NJ Realty Transfer Fee baseline (~1.0% tiered statutory schedule).',
          'N.J.S.A. 2A:50-64: 20% statutory sheriff sale deposit at knockdown.'
        );
        break;
      }
      case 'OH': {
        sheriffPoundage = Math.round(price * 0.015);
        transferTax = Math.round((price / 1000) * 4);
        citations.push(
          'ORC § 311.17(B)(1): Sheriff poundage 1.5% of foreclosure sale proceeds.',
          'ORC § 319.54(G)(3): County auditor conveyance fee baseline ($4.00 per $1,000).'
        );
        break;
      }
      case 'FL': {
        sheriffPoundage = Math.round(Math.min(price, 500) * 0.03 + Math.max(0, price - 500) * 0.015);
        transferTax = Math.round(Math.ceil(price / 100) * 0.70);
        citations.push(
          'Fla. Stat. § 28.24(10): Clerk registry fee 3% on first $500 + 1.5% on balance.',
          'Fla. Stat. § 201.02: Documentary stamp tax $0.70 per $100 of consideration.',
          'Fla. Stat. § 45.031(3): 5% statutory judicial auction deposit at sale.'
        );
        break;
      }
      case 'PA': {
        sheriffPoundage = Math.round(Math.min(price, 250000) * 0.02 + Math.max(0, price - 250000) * 0.005);
        transferTax = Math.round(price * 0.02);
        citations.push(
          '42 Pa.C.S. § 21107: Sheriff poundage 2% up to $250k + 0.5% on excess.',
          '72 P.S. § 8102-C: PA Realty Transfer Tax (1% state + 1% typical local municipal/school).'
        );
        break;
      }
      case 'NC': {
        sheriffPoundage = Math.min(Math.round(price * 0.05), 25000);
        transferTax = Math.round(price / 500);
        citations.push(
          'N.C.G.S. § 45-21.15: Trustee/commissioner statutory commission cap (up to 5%).',
          'N.C.G.S. § 105-228.30: NC Excise Tax $1.00 per $500 ($2.00 per $1,000).',
          'N.C.G.S. § 45-21.27: 5% minimum deposit ($750 floor) for judicial/upset bids.'
        );
        break;
      }
      case 'TX': {
        sheriffPoundage = 0;
        transferTax = 0;
        citations.push(
          'Texas Const. art. VIII § 29: $0 state real estate transfer tax.',
          "Tex. Local Gov't Code § 118.011: County clerk recording fee ($34 typical baseline).",
          'Tex. Tax Code § 34.015: Purchaser tax certificate required before deed execution.'
        );
        break;
      }
      case 'CA': {
        sheriffPoundage = Math.min(Math.round(price * 0.01), 1500);
        transferTax = Math.round((price / 1000) * 1.10);
        citations.push(
          "Cal. Civ. Code § 2924h: 100% cashier's check / certified funds requirement at trustee sale.",
          'Cal. Rev. & Tax Code § 11911: County documentary transfer tax ($1.10 per $1,000 baseline).',
          'Cal. Civ. Code § 2924m (SB 1079): 45-day post-sale eligible bidder window on 1-4 unit residential.'
        );
        break;
      }
      case 'GA': {
        sheriffPoundage = 0;
        transferTax = Math.round(price / 1000);
        if (isTax) {
          scheduleLabel = 'Georgia First Tuesday Tax Deed Schedule (O.C.G.A. § 48-4-1 et seq. & § 48-4-40)';
          defaultDepositPct = 0.20;
          citations.push(
            'O.C.G.A. § 48-4-1: County tax commissioner / sheriff first Tuesday tax execution sale.',
            'O.C.G.A. § 48-4-40: 12-month (365 days) statutory right of redemption with 20% statutory penalty in Year 1.',
            'O.C.G.A. § 48-4-45: Mandatory barment of redemption notice after 12 months to ripen fee simple title.',
            'O.C.G.A. § 48-6-1: Georgia Real Estate Transfer Tax ($1.00 per $1,000 of consideration).'
          );
        } else {
          citations.push(
            'O.C.G.A. § 44-14-162: Non-judicial foreclosure under power of sale (first Tuesday auction; 0-day post-sale redemption).',
            'O.C.G.A. § 48-6-1: Georgia Real Estate Transfer Tax ($1.00 per $1,000 of consideration).'
          );
        }
        break;
      }
      case 'IL': {
        sheriffPoundage = Math.min(Math.round(price * 0.01), 1000);
        transferTax = Math.round((price / 1000) * 1.50);
        citations.push(
          '735 ILCS 5/15-1507(e): Sheriff or designated selling officer statutory fee schedule.',
          '35 ILCS 200/31-10: Combined state ($1.00/k) and county ($0.50/k) real estate transfer stamps.',
          '735 ILCS 5/15-1508: Mandatory judicial confirmation of sale before deed delivery.'
        );
        break;
      }
      case 'NY': {
        sheriffPoundage = Math.min(Math.round(price * 0.01), 1100);
        transferTax = Math.round((price / 500) * 2.00);
        citations.push(
          'RPAPL § 1354: Distribution of mortgage foreclosure sale proceeds and referee deed.',
          'CPLR § 8003(b): Statutory referee compensation cap on mortgage foreclosure sales ($750–$1,100).',
          'NY Tax Law § 1402: NY State Real Estate Transfer Tax ($2.00 per $500 / $4.00 per $1,000).'
        );
        break;
      }
      case 'MI': {
        sheriffPoundage = Math.min(Math.round(price * 0.005), 500);
        transferTax = Math.round((price / 1000) * 4.30);
        citations.push(
          'MCL § 600.2558: Sheriff statutory foreclosure sale fee schedule.',
          'MCL § 207.505 & § 207.525: Combined state ($3.75/k) and county ($0.55/k) transfer tax ($4.30/k).',
          'MCL § 600.3240: Statutory post-sale redemption period (6 months standard, 1 month if abandoned).'
        );
        break;
      }
      case 'NV': {
        sheriffPoundage = 0;
        transferTax = Math.round((price / 500) * 1.95);
        citations.push(
          'NRS 107.080: Non-judicial trustee power of sale (0 days post-sale redemption).',
          'NRS 375.020: Real Property Transfer Tax ($1.95 per $500 / $3.90 per $1,000 baseline).',
          'NRS 116.3116: 9-month HOA super-priority assessment primes first deed of trust.'
        );
        break;
      }
      case 'TN': {
        sheriffPoundage = 0;
        transferTax = Math.round((price / 1000) * 3.70);
        if (isTax) {
          scheduleLabel = 'Tennessee Chancery / County Tax Sale Schedule (T.C.A. § 67-5-2701 & § 67-4-409)';
          citations.push(
            'T.C.A. § 67-5-2701: 365-day (1 year) statutory tax sale right of redemption with 12% per annum interest.',
            'T.C.A. § 67-4-409: Tennessee state recordation/transfer tax ($0.37 per $100 / $3.70 per $1,000).'
          );
        } else {
          citations.push(
            'T.C.A. § 35-5-101: Non-judicial deed of trust sale under power (0-day post-sale redemption when waived in deed of trust).',
            'T.C.A. § 67-4-409: Tennessee state recordation/transfer tax ($0.37 per $100 / $3.70 per $1,000).'
          );
        }
        break;
      }
      case 'WA': {
        sheriffPoundage = 0;
        transferTax = Math.round((price / 1000) * 16.00);
        citations.push(
          'RCW 61.24.040: Non-judicial trustee sale under deed of trust (0-day post-sale redemption).',
          'RCW 84.64.080: County tax foreclosure deed sale (immediate deed execution; 30-day appeal window under RCW 84.64.120).',
          'RCW 82.45.060: Washington Real Estate Excise Tax (REET) (1.10% state baseline + 0.50% local typical).'
        );
        break;
      }
      case 'MD': {
        sheriffPoundage = 0;
        transferTax = Math.round((price / 1000) * 5.00);
        if (isTax) {
          scheduleLabel = 'Maryland Tax Sale Certificate Auction Schedule (Md. Code Tax-Prop. § 14-827 & § 13-203)';
          citations.push(
            'Md. Code Tax-Prop. § 14-827: 180-day (6-month) statutory redemption period before bill to foreclose right of redemption.',
            'Md. Code Tax-Prop. § 14-820: County statutory interest rate on tax certificate redemption (12% to 20% typical).',
            'Md. Code Tax-Prop. § 13-203: Maryland state transfer tax (0.5% / $5.00 per $1,000).'
          );
        } else {
          citations.push(
            'Md. Rule 14-215: Mandatory court ratification of foreclosure sale before deed delivery.',
            'Md. Code Tax-Prop. § 13-203: Maryland state transfer tax (0.5% / $5.00 per $1,000).'
          );
        }
        break;
      }
      case 'AL': {
        sheriffPoundage = Math.round(price * 0.015);
        transferTax = Math.round((price / 1000) * 1.00);
        citations.push(
          'Ala. Code § 12-19-90: Sheriff execution fee baseline (approx 1.5% poundage).',
          'Ala. Code § 40-22-1: Alabama deed recording tax ($0.50 per $500 / $1.00 per $1,000 of purchase consideration).',
          'Ala. Code § 6-5-248: 180-day post-sale statutory redemption for residential homestead property (1-year otherwise).'
        );
        break;
      }
      default: {
        sheriffPoundage = Math.round(price * (schedule.defaultSheriffPoundagePercent || 0));
        transferTax = Math.round((price / 1000) * (schedule.docStampRatePerThousand ?? 5.00));
        if (!supported) {
          citations.push(
            `Statutory fee preset unavailable for state ${st || 'unknown'}. Baseline state recording/transfer assumption (0.5% of price); verify county fee schedule.`
          );
        } else {
          citations.push(schedule.notes);
        }
        break;
      }
    }
  }

  return {
    state: st || 'US',
    schedule,
    scheduleLabel,
    supported,
    notice: supported
      ? null
      : `Statutory fee preset unavailable for state ${st || 'unknown'}. Showing generic baseline estimates.`,
    buyersPremium,
    sheriffPoundage,
    transferTax,
    defaultRecordingFee: schedule.defaultRecordingFee,
    defaultDepositPct,
    settlementWindowHours: schedule.settlementWindowHours,
    statutoryNotes: schedule.notes,
    isMarketplace: marketplace,
    citations,
  };
}

module.exports = {
  JURISDICTION_FEE_SCHEDULES,
  DEFAULT_SCHEDULE,
  computeStatutoryStateFees,
};
