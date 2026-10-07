"use strict";
const { hash } = require("./store");
const MAX_SCAN = 10000,
  MAX_LIMIT = 1000;
class DiscoveryQueryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const text = (v) =>
  String(v ?? "")
    .trim()
    .toLowerCase();
function cursorEncode(v) {
  return Buffer.from(JSON.stringify(v)).toString("base64url");
}
function cursorDecode(v) {
  try {
    return JSON.parse(Buffer.from(v, "base64url").toString("utf8"));
  } catch {
    throw new DiscoveryQueryError(400, "Invalid cursor");
  }
}
function revisionOf(rows) {
  return hash(
    rows
      .map((x) => [x.id, x.sourceObservedAt || x.fetchedAt || null])
      .sort((a, b) => a[0].localeCompare(b[0])),
  ).slice(0, 24);
}
function parseBool(v, name) {
  if (v == null || v === "") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new DiscoveryQueryError(400, `${name} must be true or false`);
}
// Tri-state for document evidence: true / false / "unknown" (record has no
// document-evidence conclusion). "unknown" is the honest bucket for listings
// where hasDocuments is null — never coerce it to false.
function parseTristateBool(v, name) {
  if (v == null || v === "") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "unknown") return "unknown";
  throw new DiscoveryQueryError(400, `${name} must be true, false, or unknown`);
}

