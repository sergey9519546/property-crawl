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
  'ca-controller-tax-sale': ['sco.ca.gov'],
  civilview: ['salesweb.civilview.com'],
  courtlistener: ['www.courtlistener.com'],
  fannie: ['homepath.fanniemae.com'],
  'fl-dor-cadastral': ['services9.arcgis.com'],
  freddie: ['homesteps.com'],
  gsa: ['realestatesales.gov'],
  hud: ['hudhomestore.gov', 'egis.hud.gov'],
  'hud-usps-vacancy': ['hudgis-hud.opendata.arcgis.com', 'services.arcgis.com', 'www.huduser.gov'],
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
    case 'ca-controller-tax-sale': {
      // Controller tax-defaulted sales directory and SCO-hosted tax-sale
      // schedule/parcel-list pages. County pages on non-SCO domains stay in
      // provenance only and are never used as listing sourceUrl values.
      const last = path.split('/').filter(Boolean).at(-1) || '';
      if (!last) return false;
      if (/^boe_tax_sales\.html?$/i.test(last)) return true;
      if (/^(?:boe|ard|sl)_[a-z0-9_-]*tax[a-z0-9_-]*\.(?:html?|pdf)$/i.test(last)) return true;
      return false;
    }
    case 'civilview':
      return path === '/sales/saledetails' && url.searchParams.has('PropertyId');
    case 'courtlistener':
      // Exact docket URL: /docket/{numeric_id}/ or /docket/{numeric_id}/{slug}/
      return /^\/docket\/\d{3,}(?:\/[^/]+)?\/?$/.test(path);
    case 'fannie':
      return /^\/(property|property-details)\/[^/]+$/.test(path) && hasStablePathToken(url);
    case 'fl-dor-cadastral': {
      // Exact FDOR statewide-cadastral feature URL, never the service root or
      // an unbounded whole-inventory query. ArcGIS Online paths include an
      // org-id segment before /arcgis/rest/.
      const featureMatch = path.match(
        /^(?:\/[^/]+)?\/arcgis\/rest\/services\/florida_statewide_cadastral\/featureserver\/0\/(\d+)$/
      );
      if (featureMatch && !url.search) return true;
      const queryPath = /^(?:\/[^/]+)?\/arcgis\/rest\/services\/florida_statewide_cadastral\/featureserver\/0\/query$/;
      if (!queryPath.test(path)) return false;
      const allowed = new Set(['where', 'outFields', 'f', 'returnGeometry', 'outSR', 'resultRecordCount', 'resultOffset']);
      const entries = [...url.searchParams.keys()];
      const where = (url.searchParams.get('where') || '').replace(/\s+/g, '');
      return entries.every((key) => allowed.has(key))
        && new Set(entries).size === entries.length
        && ['json', 'pjson'].includes(url.searchParams.get('f') || '')
        && /OBJECTID=\d+/.test(where)
        && !/OR|UNION|1=1/i.test(where);
    }
    case 'freddie':
    case 'va':
      return /^\/property\/[^/]+$/.test(path) && hasStablePathToken(url);
    case 'gsa':
      return path === '/asset-details' && url.searchParams.has('property_id');
    case 'hud':
      if (url.hostname.toLowerCase() === 'egis.hud.gov') {
        const allowed = new Set(['where', 'outFields', 'f', 'returnGeometry', 'outSR']);
        const entries = [...url.searchParams.keys()];
        return path === '/arcgis/rest/services/cpdmaps/hudsfreo/mapserver/1/query'
          && /^CASE_NUM\s*=\s*'[0-9]{3}-[0-9]{6}'$/.test(url.searchParams.get('where') || '')
          && entries.every((key) => allowed.has(key)) && new Set(entries).size === entries.length
          && ['json', 'pjson'].includes(url.searchParams.get('f') || '')
          && (url.searchParams.get('outFields') || '*') === '*'
          && (!url.searchParams.has('returnGeometry') || ['true', 'false'].includes(url.searchParams.get('returnGeometry')))
          && (!url.searchParams.has('outSR') || url.searchParams.get('outSR') === '4326');
      }
      return path === '/property/propertydetails' && url.searchParams.has('caseNumber');
    case 'hud-usps-vacancy': {
      // HUD GIS Open Data ArcGIS FeatureServer record URLs, never the
      // service root or an unbounded whole-inventory query. Two accepted
      // shapes mirror the publisher's public surface:
      //   1) exact feature URL: .../FeatureServer/0/{objectid}
      //   2) bounded query URL: .../FeatureServer/0/query with a fixed
      //      resultOffset pointing at a single OBJECTID (where=OBJECTID=N).
      const featureMatch = path.match(/^(?:\/[^/]+){0,8}\/featureserver\/0\/(\d+)$/);
      if (featureMatch && !url.search) return true;
      const queryPath = /^(?:\/[^/]+){0,8}\/featureserver\/0\/query$/;
      if (!queryPath.test(path)) return false;
      const allowed = new Set([
        'where', 'outFields', 'f', 'returnGeometry', 'outSR',
        'resultRecordCount', 'resultOffset'
      ]);
      const entries = [...url.searchParams.keys()];
      const where = (url.searchParams.get('where') || '').replace(/\s+/g, '');
      const outFields = (url.searchParams.get('outFields') || '*');
      const resultRecordCount = url.searchParams.get('resultRecordCount');
      const resultOffset = url.searchParams.get('resultOffset');
      return entries.every((key) => allowed.has(key))
        && new Set(entries).size === entries.length
        && ['json', 'pjson'].includes(url.searchParams.get('f') || '')
        && (outFields === '*' || outFields.split(',').every((f) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(f)))
        && /OBJECTID=\d+/.test(where)
        && !/OR|UNION|1\s*=\s*1/i.test(where)
        && (!resultRecordCount || Number.parseInt(resultRecordCount, 10) === 1)
        && (!resultOffset || /^\d+$/.test(resultOffset));
    }
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
