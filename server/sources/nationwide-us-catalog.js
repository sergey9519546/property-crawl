'use strict';

/**
 * Nationwide U.S. source catalog expansions.
 * Every state gets LOCAL_ROUTE enrollment templates for tax sale and surplus
 * real property, enriched with explicit statutory regime taxonomy and
 * legal references.
 * Federal national sources already live in catalog.js
 * (HUD, IRS, Treasury, USDA, GSA, FEMA, EPA, Census, CourtListener, etc.).
 * CAPTCHA platforms are never added as auto-crawl adapters here.
 */

const US_STATES = Object.freeze([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
]);

const STATE_NAMES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia'
});

/**
 * Authoritative statutory tax sale regimes and governing legal citations for all 50 states + DC.
 * Regimes:
 * - 'tax_deed': Direct fee title deed auctioned; administrative pre-sale default period, no post-sale right of redemption.
 * - 'tax_lien': Tax certificate auctioned bidding down interest rate or premium; investor holds lien, post-sale foreclosure required for deed.
 * - 'hybrid_redeemable_deed': Deed or certificate conveying conditional title immediately, subject to a statutory post-sale redemption period with penalty.
 */
const STATE_TAX_SALE_STATUTES = Object.freeze({
  AL: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Ala. Code § 40-10-180',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county online auction platforms (GovEase, RealAuction) and statutory public notices email-intake.'
  }),
  AK: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Alaska Stat. § 29.45.330',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via municipal in rem tax foreclosure auction listings and legal notice registers.'
  }),
  AZ: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Ariz. Rev. Stat. § 42-18101',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county online auction platforms (RealAuction, Bid4Assets) and county treasurer delinquent rolls.'
  }),
  AR: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Ark. Code Ann. § 26-37-101',
    ingestionMethod: 'state-portal',
    ingestionNotes: 'Ingested via Arkansas Commissioner of State Lands (COSL) statewide catalog and legal notices.'
  }),
  CA: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Cal. Rev. & Tax Code § 3691',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via CA State Controller tax-defaulted sale directory, Bid4Assets, and county tax collector portals.'
  }),
  CO: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Colo. Rev. Stat. § 39-11-106',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county online auction platforms (RealAuction, SRI) and statutory public notices.'
  }),
  CT: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: 'Conn. Gen. Stat. § 12-157',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via municipal tax collector public auction notices and statutory legal publications.'
  }),
  DE: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: 'Del. Code tit. 9, § 8721',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county sheriff monition sale dockets and county court public notices.'
  }),
  DC: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'D.C. Code § 47-1332',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via DC Office of Tax and Revenue (OTR) annual online tax sale portal and DC Register.'
  }),
  FL: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Fla. Stat. § 197.542',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county RealTaxDeed/RealForeclose auction platforms (sheriff adapter) and floridapublicnotices.com email-intake.'
  }),
  GA: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: 'O.C.G.A. § 48-4-1',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county sheriff tax deed sales and statutory legal notices (georgiapublicnotice.com email-intake).'
  }),
  HI: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: 'Haw. Rev. Stat. § 246-56',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county real property tax division auction notices and statutory press notices.'
  }),
  ID: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Idaho Code § 63-1006',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county commissioners delinquent tax deed auction rolls and legal notices.'
  }),
  IL: Object.freeze({
    regime: 'tax_lien',
    legalRef: '35 ILCS 200/21-205',
    ingestionMethod: 'email-intake',
    ingestionNotes: 'Ingested via statutory public notices email-intake (publicnoticeillinois.com) and county treasurer annual tax sale rosters.'
  }),
  IN: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Ind. Code § 6-1.1-24-1',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via SRI Services county auction catalogs and Indiana statutory public notice feeds.'
  }),
  IA: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Iowa Code § 446.16',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via Iowa Treasurers Association (IowaTaxAndTags) auction portal and county public notices.'
  }),
  KS: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Kan. Stat. Ann. § 79-2801',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county district court judicial foreclosure dockets and sheriff auction notices.'
  }),
  KY: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Ky. Rev. Stat. § 134.128',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county clerk certificate of delinquency listings and KY Department of Revenue delinquent rolls.'
  }),
  LA: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: 'La. Rev. Stat. § 47:2153',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via CivicSource parish tax sale auctions and parish legal public notices.'
  }),
  ME: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Me. Rev. Stat. tit. 36, § 942',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via municipal town sealed-bid / auction notices and local statutory public notices.'
  }),
  MD: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Md. Code, Tax-Prop. § 14-808',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county tax sale online auction platforms (BidExec, RealAuction) and county finance legal notices.'
  }),
  MA: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Mass. Gen. Laws ch. 60, § 53',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via municipal auctioneer catalogs (Sullivan & Sullivan) and Massachusetts Land Court tax foreclosure dockets.'
  }),
  MI: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Mich. Comp. Laws § 211.78m',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via Michigan County Foreclosure Auctions (Title-Check) and county treasurer notice portals.'
  }),
  MN: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Minn. Stat. § 282.01',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county land department tax-forfeited land auction lists and Minnesota statutory public notices.'
  }),
  MS: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: 'Miss. Code Ann. § 27-41-55',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county auction platforms (GovEase) and chancery clerk delinquent tax rolls.'
  }),
  MO: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Mo. Rev. Stat. § 140.150',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county collector annual tax auction rosters and Missouri statutory public notices.'
  }),
  MT: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Mont. Code Ann. § 15-17-121',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county treasurer delinquent rolls and Montana legal newspaper notices.'
  }),
  NE: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Neb. Rev. Stat. § 77-1801',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county treasurer tax sale certificate rolls and Nebraska press public notices.'
  }),
  NV: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Nev. Rev. Stat. § 361.595',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via Bid4Assets Nevada county auctions and county treasurer notice portals.'
  }),
  NH: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'N.H. Rev. Stat. Ann. § 80:76',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via municipal town tax deed auction announcements and local legal notices.'
  }),
  NJ: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'N.J. Stat. Ann. § 54:5-19',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via municipal tax sale certificate auctions (NJTaxLienAuctions, RealAuction) and CivilView notices.'
  }),
  NM: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'N.M. Stat. Ann. § 7-38-65',
    ingestionMethod: 'state-portal',
    ingestionNotes: 'Ingested via NM Taxation and Revenue Department Property Tax Division statewide auction schedules.'
  }),
  NY: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'N.Y. Real Prop. Tax Law § 1120',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via Auctions International, NYSAuctions county auctions, and county treasurer Article 11 foreclosure notices.'
  }),
  NC: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'N.C. Gen. Stat. § 105-374',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county commissioner judicial tax foreclosure dockets, 10-day upset bid filings, and legal notices.'
  }),
  ND: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'N.D. Cent. Code § 57-28-15',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county auditor annual tax deed auction lists and North Dakota newspaper public notices.'
  }),
  OH: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Ohio Rev. Code § 5721.18',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via Realauction Ohio sheriff sale portals (sheriff adapter) and publicnoticesohio.com email-intake.'
  }),
  OK: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Okla. Stat. tit. 68, § 3125',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county treasurer annual June tax deed resale catalogs and county legal notices.'
  }),
  OR: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Or. Rev. Stat. § 312.010',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county property management surplus foreclosed deed auctions and county legal notices.'
  }),
  PA: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: '72 P.S. § 5860.601 / 35 P.S. § 1701',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via County Tax Claim Bureau upset/judicial sales, Bid4Assets PA auctions, and publicnoticepa.com email-intake.'
  }),
  RI: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: 'R.I. Gen. Laws § 44-9-12',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via municipal tax collector public auction notices and Rhode Island legal notice publications.'
  }),
  SC: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'S.C. Code Ann. § 12-51-40',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county delinquent tax collector auction lists and South Carolina legal notices.'
  }),
  SD: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'S.D. Codified Laws § 10-23-1',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county treasurer annual tax certificate auction rolls and legal newspaper notices.'
  }),
  TN: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: 'Tenn. Code Ann. § 67-5-2501',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via Chancery Court clerk tax sale dockets and Tennessee public notice legal feeds.'
  }),
  TX: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: 'Tex. Tax Code § 34.21',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county constable/sheriff auction notices, Linebarger/Perdue catalogs, and texaspublicnotices.com email-intake.'
  }),
  UT: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Utah Code § 59-2-1351.1',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county auditor annual May/June tax deed sale rosters and Utah public notice portal.'
  }),
  VT: Object.freeze({
    regime: 'hybrid_redeemable_deed',
    legalRef: 'Vt. Stat. Ann. tit. 32, § 5252',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via town tax collector public sale notices and Vermont statutory legal publications.'
  }),
  VA: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Va. Code § 58.1-3965',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via Special Commissioner of Sale judicial auctions (ForSaleAtAuction, VAnsells) and circuit court notices.'
  }),
  WA: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Wash. Rev. Code § 84.64.050',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via Bid4Assets Washington county tax foreclosure auctions and county treasurer notices.'
  }),
  WV: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'W. Va. Code § 11A-3-1',
    ingestionMethod: 'state-portal',
    ingestionNotes: 'Ingested via WV State Auditor County Collections public auctions and county sheriff notices.'
  }),
  WI: Object.freeze({
    regime: 'tax_deed',
    legalRef: 'Wis. Stat. § 75.521',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county treasurer In Rem tax foreclosure catalogs and Wisconsin newspaper public notices.'
  }),
  WY: Object.freeze({
    regime: 'tax_lien',
    legalRef: 'Wyo. Stat. § 39-13-108',
    ingestionMethod: 'county-platform',
    ingestionNotes: 'Ingested via county treasurer annual tax lien auction rolls and Wyoming press legal notices.'
  })
});

