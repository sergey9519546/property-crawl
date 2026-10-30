'use strict';

const fs = require('fs');
const path = require('path');

const RAW_DATA_PATH = process.env.STATUTORY_SOURCES_RAW_PATH || 'C:/Users/serge/Videos/statutory-distress-deal-sources-master-list-v2.json';
const OUTPUT_PATH = path.resolve(__dirname, '../server/sources/statutory-distress-catalog.js');

const rawData = JSON.parse(fs.readFileSync(RAW_DATA_PATH, 'utf8'));
const rawMap = new Map(rawData.sources.map((s) => [s.id, s]));

const ID_MAP = {
  // Tax deeds (FL RealForeclose / RealTaxDeed)
  'tax_v2_fl_miamidade_tax_deed': 'tax-miamidade-realforeclose',
  'tax_v2_fl_broward_tax_deed': 'tax-broward-realtaxdeed',
  'tax_v2_fl_palmbeach_tax_deed': 'tax-palmbeach-realtaxdeed',
  'tax_v2_fl_orange_tax_deed': 'tax-orange-realtaxdeed',
  'tax_v2_fl_hillsborough_tax_deed': 'tax-hillsborough-realtaxdeed',
  'tax_v2_fl_lee_tax_deed': 'tax-lee-realtaxdeed',
  'tax_v2_fl_pinellas_tax_deed': 'tax-pinellas-realtaxdeed',
  'tax_v2_fl_duval_tax_deed': 'tax-duval-realtaxdeed',
  'tax_v2_fl_polk_tax_deed': 'tax-polk-realtaxdeed',
  // Tax deeds (TX)
  'tax_v2_tx_dallas_tax': 'tax-dallas-tx-pubworks',
  'tax_v2_tx_bexar_tax': 'tax-bexar-tx-resale',
  'tax_v2_tx_tarrant_tax': 'tax-tarrant-tx-constable',
  'tax_v2_tx_travis_tax': 'tax-travis-tx-constable',
  // Tax deeds (GA)
  'tax_v2_ga_fulton_tax': 'tax-fulton-ga-sheriff',
  'tax_v2_ga_dekalb_tax': 'tax-dekalb-ga-publicaccess',
  'tax_v2_ga_cobb_tax': 'tax-cobb-ga-tax',
  'tax_v2_ga_clayton_tax': 'tax-clayton-ga-publicaccess',
  // Tax deeds (OH)
  'tax_v2_oh_cuyahoga_tax': 'tax-cuyahoga-oh-cpdocket',
  'tax_v2_oh_franklin_tax': 'tax-franklin-oh-sheriff',
  // Tax deeds (MO)
  'tax_v2_oh_16thcircuit': 'tax-jackson-mo-16thcircuit',
  // Tax deeds (MD)
  'tax_v2_md_pg_tax': 'tax-princegeorges-md-portal',
  'tax_v2_md_baltimore_tax': 'tax-baltimore-city-md-taxlien',
  'tax_v2_md_baltcounty_tax': 'tax-baltimore-county-md-ad',
  // Tax deeds (AZ)
  'tax_v2_az_maricopa_unsold_pdf': 'tax-maricopa-az-unsold-inventory',
  // Tax deeds (CO)
  'tax_v2_co_arapahoe_tax': 'tax-arapahoe-co-treasurer',
  'tax_v2_co_denver_tax': 'tax-denver-co-delinquent',
  // Tax deeds (NV)
  'tax_v2_nv_clark_tax': 'tax-clark-nv-treasurer',
  // Tax deeds (IL)
  'tax_v2_il_cook_tax': 'tax-cook-il-scavenger-sale',
  // Tax deeds (MI)
  'tax_v2_mi_wayne_tax': 'tax-wayne-mi-foreclosed-auction',
  'tax_v2_mi_oakland_tax': 'tax-oakland-mi-treasurer',
  'tax_v2_mi_macomb_tax': 'tax-macomb-mi-treasurer',
  'tax_v2_mi_genesee_tax': 'tax-genesee-mi-treasurer',
  // Tax deeds (IN)
  'tax_v2_in_allen_tax': 'tax-allen-in-treasurer',
  'tax_v2_in_grant_tax': 'tax-grant-in-delinquent-listing',
  // Tax deeds (NC)
  'tax_v2_nc_mecklenburg_tax': 'tax-mecklenburg-nc-foreclosure',
  'tax_v2_nc_mecklenburg_delinquent': 'tax-mecklenburg-nc-delinquent',
  'tax_v2_nc_durham_tax': 'tax-durham-nc-foreclosure',
  'tax_v2_nc_wake_tax': 'tax-wake-nc-foreclosure',
  'tax_v2_nc_durham_map': 'tax-durham-nc-arcgis-delinquent',
  // Tax deeds (TN)
  'tax_v2_tn_shelby_tax': 'tax-shelby-tn-county-sale',
  'tax_v2_tn_shelby_trustee_tax': 'tax-shelby-tn-trustee-sale',
  'tax_v2_tn_knox_tax': 'tax-knox-tn-trustee-sale',
  'tax_v2_tn_nashville_tax': 'tax-nashville-davidson-chancery-clerk',
  'tax_v2_tn_knox_kgis': 'tax-knox-tn-kgis-taxmap',
  // Tax deeds (CA)
  'tax_v2_ca_orange_tax': 'tax-orange-ca-treasurer-auction',
  'tax_v2_ca_state_sco': 'tax-ca-state-controller-auctions',
  // Tax deeds (WA)
  'tax_v2_wa_king_tax': 'tax-king-wa-treasury-foreclosure',
  'tax_v2_wa_pierce_tax': 'tax-pierce-wa-foreclosure-purchase',
  'tax_v2_wa_snohomish_tax': 'tax-snohomish-wa-foreclosure-details',
  // Tax deeds (MA)
  'tax_v2_ma_worcester_tax': 'tax-worcester-ma-foreclosure-auctions',
  // Tax deeds (NY)
  'tax_v2_ny_nyc_inrem': 'tax-nyc-dof-in-rem-foreclosure',
  // Tax deeds (PA)
  'tax_v2_pa_indiana_tax': 'tax-indiana-pa-claim-bureau',
  // Tax deeds (DC)
  'tax_v2_dc_taxsale': 'tax-dc-otr-annual-tax-sale',

  // Sheriff sales
  'sheriff_v2_il_cook': 'sheriff-cook-il-civil-services',
  'sheriff_v2_oh_cuyahoga': 'sheriff-cuyahoga-oh-cpdocket',
  'sheriff_v2_oh_franklin': 'sheriff-franklin-oh-real-estate',
  'sheriff_v2_oh_cook_ccsheriff': 'sheriff-cook-il-foreclosure-portal',
  'sheriff_v2_nj_union': 'sheriff-union-nj-sales-info',
  'sheriff_v2_nj_middlesex': 'sheriff-middlesex-nj-foreclosures',
  'sheriff_v2_pa_phila': 'sheriff-philadelphia-pa-foreclosures',
  'sheriff_v2_pa_montgomery': 'sheriff-montgomery-pa-sales',
  'sheriff_v2_pa_chesco': 'sheriff-chester-pa-handbills',
  'sheriff_v2_pa_delco': 'sheriff-delaware-pa-real-estate',
  'sheriff_v2_pa_will': 'sheriff-will-il-surplus-list',
  'sheriff_v2_ga_fulton': 'sheriff-fulton-ga-tax-sales',
  'sheriff_v2_nv_clark': 'sheriff-clark-nv-civil-sales',
  'sheriff_v2_nv_clark_2025': 'sheriff-clark-nv-annual-sales',
  'sheriff_v2_fl_miamidade': 'foreclosure-miamidade-realforeclose',
  'sheriff_v2_fl_miamidade_lis': 'foreclosure-miamidade-lis-pendens',
  'sheriff_v2_ma_suffolk_records': 'foreclosure-masslandrecords-suffolk',
  'foreclosure_v2_lasvegas_registry': 'foreclosure-lasvegas-abandoned-registry',

  // Land Banks
  'landbank_v2_detroit_properties': 'landbank-detroit-dlba',
  'landbank_v2_detroit sidelots': 'landbank-detroit-sidelots',
  'landbank_v2_detroit_opendata': 'landbank-detroit-opendata-dataset',
  'landbank_v2_cuyahoga_available': 'landbank-cuyahoga-available-properties',
  'landbank_v2_cuyahoga_sideyard': 'landbank-cuyahoga-sideyard-properties',
  'landbank_v2_cuyahoga_homes': 'landbank-cuyahoga-homes',
  'landbank_v2_cook_inventory': 'landbank-cook-county-inventory',
  'landbank_v2_cook_county_il': 'landbank-cook-county-government',
  'landbank_v2_cleveland': 'landbank-cleveland-program',
  'landbank_v2_communityprogress_map': 'landbank-community-progress-national-map',

  // Bank REO
  'bankreo_v2_boa_search': 'bankreo-bank-of-america-foreclosures',
  'bankreo_v2_boa_realestatecenter': 'bankreo-boa-real-estate-center',
  'bankreo_v2_wellsfargo': 'bankreo-wells-fargo-listings',
  'bankreo_v2_usbank': 'bankreo-us-bank-residential',
  'bankreo_v2_regions': 'bankreo-regions-bank-properties',
  'bankreo_v2_hud_homes_for_sale': 'bankreo-hud-gov-homes-for-sale',

  // Probate
  'probate_v2_nyc_websurrogate': 'probate-nyc-websurrogates-case-search',
  'probate_v2_nyc_kings': 'probate-kings-ny-surrogates-court',
  'probate_v2_nyc_ny_county': 'probate-newyork-ny-surrogates-court',
  'probate_v2_cook_il': 'probate-cook-il-probate-division',
  'probate_v2_cuyahoga_oh': 'probate-cuyahoga-oh-court-search',
  'probate_v2_harris_tx': 'probate-harris-tx-court-search',
  'probate_v2_dallas_tx': 'probate-dallas-tx-court-search',
  'probate_v2_la_ca': 'probate-losangeles-ca-superior-court',
  'probate_v2_sd_ca': 'probate-sandiego-ca-case-search',
  'probate_v2_fulton_ga': 'probate-fulton-ga-court-search',
  'probate_v2_wayne_mi': 'probate-wayne-mi-third-circuit',
  'probate_v2_essex_nj': 'probate-essex-nj-surrogates-court',
  'probate_v2_philadelphia_pa': 'probate-philadelphia-pa-register-of-wills',
  'probate_v2_pima_az': 'probate-pima-az-superior-court',
  'probate_v2_maricopa_az': 'probate-maricopa-az-superior-court',
  'probate_v2_king_wa': 'probate-king-wa-superior-court',
  'probate_v2_miami_fl': 'probate-miamidade-fl-civil-probate'
};

