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
    cursor: get("cursor"),
    limit,
    offset,
    lat,
    lng,
    radiusKm,
    zoom: get("zoom") == null ? null : Number(get("zoom")),
    facets: (get("facets") || "").split(",").filter(Boolean),
  };
}
function derived(row) {
  // Document evidence is tri-state. A record that carries document evidence is
  // true, a record the publisher explicitly reported as having none is false, and
  // a record that never reached a conclusion stays null. Coercing that last case
  // to false would make `hasDocuments=unknown` unfindable and would let an
  // unexamined record satisfy `hasDocuments=false`, which is a fail-open error.
  const documents = row.provenance?.sourceFacts?.documents;
  const hasDocuments =
    row.hasDocuments === true || (Array.isArray(documents) && documents.length > 0)
      ? true
      : row.hasDocuments === false
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
  if (f.program && f.program !== "all" && text(d.program) !== f.program)
    return false;
  if (f.lifecycle && f.lifecycle !== "all" && text(d.lifecycle) !== f.lifecycle)
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
    ["state", f.state],
    ["county", f.county],
    ["source_key", f.source],
    ["prop_type", f.type],
    ["auction_program", f.program],
    ["lifecycle_status", f.lifecycle],
    ["occupancy", f.occupancy],
  ]) {
    if (!v || v === "all") continue;
    // Mirrors the in-memory matcher: "unknown" selects records whose field was
    // never determined, so it must test for NULL/blank rather than the literal.
    if (v === "unknown") {
      const bare = col.replace(/^lower\(/, "").replace(/\)$/, "");
      w.push(`coalesce(${bare},'')=''`);
      continue;
    }
    add(`${col}=?`, col === "state" ? v.toUpperCase() : v);
  }
  if (f.q) {
    add(
      `(coalesce(address,'')||' '||coalesce(city,'')||' '||coalesce(county,'')||' '||coalesce(source_key,'')||' '||coalesce(auction_program,'')||' '||coalesce(provenance->>'recordId','')) ILIKE ?`,
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
  if (f.hasDocuments === "unknown") w.push("has_documents IS NULL");
  else if (f.hasDocuments != null) add("has_documents=?", f.hasDocuments);
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
};
