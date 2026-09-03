export interface SourceInfo {
  key: string;
  label: string;
  tier: 'A' | 'B';
  color: string;
  note: string;
  websiteUrl: string;
}

export interface PropertyListing {
  id: string;
  source: string;
  state: string;
  county: string;
  city: string;
  zip: string;
  address: string;
  lat: number;
  lng: number;
  beds: number;
  baths: number;
  sqft: number;
  year: number | null;
  propType: string;
  openingBid: number;
  estLow: number;
  estHigh: number;
  assessed: number;
  mid: number;
  ratio: number;
  equity: number;
  dealScore: number;
  saleDate: string;
  plaintiff: string;
  defendant: string;
  judgment: number;
  attorney: string;
  occupancy: string;
  deposit: string;
  photo: string;
  sourceUrl?: string | null;
  raw?: string;
  redemptionDays?: number;
  redemptionWarning?: string | null;
  seniorLienRisk?: string;
  seniorLienWarning?: string | null;
  cashToClose?: number;
}

// Source registry — KEPT IN SYNC with the production SOURCES at
// `data.js` (window.SOURCES). The two consumers of the source taxonomy
// must agree on key, label, tier, color, note, and websiteUrl, so a
// "View source" link or tier badge looks the same whether the user is on
// the dashboard, the API, or the marketing site.
//
// SOURCES are mirrored manually here. The marketing site runs in Next.js
// and can't import a global-script `.js` file without a build step, so
// the duplication is deliberate. If you change this block, also change
// `data.js` (and vice versa), then re-run the test suite to catch any
// drift the CI hasn't yet learned to detect.
//
// The listings below are an INTENTIONAL marketing demo — a curated 6 of
// the production 20, with different values (price estimates, plaintiff
// names, attorney names) chosen to showcase the variety of source types.
// They share IDs with some production listings because the counties and
// source types are real, but the per-listing values are demo data. The
// production dataset for the live dashboard is at `data.js` (20 listings).
export const SOURCES: Record<string, SourceInfo> = {
  sheriff:  { key: 'sheriff',  label: "Sheriff Sale",         tier: 'B', color: '#0f766e', note: 'Foreclosure sale notice published under state law',        websiteUrl: 'https://www.cuyahogasheriff.org' },
  trustee:  { key: 'trustee',  label: "Trustee's Sale",       tier: 'B', color: '#0ea5e9', note: 'Non-judicial foreclosure auction',                          websiteUrl: 'https://www.clarkcountynv.gov' },
  hud:      { key: 'hud',      label: 'HUD Home',             tier: 'A', color: '#1d4ed8', note: 'hudhomestore.gov — owner-occupant window applies',         websiteUrl: 'https://www.hudhomestore.gov' },
  fannie:   { key: 'fannie',   label: 'Fannie Mae REO',       tier: 'A', color: '#2563eb', note: 'homepath.com — First Look window',                         websiteUrl: 'https://www.homepath.com' },
  freddie:  { key: 'freddie',  label: 'Freddie Mac REO',      tier: 'A', color: '#1e40af', note: 'homesteps.com',                                            websiteUrl: 'https://www.homesteps.com' },
  usda:     { key: 'usda',     label: 'USDA RD/FSA REO',      tier: 'A', color: '#3b82f6', note: 'resales.usda.gov',                                        websiteUrl: 'https://www.resales.usda.gov' },
  va:       { key: 'va',       label: 'VA REO',               tier: 'A', color: '#0e7490', note: 'vrmproperties.com',                                       websiteUrl: 'https://vrmproperties.com' },
  irs:      { key: 'irs',      label: 'IRS Seized',           tier: 'A', color: '#b45309', note: 'irsauctions.gov — email subscribe',                       websiteUrl: 'https://www.irsauctions.gov' },
  treasury: { key: 'treasury', label: 'Treasury Forfeiture',  tier: 'A', color: '#c2410c', note: 'CWS Marketing contractor',                                websiteUrl: 'https://www.treasury.gov/auctions/treasury/rp/realprop.shtml' },
  marshals:   { key: 'marshals',   label: 'US Marshals',          tier: 'A', color: '#a16207', note: 'RealLook.com / Gaston & Sheehan',                          websiteUrl: 'https://www.usmarshals.gov' },
  gsa:        { key: 'gsa',        label: 'GSA Surplus',          tier: 'A', color: '#92400e', note: 'realestatesales.gov',                                     websiteUrl: 'https://realestatesales.gov' },
  landbank:   { key: 'landbank',   label: 'Land Bank',            tier: 'B', color: '#059669', note: 'landbanksearch.com — 70+ county land bank aggregator',      websiteUrl: 'https://www.landbanksearch.com' },
  fdic:       { key: 'fdic',       label: 'FDIC REO',             tier: 'A', color: '#1e3a8a', note: 'sales.fdic.gov — Closed sales & receivership assets',      websiteUrl: 'https://sales.fdic.gov' },
  civilview:  { key: 'civilview',  label: 'CivilView Sheriff',    tier: 'B', color: '#0d9488', note: 'salesweb.civilview.com — Tyler Technologies docket',       websiteUrl: 'https://salesweb.civilview.com' },
  bid4assets: { key: 'bid4assets', label: 'Bid4Assets',           tier: 'B', color: '#7c3aed', note: 'bid4assets.com — County sheriff & tax auctions',          websiteUrl: 'https://www.bid4assets.com' },
};

