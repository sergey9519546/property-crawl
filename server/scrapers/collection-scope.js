'use strict';

const { acquisitionScope } = require('../discovery/run-report');

const FIXED_SCOPES = Object.freeze({
  treasury: { endpoint: '/auctions/treasury/rp/realprop.shtml', filters: { assetClass: 'real_property' } },
  irs: { endpoint: '/auction/items', filters: { assetClass: 'real_estate' } },
  gsa: { endpoint: '/real-estate/real-property-disposition/assets-identified-for-accelerated-disposition', filters: { assetClass: 'real_estate', program: 'accelerated_disposition' } },
  usda: { endpoint: '/resales/public/searchSFH', filters: { propertyType: 'Single Family' }, jurisdictionSelection: 'publisher_inventory_options' },
  fannie: { endpoint: '/search-service/v1/properties', filters: { assetClass: 'real_estate' } },
  freddie: { endpoint: '/homesteps/api/propertysearch', filters: { assetClass: 'real_estate' } },
  va: { endpoint: '/api/properties', filters: { assetClass: 'real_estate' } },
  marshals: { endpoint: '/what-we-do/asset-forfeiture/real-property', filters: { assetClass: 'real_property' } },
  landbank: { endpoint: '/data', filters: { assetClass: 'real_estate' } },
  bid4assets: { endpoint: '/sheriffsales', filters: { assetClass: 'real_estate' } },
  sheriff: { endpoint: '/index.cfm', filters: { assetClass: 'real_estate' } },
});

function collectionScope(scraper) {
  if (!scraper || typeof scraper !== 'object') return null;
  if (typeof scraper.getCollectionScope === 'function') {
    const declared = acquisitionScope(scraper.getCollectionScope());
    if (declared) return declared;
  }
  const key = scraper.sourceKey;
  if (FIXED_SCOPES[key]) return acquisitionScope(FIXED_SCOPES[key]) || null;
  if (key === 'civilview') {
    if (!/^[A-Z]{2}$/.test(scraper.targetState || '') || !/^\d+$/.test(scraper.countyId || '')) return null;
    return acquisitionScope({ endpoint: '/Sales/SalesSearch', filters: { state: scraper.targetState, countyId: scraper.countyId } }) || null;
  }
  if (key === 'hud') {
    return acquisitionScope({
      endpoint: scraper.inventoryUrl ? `${scraper.inventoryUrl}/query` : '/Home/DataGrid',
      filters: scraper.inventoryUrl ? { caseStepNumber: 6 } : {},
      states: scraper.states,
      pageSize: scraper.pageSize,
    }) || null;
  }
  return null;
}

module.exports = { FIXED_SCOPES, collectionScope };
