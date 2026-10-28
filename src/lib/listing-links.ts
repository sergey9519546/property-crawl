type ListingLinkFields = {
  id?: string | null;
  provenance?: { recordId?: string | number | null } | null;
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
  "/closedrealestate",
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
  "ca-controller-tax-sale": ["sco.ca.gov"],
  civilview: ["salesweb.civilview.com"],
  courtlistener: ["www.courtlistener.com"],
  "email-notices": [
    "floridapublicnotices.com",
    "publicnoticeillinois.com",
    "texaspublicnotices.com",
    "publicnoticesohio.com",
    "publicnoticepa.com",
    "georgiapublicnotice.com",
    "publicnotice.org",
  ],
  "public-notices-email": [
    "floridapublicnotices.com",
    "publicnoticeillinois.com",
    "texaspublicnotices.com",
    "publicnoticesohio.com",
    "publicnoticepa.com",
    "georgiapublicnotice.com",
    "publicnotice.org",
  ],
  fannie: ["homepath.fanniemae.com"],
  "fhfa-hpi": ["www.fhfa.gov"],
  "fl-dor-cadastral": ["services9.arcgis.com"],
  freddie: ["homesteps.com"],
  gsa: ["realestatesales.gov", "www.gsa.gov"],
  hud: ["hudhomestore.gov", "egis.hud.gov"],
  "hud-usps-vacancy": ["hudgis-hud.opendata.arcgis.com", "services.arcgis.com", "www.huduser.gov"],
  irs: ["irsauctions.gov"],
  landbank: ["landbanksearch.com"],
  marshals: ["usmarshals.gov", "reallook.com"],
  servicelink: ["www.servicelinkauction.com"],
  sheriff: ["sheriffsaleauction.ohio.gov", "realforeclose.com", "publicnoticesohio.com"],
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
  return Boolean(root) && (host === root || host.endsWith(`.${root}`));
}

function hasRecordQuery(url: URL) {
  return Array.from(url.searchParams.keys()).some((key) =>
    RECORD_QUERY_KEYS.has(key.toLowerCase()),
  );
}

function hasStablePathToken(url: URL) {
  const segment = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  return /\d{3,}/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment);
}

function hasRecordIdentity(url: URL) {
  if (hasRecordQuery(url)) return true;

  const segments = url.pathname.split("/").filter(Boolean);
  const lastSegment = segments.at(-1)?.toLowerCase() ?? "";
  const recordPath = segments.some((segment) =>
    /^(ad|auction|asset|detail|details|listing|parcel|property|sale)/i.test(segment),
  );
  const uniqueSlug = /\d{3,}/.test(lastSegment) || lastSegment.split("-").length >= 4;
  return recordPath && uniqueSlug;
}

