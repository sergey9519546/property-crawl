'use strict';

/**
 * server/sources/platform-fingerprinter.js
 *
 * Automated Vendor Platform Classifier & Fingerprinter for county auction,
 * pre-foreclosure recorder, and government disposition portals.
 *
 * Provides deterministic classification of source URLs and raw HTML documents
 * against known vendor engine signatures (CivilView, RealAuction, Bid4Assets,
 * ServiceLink, AcclaimWeb, Texas Tax Sale, Cook County Recorder, Miami-Dade Clerk,
 * and GSA Surplus Real Estate).
 */

const SUPPORTED_PLATFORMS = [
  {
    id: 'civilview',
    name: 'CivilView Sheriff Sales',
    category: 'sheriff_auction',
    adapterModule: 'server/scrapers/adapters/civilview.js',
    supportsDirectApi: false,
    requiresRobotsCheck: true,
    primaryDomains: ['salesweb.civilview.com', 'civilview.com'],
    description: 'Vendor platform for New Jersey, Pennsylvania, and regional county sheriff sales dockets.'
  },
  {
    id: 'realauction',
    name: 'RealAuction Foreclosure & Tax Deed',
    category: 'foreclosure_tax_deed_auction',
    adapterModule: 'server/scrapers/adapters/realauction.js',
    supportsDirectApi: false,
    requiresRobotsCheck: true,
    primaryDomains: ['realauction.com', 'realforeclose.com', 'realtaxdeed.com'],
    description: 'Online auction vendor powering foreclosure and tax deed portals across Florida, Ohio, and New Jersey.'
  },
  {
    id: 'bid4assets',
    name: 'Bid4Assets Distressed Asset Auctions',
    category: 'tax_sale_auction',
    adapterModule: 'server/scrapers/bid4assets.js',
    supportsDirectApi: false,
    requiresRobotsCheck: true,
    primaryDomains: ['bid4assets.com'],
    description: 'National auction portal for county tax sales, sheriff sales, and municipal forfeiture auctions.'
  },
  {
    id: 'servicelink',
    name: 'ServiceLink Auction',
    category: 'reo_auction',
    adapterModule: 'server/scrapers/servicelink.js',
    supportsDirectApi: false,
    requiresRobotsCheck: true,
    primaryDomains: ['servicelinkauction.com', 'auction.com'],
    description: 'Institutional REO, foreclosure, and short sale disposition marketplace.'
  },
  {
    id: 'acclaimweb',
    name: 'AcclaimWeb County Land Records',
    category: 'preforeclosure_recorder',
    adapterModule: 'server/scrapers/adapters/acclaimweb.js',
    supportsDirectApi: false,
    requiresRobotsCheck: true,
    primaryDomains: ['acclaimweb.com', 'acclaim.governmax.com'],
    description: 'GovernMax AcclaimWeb land records search engine powering county recorder portals.'
  },
  {
    id: 'texas_tax_sale',
    name: 'Texas Statutory Tax Sale Postings',
    category: 'tax_sale_postings',
    adapterModule: 'server/scrapers/adapters/texas-tax-sale.js',
    supportsDirectApi: false,
    requiresRobotsCheck: true,
    primaryDomains: ['mvbalaw.com', 'lgbs.com', 'pbfcm.com', 'linebarger.com'],
    description: 'Statutory Texas Property Tax Code delinquent tax sale dockets posted by collection law firms.'
  },
  {
    id: 'cook_recorder',
    name: 'Cook County Pre-Foreclosure Recorder',
    category: 'preforeclosure_recorder',
    adapterModule: 'server/scrapers/adapters/cook-recorder.js',
    supportsDirectApi: false,
    requiresRobotsCheck: true,
    primaryDomains: ['cookrecorder.com', 'cookcountyclerkil.gov'],
    description: 'Cook County Clerk & Recorder of Deeds pre-foreclosure, lis pendens, and chancery filings.'
  },
  {
    id: 'miami_clerk',
    name: 'Miami-Dade Clerk of Courts & RealTaxDeed',
    category: 'preforeclosure_tax_deed',
    adapterModule: 'server/scrapers/adapters/miami-dade-clerk.js',
    supportsDirectApi: false,
    requiresRobotsCheck: true,
    primaryDomains: ['miamidade.realforeclose.com', 'onlineservices.miamidadeclerk.gov'],
    description: 'Miami-Dade County Clerk lis pendens and dedicated RealTaxDeed / RealForeclose auction portal.'
  },
  {
    id: 'gsa_surplus',
    name: 'GSA Surplus Real Estate Dispositions',
    category: 'federal_disposition',
    adapterModule: 'server/scrapers/adapters/gsa-api.js',
    supportsDirectApi: true,
    requiresRobotsCheck: true,
    primaryDomains: ['realestatesales.gov', 'api.gsa.gov', 'gsaauctions.gov'],
    description: 'U.S. General Services Administration federal surplus real property auctions and open-data REST API.'
  },
  {
    id: 'la_recorder',
    name: 'Los Angeles County Registrar-Recorder / County Clerk',
    category: 'preforeclosure_intake',
    adapterModule: 'server/scrapers/adapters/la-recorder.js',
    supportsDirectApi: false,
    requiresRobotsCheck: true,
    primaryDomains: ['lavote.gov', 'lavote.net'],
    description: 'Los Angeles County notice of default and trustee sale document intake and subscriber feed parsing (A31-09).'
  }
];

