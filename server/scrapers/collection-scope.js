'use strict';

const { acquisitionScope } = require('../discovery/run-report');

const FIXED_SCOPES = Object.freeze({
  treasury: { endpoint: '/auctions/treasury/rp/realprop.shtml', filters: { assetClass: 'real_property' } },
  irs: { endpoint: '/auction/items', filters: { assetClass: 'real_estate' } },
  gsa: { endpoint: '/our-listing', filters: { assetClass: 'real_estate' } },
  usda: { endpoint: '/resales/public/searchSFH', filters: { propertyType: 'Single Family' }, jurisdictionSelection: 'publisher_inventory_options' },
});

function collectionScope(scraper) {
  if (!scraper || typeof scraper !== 'object') return null;
  if (typeof scraper.getCollectionScope === 'function') return acquisitionScope(scraper.getCollectionScope()) || null;
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
