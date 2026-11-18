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

// Mirror of server/state-codes.js US_STATE_OR_TERRITORY_CODES (50 states +
// DC + the 5 territories). The closed set subsumes the USPS regex and the
// XX/US placeholder exclusions, so membership alone is the validity check.
const US_STATE_OR_TERRITORY_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA",
  "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX",
  "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "PR", "VI", "GU", "MP", "AS",
]);

function isUsStateOrTerritoryCode(value: string) {
  return US_STATE_OR_TERRITORY_CODES.has(value.trim().toUpperCase());
}

const EMAIL_NOTICE_HOSTS = [
  "floridapublicnotices.com",
  "publicnoticeillinois.com",
  "texaspublicnotices.com",
  "publicnoticesohio.com",
  "publicnoticepa.com",
  "georgiapublicnotice.com",
  "capublicnotice.com",
  "nypublicnotices.com",
  "njpublicnotices.com",
  "michiganpublicnotices.com",
  "ncpublicnotices.com",
  "publicnoticeads.com",
  "publicnoticecolorado.com",
  "indianapublicnotices.com",
  "publicnotice.org",
];

const SOURCE_ALLOWED_HOSTS: Record<string, string[]> = {
  bid4assets: ["bid4assets.com"],
  "ca-controller-tax-sale": ["sco.ca.gov"],
  civilview: ["salesweb.civilview.com"],
  courtlistener: ["www.courtlistener.com"],
  "email-notices": EMAIL_NOTICE_HOSTS,
  "public-notices-email": EMAIL_NOTICE_HOSTS,
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
      if (path !== "/hpi-state/csv") return false;
      const entries = Array.from(url.searchParams.keys());
      if (entries.length === 0) return true;
      if (entries.length !== 1 || entries[0] !== "geo") return false;
      return isUsStateOrTerritoryCode(url.searchParams.get("geo") ?? "");
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
      return (path === "/propertydetails" || path === "/property/propertydetails") && url.searchParams.has("caseNumber");
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

export type SourceLinkPresentation = {
  exactUrl: string | null;
  primaryUrl: string | null;
  primaryLabel: string;
  sessionGateUrl: string | null;
  sessionGateLabel: string | null;
  rawEvidenceUrl: string | null;
  rawEvidenceLabel: string | null;
  kind: "direct_property" | "session_required" | "batch_directory" | "raw_api_json" | "unavailable";
  hint: string | null;
  referenceId: string | null;
};

type RichListingLinkFields = ListingLinkFields & {
  address?: string | null;
  county?: string | null;
  state?: string | null;
  provenance?: {
    recordId?: string | number | null;
    countySearchUrl?: string | null;
    propertyId?: string | number | null;
    sheriffNumber?: string | null;
    courtCaseNumber?: string | null;
    detailUrlRequiresCountySession?: boolean | null;
    sourceFacts?: {
      disposalUrl?: string | null;
      parcelListUrl?: string | null;
    } | null;
  } | null;
};

function safeHttps(urlString: unknown, allowedHosts?: string[]): string | null {
  if (typeof urlString !== "string" || !urlString.trim()) return null;
  try {
    const parsed = new URL(urlString.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    if (allowedHosts && !allowedHosts.some((host) => hostnameMatches(parsed.hostname, host))) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getSourceLinkPresentation(
  listing: RichListingLinkFields,
  sourceWebsiteUrl?: string | null,
  sourceLabel?: string | null,
): SourceLinkPresentation {
  const exactUrl = getExactSourceListingUrl(listing, sourceWebsiteUrl);
  const sourceKey = listing.source?.trim().toLowerCase() || "";
  const prov = listing.provenance || {};
  const labelName = sourceLabel?.trim() || (sourceKey ? sourceKey.toUpperCase() : "Source");

  if (!exactUrl) {
    return {
      exactUrl: null,
      primaryUrl: null,
      primaryLabel: "Exact source listing unavailable",
      sessionGateUrl: null,
      sessionGateLabel: null,
      rawEvidenceUrl: null,
      rawEvidenceLabel: null,
      kind: "unavailable",
      hint: null,
      referenceId: null,
    };
  }

  if (sourceKey === "civilview") {
    const idCounty = typeof listing.id === "string" ? listing.id.match(/^CIV-[A-Z]{2}-(\d+)-(\d+)/i) : null;
    const urlProp = new URL(exactUrl).searchParams.get("PropertyId");
    const countyId = idCounty?.[1] || null;
    const propertyId = String(prov.propertyId ?? idCounty?.[2] ?? urlProp ?? "");
    const sessionGateUrl = safeHttps(prov.countySearchUrl, ["salesweb.civilview.com"])
      || (countyId ? `https://salesweb.civilview.com/Sales/SalesSearch?countyId=${encodeURIComponent(countyId)}` : "https://salesweb.civilview.com/");
    const sheriffRef = prov.sheriffNumber ? `Sheriff #${prov.sheriffNumber}` : null;
    const caseRef = prov.courtCaseNumber ? `Case ${prov.courtCaseNumber}` : null;
    const propRef = propertyId ? `PropertyId ${propertyId}` : null;
    const refText = [sheriffRef, caseRef, propRef].filter(Boolean).join(" · ") || null;
    return {
      exactUrl,
      primaryUrl: exactUrl,
      primaryLabel: "Step 2: Open Property Detail",
      sessionGateUrl,
      sessionGateLabel: `Step 1: Open ${listing.county ? `${listing.county} ` : ""}County Docket`,
      rawEvidenceUrl: null,
      rawEvidenceLabel: null,
      kind: "session_required",
      hint: `CivilView redirects direct links to its home index until your browser visits the county docket first. Open Step 1, then open Step 2 or search ${refText || "this address"}.`,
      referenceId: refText,
    };
  }

  if (sourceKey === "hud" && exactUrl.includes("egis.hud.gov")) {
    const caseMatch = exactUrl.match(/CASE_NUM(?:%20|\s)*=(?:%20|\s)*(?:'|%27)([0-9-]+)(?:'|%27)/i);
    const caseNumber = String(prov.recordId || caseMatch?.[1] || (typeof listing.id === "string" ? listing.id.replace(/^HUD-/i, "") : "")).trim();
    const consumerUrl = caseNumber
      ? `https://www.hudhomestore.gov/propertydetails?caseNumber=${encodeURIComponent(caseNumber)}`
      : "https://www.hudhomestore.gov/";
    return {
      exactUrl,
      primaryUrl: consumerUrl,
      primaryLabel: caseNumber ? `Open HUD HomeStore (Case #${caseNumber})` : "Open HUD HomeStore",
      sessionGateUrl: null,
      sessionGateLabel: null,
      rawEvidenceUrl: exactUrl,
      rawEvidenceLabel: "Inspect Official HUD eGIS JSON",
      kind: "raw_api_json",
      hint: "HUD HomeStore renders the public buyer page if still active; historical HUD eGIS acquisitions remain inspectable in the raw government record JSON.",
      referenceId: caseNumber ? `Case #${caseNumber}` : null,
    };
  }

  if (sourceKey === "gsa" && exactUrl.includes("/assets-identified-for-accelerated-disposition")) {
    const disposalUrl = safeHttps(prov.sourceFacts?.disposalUrl, ["disposal.gsa.gov", "realestatesales.gov"]);
    if (disposalUrl) {
      return {
        exactUrl,
        primaryUrl: disposalUrl,
        primaryLabel: "Open Official GSA Disposal Property Page",
        sessionGateUrl: null,
        sessionGateLabel: null,
        rawEvidenceUrl: exactUrl,
        rawEvidenceLabel: "Open GSA Disposition Directory",
        kind: "direct_property",
        hint: "Links directly to the individual GSA disposal asset page.",
        referenceId: null,
      };
    }
    return {
      exactUrl,
      primaryUrl: exactUrl,
      primaryLabel: "Open GSA Disposition List (Search Address)",
      sessionGateUrl: null,
      sessionGateLabel: null,
      rawEvidenceUrl: null,
      rawEvidenceLabel: null,
      kind: "batch_directory",
      hint: "GSA publishes early accelerated-disposition notices on a combined directory page without individual asset URLs yet. Search the property title or address on that page.",
      referenceId: listing.address || null,
    };
  }

  if (sourceKey === "ca-controller-tax-sale") {
    const countyListUrl = safeHttps(prov.sourceFacts?.parcelListUrl);
    return {
      exactUrl,
      primaryUrl: countyListUrl || exactUrl,
      primaryLabel: countyListUrl ? `Open ${listing.county || "County"} Tax Sale Schedule` : "Open CA Controller Tax Sales Schedule",
      sessionGateUrl: null,
      sessionGateLabel: null,
      rawEvidenceUrl: countyListUrl ? exactUrl : null,
      rawEvidenceLabel: countyListUrl ? "Open CA Controller Directory" : null,
      kind: "batch_directory",
      hint: "California tax-defaulted sales are published on county/state tax sale schedules. Search by APN or situs address inside the schedule.",
      referenceId: null,
    };
  }

  if (sourceKey === "fl-dor-cadastral" || sourceKey === "hud-usps-vacancy" || sourceKey === "fhfa-hpi") {
    return {
      exactUrl,
      primaryUrl: exactUrl,
      primaryLabel: `Inspect Official ${labelName} Record Data`,
      sessionGateUrl: null,
      sessionGateLabel: null,
      rawEvidenceUrl: null,
      rawEvidenceLabel: null,
      kind: "raw_api_json",
      hint: "Official agency open-data record endpoint (JSON / CSV).",
      referenceId: null,
    };
  }

  if (sourceKey === "sheriff") {
    const urlObj = new URL(exactUrl);
    const aid = urlObj.searchParams.get("aid") || (prov.recordId ? String(prov.recordId) : null);
    const calendarUrl = `${urlObj.origin}/index.cfm?zaction=USER&zmethod=CALENDAR`;
    return {
      exactUrl,
      primaryUrl: exactUrl,
      primaryLabel: aid ? `Open ${listing.county || labelName} Preview (Aid #${aid})` : `Open Exact ${labelName} Preview`,
      sessionGateUrl: calendarUrl,
      sessionGateLabel: `Open ${listing.county || "County"} Auction Calendar`,
      rawEvidenceUrl: null,
      rawEvidenceLabel: null,
      kind: "direct_property",
      hint: "Opens the county RealAuction public sale preview. If the preview is past or requires navigation, use the county auction calendar alongside the Aid/Case number.",
      referenceId: aid ? `Aid #${aid}` : null,
    };
  }

  return {
    exactUrl,
    primaryUrl: exactUrl,
    primaryLabel: `Open Exact ${labelName} Listing`,
    sessionGateUrl: null,
    sessionGateLabel: null,
    rawEvidenceUrl: null,
    rawEvidenceLabel: null,
    kind: "direct_property",
    hint: null,
    referenceId: null,
  };
}