function hasSourceRecordShape(source: string, url: URL): boolean {
  const path = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  switch (source) {
    case "bid4assets":
      return /^\/auction\/[^/]+$/.test(path) && hasStablePathToken(url);
    case "ca-controller-tax-sale": {
      const last = path.split("/").filter(Boolean).at(-1) ?? "";
      if (!last) return false;
      if (/^boe_tax_sales\.html?$/i.test(last)) return true;
      if (/^(?:boe|ard|sl)_[a-z0-9_-]*tax[a-z0-9_-]*\.(?:html?|pdf)$/i.test(last)) return true;
      return false;
    }
    case "civilview":
      return path === "/sales/saledetails" && url.searchParams.has("PropertyId");
    case "courtlistener":
      return /^\/docket\/\d{3,}(?:\/[^/]+)?\/?$/.test(path);
    case "fannie":
      return /^\/(property|property-details)\/[^/]+$/.test(path) && hasStablePathToken(url);
    case "fhfa-hpi": {
      const csvPath = /^\/datatools\/downloads\/documents\/hpi\/hpi_at_(?:state|metro|division|national)\.csv$/i;
      if (!csvPath.test(path)) return false;
      const allowed = new Set(["geo", "period"]);
      const entries = Array.from(url.searchParams.keys());
      const geo = (url.searchParams.get("geo") ?? "").toUpperCase();
      return (
        entries.every((key) => allowed.has(key)) &&
        new Set(entries).size === entries.length &&
        (entries.length === 0 ||
          (entries.length === 2 && entries.includes("geo") && entries.includes("period"))) &&
        /^(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)$/.test(
          geo,
        ) &&
        /^\d{4}Q[1-4]$/.test(url.searchParams.get("period") ?? "")
      );
    }
    case "fl-dor-cadastral": {
      const featureMatch = path.match(
        /^(?:\/[^/]+)?\/arcgis\/rest\/services\/florida_statewide_cadastral\/featureserver\/0\/(\d+)$/,
      );
      if (featureMatch && !url.search) return true;
      const queryPath =
        /^(?:\/[^/]+)?\/arcgis\/rest\/services\/florida_statewide_cadastral\/featureserver\/0\/query$/;
      if (!queryPath.test(path)) return false;
      const allowed = new Set([
        "where",
        "outFields",
        "f",
        "returnGeometry",
        "outSR",
        "resultRecordCount",
        "resultOffset",
      ]);
      const entries = Array.from(url.searchParams.keys());
      const where = (url.searchParams.get("where") ?? "").replace(/\s+/g, "");
      return (
        entries.every((key) => allowed.has(key)) &&
        new Set(entries).size === entries.length &&
        ["json", "pjson"].includes(url.searchParams.get("f") ?? "") &&
        /OBJECTID=\d+/.test(where) &&
        !/OR|UNION|1=1/i.test(where)
      );
    }
    case "freddie":
    case "va":
      return /^\/property\/[^/]+$/.test(path) && hasStablePathToken(url);
    case "gsa": {
      const host = url.hostname.toLowerCase();
      if (host === "www.gsa.gov") {
        return (
          path === "/real-estate/real-property-disposition/assets-identified-for-accelerated-disposition" &&
          !url.search
        );
      }
      return (
        (host === "realestatesales.gov" || host === "www.realestatesales.gov") &&
        path === "/asset-details" &&
        url.searchParams.has("property_id")
      );
    }
    case "hud":
      return path === "/property/propertydetails" && url.searchParams.has("caseNumber");
    case "hud-usps-vacancy": {
      const featureMatch = path.match(/^(?:\/[^/]+){0,8}\/featureserver\/0\/(\d+)$/);
      if (featureMatch && !url.search) return true;
      const queryPath = /^(?:\/[^/]+){0,8}\/featureserver\/0\/query$/;
      if (!queryPath.test(path)) return false;
      const allowed = new Set([
        "where",
        "outFields",
        "f",
        "returnGeometry",
        "outSR",
        "resultRecordCount",
        "resultOffset",
      ]);
      const entries = Array.from(url.searchParams.keys());
      const where = (url.searchParams.get("where") ?? "").replace(/\s+/g, "");
      const outFields = url.searchParams.get("outFields") ?? "*";
      const resultRecordCount = url.searchParams.get("resultRecordCount");
      const resultOffset = url.searchParams.get("resultOffset");
      return (
        entries.every((key) => allowed.has(key)) &&
        new Set(entries).size === entries.length &&
        ["json", "pjson"].includes(url.searchParams.get("f") ?? "") &&
        (outFields === "*" ||
          outFields.split(",").every((f) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(f))) &&
        /OBJECTID=\d+/.test(where) &&
        !/OR|UNION|1\s*=\s*1/i.test(where) &&
        (!resultRecordCount || Number.parseInt(resultRecordCount, 10) === 1) &&
        (!resultOffset || /^\d+$/.test(resultOffset))
      );
    }
    case "irs":
      return (
        /^\/(ad|auction)\/[^/]+$/.test(path) &&
        (hasStablePathToken(url) || (path.split("/").at(-1)?.split("-").length ?? 0) >= 3)
      );
    case "landbank":
      return /^\/p\/[^/]+$/.test(path) && hasStablePathToken(url);
    case "marshals":
      return (
        (/^\/usms-inventory\/[^/]+$/.test(path) && hasStablePathToken(url)) ||
        (/^\/what-we-do\/asset-forfeiture\/real-property\/.+/.test(path) && hasStablePathToken(url))
      );
    case "sheriff":
      return path !== "/" && path !== "/search" && (hasRecordQuery(url) || hasStablePathToken(url));
    case "servicelink":
      return (
        /^\/property-details\/[a-z0-9][a-z0-9-]{7,}$/i.test(path) &&
        !url.search &&
        !url.hash
      );
    case "treasury": {
      const last = path.split("/").at(-1) ?? "";
      return hasRecordQuery(url) || (/\.s?html?$/.test(last) && last !== "realprop.shtml");
    }
    case "usda":
      return path.endsWith("/sfhpropertydetail") && url.searchParams.has("id");
    case "email-notices":
    case "public-notices-email":
      return path !== "/" && path !== "/search";
    default:
      return hasRecordIdentity(url);
  }
}

function exactHudEgisCase(listing: ListingLinkFields, url: URL) {
  if (url.hostname.toLowerCase() !== "egis.hud.gov") return null;
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  if (path !== "/arcgis/rest/services/cpdmaps/hudsfreo/mapserver/1/query") return null;
  const allowedKeys = new Set(["where", "outfields", "f", "returngeometry", "outsr"]);
  const entries = Array.from(url.searchParams.keys());
  if (!entries.every((key) => allowedKeys.has(key.toLowerCase())) || new Set(entries.map((key) => key.toLowerCase())).size !== entries.length) return null;
  const match = /^CASE_NUM\s*=\s*'([0-9]{3}-[0-9]{6})'$/.exec(url.searchParams.get("where") ?? "");
  if (!match || !["json", "pjson"].includes(url.searchParams.get("f") ?? "")) return null;
  if ((url.searchParams.get("outFields") ?? "*") !== "*") return null;
  if (url.searchParams.has("returnGeometry") && !["true", "false"].includes(url.searchParams.get("returnGeometry") ?? "")) return null;
  if (url.searchParams.has("outSR") && url.searchParams.get("outSR") !== "4326") return null;
  const expected = listing.provenance?.recordId == null
    ? listing.id?.replace(/^HUD-/i, "")
    : String(listing.provenance.recordId);
  return expected && match[1] === expected ? url.toString() : null;
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
  if (sourceKey === "servicelink") {
    if (candidate.hostname.toLowerCase() !== "www.servicelinkauction.com") return null;
  } else if (sourceKey === "gsa") {
    const host = candidate.hostname.toLowerCase();
    const allowed =
      host === "realestatesales.gov" ||
      host === "www.realestatesales.gov" ||
      host === "www.gsa.gov";
    if (!allowed) return null;
  } else if (allowedHosts && !allowedHosts.some((host) => hostnameMatches(candidate.hostname, host))) {
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
  if (sourceKey === "hud" && candidate.hostname.toLowerCase() === "egis.hud.gov") {
    return exactHudEgisCase(listing, candidate);
  }

  if (sourceKey && allowedHosts) {
    return hasSourceRecordShape(sourceKey, candidate) ? candidate.toString() : null;
  }

  return hasRecordIdentity(candidate) ? candidate.toString() : null;
}