const PLATFORM_MAP = new Map(SUPPORTED_PLATFORMS.map((p) => [p.id, p]));

/**
 * Safely parse a URL string into a URL object.
 */
function parseUrlSafe(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    // If scheme was omitted (e.g. "salesweb.civilview.com/Sales"), try prepending https://
    try {
      return new URL('https://' + trimmed);
    } catch {
      return null;
    }
  }
}

/**
 * Classifies a URL to identify if it matches a known vendor portal.
 *
 * @param {string} url - Source URL to inspect
 * @returns {{ platform: string, confidence: 'HIGH'|'MEDIUM'|'UNKNOWN', matchedRule: string }}
 */
function classifySourceUrl(url) {
  const parsed = parseUrlSafe(url);
  if (!parsed) {
    return { platform: 'unknown', confidence: 'UNKNOWN', matchedRule: 'invalid_or_empty_url' };
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;
  const fullHref = parsed.href.toLowerCase();

  // 1. Miami-Dade Clerk & RealForeclose (Prioritized over generic RealAuction)
  if (
    hostname === 'miamidade.realforeclose.com' ||
    hostname === 'onlineservices.miamidadeclerk.gov' ||
    hostname === 'miamidadeclerk.gov' ||
    hostname.endsWith('.miamidadeclerk.gov')
  ) {
    return {
      platform: 'miami_clerk',
      confidence: 'HIGH',
      matchedRule: `domain:miami_clerk:${hostname}`
    };
  }

  // 2. CivilView
  if (hostname === 'salesweb.civilview.com' || hostname === 'civilview.com' || hostname.endsWith('.civilview.com')) {
    return {
      platform: 'civilview',
      confidence: 'HIGH',
      matchedRule: `domain:civilview:${hostname}`
    };
  }
  if (pathname.includes('/CivilView/')) {
    return {
      platform: 'civilview',
      confidence: 'HIGH',
      matchedRule: 'path:civilview:/CivilView/'
    };
  }
  if (pathname.toLowerCase().includes('/sales/salessearch')) {
    return {
      platform: 'civilview',
      confidence: 'MEDIUM',
      matchedRule: 'path:civilview:/Sales/SalesSearch'
    };
  }

  // 3. RealAuction (.realforeclose.com, .realtaxdeed.com, .realauction.com)
  if (
    hostname.endsWith('.realforeclose.com') ||
    hostname.endsWith('.realtaxdeed.com') ||
    hostname.endsWith('.realauction.com') ||
    hostname === 'realauction.com'
  ) {
    return {
      platform: 'realauction',
      confidence: 'HIGH',
      matchedRule: `domain:realauction:${hostname}`
    };
  }

  // 4. Bid4Assets
  if (hostname === 'bid4assets.com' || hostname.endsWith('.bid4assets.com')) {
    return {
      platform: 'bid4assets',
      confidence: 'HIGH',
      matchedRule: `domain:bid4assets:${hostname}`
    };
  }
  if (pathname.includes('/v5/auction/')) {
    return {
      platform: 'bid4assets',
      confidence: 'HIGH',
      matchedRule: 'path:bid4assets:/v5/auction/'
    };
  }

  // 5. ServiceLink & Auction.com
  if (
    hostname === 'servicelinkauction.com' ||
    hostname.endsWith('.servicelinkauction.com') ||
    hostname === 'auction.com' ||
    hostname.endsWith('.auction.com')
  ) {
    return {
      platform: 'servicelink',
      confidence: 'HIGH',
      matchedRule: `domain:servicelink:${hostname}`
    };
  }

  // 6. AcclaimWeb
  if (
    hostname === 'acclaimweb.com' ||
    hostname.endsWith('.acclaimweb.com') ||
    hostname === 'acclaim.governmax.com' ||
    hostname.endsWith('.acclaim.governmax.com')
  ) {
    return {
      platform: 'acclaimweb',
      confidence: 'HIGH',
      matchedRule: `domain:acclaimweb:${hostname}`
    };
  }
  if (hostname.includes('acclaim') && (pathname.includes('SearchCriteria') || pathname.includes('DirectSearch'))) {
    return {
      platform: 'acclaimweb',
      confidence: 'HIGH',
      matchedRule: 'domain_and_path:acclaimweb'
    };
  }
  if (pathname.includes('SearchCriteria') || pathname.includes('DirectSearch')) {
    if (hostname.includes('recorder') || hostname.includes('clerk') || hostname.includes('governmax')) {
      return {
        platform: 'acclaimweb',
        confidence: 'MEDIUM',
        matchedRule: `path:acclaimweb:${hostname}`
      };
    }
  }

  // 7. Texas Delinquent Tax Sale Law Firms
  const texasTaxFirms = ['mvbalaw.com', 'lgbs.com', 'pbfcm.com', 'linebarger.com'];
  for (const firm of texasTaxFirms) {
    if (hostname === firm || hostname.endsWith('.' + firm)) {
      return {
        platform: 'texas_tax_sale',
        confidence: 'HIGH',
        matchedRule: `domain:texas_tax_sale:${hostname}`
      };
    }
  }

  // 8. Cook County Pre-Foreclosure Recorder
  if (
    hostname === 'cookrecorder.com' ||
    hostname.endsWith('.cookrecorder.com') ||
    hostname === 'cookcountyclerkil.gov' ||
    hostname.endsWith('.cookcountyclerkil.gov')
  ) {
    return {
      platform: 'cook_recorder',
      confidence: 'HIGH',
      matchedRule: `domain:cook_recorder:${hostname}`
    };
  }

  // 9. GSA Surplus Real Estate
  if (
    hostname === 'realestatesales.gov' ||
    hostname.endsWith('.realestatesales.gov') ||
    hostname === 'gsaauctions.gov' ||
    hostname.endsWith('.gsaauctions.gov') ||
    hostname === 'propertydisposal.gsa.gov'
  ) {
    return {
      platform: 'gsa_surplus',
      confidence: 'HIGH',
      matchedRule: `domain:gsa_surplus:${hostname}`
    };
  }
  if (hostname === 'api.gsa.gov' && fullHref.includes('/assets/gsaauctions')) {
    return {
      platform: 'gsa_surplus',
      confidence: 'HIGH',
      matchedRule: 'api:gsa_surplus:api.gsa.gov/assets/gsaauctions'
    };
  }
  if (hostname === 'api.gsa.gov') {
    return {
      platform: 'gsa_surplus',
      confidence: 'MEDIUM',
      matchedRule: 'domain:gsa_surplus:api.gsa.gov'
    };
  }

  // 10. LA County Recorder (A31-09)
  if (hostname.includes('lavote.gov') || hostname.includes('lavote.net')) {
    return {
      platform: 'la_recorder',
      confidence: 'HIGH',
      matchedRule: `domain:la_recorder:${hostname}`
    };
  }

  return {
    platform: 'unknown',
    confidence: 'UNKNOWN',
    matchedRule: 'none'
  };
}

/**
 * HTML Vendor Signatures catalog.
 * Defines strong signatures (weight 2) and supporting signatures (weight 1).
 */
const HTML_SIGNATURE_SPECS = [
  {
    platform: 'miami_clerk',
    strong: [
      { name: 'Miami-Dade County Clerk', pattern: /Miami-Dade\s+County\s+Clerk/i },
      { name: 'Miami-Dade Clerk of Courts', pattern: /Miami-Dade\s+Clerk\s+of\s+Courts/i },
      { name: 'onlineservices.miamidadeclerk.gov', pattern: /onlineservices\.miamidadeclerk\.gov/i },
      { name: 'miamidade.realforeclose.com', pattern: /miamidade\.realforeclose\.com/i }
    ],
    supporting: [
      { name: 'Folio identifier', pattern: /\bFolio\b/i },
      { name: 'Miami-Dade County reference', pattern: /Miami-Dade/i }
    ]
  },
  {
    platform: 'civilview',
    strong: [
      { name: 'CivilView brand string', pattern: /\bCivilView\b/i },
      { name: 'salesweb.civilview.com domain', pattern: /salesweb\.civilview\.com/i },
      { name: '/CivilView/ path pattern', pattern: /\/CivilView\//i }
    ],
    supporting: [
      { name: 'Sheriff # header', pattern: /Sheriff\s*#/i },
      { name: 'Plaintiff vs Defendant caption', pattern: /Plaintiff\s+vs\.?\s+Defendant/i },
      { name: 'SalesSearch action', pattern: /SalesSearch\?countyId=/i }
    ]
  },
  {
    platform: 'realauction',
    strong: [
      { name: 'RealAuction.com brand marker', pattern: /RealAuction\.com/i },
      { name: 'realforeclose token', pattern: /\brealforeclose\b/i },
      { name: 'realtaxdeed token', pattern: /\brealtaxdeed\b/i },
      { name: 'AUCTION_ITEM class', pattern: /AUCTION_ITEM/ },
      { name: 'AUCTION_STATS class', pattern: /AUCTION_STATS/ }
    ],
    supporting: [
      { name: 'RealAuction copyright', pattern: /RealAuction/i },
      { name: 'Bids Placed auction label', pattern: /Bids\s+Placed/i }
    ]
  },
  {
    platform: 'bid4assets',
    strong: [
      { name: 'Bid4Assets brand string', pattern: /\bBid4Assets\b/i },
      { name: 'bid4assets.com domain', pattern: /bid4assets\.com/i },
      { name: '/v5/auction/ route pattern', pattern: /\/v5\/auction\//i }
    ],
    supporting: [
      { name: 'AssetId field', pattern: /\bAssetId\b/i },
      { name: 'Asset ID label', pattern: /Asset\s*ID/i }
    ]
  },
  {
    platform: 'servicelink',
    strong: [
      { name: 'ServiceLink brand string', pattern: /\bServiceLink\b/i },
      { name: 'servicelinkauction.com domain', pattern: /servicelinkauction\.com/i },
      { name: 'ServiceLink Auction compound', pattern: /ServiceLink\s+Auction/i }
    ],
    supporting: [
      { name: 'Property Auction marker', pattern: /\bProperty\s+Auction\b/i }
    ]
  },
  {
    platform: 'acclaimweb',
    strong: [
      { name: 'AcclaimWeb brand string', pattern: /\bAcclaimWeb\b/i },
      { name: 'GovernMax company marker', pattern: /\bGovernMax\b/i },
      { name: 'acclaim.governmax.com domain', pattern: /acclaim\.governmax\.com/i }
    ],
    supporting: [
      { name: 'SearchCriteria marker', pattern: /\bSearchCriteria\b/i },
      { name: 'DirectSearch marker', pattern: /\bDirectSearch\b/i }
    ]
  },
  {
    platform: 'texas_tax_sale',
    strong: [
      { name: 'Texas Property Tax Code statutory marker', pattern: /Texas\s+Property\s+Tax\s+Code/i },
      { name: 'Linebarger law firm notice', pattern: /Linebarger\s+Goggan/i },
      { name: 'MVBA law firm notice', pattern: /McCreary,\s*Veselka/i },
      { name: 'PBFCM law firm notice', pattern: /Perdue\s+Brandon/i },
      { name: 'Tax Resale statutory label', pattern: /Tax\s+Resale/i }
    ],
    supporting: [
      { name: 'Suit No citation', pattern: /\bSuit\s+No\b/i },
      { name: 'Cause No citation', pattern: /\bCause\s+No\b/i },
      { name: 'Tax Sale notice label', pattern: /Tax\s+Sale/i }
    ]
  },
  {
    platform: 'cook_recorder',
    strong: [
      { name: 'Cook County Clerk header', pattern: /Cook\s+County\s+Clerk/i },
      { name: 'Cook County Recorder of Deeds header', pattern: /Cook\s+County\s+Recorder\s+of\s+Deeds/i },
      { name: 'cookrecorder.com domain', pattern: /cookrecorder\.com/i }
    ],
    supporting: [
      { name: 'PIN Property Index Number', pattern: /\bPIN\b/ },
      { name: 'Cook County reference', pattern: /Cook\s+County/i }
    ]
  },
  {
    platform: 'gsa_surplus',
    strong: [
      { name: 'GSA Auctions brand string', pattern: /GSA\s+Auctions/i },
      { name: 'U.S. General Services Administration', pattern: /U\.S\.\s+General\s+Services\s+Administration/i },
      { name: 'realestatesales.gov domain', pattern: /realestatesales\.gov/i },
      { name: 'Real Property Utilization and Disposal', pattern: /Real\s+Property\s+Utilization\s+and\s+Disposal/i }
    ],
    supporting: [
      { name: 'GSA government domain', pattern: /gsa\.gov/i }
    ]
  },
  {
    platform: 'la_recorder',
    strong: [
      { name: 'LA County Registrar-Recorder', pattern: /Registrar-Recorder\s*\/\s*County\s*Clerk/i },
      { name: 'lavote domain reference', pattern: /lavote\.(?:gov|net)/i },
      { name: 'LA County Notice of Default', pattern: /Notice\s*of\s*Default[\s\S]{1,100}Los\s*Angeles/i }
    ],
    supporting: [
      { name: 'Assessor Identification Number (AIN)', pattern: /\bAIN\b|Assessor'?s\s*Identification\s*Number/i },
      { name: 'Notice of Trustee Sale', pattern: /Notice\s*of\s*Trustee\s*Sale/i }
    ]
  }
];

/**
 * Analyzes HTML content for vendor signatures.
 *
 * @param {string} html - Raw HTML docket or page content
 * @param {string} [url=''] - Optional URL for contextual weighting
 * @returns {{ platform: string, confidence: 'HIGH'|'MEDIUM'|'UNKNOWN', matchedSignatures: string[] }}
 */
function fingerprintPlatformHtml(html, url = '') {
  if (!html || typeof html !== 'string' || !html.trim()) {
    return {
      platform: 'unknown',
      confidence: 'UNKNOWN',
      matchedSignatures: []
    };
  }

  const scores = [];

  for (const spec of HTML_SIGNATURE_SPECS) {
    let score = 0;
    const matched = [];

    // Evaluate strong signatures (weight 2)
    for (const sig of spec.strong) {
      if (sig.pattern.test(html)) {
        score += 2;
        matched.push(`strong:${sig.name}`);
      }
    }

    // Evaluate supporting signatures (weight 1)
    for (const sig of spec.supporting) {
      if (sig.pattern.test(html)) {
        score += 1;
        matched.push(`supporting:${sig.name}`);
      }
    }

    if (score > 0) {
      scores.push({
        platform: spec.platform,
        score,
        matchedSignatures: matched
      });
    }
  }

  if (scores.length === 0) {
    return {
      platform: 'unknown',
      confidence: 'UNKNOWN',
      matchedSignatures: []
    };
  }

  // Sort descending by score
  scores.sort((a, b) => b.score - a.score);

  // Jurisdiction priority nuance: if miami_clerk has strong evidence, it wins over generic realauction
  const miamiEntry = scores.find((s) => s.platform === 'miami_clerk');
  const realauctionEntry = scores.find((s) => s.platform === 'realauction');
  if (miamiEntry && realauctionEntry) {
    const hasMiamiStrong = miamiEntry.matchedSignatures.some((m) => m.startsWith('strong:'));
    if (hasMiamiStrong) {
      const topMiami = {
        platform: 'miami_clerk',
        confidence: 'HIGH',
        matchedSignatures: [...miamiEntry.matchedSignatures, ...realauctionEntry.matchedSignatures.map((s) => `sub:${s}`)]
      };
      return topMiami;
    }
  }

  const top = scores[0];
  const hasStrongMatch = top.matchedSignatures.some((m) => m.startsWith('strong:'));

  let confidence = 'UNKNOWN';
  if (top.score >= 2 && hasStrongMatch) {
    confidence = 'HIGH';
  } else if (top.score >= 1) {
    confidence = 'MEDIUM';
  }

  return {
    platform: top.platform,
    confidence,
    matchedSignatures: top.matchedSignatures
  };
}

/**
 * Composite platform matcher evaluating URL first, then falling back to / cross-verifying with HTML.
 *
 * @param {string} url - Source URL
 * @param {string} [html=''] - Raw HTML docket or page content
 * @returns {{
 *   platform: string,
 *   confidence: 'HIGH'|'MEDIUM'|'UNKNOWN',
 *   adapterModule: string|null,
 *   matchedRule: string,
 *   matchedSignatures: string[],
 *   supportsDirectApi: boolean,
 *   requiresRobotsCheck: boolean,
 *   platformMeta: object|null
 * }}
 */
function identifyAdapterForSource(url, html = '') {
  const urlClassification = classifySourceUrl(url);
  const htmlClassification = html ? fingerprintPlatformHtml(html, url) : null;

  let finalPlatform = 'unknown';
  let finalConfidence = 'UNKNOWN';
  let matchedRule = urlClassification.matchedRule;
  let matchedSignatures = [];

  if (urlClassification.confidence === 'HIGH') {
    finalPlatform = urlClassification.platform;
    finalConfidence = 'HIGH';
    matchedRule = urlClassification.matchedRule;
    if (htmlClassification && htmlClassification.platform === finalPlatform) {
      matchedSignatures = htmlClassification.matchedSignatures;
    }
  } else if (urlClassification.confidence === 'MEDIUM') {
    if (htmlClassification && htmlClassification.platform === urlClassification.platform) {
      // Both URL and HTML agree -> upgrade to HIGH
      finalPlatform = urlClassification.platform;
      finalConfidence = 'HIGH';
      matchedRule = `${urlClassification.matchedRule} + html_corroborated`;
      matchedSignatures = htmlClassification.matchedSignatures;
    } else if (htmlClassification && htmlClassification.confidence === 'HIGH') {
      finalPlatform = htmlClassification.platform;
      finalConfidence = 'HIGH';
      matchedRule = `html_override:${htmlClassification.platform}`;
      matchedSignatures = htmlClassification.matchedSignatures;
    } else {
      finalPlatform = urlClassification.platform;
      finalConfidence = 'MEDIUM';
      matchedRule = urlClassification.matchedRule;
    }
  } else {
    // URL was UNKNOWN
    if (htmlClassification && htmlClassification.confidence !== 'UNKNOWN') {
      finalPlatform = htmlClassification.platform;
      finalConfidence = htmlClassification.confidence;
      matchedRule = `html_fingerprint:${htmlClassification.platform}`;
      matchedSignatures = htmlClassification.matchedSignatures;
    }
  }

  const meta = PLATFORM_MAP.get(finalPlatform) || null;

  return {
    platform: finalPlatform,
    confidence: finalConfidence,
    adapterModule: meta ? meta.adapterModule : null,
    matchedRule,
    matchedSignatures,
    supportsDirectApi: meta ? meta.supportsDirectApi : false,
    requiresRobotsCheck: meta ? meta.requiresRobotsCheck : true,
    platformMeta: meta
  };
}

module.exports = {
  SUPPORTED_PLATFORMS,
  classifySourceUrl,
  fingerprintPlatformHtml,
  identifyAdapterForSource
};
