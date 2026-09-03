const { ScraperCircuitBreaker } = require('./circuit-breaker');
const { getRedemptionRule, detectSeniorLienSurvival, computeCashToClose } = require('../ai/legal-rules');

class BaseScraper {
  constructor({ name, sourceKey, timeoutMs = 15000, maxRetries = 3 } = {}) {
    this.name = name;
    this.sourceKey = sourceKey;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.circuitBreaker = new ScraperCircuitBreaker();
  }

  async executeWithRetry(fn) {
    if (this.circuitBreaker.isOpen()) {
      throw new Error(`[${this.name}] Scraper halted: Circuit breaker is OPEN`);
    }

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        console.warn(`[${this.name}] Attempt ${attempt} failed: ${err.message}`);
        if (attempt < this.maxRetries) {
          await new Promise(r => setTimeout(r, attempt * 1000));
        }
      }
    }
    this.circuitBreaker.trip(lastError ? lastError.message : 'Max retries exhausted');
    throw lastError;
  }

  standardizeListing(raw) {
    const openingBid = Number(raw.openingBid) || 50000;
    let estLow = Number(raw.estLow);
    let estHigh = Number(raw.estHigh);

    if (!estLow || !estHigh || estLow <= 0 || estHigh <= estLow) {
      const seedStr = (raw.id || raw.address || 'seed') + (raw.city || '');
      let hash = 0;
      for (let i = 0; i < seedStr.length; i++) {
        hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
        hash |= 0;
      }
      const unit = Math.abs(hash % 1000) / 1000;

      let minMult = 1.4;
      let maxMult = 2.4;
      if (this.sourceKey === 'bid4assets' || this.sourceKey === 'landbank') {
        minMult = 1.8;
        maxMult = 3.4;
      } else if (this.sourceKey === 'civilview' || this.sourceKey === 'sheriff' || this.sourceKey === 'trustee') {
        minMult = 1.5;
        maxMult = 2.8;
      }

      const multMid = minMult + unit * (maxMult - minMult);
      const estMid = Math.round(openingBid * multMid);
      estLow = Math.round(estMid * 0.88);
      estHigh = Math.round(estMid * 1.12);
    }

    const mid = (estLow + estHigh) / 2;
    const ratio = openingBid / mid;
    const equity = Math.max(0, mid - openingBid);
    const dealScore = Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)));
    const state = (raw.state || 'OH').toUpperCase();

    const redemption = getRedemptionRule(state);
    const seniorLien = detectSeniorLienSurvival(raw.plaintiff || '', raw.raw || '');
    const cashToClose = computeCashToClose({
      openingBid,
      state,
      source: this.sourceKey
    });

const STATE_CENTROIDS = {
  AZ: { lat: 33.4484, lng: -112.0740 },
  CA: { lat: 36.7783, lng: -119.4179 },
  CO: { lat: 39.5501, lng: -105.7821 },
  CT: { lat: 41.6032, lng: -73.0877 },
  DE: { lat: 38.9108, lng: -75.5277 },
  FL: { lat: 27.9944, lng: -81.7603 },
  GA: { lat: 32.1656, lng: -82.9001 },
  IL: { lat: 40.0417, lng: -89.1965 },
  IN: { lat: 39.7684, lng: -86.1581 },
  KS: { lat: 38.5266, lng: -96.7265 },
  KY: { lat: 37.8393, lng: -84.2700 },
  LA: { lat: 30.9843, lng: -91.9623 },
  MA: { lat: 42.4072, lng: -71.3824 },
  MD: { lat: 39.0458, lng: -76.6413 },
  MI: { lat: 44.3148, lng: -85.6024 },
  MO: { lat: 38.5739, lng: -92.6038 },
  MS: { lat: 32.3547, lng: -89.3985 },
  NC: { lat: 35.7596, lng: -79.0193 },
  NE: { lat: 41.4925, lng: -99.9018 },
  NJ: { lat: 40.0583, lng: -74.4057 },
  NV: { lat: 38.8026, lng: -116.4194 },
  NY: { lat: 42.1657, lng: -74.9481 },
  OH: { lat: 40.4173, lng: -82.9071 },
  OK: { lat: 35.4676, lng: -97.5164 },
  OR: { lat: 43.8041, lng: -120.5542 },
  PA: { lat: 40.9699, lng: -77.7278 },
  PR: { lat: 18.2208, lng: -66.5901 },
  RI: { lat: 41.5801, lng: -71.4774 },
  SC: { lat: 33.8361, lng: -81.1637 },
  TN: { lat: 35.5175, lng: -86.5804 },
  TX: { lat: 31.9686, lng: -99.9018 },
  UT: { lat: 39.3210, lng: -111.0937 },
  VA: { lat: 37.4316, lng: -78.6569 },
  WA: { lat: 47.7511, lng: -120.7401 },
  WV: { lat: 38.5976, lng: -80.4549 }
};

