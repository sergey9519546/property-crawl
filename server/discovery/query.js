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
  if (v === "unknown") return "unknown";
  throw new DiscoveryQueryError(400, `${name} must be true or false, or unknown`);
}
function parseDate(v, name) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
    throw new DiscoveryQueryError(400, `Invalid ${name}`);
  const [year, month, day] = v.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day)
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
    n[1] >= n[3] ||
    n[0] === n[2]
  )
    throw new DiscoveryQueryError(400, "Invalid bbox");
  return n;
}
function queryFromUrl(url) {
  const get = (n) => url.searchParams.get(n);
  const boundedText = (name, max) => {
    const value = get(name);
    if (value != null && value.length > max) throw new DiscoveryQueryError(400, `${name} is too long`);
    return text(value);
  };
  const limit = Number(get("limit") || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw new DiscoveryQueryError(
      400,
      "limit must be an integer from 1 to 1000",
    );
  const optionalNumber = (name) => {
    const raw = get(name);
    return raw == null || raw === "" ? null : Number(raw);
  };
  const maxBid = optionalNumber("maxBid");
  if (maxBid !== null && (!Number.isFinite(maxBid) || maxBid < 0 || maxBid > 50000000))
    throw new DiscoveryQueryError(400, "Invalid maxBid");
  const minScore = optionalNumber("minScore");
  const minEquity = optionalNumber("minEquity");
  if (minScore !== null && (!Number.isFinite(minScore) || minScore < 0 || minScore > 100)) throw new DiscoveryQueryError(400, "Invalid minScore");
  if (minEquity !== null && (!Number.isFinite(minEquity) || minEquity < 0 || minEquity > 50000000)) throw new DiscoveryQueryError(400, "Invalid minEquity");
  const offset = Number(get("offset") || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new DiscoveryQueryError(400, "offset must be an integer from 0 to 100000");
  const zoom = get("zoom") == null ? null : Number(get("zoom"));
  if (zoom !== null && (!Number.isFinite(zoom) || zoom < 0 || zoom > 20))
    throw new DiscoveryQueryError(400, "zoom must be from 0 to 20");
  const saleFrom = parseDate(get("saleFrom"), "saleFrom");
  const saleTo = parseDate(get("saleTo"), "saleTo");
  if (saleFrom && saleTo && saleFrom > saleTo)
    throw new DiscoveryQueryError(400, "saleFrom must not be after saleTo");
  const cursor = get("cursor");
  if (cursor && offset) throw new DiscoveryQueryError(400, "offset cannot be combined with cursor");
  const sort = get("sort") || "score";
  if (!["score", "date", "bid-asc", "equity"].includes(sort)) throw new DiscoveryQueryError(400, "Invalid sort");
  const freshness = boundedText("freshness", 16);
  if (freshness && freshness !== "all" && !["fresh", "aging", "stale", "unknown", "unverified"].includes(freshness)) throw new DiscoveryQueryError(400, "Invalid freshness");
  const seniorLien = boundedText("seniorLien", 16);
  if (seniorLien && seniorLien !== "all" && !["clean", "risk"].includes(seniorLien)) throw new DiscoveryQueryError(400, "Invalid seniorLien");
  const redemption = boundedText("redemption", 32);
  if (redemption && redemption !== "all" && !["immediate", "redemption_active"].includes(redemption)) throw new DiscoveryQueryError(400, "Invalid redemption");
  return {
    q: boundedText("q", 256),
    state: boundedText("state", 2),
    county: boundedText("county", 128),
    source: boundedText("source", 64),
    type: boundedText("type", 64),
    program: boundedText("program", 128),
    lifecycle: boundedText(get("lifecycle") != null ? "lifecycle" : "status", 32),
    occupancy: boundedText("occupancy", 64),
    freshness,
    saleFrom,
    saleTo,
    maxBid,
    minScore,
    minEquity,
    seniorLien,
    redemption,
    hasDocuments: parseBool(get("hasDocuments"), "hasDocuments"),
    bbox: parseBbox(get("bbox")),
    sort,
    cursor,
    offset,
    limit,
    zoom,
    facets: (get("facets") || "").split(",").filter(Boolean),
  };
}
function derived(row, now = Date.now()) {
  const documents = row.provenance?.sourceFacts?.documents;
  const hasDocuments = row.hasDocuments === true || (Array.isArray(documents) && documents.length > 0)
    ? true
    : row.hasDocuments === false || Array.isArray(documents) ? false : null;
  const observedAt = row.sourceObservedAt || row.provenance?.observedAt || row.fetchedAt;
  const observedMs = Date.parse(observedAt || "");
  const nowMs = now instanceof Date ? now.getTime() : Number.isFinite(Number(now)) ? Number(now) : Date.parse(String(now));
  const ageDays = Number.isFinite(observedMs) && Number.isFinite(nowMs) ? Math.max(0, (nowMs - observedMs) / 86400000) : null;
  return {
    program:
      row.auctionProgram || row.provenance?.sourceFacts?.auctionProgram || null,
    lifecycle: row.lifecycleStatus || row.status || null,
    outcome: row.transactionOutcome || null,
    hasDocuments,
    freshness: row.provenance?.origin !== "live" ? "unverified" : ageDays === null ? "unknown" : ageDays <= 7 ? "fresh" : ageDays <= 30 ? "aging" : "stale",
  };
}
function matches(row, f, options = {}) {
  const d = derived(row, options.now ?? Date.now());
  if (
    f.q &&
    !text(
      [
        row.address,
        row.city,
        row.county,
        row.state,
        row.source,
        row.id,
        row.provenance?.recordId,
        row.provenance?.sourceFacts?.apn,
        row.provenance?.sourceFacts?.parcelId,
        row.provenance?.sourceFacts?.caseNumber,
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
  ])
    if (v && v !== "all" && (v === 'unknown' ? Boolean(text(row[k])) : text(row[k]) !== v)) return false;
  if (f.program && f.program !== "all" && (f.program === 'unknown' ? Boolean(text(d.program)) : text(d.program) !== f.program))
    return false;
  if (f.lifecycle && f.lifecycle !== "all" && (f.lifecycle === 'unknown' ? Boolean(text(d.lifecycle)) : text(d.lifecycle) !== f.lifecycle))
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
  if (f.seniorLien === "clean" && (!row.seniorLienRisk || row.seniorLienRisk === "high")) return false;
  if (f.seniorLien === "risk" && row.seniorLienRisk !== "high") return false;
  if (f.redemption === "immediate" && row.redemptionDays !== 0) return false;
  if (f.redemption === "redemption_active" && !(row.redemptionDays > 0)) return false;
  if (f.hasDocuments === "unknown" ? d.hasDocuments !== null : f.hasDocuments != null && d.hasDocuments !== f.hasDocuments)
    return false;
  if (f.bbox) {
    const [w, s, e, n] = f.bbox,
      lat = Number(row.lat),
      lng = Number(row.lng);
    if (
      row.lat === "" || row.lng === "" ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < s ||
      lat > n ||
      (w <= e ? lng < w || lng > e : lng < w && lng > e)
    )
      return false;
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
  const programExpr="coalesce(nullif(btrim(auction_program),''),nullif(btrim(provenance#>>'{sourceFacts,auctionProgram}'),''))";
  const lifecycleExpr="coalesce(nullif(btrim(lifecycle_status),''),nullif(btrim(status),''))";
  for (const [col, v] of [
    ["state", f.state],
    ["lower(county)", f.county],
    ["source_key", f.source],
    ["lower(prop_type)", f.type],
    [`lower(${programExpr})`, f.program],
    [`lower(${lifecycleExpr})`, f.lifecycle],
    ["lower(occupancy)", f.occupancy],
  ])
    if (v && v !== "all") {
      if (v === 'unknown') w.push(`(${col} IS NULL OR btrim((${col})::text)='')`);
      else add(`${col}=?`, col === "state" ? v.toUpperCase() : v);
    }
  if (f.q) {
    add(
      `(coalesce(id,'')||' '||coalesce(address,'')||' '||coalesce(city,'')||' '||coalesce(county,'')||' '||coalesce(source_key,'')||' '||coalesce(${programExpr},'')||' '||coalesce(provenance->>'recordId','')||' '||coalesce(provenance#>>'{sourceFacts,apn}','')||' '||coalesce(provenance#>>'{sourceFacts,parcelId}','')||' '||coalesce(provenance#>>'{sourceFacts,caseNumber}','')) ILIKE ?`,
      `%${f.q}%`,
    );
  }
  if (f.saleFrom) add("sale_date>=?", f.saleFrom);
  if (f.saleTo) add("sale_date<=?", f.saleTo);
  if (f.maxBid != null) add("opening_bid<=?", f.maxBid);
  if (f.minScore != null) add("deal_score>=?", f.minScore);
  if (f.minEquity != null) add("equity_spread>=?", f.minEquity);
  if (f.seniorLien === "clean") w.push("senior_lien_risk IS NOT NULL AND senior_lien_risk<>'high'");
  else if (f.seniorLien === "risk") w.push("senior_lien_risk='high'");
  if (f.redemption === "immediate") w.push("redemption_days=0");
  else if (f.redemption === "redemption_active") w.push("redemption_days>0");
  if (f.hasDocuments === true) w.push("(has_documents=TRUE OR jsonb_array_length(CASE WHEN jsonb_typeof(provenance#>'{sourceFacts,documents}')='array' THEN provenance#>'{sourceFacts,documents}' ELSE '[]'::jsonb END)>0)");
  else if (f.hasDocuments === false) w.push("(has_documents IS DISTINCT FROM TRUE AND jsonb_array_length(CASE WHEN jsonb_typeof(provenance#>'{sourceFacts,documents}')='array' THEN provenance#>'{sourceFacts,documents}' ELSE '[]'::jsonb END)=0 AND (has_documents=FALSE OR jsonb_typeof(provenance#>'{sourceFacts,documents}')='array'))");
  else if (f.hasDocuments === "unknown") w.push("(has_documents IS NULL AND jsonb_typeof(provenance#>'{sourceFacts,documents}') IS DISTINCT FROM 'array')");
  if (f.freshness && f.freshness !== "all") {
    if (f.freshness === "fresh") w.push("provenance->>'origin'='live' AND coalesce(source_observed_at,fetched_at)>=NOW()-INTERVAL '7 days'");
    else if (f.freshness === "aging") w.push("provenance->>'origin'='live' AND coalesce(source_observed_at,fetched_at)<NOW()-INTERVAL '7 days' AND coalesce(source_observed_at,fetched_at)>=NOW()-INTERVAL '30 days'");
    else if (f.freshness === "stale") w.push("provenance->>'origin'='live' AND coalesce(source_observed_at,fetched_at)<NOW()-INTERVAL '30 days'");
    else if (f.freshness === "unknown") w.push("provenance->>'origin'='live' AND coalesce(source_observed_at,fetched_at) IS NULL");
    else if (f.freshness === "unverified") w.push("coalesce(provenance->>'origin','')<>'live'");
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
async function pgRevision(client) {
  const r = await client.query(
    "SELECT revision::text AS revision FROM discovery_listing_revision WHERE singleton=TRUE",
  );
  return r.rows[0].revision;
}
async function pgSummary(client, where, requestedFacets) {
  const expressions = {
    state: "coalesce(nullif(btrim(state::text),''),'unknown')", county: "coalesce(nullif(btrim(county::text),''),'unknown')",
    source: "coalesce(nullif(btrim(source_key::text),''),'unknown')", type: "coalesce(nullif(btrim(prop_type::text),''),'unknown')",
    occupancy: "coalesce(nullif(btrim(occupancy::text),''),'unknown')", program: "coalesce(nullif(btrim(auction_program::text),''),nullif(btrim(provenance#>>'{sourceFacts,auctionProgram}'),''),'unknown')",
    lifecycle: "coalesce(nullif(btrim(lifecycle_status::text),''),nullif(btrim(status::text),''),'unknown')",
    freshness: `CASE WHEN coalesce(provenance->>'origin','')<>'live' THEN 'unverified' WHEN coalesce(source_observed_at,fetched_at) IS NULL THEN 'unknown' WHEN coalesce(source_observed_at,fetched_at)>=NOW()-INTERVAL '7 days' THEN 'fresh' WHEN coalesce(source_observed_at,fetched_at)>=NOW()-INTERVAL '30 days' THEN 'aging' ELSE 'stale' END`,
  };
  const fields = [...new Set(requestedFacets)].filter((field) => expressions[field]);
  if (!fields.length) {
    const row = (await client.query(`SELECT count(*)::int AS count FROM listings${where.sql}`, where.params)).rows[0];
    return { total: Number(row.count), facets: {} };
  }
  const facetCase = fields.map((field) => `WHEN GROUPING(${expressions[field]})=0 THEN '${field}'`).join(' ');
  const valueCase = fields.map((field) => `WHEN GROUPING(${expressions[field]})=0 THEN coalesce(nullif(btrim((${expressions[field]})::text),''),'unknown')`).join(' ');
  const groupingSets = fields.map((field) => `(${expressions[field]})`).concat('()').join(',');
  const rows = (await client.query(`SELECT CASE ${facetCase} ELSE '__total' END AS facet, CASE ${valueCase} ELSE NULL END AS value, count(*)::int AS count FROM listings${where.sql} GROUP BY GROUPING SETS (${groupingSets}) ORDER BY facet,count DESC,value`, where.params)).rows;
  const facets = Object.fromEntries(fields.map((field) => [field, []]));
  let total = 0;
  for (const row of rows) {
    if (row.facet === '__total') total = Number(row.count);
    else facets[row.facet].push({ value: row.value, count: Number(row.count) });
  }
  return { total, facets };
}
async function pgSearch(database, f) {
  const client = typeof database.pool.connect === "function" ? await database.pool.connect() : database.pool;
  const transactional = client !== database.pool;
  try {
  if (transactional) {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  }
  const revision = await pgRevision(client),
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
    const valueParam = `$${params.length - 1}`, idParam = `$${params.length}`;
    cursorClause = `${where.sql ? " AND" : " WHERE"} (${sort.expr} ${sort.dir === "ASC" ? ">" : "<"} ${valueParam} OR (${sort.expr}=${valueParam} AND id>${idParam}))`;
  }
  params.push(f.limit + 1);
  const limitParam = `$${params.length}`;
  let offsetClause = "";
  if (!f.cursor && f.offset) {
    params.push(f.offset);
    offsetClause = ` OFFSET $${params.length}`;
  }
  const select = database.listingSelect;
  if (!select)
    throw new DiscoveryQueryError(
      503,
      "PostgreSQL listing projection is unavailable",
    );
  const rows = (
    await client.query(
      `SELECT ${select}, ${sort.expr}::float8 AS "cursorValue" FROM listings${where.sql}${cursorClause} ORDER BY ${sort.expr} ${sort.dir},id ASC LIMIT ${limitParam}${offsetClause}`,
      params,
    )
  ).rows;
  const hasMore = rows.length > f.limit;
  if (hasMore) rows.pop();
  const listings = rows.map(({ cursorValue, ...r }) => r);
  const summary = await pgSummary(client, where, f.facets);
  const total = summary.total, facets = summary.facets;
  const last = rows.at(-1);
  const result = {
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
  if (transactional) await client.query("COMMIT");
  return result;
  } catch (error) {
    if (transactional) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (transactional) client.release();
  }
}
async function pgMap(database, f) {
  if (!f.bbox)
    throw new DiscoveryQueryError(400, "bbox is required for map queries");
  const client = typeof database.pool.connect === "function" ? await database.pool.connect() : database.pool;
  const transactional = client !== database.pool;
  try {
  if (transactional) await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const where = pgWhere(f),
    zoom = f.zoom == null ? 8 : f.zoom,
    grid = Math.max(0.0001, 360 / Math.pow(2, zoom + 4)),
    limit = Math.min(f.limit, 2000),
    params = [...where.params, grid, limit + 1];
  const lifecycleExpr="coalesce(nullif(btrim(lifecycle_status),''),nullif(btrim(status),'') )";
  const sql = `SELECT ST_X(ST_Centroid(ST_Collect(geog::geometry)))::float8 AS lng,ST_Y(ST_Centroid(ST_Collect(geog::geometry)))::float8 AS lat,count(*)::int AS count,min(id) AS id,CASE WHEN count(DISTINCT source_key)=1 THEN min(source_key) ELSE 'multiple' END AS source,CASE WHEN count(DISTINCT ${lifecycleExpr})=1 THEN min(${lifecycleExpr}) ELSE 'mixed' END AS status FROM listings${where.sql}${where.sql ? " AND" : " WHERE"} geog IS NOT NULL GROUP BY ST_SnapToGrid(geog::geometry,$${where.params.length + 1}) ORDER BY count(*) DESC,min(id) LIMIT $${where.params.length + 2}`;
  const rows = (await client.query(sql, params)).rows,
    more = rows.length > limit;
  if (more) rows.pop();
  const result = {
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
    revision: await pgRevision(client),
    truncated: more,
  };
  if (transactional) await client.query("COMMIT");
  return result;
  } catch (error) {
    if (transactional) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (transactional) client.release();
  }
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
  let start = after ? filtered.findIndex((r) => r.id === after) + 1 : (f.offset || 0);
  if (after && start === 0)
    throw new DiscoveryQueryError(409, "Cursor is stale; restart the search");
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
      r.lat !== null && r.lat !== undefined && r.lat !== "" &&
      r.lng !== null && r.lng !== undefined && r.lng !== "" &&
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
  pgWhere,
  revisionOf,
};