// The only freshness buckets the selector can distinguish. Validating at parse
// time keeps the in-memory matcher and the SQL builder in agreement: an
// unrecognised bucket raises a 400 instead of silently matching zero rows in
// memory while the database path would have rejected it.
function parseFreshness(v) {
  if (v == null || v === "") return "";
  const bucket = String(v).trim().toLowerCase();
  if (bucket === "all" || bucket === "observed" || bucket === "unverified")
    return bucket;
  throw new DiscoveryQueryError(400, "Invalid freshness");
}
function parseDate(v, name) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)))
    throw new DiscoveryQueryError(400, `Invalid ${name}`);
  // Date.parse rolls impossible calendar dates forward instead of failing, so
  // "2026-02-30" quietly becomes 2026-03-02 and silently shifts a sale-date
  // window. Require the parsed date to round-trip to the same Y-M-D.
  const [y, m, d] = v.split("-").map(Number);
  const round = new Date(`${v}T00:00:00Z`);
  if (
    !Number.isFinite(round.getTime()) ||
    round.getUTCFullYear() !== y ||
    round.getUTCMonth() + 1 !== m ||
    round.getUTCDate() !== d
  )
    throw new DiscoveryQueryError(400, `Invalid ${name}`);
  return v;
}
function parseBbox(v) {
  if (!v) return null;
  const n = v.split(",").map(Number);
  if (
    n.length !== 4 ||
    !n.every(Number.isFinite) ||
    n[1] < -90 ||
    n[1] > 90 ||
    n[3] < -90 ||
    n[3] > 90 ||
    n[0] < -180 ||
    n[0] > 180 ||
    n[2] < -180 ||
    n[2] > 180 ||
    n[0] === n[2] ||
    n[1] >= n[3]
  )
    throw new DiscoveryQueryError(400, "Invalid bbox");
  return n;
}
function queryFromUrl(url) {
  const get = (n) => url.searchParams.get(n);
  const limit = Number(get("limit") || 50);
  const offset = Number(get("offset") || 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw new DiscoveryQueryError(
      400,
      "limit must be an integer from 1 to 1000",
    );
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new DiscoveryQueryError(400, "offset must be an integer from 0 to 100000");
  const maxBid = get("maxBid") == null ? null : Number(get("maxBid"));
  if (maxBid !== null && (!Number.isFinite(maxBid) || maxBid < 0))
    throw new DiscoveryQueryError(400, "Invalid maxBid");
  const minScore = get("minScore") == null ? null : Number(get("minScore"));
  const minEquity = get("minEquity") == null ? null : Number(get("minEquity"));
  if (minScore !== null && (!Number.isFinite(minScore) || minScore < 0 || minScore > 100)) throw new DiscoveryQueryError(400, "Invalid minScore");
  if (minEquity !== null && (!Number.isFinite(minEquity) || minEquity < 0)) throw new DiscoveryQueryError(400, "Invalid minEquity");
  const lat = get("lat") == null ? null : Number(get("lat"));
  const lng = get("lng") == null ? null : Number(get("lng"));
  const radiusKm = get("radiusKm") == null ? 100 : Number(get("radiusKm"));
  if ((lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) || (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)))
    throw new DiscoveryQueryError(400, "lat and lng must be valid coordinates supplied together");
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 20000)
    throw new DiscoveryQueryError(400, "radiusKm must be between 0 and 20000");
  const sort = get("sort") === "bid" ? "bid-asc" : (get("sort") || "score");
  if (!['score', 'date', 'bid-asc', 'equity'].includes(sort)) throw new DiscoveryQueryError(400, "Invalid sort");
  // Also dropped by the a58f76f refactor. A zoom outside the map's usable range
  // silently produces a query the map layer cannot render; an offset combined
  // with a cursor is ambiguous, because the two describe different positions
  // and the layer silently prefers one. Both reject rather than guess, in line
  // with every other unrecognised value in this function.
  const zoom = get("zoom") == null ? null : Number(get("zoom"));
  if (zoom !== null && (!Number.isFinite(zoom) || zoom < 0 || zoom > 20))
    throw new DiscoveryQueryError(400, "zoom must be from 0 to 20");
  const cursor = get("cursor");
  if (cursor && offset) throw new DiscoveryQueryError(400, "offset cannot be combined with cursor");
  if (minEquity !== null && minEquity > 50000000)
    throw new DiscoveryQueryError(400, "Invalid minEquity");
  // A reversed date range can only ever match zero rows, and "no results" is the
  // one answer the caller cannot act on. This check was dropped by the a58f76f
  // refactor, which inlined the two parseDate calls into the returned literal
  // and took the ordering guard with it. The test that still guarded it had
  // been failing ever since, invisibly: the quality gate classified every
  // failure in this suite as skip_env because its DATABASE_URL is unset in CI.
  // Reject, consistent with how every other unrecognised value here is handled.
  const saleFrom = parseDate(get("saleFrom"), "saleFrom");
  const saleTo = parseDate(get("saleTo"), "saleTo");
  if (saleFrom && saleTo && saleFrom > saleTo)
    throw new DiscoveryQueryError(400, "saleFrom must not be after saleTo");
  return {
    q: text(get("q")),
    state: text(get("state")),
    county: text(get("county")),
    source: text(get("source")),
    type: text(get("type")),
    program: text(get("program")),
    lifecycle: text(get("lifecycle") || get("status")),
    occupancy: text(get("occupancy")),
    freshness: parseFreshness(get("freshness")),
    saleFrom: parseDate(get("saleFrom"), "saleFrom"),
    saleTo: parseDate(get("saleTo"), "saleTo"),
    maxBid,
    minScore,
    minEquity,
    seniorLien: text(get("seniorLien")),
    redemption: text(get("redemption")),
    hasDocuments: parseTristateBool(get("hasDocuments"), "hasDocuments"),
    bbox: parseBbox(get("bbox")),
    sort,
    cursor,
    limit,
    offset,
    lat,
    lng,
    radiusKm,
    zoom,
    facets: (get("facets") || "").split(",").filter(Boolean),
  };
}
function derived(row) {
  // Document evidence is tri-state. A record that carries document evidence is
  // true, a record the publisher explicitly reported as having none is false, and
  // a record that never reached a conclusion stays null. Coercing that last case
  // to false would make `hasDocuments=unknown` unfindable and would let an
  // unexamined record satisfy `hasDocuments=false`, which is a fail-open error.
  //
  // The mirror error is also fail-open and was live here: a document container
  // that is PRESENT but EMPTY is a conclusion - we looked and there are none -
  // so it must be false, not null. Reporting it as null made
  // `hasDocuments=unknown` hunts match records that had in fact been examined.
  //
  // Documents count from EITHER provenance location, and this now mirrors
  // server/intelligence/hunts.js exactly. The two disagreed: the hunt snapshot
  // merges sourceFacts.documents and media.documents and treats a present-empty
  // container as false, while this read only sourceFacts and treated a
  // present-empty container as unknown. So the two halves of one hunt reached
  // opposite conclusions about the same listing - a `hasDocuments=true` hunt
  // missed every listing whose documents arrived through the media pipeline.
  const documentSets = [
    row.provenance?.sourceFacts?.documents,
    row.provenance?.media?.documents,
  ].filter(Array.isArray);
  const hasDocuments =
    row.hasDocuments === true || documentSets.some((documents) => documents.length > 0)
      ? true
      : row.hasDocuments === false || documentSets.length > 0
        ? false
        : null;
  return {
    program:
      row.auctionProgram || row.provenance?.sourceFacts?.auctionProgram || null,
    lifecycle: row.lifecycleStatus || row.status || null,
    outcome: row.transactionOutcome || null,
    hasDocuments,
    freshness: row.provenance?.origin === "live" ? "observed" : "unverified",
  };
}
function matches(row, f) {
  const d = derived(row);
  if (
    f.q &&
    !text(
      [
        row.address,
        row.city,
        row.county,
        row.state,
        row.source,
        row.provenance?.recordId,
        d.program,
      ].join(" "),
    ).includes(f.q)
  )
    return false;
  for (const [k, v] of [
    ["state", f.state],
    ["county", f.county],
    ["source", f.source],
    ["propType", f.type],
    ["occupancy", f.occupancy],
  ]) {
    if (!v || v === "all") continue;
    // "unknown" is the canonical sentinel for "this field was never determined",
    // not a literal a publisher wrote. It must match a blank field, otherwise
    // selecting Unknown in the workbench can never return the records it describes.
    if (v === "unknown") {
      if (text(row[k]) !== "") return false;
      continue;
    }
    if (text(row[k]) !== v) return false;
  }
  // "unknown" is the canonical sentinel for "this field was never determined",
  // and it applies to the derived fields too. Without it, program=unknown
  // matched nothing at all here while the facet offered the bucket and the SQL
  // returned it - a filter value the caller could select and never get.
  if (f.program && f.program !== "all"
      && (f.program === "unknown" ? text(d.program) !== "" : text(d.program) !== f.program))
    return false;
  if (f.lifecycle && f.lifecycle !== "all"
      && (f.lifecycle === "unknown" ? text(d.lifecycle) !== "" : text(d.lifecycle) !== f.lifecycle))
    return false;
  if (f.freshness && f.freshness !== "all" && d.freshness !== f.freshness)
    return false;
  if (f.saleFrom && (!row.saleDate || row.saleDate < f.saleFrom)) return false;
  if (f.saleTo && (!row.saleDate || row.saleDate > f.saleTo)) return false;
  if (
    f.maxBid != null &&
    (row.openingBid == null || Number(row.openingBid) > f.maxBid)
  )
    return false;
  if (f.minScore != null && (row.dealScore == null || Number(row.dealScore) < f.minScore)) return false;
  if (f.minEquity != null && (row.equity == null || Number(row.equity) < f.minEquity)) return false;
  if (f.seniorLien === "clean" && (!row.seniorLienRisk || ["high", "unknown"].includes(row.seniorLienRisk))) return false;
  if (f.seniorLien === "risk" && row.seniorLienRisk !== "high") return false;
  if (f.redemption === "immediate" && row.redemptionDays !== 0) return false;
  if (f.redemption === "redemption_active" && !(row.redemptionDays > 0)) return false;
  if (f.hasDocuments === "unknown") {
    if (d.hasDocuments !== null && d.hasDocuments !== undefined) return false;
  } else if (f.hasDocuments != null && d.hasDocuments !== f.hasDocuments)
    return false;
  if (f.bbox) {
    const [w, s, e, n] = f.bbox,
      lat = Number(row.lat),
      lng = Number(row.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < s ||
      lat > n ||
      (w <= e ? lng < w || lng > e : lng < w && lng > e)
    )
      return false;
  }
  if (f.lat != null && f.lng != null) {
    const dLat = (Number(row.lat) - f.lat) * Math.PI / 180;
    const dLng = (Number(row.lng) - f.lng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(f.lat * Math.PI / 180) * Math.cos(Number(row.lat) * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (!Number.isFinite(distanceKm) || distanceKm > f.radiusKm) return false;
  }
  return true;
}
function compare(a, b, sort) {
  let av,
    bv,
    asc = false;
  if (sort === "date") {
    av = a.saleDate ? Date.parse(a.saleDate) : null;
    bv = b.saleDate ? Date.parse(b.saleDate) : null;
    asc = true;
  } else if (sort === "bid-asc") {
    av = a.openingBid;
    bv = b.openingBid;
    asc = true;
  } else if (sort === "equity") {
    av = a.equity;
    bv = b.equity;
  } else {
    av = a.dealScore;
    bv = b.dealScore;
  }
  const ak = Number.isFinite(Number(av)) && av !== null,
    bk = Number.isFinite(Number(bv)) && bv !== null;
  if (ak !== bk) return ak ? -1 : 1;
  if (ak && Number(av) !== Number(bv))
    return asc ? Number(av) - Number(bv) : Number(bv) - Number(av);
  return String(a.id).localeCompare(String(b.id));
}
function buildFacets(rows, fields) {
  const allowed = {
    state: (r) => r.state,
    county: (r) => r.county,
    source: (r) => r.source,
    type: (r) => r.propType,
    program: (r) => derived(r).program,
    lifecycle: (r) => derived(r).lifecycle,
    occupancy: (r) => r.occupancy,
    freshness: (r) => derived(r).freshness,
  };
  return Object.fromEntries(
    fields
      .filter((f) => allowed[f])
      .map((f) => {
        const counts = new Map();
        for (const r of rows) {
          const v = allowed[f](r) || "unknown";
          counts.set(String(v), (counts.get(String(v)) || 0) + 1);
        }
        return [
          f,
          [...counts]
            .map(([value, count]) => ({ value, count }))
            .sort(
              (a, b) => b.count - a.count || a.value.localeCompare(b.value),
            ),
        ];
      }),
  );
}
function pgWhere(f, start = 1) {
  const p = [],
    w = [];
  const add = (sql, v) => {
    w.push(sql.replace("?", `$${start + p.length}`));
    p.push(v);
  };
  for (const [col, v] of [
    // Order matters: it is the order the bound parameters appear in, and the
    // discovery backend suite pins which filter lands at which position.
    ["state", f.state],
    ["county", f.county],
    ["source_key", f.source],
    ["prop_type", f.type],
    // These two are derived, not stored: matches() reads the column first and
    // falls back - auction_program to provenance.sourceFacts.auctionProgram,
    // lifecycle_status to status. The SQL has to carry the same fallback or the
    // two backends select different records. Measured against the live store the
    // columns happen to be populated, which is exactly why this stayed hidden:
    // a row whose value only exists in the fallback matched in memory and not
    // in SQL. lifecycle_status also needs nullif, because '' is falsy for the
    // memory accessor and coalesce would happily return it instead of status.
    ["coalesce(auction_program, provenance->'sourceFacts'->>'auctionProgram')", f.program],
    ["coalesce(nullif(lifecycle_status,''), status)", f.lifecycle],
    ["occupancy", f.occupancy],
  ]) {
    if (!v || v === "all") continue;
    // Mirrors the in-memory matcher: "unknown" selects records whose field was
    // never determined, so it must test for NULL/blank rather than the literal.
    if (v === "unknown") {
      w.push(`coalesce(${col},'')=''`);
      continue;
    }
    // Every value above reached here through text(), which lowercases it, and
    // matches() lowercases the row too - so the two backends only agree if the
    // SQL lowercases the column. It did not: `col=?` compared 'maricopa'
    // against 'Maricopa', and on Postgres - the backend production runs on -
    // every filter whose stored values contain an uppercase letter returned
    // nothing. The workbench rendered those facets with real counts
    // ("Single Family Home" 5,661, "TPS" 4,533, "Status: Active" 2,239,
    // "Vacant" 2,044, "Maricopa" 186) and every one of them filtered to zero.
    //
    // `state` used to be special-cased back to upper case, which only worked
    // because every state code is already stored uppercase; lower() on both
    // sides is the same rule the memory matcher applies, applied once.
    add(`lower(${col})=?`, v);
  }
  if (f.q) {
    // The same derived program matches() searches: a record whose program only
    // exists in provenance is findable by keyword there and was invisible here,
    // which the parity matrix caught (q=hud reo returned [] against memory's
    // ["b"]).
    add(
      `(coalesce(address,'')||' '||coalesce(city,'')||' '||coalesce(county,'')||' '||coalesce(source_key,'')||' '||coalesce(auction_program, provenance->'sourceFacts'->>'auctionProgram','')||' '||coalesce(provenance->>'recordId','')) ILIKE ?`,
      `%${f.q}%`,
    );
  }
  if (f.saleFrom) add("sale_date>=?", f.saleFrom);
  if (f.saleTo) add("sale_date<=?", f.saleTo);
  if (f.maxBid != null) add("opening_bid<=?", f.maxBid);
  if (f.minScore != null) add("deal_score>=?", f.minScore);
  if (f.minEquity != null) add("equity_spread>=?", f.minEquity);
  if (f.seniorLien === "clean") w.push("senior_lien_risk IS NOT NULL AND senior_lien_risk NOT IN ('high','unknown')");
  else if (f.seniorLien === "risk") w.push("senior_lien_risk='high'");
  if (f.redemption === "immediate") w.push("redemption_days=0");
  else if (f.redemption === "redemption_active") w.push("redemption_days>0");
  // Document evidence is tri-state and can arrive in three places, exactly as
  // derived() reads them: the has_documents column, and the sourceFacts.documents
  // and media.documents arrays. The SQL used to test `has_documents IS NULL`
  // alone, so a record whose documents arrived through either provenance
  // container was memory-true but SQL-unknown - the parity suite caught it
  // returning 16 rows where memory returned 4. A container that is present but
  // EMPTY is still a conclusion ("we looked, there are none") and must be false,
  // which is what the separate PRESENCE terms below exist for. jsonb_typeof
  // guards jsonb_array_length, which raises on a non-array, so a malformed
  // container is ignored rather than exploding the query.
  const documentArray = (container) =>
    `(CASE WHEN jsonb_typeof(provenance->'${container}'->'documents')='array' `
    + `THEN jsonb_array_length(provenance->'${container}'->'documents') END)`;
  const documentPresent = (container) =>
    `(jsonb_typeof(provenance->'${container}'->'documents')='array')`;
  // Both predicates must be total. `has_documents IS TRUE` is NULL when the
  // column is NULL, and jsonb_typeof(NULL) is NULL too, so an unguarded OR
  // chain collapses the whole comparison to NULL and `NOT NULL` filters the row
  // out instead of classifying it. Everything folds to false first.
  const docsTrue = `(coalesce(has_documents IS TRUE,false) OR greatest(coalesce(${documentArray("sourceFacts")},0),coalesce(${documentArray("media")},0))>0)`;
  const docsFalseRaw = `(coalesce(has_documents IS FALSE,false) OR coalesce(${documentPresent("sourceFacts")},false) OR coalesce(${documentPresent("media")},false))`;
  // A present container is a conclusion, but only a non-empty one means "yes",
  // and true has to win: a row whose sourceFacts.documents holds a document is
  // true even though the column is NULL and the container is "present". So
  // false is "concluded absent" AND NOT "concluded present" - the same ordering
  // derived() uses.
  const docsFalse = `((${docsFalseRaw}) AND NOT ${docsTrue})`;
  if (f.hasDocuments === "unknown") w.push(`NOT ${docsTrue} AND NOT ${docsFalse}`);
  else if (f.hasDocuments === true) w.push(docsTrue);
  else if (f.hasDocuments === false) w.push(docsFalse);
  if (f.freshness && f.freshness !== "all") {
    if (f.freshness === "observed") w.push("provenance->>'origin'='live'");
    else if (f.freshness === "unverified")
      w.push("coalesce(provenance->>'origin','')<>'live'");
    else throw new DiscoveryQueryError(400, "Invalid freshness");
  }
  if (f.bbox) {
    const [west, south, east, north] = f.bbox;
    add("latitude>=?", south);
    add("latitude<=?", north);
    if (west <= east) {
      add("longitude>=?", west);
      add("longitude<=?", east);
    } else {
      const first = start + p.length;
      p.push(west, east);
      w.push(`(longitude>=$${first} OR longitude<=$${first + 1})`);
    }
  }
  if (f.lat != null && f.lng != null) {
    const first = start + p.length;
    w.push(`ST_DWithin(geog, ST_SetSRID(ST_MakePoint($${first},$${first + 1}),4326)::geography,$${first + 2})`);
    p.push(f.lng, f.lat, f.radiusKm * 1000);
  }
  return { sql: w.length ? ` WHERE ${w.join(" AND ")}` : "", params: p };
}
function pgSort(f) {
  if (f.sort === "date")
    return {
      expr: "coalesce(extract(epoch from sale_date),253402300799)",
      dir: "ASC",
    };
  if (f.sort === "bid-asc")
    return { expr: "coalesce(opening_bid,1e30)", dir: "ASC" };
  if (f.sort === "equity")
    return { expr: "coalesce(equity_spread,-1)", dir: "DESC" };
  if (f.sort === "score")
    return { expr: "coalesce(deal_score,-1)", dir: "DESC" };
  throw new DiscoveryQueryError(400, "Invalid sort");
}
async function pgRevision(database) {
  const r = await database.pool.query(
    "SELECT md5(count(*)::text||':'||coalesce(max(updated_at)::text,'')) AS revision FROM listings",
  );
  return r.rows[0].revision;
}
async function pgSearch(database, f) {
  const revision = await pgRevision(database),
    binding = hash({ ...f, cursor: null }).slice(0, 24),
    where = pgWhere(f),
    sort = pgSort(f);
  let cursorClause = "",
    params = [...where.params];
  if (f.cursor) {
    const c = cursorDecode(f.cursor);
    if (c.revision !== revision)
      throw new DiscoveryQueryError(409, "Cursor is stale; restart the search");
    if (c.binding !== binding)
      throw new DiscoveryQueryError(400, "Cursor does not match this query");
    params.push(c.value, c.id);
    cursorClause = `${where.sql ? " AND" : " WHERE"} (${sort.expr},id) ${sort.dir === "ASC" ? ">" : "<"} ($${params.length - 1},$${params.length})`;
  }
  params.push(f.limit + 1, f.offset || 0);
  const select = database.listingSelect;
  if (!select)
    throw new DiscoveryQueryError(
      503,
      "PostgreSQL listing projection is unavailable",
    );
  const rows = (
    await database.pool.query(
       `SELECT ${select}, ${sort.expr}::float8 AS "cursorValue" FROM listings${where.sql}${cursorClause} ORDER BY ${sort.expr} ${sort.dir},id ${sort.dir} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )
  ).rows;
  const hasMore = rows.length > f.limit;
  if (hasMore) rows.pop();
  const listings = rows.map(({ cursorValue, ...r }) => r);
  const total = Number(
    (
      await database.pool.query(
        `SELECT count(*)::int AS count FROM listings${where.sql}`,
        where.params,
      )
    ).rows[0].count,
  );
  const allowed = {
      state: "state",
      county: "county",
      source: "source_key",
      type: "prop_type",
      program: "auction_program",
      lifecycle: "lifecycle_status",
      // The buckets here group by the stored string exactly as the publisher
      // wrote it, while pgWhere matches case-insensitively - the same rule the
      // in-memory matcher applies. So a facet count can be narrower than the
      // filter it produces, and publishers that vary casing get several chips
      // for one concept. Live: occupancy offers 'Occupied' (4,316),
      // 'OCCUPIED' (16), 'OWNER OCCUPIED' (4) and 'TENANT OCCUPIED' (1), and
      // filtering 'occupied' correctly returns all 4,332.
      //
      // The sentinel collision beside it is deliberate, not an oversight:
      // 'unknown' is the documented token for "never determined", meaning
      // blank/NULL, which is also what the in-memory matcher tests. Publishers
      // that wrote the literal text 'Unknown' (162 on type, 40 + 7 on
      // occupancy) therefore occupy their own facet bucket that no single
      // filter value can isolate. Separating them needs a distinct token in
      // the filter API, not a query change.
      //
      // occupancy: nullif folds the blank-string bucket into the "unknown"
      // sentinel, mirroring the in-memory accessor's falsy-to-"unknown" rule
      // and pgWhere's coalesce(occupancy,'')='' test for that sentinel.
      occupancy: "nullif(occupancy,'')",
      // freshness is derived, not stored. The literals are exactly the buckets
      // derived() returns and parseFreshness accepts, so every option this
      // facet returns can be selected without a 400. The CASE is total, so it
      // can never yield the "unknown" sentinel the freshness parser rejects.
      freshness:
        "CASE WHEN provenance->>'origin'='live' THEN 'observed' ELSE 'unverified' END",
    },
    facets = {};
  for (const field of f.facets) {
    if (!allowed[field]) continue;
    facets[field] = (
      await database.pool.query(
        `SELECT coalesce(${allowed[field]}::text,'unknown') AS value,count(*)::int AS count FROM listings${where.sql} GROUP BY 1 ORDER BY count DESC,value`,
        where.params,
      )
    ).rows;
  }
  const last = rows.at(-1);
  return {
    listings,
    total,
    page: {
      hasMore,
      nextCursor: hasMore
        ? cursorEncode({
            revision,
            binding,
            value: Number(last.cursorValue),
            id: last.id,
          })
        : null,
    },
    revision,
    facets,
  };
}
async function pgMap(database, f) {
  if (!f.bbox)
    throw new DiscoveryQueryError(400, "bbox is required for map queries");
  const where = pgWhere(f),
    zoom = Math.max(0, Math.min(20, Number(f.zoom) || 8)),
    grid = Math.max(0.0001, 360 / Math.pow(2, zoom + 4)),
    limit = Math.min(f.limit, 2000),
    params = [...where.params, grid, limit + 1];
  const sql = `SELECT ST_X(ST_Centroid(ST_Collect(geog::geometry)))::float8 AS lng,ST_Y(ST_Centroid(ST_Collect(geog::geometry)))::float8 AS lat,count(*)::int AS count,min(id) AS id,CASE WHEN count(DISTINCT source_key)=1 THEN min(source_key) ELSE 'multiple' END AS source,CASE WHEN count(DISTINCT lifecycle_status)=1 THEN min(lifecycle_status) ELSE 'mixed' END AS status FROM listings${where.sql}${where.sql ? " AND" : " WHERE"} geog IS NOT NULL GROUP BY ST_SnapToGrid(geog::geometry,$${where.params.length + 1}) ORDER BY count(*) DESC,min(id) LIMIT $${where.params.length + 2}`;
  const rows = (await database.pool.query(sql, params)).rows,
    more = rows.length > limit;
  if (more) rows.pop();
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      properties: {
        id: r.id,
        count: r.count,
        source: r.source,
        status: r.status,
      },
    })),
    revision: await pgRevision(database),
    truncated: more,
  };
}
async function load(database) {
  const r = await database.getListings({
    limit: MAX_SCAN,
    offset: 0,
    sort: "score",
  });
  if (Number(r.total) > r.listings.length)
    throw new DiscoveryQueryError(
      503,
      `Discovery inventory exceeds ${MAX_SCAN}; PostgreSQL query adapter is required`,
    );
  return r.listings;
}
async function search(database, f) {
  if (database.isPg) return pgSearch(database, f);
  const all = await load(database),
    revision = revisionOf(all),
    binding = hash({ ...f, cursor: null }).slice(0, 24);
  let after = null;
  if (f.cursor) {
    const c = cursorDecode(f.cursor);
    if (c.revision !== revision)
      throw new DiscoveryQueryError(409, "Cursor is stale; restart the search");
    if (c.binding !== binding)
      throw new DiscoveryQueryError(400, "Cursor does not match this query");
    after = c.id;
  }
  const filtered = all
    .filter((r) => matches(r, f))
    .sort((a, b) => compare(a, b, f.sort));
  let start = after ? filtered.findIndex((r) => r.id === after) + 1 : 0;
  if (after && start === 0)
    throw new DiscoveryQueryError(409, "Cursor is stale; restart the search");
  start += f.offset || 0;
  const listings = filtered.slice(start, start + f.limit),
    hasMore = start + listings.length < filtered.length;
  return {
    listings,
    total: filtered.length,
    page: {
      hasMore,
      nextCursor: hasMore
        ? cursorEncode({ revision, binding, id: listings.at(-1).id })
        : null,
    },
    revision,
    facets: buildFacets(filtered, f.facets),
  };
}
async function map(database, f) {
  if (database.isPg) return pgMap(database, f);
  const all = (await load(database)).filter(
    (r) =>
      matches(r, f) &&
      r.lat !== null &&
      r.lng !== null &&
      Number.isFinite(Number(r.lat)) &&
      Number.isFinite(Number(r.lng)),
  );
  const cap = Math.min(f.limit, 2000),
    shown = all.slice(0, cap),
    revision = revisionOf(all);
  return {
    type: "FeatureCollection",
    features: shown.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(r.lng), Number(r.lat)] },
      properties: {
        id: r.id,
        count: 1,
        source: r.source,
        status: derived(r).lifecycle,
      },
    })),
    revision,
    truncated: all.length > shown.length,
  };
}
module.exports = {
  DiscoveryQueryError,
  queryFromUrl,
  search,
  map,
  matches,
  parseBbox,
  revisionOf,
  // Exported so the PG/memory parity test can build the same WHERE the store
  // runs. It was referenced there but missing here, which meant that suite only
  // ever proved itself when DATABASE_URL was set and otherwise stayed silent.
  pgWhere,
};