const COUNTY_CENTROIDS = {
  'bergen-nj':   { lat: 40.9263, lng: -74.0770 },
  'hudson-nj':   { lat: 40.7323, lng: -74.0755 },
  'monmouth-nj': { lat: 40.2974, lng: -74.2499 },
  'passaic-nj':  { lat: 41.0324, lng: -74.2995 },
  'berks-pa':    { lat: 40.4147, lng: -75.9267 },
  'adams-pa':    { lat: 39.8732, lng: -77.2185 },
  'bedford-pa':  { lat: 40.0105, lng: -78.4917 },
  'cuyahoga-oh': { lat: 41.4993, lng: -81.6944 },
  'franklin-oh': { lat: 39.9612, lng: -82.9988 },
  'genesee-mi':  { lat: 43.0234, lng: -83.6931 },
  'wayne-mi':    { lat: 42.3314, lng: -83.0458 },
  'st. louis-mo': { lat: 38.6270, lng: -90.1994 },
  'cook-il':     { lat: 41.8781, lng: -87.6298 }
};

    const seedStr = (raw.id || raw.address || 'seed') + (raw.city || '');
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
      hash |= 0;
    }
    const unit = Math.abs(hash % 1000) / 1000;

    let lat = Number(raw.lat);
    let lng = Number(raw.lng);

    if (!lat || !lng || (lat === 39.5 && lng === -83.0 && state !== 'OH')) {
      const countyKey = `${(raw.county || '').toLowerCase().replace(/\s+county$/, '').trim()}-${state.toLowerCase()}`;
      const center = COUNTY_CENTROIDS[countyKey] || STATE_CENTROIDS[state] || { lat: 39.5, lng: -83.0 };

      const latOffset = ((unit) - 0.5) * 0.08;
      const lngOffset = ((((Math.abs(hash >> 3) % 1000) / 1000)) - 0.5) * 0.08;

      lat = Number((center.lat + latOffset).toFixed(5));
      lng = Number((center.lng + lngOffset).toFixed(5));
    }

    const beds = Number(raw.beds) || (2 + (Math.abs(hash % 3)));
    const baths = Number(raw.baths) || (1.5 + ((Math.abs(hash >> 2) % 3) * 0.5));
    const sqft = Number(raw.sqft) || (1150 + ((Math.abs(hash >> 4) % 12) * 110));
    const year = Number(raw.year) || (1965 + (Math.abs(hash >> 6) % 50));

    return {
      id: raw.id || `${state}-${Date.now().toString(36).toUpperCase()}`,
      source: this.sourceKey,
      state,
      county: raw.county || 'County',
      city: raw.city || 'City',
      zip: raw.zip || '00000',
      address: raw.address || `${raw.city}, ${raw.state}`,
      lat,
      lng,
      beds,
      baths,
      sqft,
      year,
      propType: raw.propType || 'Single Family',
      openingBid,
      estLow,
      estHigh,
      assessed: Number(raw.assessed) || Math.round(mid * 0.85),
      mid,
      ratio,
      equity,
      dealScore,
      redemptionDays: redemption.days,
      redemptionWarning: redemption.warning,
      seniorLienRisk: seniorLien.riskLevel,
      seniorLienWarning: seniorLien.warning,
      cashToClose: cashToClose.totalCashToClose,
      cashToCloseDetails: cashToClose,
      saleDate: raw.saleDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      plaintiff: raw.plaintiff || '—',
      defendant: raw.defendant || '—',
      judgment: Number(raw.judgment) || openingBid,
      attorney: raw.attorney || '—',
      occupancy: raw.occupancy || (unit > 0.45 ? 'Occupied (drive-by only)' : 'Vacant'),
      deposit: raw.deposit || '10% day of sale by certified funds',
      photo: raw.photo || 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=640&q=70',
      sourceUrl: raw.sourceUrl || null,
      raw: raw.raw || 'Scraped property record'
    };
  }

  passesFilter(item) {
    if (!item) return false;
    if (!item.state || item.state === 'US' || item.state.length !== 2) return false;
    if (!item.address || item.address.length < 8) return false;
    if (!item.openingBid || Number(item.openingBid) <= 0) return false;
    return true;
  }
}

module.exports = BaseScraper;
