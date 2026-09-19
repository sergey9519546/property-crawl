'use strict';

/**
 * Market enrollment for CivilView + Sheriff (Ohio Realauction) collectors.
 * Only public publisher surfaces. CAPTCHA storefronts are listed as
 * fail-closed and never enrolled for automatic crawl.
 */

const MARKET_ENROLLMENT = {
  version: 1,
  note: 'Operator market defaults. Override via env; never bypass CAPTCHA.',
  civilview: {
    targetStates: ['NJ', 'OH', 'PA', 'FL', 'TX', 'AZ'],
    // Ids validated against live salesweb.civilview.com index (2026-09-19).
    extraCountyIdsByState: {
      // NJ high-volume: Hudson, Bergen, Middlesex, Essex, Monmouth, Passaic, Union, Ocean
      NJ: ['10', '7', '73', '2', '8', '17', '15', '85'],
      // OH published CivilView counties
      OH: ['34', '18', '81', '61'],
      // PA: Lehigh, Montgomery, Philadelphia
      PA: ['51', '23', '60'],
      // FL: Palm Beach, Santa Rosa
      FL: ['49', '75'],
      // TX: Dallas P1/P2, Guadalupe Sheriff, Rockwall Sheriff
      TX: ['93', '94', '90', '63'],
      // AZ: Maricopa
      AZ: ['47'],
    },
    maxCountiesPerRun: 8,
    detailLimit: 80,
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
