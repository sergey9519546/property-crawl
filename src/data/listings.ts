import { PropertyListing, SOURCES, SourceInfo } from "@/components/terminal/property-data";

export type Listing = PropertyListing;
export type { SourceInfo };
export { SOURCES };

// The fixture listings in property-data.ts are NOT exported from here. They once
// were, as LISTINGS, and the feed used that array as its initial state - so a
// visitor whose inventory request failed was shown fabricated deals with
// invented addresses, opening bids and valuation bands, and the sitemap
// published every one of those ids as a page that 404s.
//
// Nothing imports LISTINGS any more, so it was dead code that any single
// careless import could have put straight back into the product. Only the types
// and the source labels - which describe publishers, not records - are exported.