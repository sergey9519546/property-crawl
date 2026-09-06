'use strict';

const { inspectSourceRecordUrl, hostnameMatches } = require('./source-policy');

const STOCK_HOSTS = ['unsplash.com', 'pexels.com', 'pixabay.com', 'picsum.photos', 'placehold.co', 'placeholder.com'];
const CONTEXT_HOSTS = ['arcgisonline.com', 'arcgis.com', 'googleapis.com', 'google.com', 'openstreetmap.org'];
const DOCUMENT_EXTENSION = /\.(?:pdf|docx?|xlsx?|pptx?|txt|html?|svg|ico|zip)(?:$|[?#])/i;
const PLACEHOLDER = /(?:no[ _-]?(?:image|photo)|image[ _-]?not[ _-]?available|placeholder|default[ _-]?(?:photo|image)|spacer|transparent|tracking|pixel|logo|icon|banner|type_land|watermark)/i;

function inspectImageUrl(value, baseUrl) {
  const reject = (reason) => ({ accepted: false, reason, url: null });
  if (typeof value !== 'string' || !value.trim()) return reject('missing_image');
  if (value.length > 2048) return reject('image_url_too_long');
  let url;
  try { url = baseUrl ? new URL(value, baseUrl) : new URL(value); } catch (_) { return reject('invalid_image_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return reject('unsafe_image_url');
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || /^[\d.]+$/.test(host) || host.startsWith('[')) return reject('non_public_image_host');
  if (STOCK_HOSTS.some((root) => hostnameMatches(host, root))) return reject('stock_image');
  if (CONTEXT_HOSTS.some((root) => hostnameMatches(host, root))) return reject('map_context_not_property_photo');
  let path;
  try { path = decodeURIComponent(url.pathname); } catch (_) { return reject('invalid_image_url'); }
  if (DOCUMENT_EXTENSION.test(path)) return reject('document_not_image');
  if (PLACEHOLDER.test(path)) return reject('placeholder_or_site_art');
  url.hash = '';
  return { accepted: true, reason: null, url: url.toString() };
}

function inspectPublisherPhoto(listing) {
  const inspected = inspectImageUrl(listing?.photo);
  if (!inspected.accepted) return inspected;
  const source = inspectSourceRecordUrl(listing.source, listing.sourceUrl);
  const evidence = listing?.provenance?.media?.photo;
  if (!source.isValid || !evidence || evidence.origin !== 'publisher_record' || evidence.verification !== 'source_extracted') {
    return { accepted: false, reason: 'missing_record_image_evidence', url: null };
  }
  const imageSource = inspectSourceRecordUrl(listing.source, evidence.sourceRecordUrl);
  if (!imageSource.isValid || source.url !== imageSource.url) {
    return { accepted: false, reason: 'image_record_mismatch', url: null };
  }
  if (evidence.url && inspectImageUrl(evidence.url).url !== inspected.url) {
    return { accepted: false, reason: 'image_url_evidence_mismatch', url: null };
  }
  return inspected;
}

function decodeAttribute(value) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

function attributes(tag) {
  const result = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) result[match[1].toLowerCase()] = decodeAttribute(match[2] ?? match[3] ?? match[4]);
  return result;
}

// These selectors are based on inspected publisher detail pages. Never scan
// an index page or arbitrary search results for an image that looks plausible.
function extractDetailImages({ source, html, sourceUrl, address }) {
  if (!inspectSourceRecordUrl(source, sourceUrl).isValid || typeof html !== 'string') return [];
  let section = html;
  if (source === 'irs') {
    const start = html.search(/class=["'][^"']*field--name-field-asset-photos/i);
    if (start < 0) return [];
    section = html.slice(start);
    const end = section.search(/class=["'][^"']*field--name-field-(?:asset-description|asset-address)/i);
    if (end >= 0) section = section.slice(0, end);
  }
  const normalize = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const expectedAddress = normalize(address);
  const selected = [];
  for (const match of section.matchAll(/<img\b[^>]*>/gi)) {
    const attr = attributes(match[0]);
    let selector;
    if (source === 'treasury') {
      if (!expectedAddress || normalize(attr.alt) !== expectedAddress) continue;
      selector = 'img[alt=full-property-address]';
    } else if (source === 'irs') {
      selector = '.field--name-field-asset-photos img';
    } else if (source === 'gsa') {
      if (!String(attr.class || '').split(/\s+/).includes('slide-img')) continue;
      selector = 'img.slide-img';
    } else continue;
    if ((attr.width && Number(attr.width) < 120) || (attr.height && Number(attr.height) < 80)) continue;
    const candidate = inspectImageUrl(attr['data-src'] || attr.src, sourceUrl);
    if (!candidate.accepted || selected.some((item) => item.url === candidate.url)) continue;
    const host = new URL(candidate.url).hostname;
    const pageHost = new URL(sourceUrl).hostname;
    if (!hostnameMatches(host, pageHost.replace(/^www\./, '')) && !(source === 'gsa' && hostnameMatches(host, 'cloudfront.net'))) continue;
    selected.push({ url: candidate.url, sourceRecordUrl: new URL(sourceUrl).toString(), selector, alt: attr.alt || null });
    if (selected.length === 12) break;
  }
  return selected;
}

module.exports = { inspectImageUrl, inspectPublisherPhoto, extractDetailImages };
