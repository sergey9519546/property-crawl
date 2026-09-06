type ListingLinkFields = {
  source?: string | null;
  sourceUrl?: string | null;
};

const GENERIC_QUERY_KEYS = new Set([
  "county",
  "countyid",
  "filter",
  "limit",
  "page",
  "pagesize",
  "q",
  "query",
  "search",
  "sort",
  "state",
]);

const GENERIC_PATHS = new Set([
  "/asset-sales/real-estate-and-property-sales",
  "/auctions",
  "/listings",
  "/properties",
  "/property-search",
  "/sales/salessearch",
  "/search",
]);

const RECORD_QUERY_KEYS = new Set([
  "aid",
  "auctionid",
  "case",
  "casenumber",
  "docket",
  "id",
  "listingid",
  "p",
  "parcel",
  "property_id",
  "propertyid",
  "saleid",
]);

const SOURCE_ALLOWED_HOSTS: Record<string, string[]> = {
  bid4assets: ["bid4assets.com"],
  civilview: ["salesweb.civilview.com"],
  fannie: ["homepath.fanniemae.com"],
  freddie: ["homesteps.com"],
  gsa: ["realestatesales.gov"],
  hud: ["hudhomestore.gov"],
  irs: ["irsauctions.gov"],
  landbank: ["landbanksearch.com"],
  marshals: ["usmarshals.gov", "reallook.com"],
  servicelink: ["servicelinkauction.com"],
  sheriff: ["sheriffsaleauction.ohio.gov", "publicnoticesohio.com"],
  treasury: ["treasury.gov", "cwsmarketing.com"],
  usda: ["resales.usda.gov"],
  va: ["vrmproperties.com"],
};

function normalizeHostname(value: string) {
  return value.toLowerCase().replace(/^www\./, "");
}

function hostnameMatches(hostname: string, allowedRoot: string) {
  const host = normalizeHostname(hostname);
  const root = normalizeHostname(allowedRoot);
  return host === root || host.endsWith(`.${root}`);
}

function hasRecordIdentity(url: URL) {
  const queryKeys = Array.from(url.searchParams.keys(), (key) => key.toLowerCase());
  if (queryKeys.some((key) => RECORD_QUERY_KEYS.has(key))) return true;

  const segments = url.pathname.split("/").filter(Boolean);
  const lastSegment = segments.at(-1)?.toLowerCase() ?? "";
  const recordPath = segments.some((segment) =>
    /^(ad|auction|asset|detail|details|listing|parcel|property|sale)/i.test(segment),
  );
  const uniqueSlug = /\d{3,}/.test(lastSegment) || lastSegment.split("-").length >= 4;
  return recordPath && uniqueSlug;
}

function normalizedUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url;
}

/**
 * Returns a source-record URL only when it is more specific than the
 * source's general website. This prevents a listing CTA from pretending a
 * portal homepage is the record behind the deal.
 */
export function getExactSourceListingUrl(
  listing: ListingLinkFields,
  sourceWebsiteUrl?: string | null,
) {
  if (!listing.sourceUrl) return null;

  let candidate: URL;
  try {
    candidate = normalizedUrl(listing.sourceUrl);
    if (candidate.protocol !== "https:" || candidate.username || candidate.password || candidate.port) return null;
  } catch {
    return null;
  }

  if (sourceWebsiteUrl) {
    try {
      const homepage = normalizedUrl(sourceWebsiteUrl);
      if (candidate.toString() === homepage.toString()) return null;
    } catch {
      // An unknown source can lack a valid portal URL; the candidate can
      // still be an exact record URL in its own right.
    }
  }

  const sourceKey = listing.source?.trim().toLowerCase();
  const allowedHosts = sourceKey ? SOURCE_ALLOWED_HOSTS[sourceKey] : undefined;
  if (allowedHosts && !allowedHosts.some((host) => hostnameMatches(candidate.hostname, host))) {
    return null;
  }
  if (!allowedHosts && sourceWebsiteUrl) {
    try {
      const portal = normalizedUrl(sourceWebsiteUrl);
      if (!hostnameMatches(candidate.hostname, portal.hostname)) return null;
    } catch {
      return null;
    }
  }

  const path = candidate.pathname.toLowerCase();
  const queryKeys = Array.from(candidate.searchParams.keys(), (key) => key.toLowerCase());

  // Known collection/search routes are never exact listing evidence, even if
  // they contain a county or pagination query. This explicitly rejects the
  // CivilView county results and FDIC asset-sales landing pages that used to
  // be presented as exact records.
  if (GENERIC_PATHS.has(path)) return null;
  if (queryKeys.length > 0 && queryKeys.every((key) => GENERIC_QUERY_KEYS.has(key))) return null;

  // Real listing CTAs must carry a stable record identity in either the path
  // or query string. A merely non-root URL is not enough.
  return hasRecordIdentity(candidate) ? candidate.toString() : null;
}
