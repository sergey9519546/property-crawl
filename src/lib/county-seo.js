'use strict';

/**
 * Programmatic SEO helper functions for county docket pages.
 * Handles county slug normalization, metadata generation, statutory schedules, and schema.org structured data.
 */

const { STATE_REDEMPTION_RULES } = require('../../server/ai/legal-rules.js');
const { JURISDICTION_FEE_SCHEDULES } = require('../../server/intelligence/cash-to-close.js');

const DEFAULT_BASE_URL = 'https://perfectproperty.org';

const HYPHENATED_COUNTIES = new Set(['miami-dade', 'jo-daviess', 'matanuska-susitna', 'isle-of-wight']);

/**
 * Normalizes a URL slug or raw county parameter to a standardized title-cased county name.
 * e.g. "essex" -> "Essex"
 *      "orange-county" -> "Orange County"
 *      "miami-dade" -> "Miami-Dade"
 *      "san-diego" -> "San Diego"
 *      "Cuyahoga" -> "Cuyahoga"
 *      "prince-george-s" -> "Prince George's"
 */
function normalizeCountySlug(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {}

  const trimmed = decoded.trim();
  if (!trimmed) return '';

  const lowerSlug = trimmed.toLowerCase().replace(/['’]/g, '');

  // Check known hyphenated county names
  if (HYPHENATED_COUNTIES.has(lowerSlug)) {
    return lowerSlug
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('-');
  }

  // Reconstruct possessive 's from URL slug (e.g. prince-george-s -> prince-george's)
  const possessive = trimmed.replace(/[-_]s\b/gi, "'s");
  // Replace hyphens or underscores with spaces
  const spaced = possessive.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');

  // Capitalize words
  return spaced
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      // Special handling for contractions or apostrophes e.g. George's or O'Brien
      if (lower.includes("'")) {
        return lower
          .split("'")
          .map((sub, i) => (i === 0 ? sub.charAt(0).toUpperCase() + sub.slice(1) : sub))
          .join("'");
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Converts a county name to a canonical URL slug.
 * e.g. "Essex" -> "essex"
 *      "Orange County" -> "orange-county"
 *      "Miami-Dade" -> "miami-dade"
 */
function countyToSlug(county) {
  if (!county || typeof county !== 'string') return '';
  return county
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Returns the formal display name for a county.
 * Adds "County" unless it's already present or a Parish/Borough/Census Area.
 */
function formatCountyDisplayName(county) {
  const norm = normalizeCountySlug(county);
  if (!norm) return '';
  if (/(?:county|parish|borough|census area|city)$/i.test(norm)) {
    return norm;
  }
  return `${norm} County`;
}

/**
 * Computes median value from an array of numbers.
 */
function computeMedian(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (nums.length === 0) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/**
 * Computes summary metrics for listings within a county.
 */
function computeCountyStats(listings = []) {
  const list = Array.isArray(listings) ? listings : [];
  const openingBids = [];
  const dealScores = [];
  const sourceBreakdown = {};
  const propertyTypes = {};

  for (const item of list) {
    if (item.openingBid != null) openingBids.push(Number(item.openingBid));
    if (item.dealScore != null) dealScores.push(Number(item.dealScore));

    const source = String(item.source || 'other').toLowerCase();
    sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;

    const pType = String(item.propType || 'Other');
    propertyTypes[pType] = (propertyTypes[pType] || 0) + 1;
  }

  return {
    totalCount: list.length,
    medianOpeningBid: computeMedian(openingBids),
    medianDealScore: computeMedian(dealScores),
    sourceBreakdown,
    propertyTypes,
  };
}

/**
 * Retrieves the statutory redemption and upset bid overview for a given 2-letter state code.
 */
function getStatutoryRedemption(stateCode) {
  const code = String(stateCode || '').trim().toUpperCase();
  const rule = STATE_REDEMPTION_RULES[code];
  if (!rule) {
    return {
      days: null,
      label: 'Statutory redemption details require review of local judicial confirmation proceedings and state statutes.',
      stateCode: code,
      upsetBid: {
        hasUpsetBid: false,
        windowDays: 0,
        minDepositPct: null,
        minDepositFloor: null,
        statute: null,
        description: null,
      },
      homesteadDistinction: null,
      statuteCitation: null,
    };
  }

  // Upset bid rules
  let upsetBid = {
    hasUpsetBid: false,
    windowDays: 0,
    minDepositPct: null,
    minDepositFloor: null,
    statute: null,
    description: 'No statutory upset bid period; bidding concludes at auction gavel or confirmation.',
  };

  if (code === 'NC') {
    upsetBid = {
      hasUpsetBid: true,
      windowDays: 10,
      minDepositPct: 0.05,
      minDepositFloor: 750,
      statute: 'N.C.G.S. § 45-21.27',
      description: '10-day statutory upset bid period; each qualifying upset bid (minimum 5% increase or $750 floor deposited with Clerk of Superior Court) reopens a new 10-day window.',
    };
  } else if (code === 'SC') {
    upsetBid = {
      hasUpsetBid: true,
      windowDays: 30,
      minDepositPct: 0.05,
      minDepositFloor: null,
      statute: 'S.C. Code § 15-39-720',
      description: '30-day upset bid period remains open unless plaintiff expressly waives deficiency judgment in foreclosure complaint.',
    };
  }

  // Homestead vs Non-homestead distinctions
  let homesteadDistinction = null;
  if (code === 'AL') {
    homesteadDistinction = {
      hasDistinction: true,
      homesteadDays: 180,
      nonHomesteadDays: 365,
      statute: 'Ala. Code § 6-5-248',
      interestRatePct: 12,
      description: '180-day post-sale statutory redemption for residential homestead property; 1-year (365 days) for non-homestead or investment property with 12% per annum statutory interest (Ala. Code § 40-10-122).',
    };
  } else if (code === 'TX') {
    homesteadDistinction = {
      hasDistinction: true,
      homesteadDays: 730,
      nonHomesteadDays: 180,
      statute: 'Tex. Tax Code § 34.21',
      interestRatePct: 25,
      description: '2-year (730-day) right of redemption for homestead and agricultural property (25% statutory penalty Year 1, 50% Year 2); 180 days for other real property; 0 days for non-judicial mortgage foreclosure.',
    };
  } else if (code === 'MI') {
    homesteadDistinction = {
      hasDistinction: true,
      homesteadDays: 180,
      nonHomesteadDays: 30,
      statute: 'MCL § 600.3240',
      interestRatePct: 0,
      description: '6-month (180-day) statutory redemption standard; shortened to 30 days if property is legally determined abandoned.',
    };
  } else if (code === 'IA') {
    homesteadDistinction = {
      hasDistinction: true,
      homesteadDays: 365,
      nonHomesteadDays: 180,
      statute: 'Iowa Code § 628.3',
      interestRatePct: 0,
      description: '1-year (365-day) statutory right of redemption; reduced to 6 months if deficiency waived or 30 days if abandoned.',
    };
  }

  // Extract statutory citation from rule label
  const match = rule.label.match(/\(([^)]+)\)/);
  const statuteCitation = match ? match[1] : null;

  return {
    days: rule.days,
    label: rule.label,
    stateCode: code,
    upsetBid,
    homesteadDistinction,
    statuteCitation,
  };
}

/**
 * Retrieves the state statutory fee schedule, transfer taxes, and sheriff poundage citations.
 */
function getStatutoryFeeSchedule(stateCode, baselinePrice = 150000) {
  const code = String(stateCode || '').trim().toUpperCase();
  const schedule = JURISDICTION_FEE_SCHEDULES[code] || null;
  const price = typeof baselinePrice === 'number' && Number.isFinite(baselinePrice) && baselinePrice > 0 ? baselinePrice : 150000;

  if (!schedule) {
    return {
      state: code,
      name: code || 'United States',
      isSupported: false,
      scheduleLabel: `${code || 'State'} Statutory Baseline (General Estimate)`,
      transferTaxRatePerThousand: 5.0,
      transferTaxCitation: 'Baseline state recording/transfer assumption (0.5% of price); verify county fee schedule.',
      sheriffPoundageRatePercent: 0.015,
      sheriffPoundageCitation: 'Standard statutory execution poundage estimate (~1.5%).',
      settlementWindowHours: 48,
      settlementDeadlineDescription: 'Verify court confirmation and settlement deadline with county clerk.',
      depositRequirement: '10% certified funds deposit typical.',
      citations: [
        `Statutory fee schedule not yet fully modeled for ${code || 'this state'}. Showing generic baseline estimates.`,
      ],
      estimatedFees: {
        baselinePrice: price,
        transferTax: Math.round(price * 0.005),
        sheriffPoundage: Math.round(price * 0.015),
        recordingFee: 100,
        estimatedDeposit: Math.round(price * 0.10),
        totalEstimatedClosingCosts: Math.round(price * 0.02) + 100,
      },
    };
  }

  // Itemized calculations
  let sheriffPoundage = Math.round(price * schedule.defaultSheriffPoundagePercent);
  if (code === 'NJ') {
    const tier1 = Math.min(price, 5000) * 0.06;
    const tier2 = Math.max(0, Math.min(price - 5000, 15000)) * 0.04;
    const tier3 = Math.max(0, price - 20000) * 0.02;
    sheriffPoundage = Math.max(150, Math.round(tier1 + tier2 + tier3));
  } else if (code === 'FL') {
    sheriffPoundage = Math.round(Math.min(price, 500) * 0.03 + Math.max(0, price - 500) * 0.015);
  } else if (code === 'PA') {
    sheriffPoundage = Math.round(Math.min(price, 250000) * 0.02 + Math.max(0, price - 250000) * 0.005);
  }

  const transferTax = Math.round((price / 1000) * schedule.docStampRatePerThousand);
  const recordingFee = Math.round(schedule.defaultRecordingFee || 80);
  const depositPct = code === 'NJ' ? 0.20 : code === 'FL' ? 0.05 : code === 'NC' ? 0.05 : 0.10;
  const estimatedDeposit = Math.round(price * depositPct);

  const citations = [schedule.notes];
  let transferTaxCitation = `Transfer tax / doc stamps: $${schedule.docStampRatePerThousand.toFixed(2)} per $1,000 consideration.`;
  let sheriffPoundageCitation = schedule.defaultSheriffPoundagePercent > 0
    ? `Sheriff poundage: ${(schedule.defaultSheriffPoundagePercent * 100).toFixed(1)}% statutory execution fee.`
    : `Sheriff poundage: $0 execution fee charged to purchaser (non-judicial power of sale or standard trustee sale).`;

  if (code === 'NJ') {
    transferTaxCitation = 'N.J.S.A. 46:15-7: NJ Realty Transfer Fee (~1.0% tiered statutory schedule).';
    sheriffPoundageCitation = 'N.J.S.A. 22A:4-8: Sheriff commission 6% on first $5k, 4% on next $15k, 2% above $20k ($150 min).';
    citations.push(
      'N.J.S.A. 22A:4-8: Sheriff execution commission schedule.',
      'N.J.S.A. 46:15-7: NJ Realty Transfer Fee graduated tiers.',
      'N.J.S.A. 2A:50-64: 20% statutory sheriff sale deposit at knockdown.'
    );
  } else if (code === 'OH') {
    transferTaxCitation = 'ORC § 319.54(G)(3): County auditor conveyance fee baseline ($4.00 per $1,000 consideration).';
    sheriffPoundageCitation = 'ORC § 311.17(B)(1): Sheriff execution poundage (1.5% to 2.0% of sale proceeds).';
    citations.push(
      'ORC § 311.17(B)(1): Sheriff poundage on execution sales.',
      'ORC § 319.54(G)(3): County auditor conveyance fee schedule.'
    );
  } else if (code === 'FL') {
    transferTaxCitation = 'Fla. Stat. § 201.02: Documentary stamp tax $0.70 per $100 ($7.00 per $1,000 of consideration).';
    sheriffPoundageCitation = 'Fla. Stat. § 28.24(10): Clerk registry electronic auction fee (3% on first $500, 1.5% balance).';
    citations.push(
      'Fla. Stat. § 28.24(10): Clerk registry electronic auction fees.',
      'Fla. Stat. § 201.02: Documentary stamp taxes on conveyances.',
      'Fla. Stat. § 45.031(3): 5% statutory judicial auction deposit at sale.'
    );
  } else if (code === 'PA') {
    transferTaxCitation = '72 P.S. § 8102-C: PA Realty Transfer Tax (1% state + 1% typical local municipal/school = 2%).';
    sheriffPoundageCitation = '42 Pa.C.S. § 21107: Sheriff poundage 2% up to $250k + 0.5% on excess.';
    citations.push(
      '42 Pa.C.S. § 21107: Sheriff poundage on execution sales.',
      '72 P.S. § 8102-C: Pennsylvania Realty Transfer Tax.'
    );
  } else if (code === 'NC') {
    transferTaxCitation = 'N.C.G.S. § 105-228.30: NC Excise Tax $1.00 per $500 ($2.00 per $1,000 of consideration).';
    sheriffPoundageCitation = 'N.C.G.S. § 45-21.15: Trustee/commissioner statutory commission cap (up to 5%).';
    citations.push(
      'N.C.G.S. § 45-21.15: Commissioner/trustee statutory commission cap.',
      'N.C.G.S. § 105-228.30: County real estate excise stamp tax.',
      'N.C.G.S. § 45-21.27: 5% minimum deposit ($750 floor) for initial bid and each qualifying upset bid.'
    );
  } else if (code === 'TX') {
    transferTaxCitation = 'Texas Const. art. VIII § 29: $0 state and local real estate transfer tax prohibition.';
    sheriffPoundageCitation = 'Tex. Civ. Prac. & Rem. Code: No constable execution poundage charged to purchaser.';
    citations.push(
      'Texas Const. art. VIII § 29: Constitutional prohibition of real estate transfer tax.',
      'Tex. Tax Code § 34.015: Purchaser tax certificate required before deed execution.'
    );
  } else if (code === 'CA') {
    transferTaxCitation = 'Cal. Rev. & Tax Code § 11911: County documentary transfer tax ($1.10 per $1,000 consideration).';
    sheriffPoundageCitation = 'Cal. Civ. Code § 2924h: Non-judicial trustee power of sale assesses no county poundage.';
    citations.push(
      'Cal. Civ. Code § 2924h: 100% certified funds required at trustee auction gavel.',
      'Cal. Rev. & Tax Code § 11911: County documentary transfer tax baseline.',
      'Cal. Civ. Code § 2924m (SB 1079): 45-day post-sale eligible bidder window on 1-4 unit residential.'
    );
  } else if (code === 'AL') {
    transferTaxCitation = 'Ala. Code § 40-22-1: Alabama deed recording tax ($0.50 per $500 / $1.00 per $1,000).';
    sheriffPoundageCitation = 'Ala. Code § 12-19-90: Sheriff execution fee baseline (~1.5% poundage).';
    citations.push(
      'Ala. Code § 12-19-90: Sheriff execution fee schedule.',
      'Ala. Code § 40-22-1: Alabama deed privilege tax.',
      'Ala. Code § 6-5-248: 180-day homestead vs 1-year non-homestead statutory redemption.'
    );
  }

  return {
    state: code,
    name: schedule.name,
    isSupported: true,
    scheduleLabel: `${schedule.name} Statutory Fee Schedule`,
    transferTaxRatePerThousand: schedule.docStampRatePerThousand,
    transferTaxCitation,
    sheriffPoundageRatePercent: schedule.defaultSheriffPoundagePercent,
    sheriffPoundageCitation,
    settlementWindowHours: schedule.settlementWindowHours,
    settlementDeadlineDescription: schedule.settlementWindowHours === 0
      ? '100% certified funds / cashier checks due at auction gavel.'
      : schedule.settlementWindowHours <= 48
      ? `Balance due within ${schedule.settlementWindowHours} hours of auction gavel.`
      : `Balance due within ${Math.round(schedule.settlementWindowHours / 24)} days of sale or confirmation.`,
    depositRequirement: code === 'NJ' ? '20% statutory deposit at knockdown (N.J.S.A. 2A:50-64)'
      : code === 'NC' ? '5% deposit ($750 minimum) with Clerk of Superior Court (N.C.G.S. § 45-21.27)'
      : code === 'FL' ? '5% deposit at sale (Fla. Stat. § 45.031(3))'
      : code === 'TX' || code === 'CA' ? '100% cashier check / certified funds at auction'
      : '10% certified funds deposit typical',
    citations: Array.from(new Set(citations)),
    estimatedFees: {
      baselinePrice: price,
      transferTax,
      sheriffPoundage,
      recordingFee,
      estimatedDeposit,
      totalEstimatedClosingCosts: transferTax + sheriffPoundage + recordingFee,
    },
  };
}

/**
 * Returns a high-CTR title string for a county page, tightly fitting 40-55 SERP characters.
 * e.g. "Essex County Sheriff Sales & Tax Deeds | PerfectProperty"
 */
function generateHighCtrCountyTitle(county, state) {
  const norm = normalizeCountySlug(county);
  const st = String(state || '').trim().toUpperCase();
  const formal = formatCountyDisplayName(norm);
  const brand = '| PerfectProperty';
  const prefix = `${formal} Sheriff Sales & Tax Deeds`;
  const candidate = `${prefix} ${brand}`;
  if (candidate.length <= 57) {
    return candidate;
  }
  // Shorten county name if needed
  return `${norm} Sheriff Sales & Auctions ${brand}`;
}

/**
 * Generates dynamic Next.js page metadata for a county docket page.
 */
function generateCountyMetadata({ state, county, count = 0, medianBid = null, baseUrl = DEFAULT_BASE_URL, format = 'standard' }) {
  const st = String(state || '').trim().toUpperCase();
  const countyFormatted = formatCountyDisplayName(county);
  const countySlug = countyToSlug(county);
  const cleanBase = String(baseUrl).replace(/\/+$/, '');
  const canonicalUrl = `${cleanBase}/states/${st}/${countySlug}`;

  const countStr = count > 0 ? `${count} active` : 'verified';
  const bidStr = medianBid ? ` Median opening bid: $${Math.round(medianBid).toLocaleString('en-US')}.` : '';

  const title = format === 'high-ctr'
    ? generateHighCtrCountyTitle(county, st)
    : `Distressed & Foreclosure Property in ${countyFormatted}, ${st} | PerfectProperty`;
  const description = `Explore ${countStr} distressed, foreclosure, and tax-deed properties in ${countyFormatted}, ${st}.${bidStr} See the published sale details and the state's redemption rule.`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: 'PerfectProperty',
      type: 'website',
    },
  };
}

/**
 * Builds Schema.org BreadcrumbList for /states/[state]/[county].
 */
function buildCountyBreadcrumbs({ state, county, baseUrl = DEFAULT_BASE_URL }) {
  const st = String(state || '').trim().toUpperCase();
  const countyFormatted = formatCountyDisplayName(county);
  const countySlug = countyToSlug(county);
  const cleanBase = String(baseUrl).replace(/\/+$/, '');

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: `${cleanBase}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'States',
        item: `${cleanBase}/states`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: st,
        item: `${cleanBase}/states/${st}`,
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: countyFormatted,
        item: `${cleanBase}/states/${st}/${countySlug}`,
      },
    ],
  };
}

/**
 * Builds Schema.org ItemList for county listings.
 */
function buildCountyItemList({ state, county, listings = [], baseUrl = DEFAULT_BASE_URL }) {
  const st = String(state || '').trim().toUpperCase();
  const countyFormatted = formatCountyDisplayName(county);
  const cleanBase = String(baseUrl).replace(/\/+$/, '');

  const elements = (Array.isArray(listings) ? listings : []).slice(0, 50).map((item, index) => {
    const id = encodeURIComponent(String(item.id || index + 1));
    const name = String(item.address || `Distressed Property ${item.id || ''}`).trim();
    const bid = item.openingBid != null ? `Opening bid: $${Math.round(Number(item.openingBid)).toLocaleString('en-US')}.` : 'Opening bid not published yet.';
    const score = item.dealScore != null ? ` Deal Score: ${item.dealScore}/99.` : '';
    const desc = `${item.propType || 'Property for sale'} in ${countyFormatted}, ${st}. ${bid}${score}`;

    return {
      '@type': 'ListItem',
      position: index + 1,
      url: `${cleanBase}/listings/${id}`,
      name,
      description: desc,
    };
  });

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Distressed & Foreclosure Property in ${countyFormatted}, ${st}`,
    numberOfItems: listings.length,
    itemListElement: elements,
  };
}

/**
 * Builds Schema.org FAQPage structured data optimized for GEO and AI answer engines.
 */
function buildCountyFaqSchema({ state, county, baseUrl = DEFAULT_BASE_URL }) {
  const st = String(state || '').trim().toUpperCase();
  const countyFormatted = formatCountyDisplayName(county);
  const redemption = getStatutoryRedemption(st);
  const feeSchedule = getStatutoryFeeSchedule(st);

  const questions = [
    {
      question: `What are the statutory redemption and upset bid rules in ${countyFormatted}, ${st}?`,
      answer: (() => {
        let text = `In ${st}, ${redemption.label}. `;
        if (redemption.upsetBid && redemption.upsetBid.hasUpsetBid) {
          text += `North Carolina law (${redemption.upsetBid.statute}) provides a ${redemption.upsetBid.windowDays}-day upset bid period. Each qualifying upset bid (minimum 5% increase or $750 floor deposited with the Clerk of Superior Court) reopens a new 10-day window until no further upset bids are filed. `;
        }
        if (redemption.homesteadDistinction && redemption.homesteadDistinction.hasDistinction) {
          text += `${redemption.homesteadDistinction.description} `;
        }
        if (redemption.days === 0) {
          text += 'Post-sale redemption terminates at the auction gavel drop or upon confirmation of sale, meaning winning bidders take immediate equitable title subject to court deed delivery. ';
        }
        text += `Always verify the specific civil action docket and foreclosure terms with the ${countyFormatted} court clerk before bidding.`;
        return text.trim();
      })(),
    },
    {
      question: `What transfer taxes, sheriff execution poundage, and court fees apply in ${st}?`,
      answer: (() => {
        let text = `Under ${feeSchedule.scheduleLabel}: `;
        text += `${feeSchedule.transferTaxCitation} `;
        text += `${feeSchedule.sheriffPoundageCitation} `;
        text += `Settlement rules: ${feeSchedule.settlementDeadlineDescription} `;
        text += `Deposit requirement: ${feeSchedule.depositRequirement}.`;
        return text.trim();
      })(),
    },
    {
      question: `Does winning an auction in ${countyFormatted} extinguish prior mortgages or delinquent property taxes?`,
      answer: `No. A foreclosure auction only wipes out junior liens named and properly served in the foreclosure complaint. Senior first mortgages, municipal real estate tax liens, utility assessments, and HOA super-priority liens (where applicable) survive the sale and remain encumbrances on the property. Furthermore, if a federal tax lien is recorded, 26 U.S.C. § 7425 gives the IRS a 120-day statutory right of redemption. Winning bidders take title 'as-is, where-is' subject to all surviving senior encumbrances. A full title search by a qualified title abstractor is strongly advised prior to bidding.`,
    },
    {
      question: `How do I participate in ${countyFormatted}, ${st} foreclosure auctions?`,
      answer: `Foreclosure auctions in ${countyFormatted} are conducted either on courthouse steps, at designated county administrative facilities, or through approved online electronic auction portals. Bidders must bring certified funds (cashier's checks payable per county specifications) meeting the statutory deposit requirement (${feeSchedule.depositRequirement}). Personal checks and credit cards are strictly refused. Review the published notice of sale in the county civil docket or newspaper of record for exact sale hour, legal parcel description, and deposit instructions.`,
    },
  ];

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: q.answer,
      },
    })),
  };
}

module.exports = {
  normalizeCountySlug,
  countyToSlug,
  formatCountyDisplayName,
  computeCountyStats,
  getStatutoryRedemption,
  getStatutoryFeeSchedule,
  generateHighCtrCountyTitle,
  generateCountyMetadata,
  buildCountyBreadcrumbs,
  buildCountyItemList,
  buildCountyFaqSchema,
  DEFAULT_BASE_URL,
};