/** Official state government portal used as discovery root for enrollment. */
function statePortal(state) {
  return 'https://www.usa.gov/state-governments';
}

function buildNationwideStateEntries() {
  const entries = [];
  for (const code of US_STATES) {
    const name = STATE_NAMES[code] || code;
    const statute = STATE_TAX_SALE_STATUTES[code] || {
      regime: 'tax_deed',
      legalRef: 'State statute',
      ingestionMethod: 'county-platform',
      ingestionNotes: 'Ingested via county public notices and official platforms.'
    };
    entries.push({
      id: `state-tax-sale-${code.toLowerCase()}`,
      label: `${name} (${code}) State/County Tax Sale Program`,
      category: 'tax_sale',
      role: 'opportunity',
      coverage: `${name} statewide tax sale program (${statute.regime.replace(/_/g, ' ')}) — per-county enrollment required; governed by ${statute.legalRef}.`,
      discoveryUrl: statePortal(code),
      access: 'jurisdiction',
      adapterKey: null,
      status: 'LOCAL_ROUTE',
      regime: statute.regime,
      legalRef: statute.legalRef,
      ingestionMethod: statute.ingestionMethod,
      workflow: {
        primary: `Identify the ${name} county tax collector/treasurer that publishes ${statute.regime.replace(/_/g, ' ')} sales under ${statute.legalRef} and enroll that exact official notice publisher.`,
        fallback: 'Use state comptroller/revenue guidance and county treasurer contacts.',
        cadenceHours: 168,
        steps: [
          `Confirm ${statute.regime.replace(/_/g, ' ')} statutory procedure under ${statute.legalRef}.`,
          `Ingest via ${statute.ingestionNotes}`,
          'Capture notice URL, sale type, redemption rules, and bidder requirements.',
        ],
      },
      requiredEvidence: [
        'official county/state tax-sale notice',
        'parcel or legal description',
        'sale type and redemption terms',
        'source-observed timestamp',
      ],
      notes: `Nationwide enrollment template for ${name}. Statutory regime: ${statute.regime} (${statute.legalRef}). ${statute.ingestionNotes} Tax lien ≠ ownership. CAPTCHA marketplaces remain excluded.`,
    });
    entries.push({
      id: `state-surplus-${code.toLowerCase()}`,
      label: `${name} (${code}) State Surplus Real Property`,
      category: 'government_surplus',
      role: 'opportunity',
      coverage: `${name} state agency excess real-estate disposal programs; office and portal vary by state.`,
      discoveryUrl: statePortal(code),
      access: 'jurisdiction',
      adapterKey: null,
      status: 'LOCAL_ROUTE',
      workflow: {
        primary: `Enroll the ${name} state surplus/procurement office that disposes real property.`,
        fallback: 'Use state public-notice register and agency facilities contacts.',
        cadenceHours: 168,
        steps: [
          'Identify the state real-property disposal authority.',
          'Find the exact solicitation or auction notice.',
          'Record sale method, deposit, and transfer conditions.',
        ],
      },
      requiredEvidence: ['state disposal notice', 'legal description', 'bid/offer terms'],
      notes: `Nationwide enrollment template for ${name} surplus real property only (not personal property).`,
    });
  }
  return entries;
}

