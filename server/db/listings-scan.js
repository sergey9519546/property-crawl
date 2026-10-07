// server/db/listings-scan.js
//
// The one way to read the whole listing store.
//
// Every analytics surface needs the whole pool, because what it publishes is a
// statistic over that pool: a median opening bid, a per-source tally, a
// weekly bucket count. Reading a fixed-size slice and publishing the statistic
// does not produce a smaller number -- it produces a number about a different
// thing, wearing the same label.
//
// Five call sites had each invented their own cap:
//
//   auction-calendar  limit: 1000   reported 28 of 3,417 upcoming auctions
//   neighborhoods     limit: 1000   no disclosure of any kind
//   saved-searches    limit: 1000   published "scanned: 1000" as coverage
//   watchlist-comps   limit: 1000   comps drawn from an arbitrary slice
//   source-network    limit: 10000  correct at 9,831 rows, silent at 10,001
//
// A cap that is correct today and wrong tomorrow is the worst kind: it needs
// no test to fail and produces no error when it does.
//
// So: read to the end, and report what was read.
//
//   scanned          rows actually read
//   availableTotal   the size the backend claims, or null if it claims none
//   truncated        scanned < availableTotal, or maxRows was hit
//
// `truncated` is the field that makes this safe. A caller that cannot read
// everything says so, and a caller that read everything is distinguishable
// from a caller that read a thousand rows and hoped.
//
// Offset paging is only safe over a total order. Every Postgres sort in
// db/client.js ends in `id ASC`, and the in-memory sorts tie-break on id for
// the same reason, so `sort` defaults to 'date' and must be one of those. A
// caller may choose another, but choosing one that is not total reintroduces
// silent row loss across page boundaries.

'use strict';

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_ROWS = 200_000;

async function scanAllListings(database, filters = {}, options = {}) {
  const pageSize = Number.isFinite(options.pageSize) && options.pageSize > 0
    ? Math.floor(options.pageSize)
    : DEFAULT_PAGE_SIZE;
  const maxRows = Number.isFinite(options.maxRows) && options.maxRows > 0
    ? Math.floor(options.maxRows)
    : DEFAULT_MAX_ROWS;
  const sort = options.sort || 'date';

  const rows = [];
  let offset = 0;
  let availableTotal = null;

  for (;;) {
    const page = await database.getListings({ ...filters, limit: pageSize, offset, sort });
    const batch = Array.isArray(page?.listings) ? page.listings : [];
    const reported = Number(page?.total);
    if (Number.isFinite(reported)) availableTotal = reported;

    rows.push(...batch);
    offset += batch.length;

    if (batch.length === 0) break;                          // end of stream
    if (batch.length < pageSize) break;                     // short page
    if (availableTotal !== null && rows.length >= availableTotal) break;
    if (rows.length >= maxRows) break;                      // disclosed below
  }

  const scanned = rows.length;
  return {
    pool: rows,
    scanned,
    availableTotal,
    truncated: availableTotal === null ? false : scanned < availableTotal
  };
}

module.exports = { scanAllListings, DEFAULT_PAGE_SIZE, DEFAULT_MAX_ROWS };