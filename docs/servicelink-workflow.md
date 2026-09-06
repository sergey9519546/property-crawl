# ServiceLink Auction collector workflow

The ServiceLink collector reads only the public listing route observed in the reference audit:

```text
GET https://www.servicelinkauction.com/api/listingsvc/v1/Listings?limit=<1..100>
```

It sends only `Accept: application/json`. It does not replay the public client-tag header, authenticate, create an account, use cookies, access bidding/offers/users/admin routes, open WebSockets, or download property images or documents.

`ServiceLinkScraper` is scheduler-compatible with `sourceKey: "servicelink"` and `name: "ServiceLinkScraper"`. Its default run makes one request with `limit=25`; `SERVICELINK_MAX_PAGES` or the constructor can increase the bounded cursor walk to at most five pages, while `SERVICELINK_PAGE_SIZE` is capped at 100. The collector follows only a printable, bounded `continuationToken` by attaching it as a URL-encoded query value to the same fixed host and path. It never dereferences a server-provided URL.

The response must be JSON with a `data` array. Transport failures, non-JSON/schema failures, HTTP failures, and challenge pages pass through the common `fetchTextWithPolicy`/`ScraperCircuitBreaker` safeguards. A valid empty `data` array is reported as `empty`; a failed request is reported as `failed` and is never converted to empty inventory.

Each admitted record requires the publisher's exact `propertyInfo.websiteUrl` or `canonicalUrl` to pass the ServiceLink source policy. Valid record URLs are HTTPS only, on exactly `www.servicelinkauction.com`, and match one `/property-details/<slug>` path without a query or fragment. The collector never constructs a property URL from a listing ID.

The normalized record has `id: servicelink:<listingId>`, public property facts, the publisher’s literal status text, and provenance with `recordKind: "source_record"`, the exact listing ID, `publisher: "ServiceLink Auction"`, exact source URL, and source timestamps. It retains only a compact, whitelisted raw record. It does not infer availability from status or program labels.

`openingBid` remains null unless the record has an explicit numeric per-listing `openingBid` or `tpsOpenBid`. Current bids, estimates, and auction-run-level starting bids are not used as an opening bid. The adapter preserves foreclosure sale date as `saleDate` only when published; auction-run dates stay in source facts. No photos are collected by this adapter.
