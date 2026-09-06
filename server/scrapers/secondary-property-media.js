'use strict';

// Deterministic and browser-safe. Search results are discovery, never evidence.
const { inspectImageUrl } = require('./media-policy');
const PROVIDERS = {
  'www.compass.com': { name: 'Compass', path: /^\/homedetails\/[^/]+\/[^/]+\/?$/, images: ['www.compass.com'] },
  'www.redfin.com': { name: 'Redfin', path: /^\/[A-Z]{2}\/[^/]+\/[^/]+\/home\/\d+\/?$/, images: ['ssl.cdn-redfin.com', 'photos.redfin.com'] },
  'www.zillow.com': { name: 'Zillow', path: /^\/homedetails\/[^/]+\/\d+_zpid\/?$/, images: ['photos.zillowstatic.com'] },
  'www.realtor.com': { name: 'Realtor.com', path: /^\/realestateandhomes-detail\/[^/]+$/, images: ['ap.rdcpix.com'] },
};
const WORDS = { STREET: 'ST', AVENUE: 'AVE', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', BOULEVARD: 'BLVD', COURT: 'CT', PLACE: 'PL', TERRACE: 'TER', CIRCLE: 'CIR', PARKWAY: 'PKWY', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };
const normalize = (value) => typeof value === 'string' ? value.toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim() : '';

function propertyPage(value) {
  try {
    const url = new URL(value);
    const provider = PROVIDERS[url.hostname];
    if (!provider || url.protocol !== 'https:' || url.username || url.password || url.port || !provider.path.test(url.pathname)) return null;
    url.search = ''; url.hash = '';
    return { url: url.toString().replace(/\/$/, ''), provider };
  } catch { return null; }
}

function exactAddress(value) {
  if (!value || typeof value !== 'object') return null;
  let street = normalize(value.streetAddress || value.address || value.street);
  const city = normalize(value.addressLocality || value.city);
  const state = normalize(value.addressRegion || value.state);
  const zip = normalize(value.postalCode || value.zip);
  const rawCountry = value.addressCountry || value.country || 'US';
  const country = normalize(typeof rawCountry === 'object' ? rawCountry.name : rawCountry);
  if (!city || /^(UNKNOWN|N A)$/.test(city) || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip) || zip === '00000' || !['US', 'USA', 'UNITED STATES'].includes(country)) return null;
  const suffix = ` ${city} ${state} ${zip}`;
  if (street.endsWith(suffix)) street = street.slice(0, -suffix.length);
  let unit = normalize(value.unit || '');
  const match = street.match(/\s+(?:APT|APARTMENT|UNIT|SUITE|STE|#)\s*([A-Z0-9-]+)$/);
  if (match) {
    if (unit && unit !== match[1]) return null;
    unit = match[1]; street = street.slice(0, match.index);
  }
  if (!/^\d+[A-Z]?(?:-\d+[A-Z]?)?\s+[A-Z0-9][A-Z0-9 '\/-]+$/.test(street) || street.includes('#')) return null;
  street = street.split(' ').map(word => WORDS[word] || word).join(' ');
  return { street, unit, city, state, zip, country: 'US' };
}

function sameAddress(left, right) {
  const a = exactAddress(left), b = exactAddress(right);
  return Boolean(a && b && ['street', 'unit', 'city', 'state', 'zip', 'country'].every(key => a[key] === b[key]));
}

function allowedImage(value, page) {
  const image = inspectImageUrl(value);
  if (!image.accepted) return null;
  const url = new URL(image.url);
  if (!page.provider.images.includes(url.hostname)) return null;
  // A same-host corporate logo or agent portrait must not qualify as a gallery.
  if (page.provider.name === 'Compass' && !/^\/m\/[a-f0-9]{32,}\/[^/]+\.(?:jpe?g|png|webp)$/i.test(url.pathname)) return null;
  return image.url;
}

function extractSecondaryMedia({ listing, sourceUrl, html, observedAt = new Date().toISOString() }) {
  const page = propertyPage(sourceUrl);
  const expected = exactAddress(listing);
  const reject = reason => ({ accepted: false, reason });
  if (!page) return reject('unsupported_or_non_detail_page');
  if (!expected) return reject('incomplete_canonical_address');
  if (typeof html !== 'string' || html.length > 3_000_000) return reject('invalid_page');
  const matching = [];
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue;
    let document;
    try { document = JSON.parse(script[2]); } catch { continue; }
    const roots = Array.isArray(document) ? document : [document];
    const nodes = roots.flatMap(root => root && Array.isArray(root['@graph']) ? root['@graph'] : [root]);
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      if (!types.some(type => ['SingleFamilyResidence', 'Residence', 'House', 'Apartment', 'RealEstateListing'].includes(type))) continue;
      const identity = propertyPage(node.url || node['@id']);
      if (!identity || identity.url !== page.url || !sameAddress(expected, node.address)) continue;
      matching.push(node);
    }
  }
  if (matching.length !== 1) return reject(matching.length ? 'ambiguous_property_entities' : 'exact_address_not_confirmed');
  const node = matching[0];
  const images = [...new Set((Array.isArray(node.image) ? node.image : [node.image]).map(image => allowedImage(typeof image === 'string' ? image : image?.contentUrl || image?.url, page)).filter(Boolean))].slice(0, 12);
  if (!images.length) return reject('no_property_gallery');
  return { accepted: true, media: { provider: page.provider.name, sourceRecordUrl: page.url, observedAt, verification: 'exact_address_match', matchedAddress: expected, images, extraction: 'jsonld_property_image', captureDate: null } };
}

function inspectSecondaryMedia(listing) {
  const reject = reason => ({ accepted: false, reason, url: null, gallery: [], provider: null, sourceRecordUrl: null });
  const media = listing?.provenance?.media?.secondary;
  if (!media || media.verification !== 'exact_address_match' || media.extraction !== 'jsonld_property_image') return reject('missing_exact_address_evidence');
  const page = propertyPage(media.sourceRecordUrl);
  if (!page || media.provider !== page.provider.name || !Number.isFinite(Date.parse(media.observedAt))) return reject('invalid_secondary_evidence');
  if (!sameAddress(listing, media.matchedAddress)) return reject('secondary_address_mismatch');
  if (!Array.isArray(media.images)) return reject('missing_secondary_gallery');
  const gallery = [...new Set(media.images.slice(0, 12).map(url => allowedImage(url, page)).filter(Boolean))];
  if (!gallery.length) return reject('no_safe_secondary_images');
  return { accepted: true, reason: null, url: gallery[0], gallery, provider: page.provider.name, sourceRecordUrl: page.url };
}

module.exports = { exactAddress, sameAddress, propertyPage, extractSecondaryMedia, inspectSecondaryMedia };
