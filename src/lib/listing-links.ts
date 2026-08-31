type ListingLinkFields = {
  sourceUrl?: string | null;
};

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
    if (candidate.protocol !== "https:" && candidate.protocol !== "http:") return null;
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

  const hasRecordPath = candidate.pathname !== "/";
  const hasRecordQuery = Array.from(candidate.searchParams.keys()).length > 0;
  return hasRecordPath || hasRecordQuery ? candidate.toString() : null;
}
