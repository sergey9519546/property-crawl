'use strict';

/**
 * Market enrollment for CivilView + Sheriff (Ohio Realauction) collectors.
 * Only public publisher surfaces. CAPTCHA storefronts are listed as
 * fail-closed and never enrolled for automatic crawl.
 */

const { CIVILVIEW_NATIONWIDE, countiesByState, allStateCodes, idsForState } = require('./nationwide-civilview');

const MARKET_ENROLLMENT = {
  version: 2,
  note: 'Nationwide participating CivilView set + OH Sheriff extras + careful HUD. CAPTCHA never enrolled.',
  civilview: {
    nationwide: true,
    targetStates: allStateCodes(),
    maxCountiesPerRun: 8,
    detailLimit: 80,
    // Full multi-state registry lives in config/nationwide-civilview.js
    extraCountyIdsByState: Object.fromEntries(
      allStateCodes().map((state) => [state, idsForState(state).map((c) => c.id)])
    ),
    registryCountyCount: CIVILVIEW_NATIONWIDE.counties.length,
  },
  sheriffOhio: {
    extraCounties: [
      { name: 'Portage', domain: 'portage.sheriffsaleauction.ohio.gov', state: 'OH' },
      { name: 'Union', domain: 'union.sheriffsaleauction.ohio.gov', state: 'OH' },
      { name: 'Wayne', domain: 'wayne.sheriffsaleauction.ohio.gov', state: 'OH' },
      { name: 'Miami', domain: 'miami.sheriffsaleauction.ohio.gov', state: 'OH' },
      { name: 'Greene', domain: 'greene.sheriffsaleauction.ohio.gov', state: 'OH' },
    ],
    countyConcurrency: 3,
  },
  hud: {
    states: 'OH,NJ,PA,FL,TX,GA,AZ,NC,IL,MI',
    maxPagesPerState: 4,
    pageSize: 50,
    stateConcurrency: 2,
  },
  captchaFailClosed: [
    { source: 'bid4assets', reason: 'Akamai/CAPTCHA storefront; never auto-bypass' },
    { source: 'landbank', reason: 'Turnstile/CAPTCHA on some portals' },
    { source: 'ca-controller-tax-sale', reason: 'Cloudflare challenge; DISCOVERY_ONLY' },
  ],
};

function stateFromCountyName(name) {
  const match = String(name || '').match(/,\s*([A-Z]{2})\b/);
  return match ? match[1] : null;
}

/**
 * Pair live CivilView index with enrollment target states.
 * Returns validated ids only — unknown ids are dropped, never guessed.
 */
function resolveCivilViewIds(liveCounties, enrollment = MARKET_ENROLLMENT) {
  const byId = new Map(liveCounties.map((c) => [String(c.id), c]));
  const result = {};
  for (const state of enrollment.civilview.targetStates) {
    const preferred = (enrollment.civilview.extraCountyIdsByState[state] || [])
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .filter((c) => !c.state || c.state === state);
    const liveForState = liveCounties.filter((c) => c.state === state);
    // Auto-fill from live index when enrollment list is empty (operator default).
    const ids = preferred.length
      ? preferred.map((c) => String(c.id))
      : liveForState.slice(0, enrollment.civilview.maxCountiesPerRun).map((c) => String(c.id));
    result[state] = {
      ids,
      names: ids.map((id) => byId.get(id)?.name || id),
      liveCount: liveForState.length,
    };
  }
  return result;
}

function sheriffExtraCountiesEnv(enrollment = MARKET_ENROLLMENT) {
  return enrollment.sheriffOhio.extraCounties
    .map((c) => `${c.name}:${c.domain}:${c.state}`)
    .join(',');
}

function hudEnv(enrollment = MARKET_ENROLLMENT) {
  const hud = enrollment.hud;
  return {
    HUD_STATES: hud.states,
    HUD_MAX_PAGES_PER_STATE: String(hud.maxPagesPerState),
    HUD_PAGE_SIZE: String(hud.pageSize),
    HUD_STATE_CONCURRENCY: String(hud.stateConcurrency),
  };
}

module.exports = {
  MARKET_ENROLLMENT,
  resolveCivilViewIds,
  sheriffExtraCountiesEnv,
  hudEnv,
  stateFromCountyName,
};