const NATIONWIDE_US_ENTRIES = Object.freeze(buildNationwideStateEntries());

const CIVILVIEW_NATIONWIDE_ENTRY = Object.freeze({
  id: 'civilview-nationwide',
  label: 'CivilView Participating Jurisdictions (Nationwide set)',
  category: 'foreclosure_auction',
  role: 'opportunity',
  coverage: 'All currently published CivilView/Sales Web participating counties (multi-state sheriff and tax-sale programs). Not every U.S. county.',
  discoveryUrl: 'https://salesweb.civilview.com/',
  access: 'jurisdiction',
  adapterKey: 'civilview',
  status: 'SCOPE_LIMITED',
  workflow: {
    primary: 'Set CIVILVIEW_NATIONWIDE=1 or enroll per-state CIVILVIEW_EXTRA_COUNTIES from config/nationwide-civilview.js.',
    fallback: 'Use each county sheriff/treasurer original notice.',
    cadenceHours: 12,
    steps: [
      'Discover countyId via scripts/civilview-counties.js.',
      'Enroll bounded county sets per run (maxCounties/detailLimit).',
      'Capture SaleDetails and issuing-county notice terms.',
    ],
  },
  requiredEvidence: ['CivilView SaleDetails URL', 'issuing county notice', 'source-observed timestamp'],
  notes: 'Nationwide means all participating CivilView counties (~67 across 18 states as of 2026-09-19), not 3,000+ U.S. counties.',
});

