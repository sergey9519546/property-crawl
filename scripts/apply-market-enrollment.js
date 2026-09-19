'use strict';

/**
 * Apply market enrollment:
 * 1) Discover live CivilView county ids
 * 2) Resolve target-state enrollment
 * 3) Print env exports + validate CAPTCHA fail-closed sources
 *
 * Does not scrape listings. CAPTCHA sources are never enrolled.
 */

const {
  MARKET_ENROLLMENT,
  resolveCivilViewIds,
  sheriffExtraCountiesEnv,
  hudEnv,
} = require('../config/market-enrollment');
const { fetchCivilViewIndex } = require('./civilview-counties');

async function main() {
  console.log('=== Market enrollment ===');
  console.log(MARKET_ENROLLMENT.note);
  console.log('');

  let live = [];
  try {
    live = await fetchCivilViewIndex();
    console.log(`CivilView live counties discovered: ${live.length}`);
  } catch (error) {
    console.warn(`CivilView discovery failed (${error.message}); enrollment uses declared ids only.`);
  }

  const civilview = resolveCivilViewIds(live, MARKET_ENROLLMENT);
  console.log('--- CivilView by state ---');
  for (const [state, info] of Object.entries(civilview)) {
    console.log(`  ${state}: live=${info.liveCount} enrolled=${info.ids.join(',') || '(none)'} ${info.names.slice(0, 4).join(' | ')}`);
  }

  console.log('--- Sheriff OH extras ---');
  console.log(`  ${sheriffExtraCountiesEnv()}`);

  console.log('--- HUD careful defaults ---');
  const hud = hudEnv();
  for (const [key, value] of Object.entries(hud)) console.log(`  ${key}=${value}`);

  console.log('--- CAPTCHA fail-closed (never enrolled) ---');
  for (const item of MARKET_ENROLLMENT.captchaFailClosed) {
    console.log(`  ${item.source}: ${item.reason}`);
  }

  console.log('');
  console.log('Suggested env block (export / paste into host dashboard):');
  console.log('');
  console.log('# CivilView nationwide participating set');
  console.log('CIVILVIEW_NATIONWIDE=1');
  console.log(`CIVILVIEW_MAX_COUNTIES=${MARKET_ENROLLMENT.civilview.maxCountiesPerRun}`);
  console.log(`CIVILVIEW_DETAIL_LIMIT=${MARKET_ENROLLMENT.civilview.detailLimit}`);
  console.log(`# Participating states: ${Object.keys(civilview).join(',')}`);
  console.log(`# Registry counties: ${MARKET_ENROLLMENT.civilview.registryCountyCount || 'see config/nationwide-civilview.js'}`);
  console.log('');
  console.log(`# CivilView per-state extras (optional rotation)`);
  for (const [state, info] of Object.entries(civilview)) {
    if (!info.ids.length) continue;
    console.log(`# ${state}: ${info.names.slice(0, 3).join(', ')}${info.names.length > 3 ? '…' : ''} (${info.ids.length} ids)`);
    console.log(`# CIVILVIEW_TARGET_STATE=${state}`);
    console.log(`# CIVILVIEW_EXTRA_COUNTIES=${info.ids.join(',')}`);
  }
  console.log('');
  console.log(`SHERIFF_EXTRA_COUNTIES=${sheriffExtraCountiesEnv()}`);
  console.log(`SHERIFF_COUNTY_CONCURRENCY=${MARKET_ENROLLMENT.sheriffOhio.countyConcurrency}`);
  console.log('');
  for (const [key, value] of Object.entries(hud)) console.log(`${key}=${value}`);
  console.log('');
  console.log('SCRAPER_BACKGROUND_ENABLED=0  # careful: enable scheduled runs only after canaries');
  console.log('');
  console.log('CAPTCHA policy: bid4assets / landbank / ca-controller remain fail-closed.');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
