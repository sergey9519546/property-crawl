'use strict';

/**
 * Nationwide coverage matrix for property-crawl sources.
 */

const { SOURCE_CATALOG, SOURCE_STATUS_BY_ID } = require('../server/sources/catalog');
const { CIVILVIEW_NATIONWIDE, allStateCodes } = require('../config/nationwide-civilview');
const { MARKET_ENROLLMENT } = require('../config/market-enrollment');

function main() {
  const federalNational = SOURCE_CATALOG.filter((s) =>
    s.coverage && /Nationwide|nationwide/.test(s.coverage) && s.adapterKey
  );
  const byStatus = {};
  for (const entry of SOURCE_CATALOG) {
    const status = entry.status || SOURCE_STATUS_BY_ID[entry.id] || 'UNKNOWN';
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  const stateTemplates = SOURCE_CATALOG.filter((s) => /^state-(tax-sale|surplus)-[a-z]{2}$/.test(s.id));

  console.log('=== Nationwide U.S. source coverage ===');
  console.log(`Catalog total: ${SOURCE_CATALOG.length}`);
  console.log(`CivilView participating counties: ${CIVILVIEW_NATIONWIDE.counties.length} across ${allStateCodes().length} states`);
  console.log(`CivilView states: ${allStateCodes().join(',')}`);
  console.log(`State tax-sale templates: ${stateTemplates.filter((s) => s.id.startsWith('state-tax-sale-')).length}`);
  console.log(`State surplus templates: ${stateTemplates.filter((s) => s.id.startsWith('state-surplus-')).length}`);
  console.log('--- Status mix ---');
  for (const [status, count] of Object.entries(byStatus).sort()) {
    console.log(`  ${status}: ${count}`);
  }
  console.log('--- Federal/national adapters with nationwide coverage text ---');
  for (const entry of federalNational) {
    console.log(`  ${entry.id} adapter=${entry.adapterKey}`);
  }
  console.log('--- CAPTCHA fail-closed ---');
  for (const item of MARKET_ENROLLMENT.captchaFailClosed) {
    console.log(`  ${item.source}`);
  }
  console.log('');
  console.log('Honesty: nationwide = federal national feeds + all published CivilView counties');
  console.log('+ 50-state enrollment templates. Not every U.S. county has a live scraper.');
}

if (require.main === module) main();

module.exports = { main };
