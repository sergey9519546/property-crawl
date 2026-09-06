const RECORD_QUERY_KEYS = new Set([
  'aid',
  'auctionid',
  'case',
  'casenumber',
  'docket',
  'id',
  'listingid',
  'p',
  'parcel',
  'property_id',
  'propertyid',
  'saleid',
]);

const SOURCE_HOSTS = Object.freeze({
  bid4assets: ['bid4assets.com'],
  civilview: ['salesweb.civilview.com'],
  fannie: ['homepath.fanniemae.com'],
  freddie: ['homesteps.com'],
  gsa: ['realestatesales.gov'],
  hud: ['hudhomestore.gov'],
  irs: ['irsauctions.gov'],
  landbank: ['landbanksearch.com'],
  marshals: ['usmarshals.gov', 'reallook.com'],
  sheriff: ['sheriffsaleauction.ohio.gov', 'publicnoticesohio.com'],
  servicelink: ['www.servicelinkauction.com'],
  treasury: ['treasury.gov', 'cwsmarketing.com'],
  usda: ['resales.usda.gov'],
  va: ['vrmproperties.com'],
});

function normalizedHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function hostnameMatches(hostname, allowedRoot) {
  const host = normalizedHostname(hostname);
  const root = normalizedHostname(allowedRoot);
  return Boolean(root) && (host === root || host.endsWith(`.${root}`));
}

function hasRecordQuery(url) {
  return [...url.searchParams.keys()].some((key) => RECORD_QUERY_KEYS.has(key.toLowerCase()));
}

function hasStablePathToken(url) {
  const segment = url.pathname.split('/').filter(Boolean).at(-1) || '';
  return /\d{3,}/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment);
}

function hasSourceRecordShape(source, url) {
  const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  switch (source) {
    case 'bid4assets':
      return /^\/auction\/[^/]+$/.test(path) && hasStablePathToken(url);
    case 'civilview':
      return path === '/sales/saledetails' && url.searchParams.has('PropertyId');
    case 'fannie':
      return /^\/(property|property-details)\/[^/]+$/.test(path) && hasStablePathToken(url);
    case 'freddie':
    case 'va':
      return /^\/property\/[^/]+$/.test(path) && hasStablePathToken(url);
    case 'gsa':
      return path === '/asset-details' && url.searchParams.has('property_id');
    case 'hud':
      return path === '/property/propertydetails' && url.searchParams.has('caseNumber');
    case 'irs':
      return /^\/(ad|auction)\/[^/]+$/.test(path) && (hasStablePathToken(url) || path.split('/').at(-1).split('-').length >= 3);
    case 'landbank':
      return /^\/p\/[^/]+$/.test(path) && hasStablePathToken(url);
    case 'marshals':
      return (/^\/usms-inventory\/[^/]+$/.test(path) && hasStablePathToken(url))
        || (/^\/what-we-do\/asset-forfeiture\/real-property\/.+/.test(path) && hasStablePathToken(url));
    case 'sheriff':
      return path !== '/' && path !== '/search' && (hasRecordQuery(url) || hasStablePathToken(url));
    case 'servicelink':
      return /^\/property-details\/[a-z0-9][a-z0-9-]{7,}$/i.test(path)
        && !url.search
        && !url.hash;
    case 'treasury': {
      const last = path.split('/').at(-1) || '';
      return (hasRecordQuery(url) || (/\.s?html?$/.test(last) && last !== 'realprop.shtml'));
    }
    case 'usda':
      return path.endsWith('/sfhpropertydetail') && url.searchParams.has('id');
    default:
      return false;
  }
}

function inspectSourceRecordUrl(sourceValue, sourceUrl) {
  const source = String(sourceValue || '').trim().toLowerCase();
  const allowedHosts = SOURCE_HOSTS[source];
  if (!allowedHosts) return { isValid: false, error: 'unsupported_source_policy' };

  let url;
  try {
    url = new URL(String(sourceUrl || ''));
  } catch (_) {
    return { isValid: false, error: 'invalid_source_url' };
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return { isValid: false, error: 'unsafe_source_url' };
  }
  // ServiceLink listing records are public property-detail pages on the one
  // observed production host. Do not accept tenant, API, media, or lookalike
  // subdomains merely because they share a registrable domain.
  if (source === 'servicelink' && url.hostname.toLowerCase() !== 'www.servicelinkauction.com') {
    return { isValid: false, error: 'source_host_mismatch' };
  }
  if (!allowedHosts.some((host) => hostnameMatches(url.hostname, host))) {
    return { isValid: false, error: 'source_host_mismatch' };
  }
  if (!hasSourceRecordShape(source, url)) {
    return { isValid: false, error: 'source_url_not_exact_record' };
  }

  url.hash = '';
  return { isValid: true, error: null, url: url.toString() };
}

module.exports = {
  SOURCE_HOSTS,
  hasSourceRecordShape,
  hostnameMatches,
  inspectSourceRecordUrl,
};
