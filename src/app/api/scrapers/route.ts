// =============================================================
// Next.js route: /api/scrapers
// =============================================================
//
// Status endpoint for the data ingestion pipeline. This route is
// intentionally a UI-friendly read-only summary; it does NOT trigger
// scrapers. The real ingestion pipeline lives in `server/scrapers/`
// (a separate Node.js process started by `npm run scrape` or
// `server/scrapers/scheduler.js`) and writes to the production
// PostgreSQL+PostGIS database described in `server/db/schema.sql`.
//
// To wire this Next.js route to the real scheduler, the Next.js
// process would need to either:
//   (a) run as a sidecar in the same container as `server/server.js`
//       and call its scheduler in-process, or
//   (b) make an HTTP call to the server (requires CORS + auth).
//
// Until either is wired, this route returns a HONEST snapshot of
// what the marketing site knows: the curated demo listings from
// `src/components/terminal/property-data.ts` (6 listings), with a
// clear note that production data is served by `server/server.js`.
//
// Source of truth: `data.js` (20 listings) — loaded by
// `server/db/client.js` via VM sandbox.

import { NextResponse } from "next/server";
import { LISTINGS, SOURCES } from "@/data/listings";

export async function GET() {
  // Count listings per source from the in-memory demo dataset.
  // This is a marketing-site snapshot, not the production count.
  const bySource: Record<string, number> = {};
  for (const l of LISTINGS) {
    bySource[l.source] = (bySource[l.source] || 0) + 1;
  }
  const feeds = Object.keys(SOURCES).map((key) => ({
    name: SOURCES[key].label,
    key,
    status: "demo" as const,
    listingsFound: bySource[key] || 0,
    note: "Production counts live in server/db (PostgreSQL). This route shows the marketing demo subset."
  }));

  return NextResponse.json({
    status: "demo",
    scheduler: "not-running",
    note: "This route is a UI snapshot of the marketing demo dataset. The real scheduler runs from server/scrapers/scheduler.js and writes to the production PostgreSQL database.",
    productionDataSource: "data.js (20 listings) loaded by server/db/client.js",
    marketingDemoSource: "src/components/terminal/property-data.ts (" + LISTINGS.length + " listings)",
    lastRun: null,
    feeds,
    totalIndexed: LISTINGS.length
  });
}

export async function POST() {
  return NextResponse.json({
    success: false,
    error: "POST not supported in this Next.js route. The real scraper trigger is `npm run scrape` (or `node server/scrapers/scheduler.js`). See server/scrapers/ for the actual implementation."
  }, { status: 405 });
}