const SHERIFF_REALEAUCTION_MULTI_STATE = Object.freeze({
  id: 'realeauction-sheriff-multi-state',
  label: 'Realauction Sheriff/Tax Sale Portals (Multi-state)',
  category: 'foreclosure_auction',
  role: 'opportunity',
  coverage: 'Participating Realauction county portals (Ohio default set + operator-enrolled counties in other states using the same platform).',
  discoveryUrl: 'https://www.realauction.com/',
  access: 'jurisdiction',
  adapterKey: 'sheriff',
  status: 'LOCAL_ROUTE',
  workflow: {
    primary: 'Enroll Name:domain:ST via SHERIFF_EXTRA_COUNTIES for each Realauction county portal.',
    fallback: 'County sheriff or tax collector original sale notice.',
    cadenceHours: 12,
    steps: [
      'Confirm the county publishes on Realauction / sheriffsaleauction.* domains.',
      'Enroll domain and state code.',
      'Capture case/sale record and court or tax authority terms.',
    ],
  },
  requiredEvidence: ['Realauction case/sale URL', 'county authority notice', 'sale date and bid terms'],
  notes: 'Ohio defaults ship in sheriff.js; other states require explicit enrollment. Not nationwide by default.',
});

module.exports = {
  US_STATES,
  STATE_NAMES,
  STATE_TAX_SALE_STATUTES,
  NATIONWIDE_US_ENTRIES,
  CIVILVIEW_NATIONWIDE_ENTRY,
  SHERIFF_REALEAUCTION_MULTI_STATE,
  buildNationwideStateEntries,
};