export const INITIAL_LISTINGS: PropertyListing[] = [
  {
    id: 'OH-CUY-10231',
    source: 'sheriff',
    state: 'OH',
    county: 'Cuyahoga',
    city: 'Cleveland',
    zip: '44105',
    address: '3841 E 55th St, Cleveland, OH 44105',
    lat: 41.467,
    lng: -81.652,
    beds: 3,
    baths: 1.5,
    sqft: 1340,
    year: 1924,
    propType: 'Single Family',
    openingBid: 38000,
    estLow: 105000,
    estHigh: 132000,
    assessed: 88000,
    mid: 118500,
    ratio: 0.32,
    equity: 80500,
    dealScore: 88,
    saleDate: '2026-09-18',
    plaintiff: 'Huntington National Bank',
    defendant: 'Kowalski, Donald J.',
    judgment: 71340,
    attorney: 'Carlisle, McNellie, Rini, Kramer & Ulrich Co., LPA',
    occupancy: 'Occupied (drive-by only)',
    deposit: '$5,000 certified check to Sheriff at auction',
    photo: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80',
    sourceUrl: null,
    raw: 'CASE NO. CV-24-991204: Huntington National Bank vs. Donald J. Kowalski. Permanent Parcel No. 132-08-041. Appraised at $110,000. Minimum bid $38,000.'
  },
  {
    id: 'OH-FRA-20419',
    source: 'hud',
    state: 'OH',
    county: 'Franklin',
    city: 'Columbus',
    zip: '43207',
    address: '892 S Champion Ave, Columbus, OH 43207',
    lat: 39.945,
    lng: -82.971,
    beds: 3,
    baths: 1,
    sqft: 1180,
    year: 1952,
    propType: 'Single Family',
    openingBid: 52000,
    estLow: 118000,
    estHigh: 139000,
    assessed: 94000,
    mid: 128500,
    ratio: 0.40,
    equity: 76500,
    dealScore: 77,
    saleDate: '2026-09-24',
    plaintiff: 'U.S. Dept. of Housing & Urban Development',
    defendant: '—',
    judgment: 0,
    attorney: 'HUD Registered Listing Broker',
    occupancy: 'Vacant',
    deposit: '$1,000 earnest money via HUD HomeStore portal',
    photo: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80',
    sourceUrl: null,
    raw: 'HUD CASE 411-998214: 892 S Champion Ave. List $52,000. Owner occupant period active through Sept 20.'
  },
  {
    id: 'TX-TAR-30112',
    source: 'fannie',
    state: 'TX',
    county: 'Tarrant',
    city: 'Fort Worth',
    zip: '76105',
    address: '3218 Avenue I, Fort Worth, TX 76105',
    lat: 32.721,
    lng: -97.288,
    beds: 3,
    baths: 2,
    sqft: 1450,
    year: 1965,
    propType: 'Single Family',
    openingBid: 125000,
    estLow: 185000,
    estHigh: 210000,
    assessed: 168000,
    mid: 197500,
    ratio: 0.63,
    equity: 72500,
    dealScore: 68,
    saleDate: '2026-09-22',
    plaintiff: 'Fannie Mae REO',
    defendant: '—',
    judgment: 0,
    attorney: 'HomePath Realty Team',
    occupancy: 'Vacant',
    deposit: 'Standard HomePath contract terms',
    photo: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80',
    sourceUrl: null,
    raw: 'HOMEPATH REO PROPERTY: 3218 Avenue I. List $125,000. First Look program active.'
  },
  {
    id: 'NV-CLA-40551',
    source: 'irs',
    state: 'NV',
    county: 'Clark',
    city: 'Las Vegas',
    zip: '89101',
    address: '915 E Stewart Ave, Las Vegas, NV 89101',
    lat: 36.172,
    lng: -115.132,
    beds: 2,
    baths: 1,
    sqft: 980,
    year: 1958,
    propType: 'Single Family',
    openingBid: 110000,
    estLow: 215000,
    estHigh: 245000,
    assessed: 190000,
    mid: 230000,
    ratio: 0.48,
    equity: 120000,
    dealScore: 78,
    saleDate: '2026-09-29',
    plaintiff: 'Internal Revenue Service (PALS)',
    defendant: 'G. Morales Tax Estate',
    judgment: 142000,
    attorney: 'IRS Property Appraisal & Liquidation Specialist',
    occupancy: 'Vacant',
    deposit: '20% certified check day of auction',
    photo: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&q=80',
    sourceUrl: null,
    raw: 'IRS SEIZED PROPERTY AUCTION: 915 E Stewart Ave. Minimum bid $110,000. 180-day redemption rule applies.'
  },
  {
    id: 'FL-DUV-50123',
    source: 'tax',
    state: 'FL',
    county: 'Duval',
    city: 'Jacksonville',
    zip: '32208',
    address: '5424 Moncrief Rd, Jacksonville, FL 32208',
    lat: 30.385,
    lng: -81.701,
    beds: 3,
    baths: 2,
    sqft: 1280,
    year: 1974,
    propType: 'Single Family',
    openingBid: 29000,
    estLow: 135000,
    estHigh: 155000,
    assessed: 112000,
    mid: 145000,
    ratio: 0.20,
    equity: 116000,
    dealScore: 95,
    saleDate: '2026-09-17',
    plaintiff: 'Duval County Tax Collector',
    defendant: 'Estate of M. Williams',
    judgment: 18450,
    attorney: 'County Tax Foreclosure Division',
    occupancy: 'Vacant',
    deposit: '5% or $200 deposit via RealAuction',
    photo: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80',
    sourceUrl: null,
    raw: 'DUVAL TAX DEED CERT 2022-8812: 5424 Moncrief Rd. Tax certificate redemption expired.'
  },
  {
    id: 'GA-FULT-60281',
    source: 'trustee',
    state: 'GA',
    county: 'Fulton',
    city: 'Atlanta',
    zip: '30310',
    address: '1142 Cascade Ave SW, Atlanta, GA 30310',
    lat: 33.725,
    lng: -84.445,
    beds: 4,
    baths: 2,
    sqft: 1720,
    year: 1948,
    propType: 'Single Family',
    openingBid: 95000,
    estLow: 240000,
    estHigh: 280000,
    assessed: 215000,
    mid: 260000,
    ratio: 0.36,
    equity: 165000,
    dealScore: 84,
    saleDate: '2026-10-06',
    plaintiff: 'Fulton Trustee Liquidations',
    defendant: 'Harris, T. Estate',
    judgment: 118000,
    attorney: 'McCalla Raymer Leibert Pierce LLC',
    occupancy: 'Unknown',
    deposit: 'Certified cashier funds day of sale',
    photo: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80',
    sourceUrl: null,
    raw: 'GEORGIA NON-JUDICIAL POWER OF SALE: 1142 Cascade Ave SW. Minimum bid $95,000.'
  }
];