function buildEntry(rawId, newId) {
  const raw = rawMap.get(rawId);
  if (!raw) throw new Error('Missing rawId: ' + rawId);
  const discoveryUrl = raw.url.replace(/^http:\/\//, 'https://');
  
  let category, role, access, status;
  let workflow, requiredEvidence;

  if (raw.category === 'tax_deed') {
    category = 'tax_sale';
    role = 'opportunity';
    access = discoveryUrl.includes('realforeclose.com') || discoveryUrl.includes('realtaxdeed.com') || discoveryUrl.includes('arcgis.com') ? 'public' : 'jurisdiction';
    status = newId === 'tax-ca-state-controller-auctions' ? 'DISCOVERY_ONLY' : 'LOCAL_ROUTE';
    workflow = {
      primary: `Inspect ${raw.source_name} for delinquent tax property records and scheduled auctions.`,
      fallback: 'Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.',
      cadenceHours: raw.refresh_cadence === 'daily' ? 24 : 168,
      steps: [
        'Review published delinquent tax roll or scheduled tax-deed auction notices.',
        'Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.',
        'Preserve exact publisher record URL, auction ID, and source-observed timestamp.'
      ]
    };
    requiredEvidence = [
      'official county tax-sale notice or auction parcel ID',
      'APN or legal description',
      'opening bid or delinquent amount',
      'source-observed timestamp'
    ];
  } else if (raw.category === 'sheriff_sale' || raw.category === 'foreclosure') {
    category = 'foreclosure_auction';
    role = 'opportunity';
    access = discoveryUrl.includes('realforeclose.com') ? 'public' : 'jurisdiction';
    status = 'LOCAL_ROUTE';
    workflow = {
      primary: `Monitor ${raw.source_name} for civil foreclosure sale notices and scheduled auctions.`,
      fallback: 'Confirm foreclosure sale status with the county sheriff civil division or court clerk.',
      cadenceHours: 24,
      steps: [
        'Examine sheriff foreclosure sale calendar and legal advertisement notices.',
        'Extract case number, plaintiff/defendant, property address, and minimum bid.',
        'Confirm sale status and adjournment history with the civil process office.'
      ]
    };
    requiredEvidence = [
      'sheriff or court sale notice and case number',
      'property address or legal description',
      'scheduled sale date and bid terms',
      'source-observed timestamp'
    ];
  } else if (raw.category === 'land_bank') {
    category = 'land_bank';
    role = 'opportunity';
    access = 'public';
    status = newId.includes('national-map') ? 'DISCOVERY_ONLY' : 'LOCAL_ROUTE';
    workflow = {
      primary: `Search ${raw.source_name} for available residential, commercial, or side-lot properties.`,
      fallback: 'Contact the land bank authority or municipal community development agency.',
      cadenceHours: 168,
      steps: [
        'Query land bank available inventory portal or open data records.',
        'Capture property parcel identifier, asking price, and program eligibility requirements.',
        'Verify compliance with local redevelopment guidelines before offer submission.'
      ]
    };
    requiredEvidence = [
      'official land bank property identifier or parcel number',
      'listing price and acquisition program terms',
      'source-observed timestamp'
    ];
  } else if (raw.category === 'bank_seized') {
    category = 'marketplace';
    role = 'opportunity';
    access = 'public';
    status = 'DISCOVERY_ONLY';
    workflow = {
      primary: `Search ${raw.source_name} for institution-owned real estate (REO) inventory.`,
      fallback: 'Contact designated bank asset management office or listing agent.',
      cadenceHours: 24,
      steps: [
        'Query bank foreclosure and REO disposition portal for target state and county.',
        'Capture property address, listing price, asset ID, and offer submission instructions.',
        'Verify occupancy status and clear title terms with asset manager.'
      ]
    };
    requiredEvidence = [
      'bank asset identifier or listing URL',
      'list price and offer submission window',
      'source-observed timestamp'
    ];
  } else if (raw.category === 'probate') {
    category = 'court_record';
    role = 'evidence';
    access = 'jurisdiction';
    status = 'LOCAL_ROUTE';
    workflow = {
      primary: `Search ${raw.source_name} for open probate estate filings and real-property assets.`,
      fallback: 'Inspect records in person at the county surrogate or probate court clerk counter.',
      cadenceHours: 168,
      steps: [
        'Search probate court docket for open decedent estate administration cases.',
        'Cross-reference estate petitions with recorded real-estate holdings.',
        'Retain case docket number, personal representative details, and court observation date.'
      ]
    };
    requiredEvidence = [
      'probate court case/docket number',
      'decedent estate title and court identifier',
      'source-observed timestamp'
    ];
  }

  const coverage = `${raw.source_name} (${raw.coverage || 'jurisdiction'}, ${raw.state}). Official statutory source for ${raw.category.replace(/_/g, ' ')}.`;
  const notes = `${raw.legal_notes} Tech: ${raw.tech_notes} Extraction method: ${raw.scrape_method}. Cost: ${raw.cost}. API: ${raw.api_available ? 'yes' : 'no'}.`;

  return {
    id: newId,
    label: raw.source_name,
    category,
    role,
    coverage,
    discoveryUrl,
    access,
    adapterKey: (status !== 'DISCOVERY_ONLY' && /(?:realforeclose\.com|realtaxdeed\.com|sheriffsaleauction\.ohio\.gov)/i.test(discoveryUrl))
      ? 'sheriff'
      : (status !== 'DISCOVERY_ONLY' && /salesweb\.civilview\.com/i.test(discoveryUrl))
        ? 'civilview'
        : null,
    status,
    workflow,
    requiredEvidence,
    notes
  };
}

const entries = Object.entries(ID_MAP).map(([rawId, newId]) => buildEntry(rawId, newId));

const fileContent = `'use strict';

/**
 * High-trust official distress deal sources extracted from
 * Curated statutory distress sources master catalog.
 *
 * Covers:
 * - Official county tax deed auction platforms (RealForeclose, RealTaxDeed) & county tax collectors
 * - Official sheriff civil foreclosure sales and court docket execution notices
 * - Municipal and county land banks (DLBA, Cuyahoga, Cook County, Cleveland)
 * - First-party bank REO property portals (Bank of America, Wells Fargo, US Bank, Regions)
 * - Official county surrogate and probate court case records
 */

const STATUTORY_DISTRESS_CATALOG_ENTRIES = Object.freeze(${JSON.stringify(entries, null, 2)});

module.exports = {
  STATUTORY_DISTRESS_CATALOG_ENTRIES
};
`;

fs.writeFileSync(OUTPUT_PATH, fileContent, 'utf8');
console.log(`Successfully generated ${OUTPUT_PATH} with ${entries.length} entries.`);
