import sourcePolicy from "../../server/scrapers/source-policy.js";

const {
  GENERIC_PATHS,
  GENERIC_QUERY_KEYS,
  SOURCE_HOSTS: SOURCE_ALLOWED_HOSTS,
  hasRecordIdentity,
  hasSourceRecordShape,
  hostnameMatches,
} = sourcePolicy as {
  GENERIC_PATHS: Set<string>;
  GENERIC_QUERY_KEYS: Set<string>;
  SOURCE_HOSTS: Record<string, string[]>;
  hasRecordIdentity: (url: URL) => boolean;
  hasSourceRecordShape: (source: string, url: URL) => boolean;
  hostnameMatches: (hostname: string, allowedRoot: string) => boolean;
};

type ListingLinkFields = {
  id?: string | null;
  provenance?: { recordId?: string | number | null } | null;
  source?: string | null;
  sourceUrl?: string | null;
};

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
