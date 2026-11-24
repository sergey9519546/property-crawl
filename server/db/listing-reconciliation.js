'use strict';

const { LISTING_SELECT } = require('./listing-sql-constants');
const { mapPgListingRow, isFiniteTime } = require('./listing-normalizers');

/**
 * Reconcile publisher-index absence after a complete, non-truncated sweep.
 * Mirrors mergeLiveRecords() in server/db/live-record-store.js for PostgreSQL
 * and in-memory backends: records from sourceKey that were absent from the
 * complete sweep are annotated with provenance.publisherAbsence without
 * fabricating a 'sold' or 'closed' status, while observed ids clear any prior
 * publisherAbsence marker. Partial, truncated, or empty runs never annotate.
 */
async function reconcilePublisherAbsence(db, sourceKey, seenIds, options = {}) {
  if (options.runCompleted !== true || typeof sourceKey !== 'string' || !sourceKey.trim()) {
    return { retired: 0, restored: 0 };
  }
  const ids = Array.isArray(seenIds)
    ? [...new Set(seenIds.filter((id) => typeof id === 'string' && id.trim()))]
    : [];
  if (ids.length === 0) {
    return { retired: 0, restored: 0 };
  }
  const at = typeof options.at === 'string' && isFiniteTime(options.at)
    ? new Date(Date.parse(options.at)).toISOString()
    : new Date().toISOString();
  const county = typeof options.county === 'string' && options.county.trim() ? options.county.trim() : null;
  const state = typeof options.state === 'string' && options.state.trim() ? options.state.trim().toUpperCase() : null;

  if (db.isPg && db.pool) {
    const retireRes = await db.pool.query(
      `UPDATE listings
          SET provenance = jsonb_set(
                COALESCE(provenance, '{}'::jsonb),
                '{publisherAbsence}',
                jsonb_build_object('at', $3::text, 'sourceKey', $1::text, 'outcome', 'absent_from_complete_index'),
                true
              ),
              updated_at = NOW()
        WHERE source_key = $1
          AND ($4::text IS NULL OR LOWER(county) = LOWER($4::text))
          AND ($5::text IS NULL OR UPPER(state) = $5::text)
          AND NOT (id = ANY($2::text[]))`,
      [sourceKey, ids, at, county, state]
    );
    const restoreRes = await db.pool.query(
      `UPDATE listings
          SET provenance = provenance - 'publisherAbsence',
              updated_at = NOW()
        WHERE source_key = $1
          AND ($3::text IS NULL OR LOWER(county) = LOWER($3::text))
          AND ($4::text IS NULL OR UPPER(state) = $4::text)
          AND id = ANY($2::text[])
          AND provenance ? 'publisherAbsence'`,
      [sourceKey, ids, county, state]
    );
    return {
      retired: retireRes.rowCount || 0,
      restored: restoreRes.rowCount || 0,
    };
  }

  if (db.memoryInventoryRequested()) {
    const seenSet = new Set(ids);
    let retired = 0;
    let restored = 0;
    for (let i = 0; i < db.inMemoryData.listings.length; i++) {
      const record = db.inMemoryData.listings[i];
      if (!record || record.source !== sourceKey) continue;
      if (county && String(record.county || '').trim().toLowerCase() !== county.toLowerCase()) continue;
      if (state && String(record.state || '').trim().toUpperCase() !== state) continue;
      if (seenSet.has(record.id)) {
        if (record.provenance?.publisherAbsence) {
          const provenance = { ...record.provenance };
          delete provenance.publisherAbsence;
          db.inMemoryData.listings[i] = { ...record, provenance };
          restored++;
        }
      } else {
        const provenance = {
          ...(record.provenance || {}),
          publisherAbsence: { at, sourceKey, outcome: 'absent_from_complete_index' },
        };
        db.inMemoryData.listings[i] = { ...record, provenance };
        retired++;
      }
    }
    return { retired, restored };
  }

  return { retired: 0, restored: 0 };
}

/**
 * Reconcile duplicate publisher notices sharing the same source, county,
 * docket/sheriff writ identifier, and normalized street address. Stamps
 * provenance.supersededBy on older duplicate records cleanly without
 * conflating distinct unit addresses on multi-parcel writs.
 */
async function reconcileDuplicateDockets(db, sourceKey, seenListings = [], options = {}) {
  if (typeof sourceKey !== 'string' || !sourceKey.trim() || !Array.isArray(seenListings) || seenListings.length === 0) {
    return { superseded: 0, cleared: 0 };
  }
  const at = typeof options.at === 'string' && isFiniteTime(options.at)
    ? new Date(Date.parse(options.at)).toISOString()
    : new Date().toISOString();

  const docketInfoFor = (listing) => {
    if (!listing || typeof listing !== 'object') return null;
    const facts = listing.provenance?.sourceFacts || {};
    const fields = listing.provenance?.sourceFields || {};
    const sheriff = String(facts.sheriffNumber || fields['Sheriff #'] || listing.sheriffNumber || listing.raw?.sheriffNumber || '')
      .replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const court = String(listing.courtCaseNumber || facts.courtCaseNumber || fields['Court Case #'] || '')
      .replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const docketKey = sheriff.length >= 3 ? `SH:${sheriff}` : (court.length >= 3 ? `CC:${court}` : '');
    const state = String(listing.state || '').trim().toUpperCase();
    const county = String(listing.county || '').trim().toLowerCase();
    const addrKey = String(listing.address || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!docketKey || !state || !county || addrKey.length < 6) return null;
    return {
      groupKey: `${sourceKey}|${state}|${county}|${docketKey}|${addrKey}`,
      docket: sheriff || court,
      state,
      county,
    };
  };

  const pickPreferred = (a, b) => {
    const aAbsent = Boolean(a.provenance?.publisherAbsence);
    const bAbsent = Boolean(b.provenance?.publisherAbsence);
    if (aAbsent !== bAbsent) return aAbsent ? 1 : -1;
    const aDate = typeof a.saleDate === 'string' ? a.saleDate : '';
    const bDate = typeof b.saleDate === 'string' ? b.saleDate : '';
    if (aDate !== bDate) {
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate > bDate ? -1 : 1;
    }
    const aObs = a.sourceObservedAt ? Date.parse(a.sourceObservedAt) : 0;
    const bObs = b.sourceObservedAt ? Date.parse(b.sourceObservedAt) : 0;
    if (Number.isFinite(aObs) && Number.isFinite(bObs) && aObs !== bObs) return bObs - aObs;
    const aNum = Number((String(a.id || '').match(/(\d+)$/) || [])[1] || 0);
    const bNum = Number((String(b.id || '').match(/(\d+)$/) || [])[1] || 0);
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return bNum - aNum;
    return String(b.id || '').localeCompare(String(a.id || ''));
  };

  const seenScopes = new Map();
  const seenMap = new Map();
  for (const item of seenListings) {
    if (!item || typeof item !== 'object' || !item.id) continue;
    const info = docketInfoFor(item);
    if (!info) continue;
    seenMap.set(item.id, item);
    seenScopes.set(`${info.state}|${info.county}`, { state: info.state, county: info.county });
  }
  if (seenScopes.size === 0) return { superseded: 0, cleared: 0 };

  let candidates = [];
  if (db.isPg && db.pool) {
    const states = [...new Set([...seenScopes.values()].map((s) => s.state))];
    const counties = [...new Set([...seenScopes.values()].map((s) => s.county))];
    const res = await db.pool.query(
      `SELECT ${LISTING_SELECT} FROM listings
        WHERE source_key = $1
          AND UPPER(state) = ANY($2::text[])
          AND LOWER(COALESCE(county, '')) = ANY($3::text[])`,
      [sourceKey, states, counties],
    );
    const merged = new Map(res.rows.map((r) => [r.id, mapPgListingRow(r)]));
    for (const [id, item] of seenMap.entries()) {
      merged.set(id, { ...(merged.get(id) || {}), ...item });
    }
    candidates = [...merged.values()];
  } else if (db.memoryInventoryRequested()) {
    candidates = db.inMemoryData.listings.filter((row) => {
      if (!row || row.source !== sourceKey) return false;
      const st = String(row.state || '').trim().toUpperCase();
      const co = String(row.county || '').trim().toLowerCase();
      return seenScopes.has(`${st}|${co}`);
    });
  } else {
    return { superseded: 0, cleared: 0 };
  }

  const groups = new Map();
  for (const candidate of candidates) {
    const info = docketInfoFor(candidate);
    if (!info) continue;
    if (!groups.has(info.groupKey)) groups.set(info.groupKey, []);
    groups.get(info.groupKey).push({ record: candidate, info });
  }

  const toSupersede = [];
  const toClearIds = [];
  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    entries.sort((x, y) => pickPreferred(x.record, y.record));
    const winner = entries[0].record;
    if (winner.provenance?.supersededBy) toClearIds.push(winner.id);
    for (let i = 1; i < entries.length; i += 1) {
      const loser = entries[i].record;
      if (loser.provenance?.supersededBy?.byId === winner.id) continue;
      toSupersede.push({
        id: loser.id,
        marker: { byId: winner.id, at, reason: 'duplicate_docket_superseded', docket: entries[i].info.docket },
      });
    }
  }

  if (db.isPg && db.pool) {
    const BATCH_SIZE = 500;
    for (let i = 0; i < toSupersede.length; i += BATCH_SIZE) {
      const chunk = toSupersede.slice(i, i + BATCH_SIZE);
      await db.pool.query(
        `UPDATE listings
            SET provenance = jsonb_set(COALESCE(listings.provenance, '{}'::jsonb), '{supersededBy}', u.marker::jsonb, true),
                updated_at = NOW()
           FROM UNNEST($1::text[], $2::text[]) AS u(id, marker)
          WHERE listings.id = u.id`,
        [chunk.map((item) => item.id), chunk.map((item) => JSON.stringify(item.marker))],
      );
    }
    if (toClearIds.length > 0) {
      await db.pool.query(
        `UPDATE listings
            SET provenance = provenance - 'supersededBy',
                updated_at = NOW()
          WHERE id = ANY($1::text[])
            AND provenance ? 'supersededBy'`,
        [toClearIds],
      );
    }
    return { superseded: toSupersede.length, cleared: toClearIds.length };
  }

  const supersedeMap = new Map(toSupersede.map((x) => [x.id, x.marker]));
  const clearSet = new Set(toClearIds);
  let superseded = 0;
  let cleared = 0;
  for (let i = 0; i < db.inMemoryData.listings.length; i += 1) {
    const rec = db.inMemoryData.listings[i];
    if (!rec) continue;
    if (supersedeMap.has(rec.id)) {
      const provenance = { ...(rec.provenance || {}), supersededBy: supersedeMap.get(rec.id) };
      db.inMemoryData.listings[i] = { ...rec, provenance };
      superseded += 1;
    } else if (clearSet.has(rec.id) && rec.provenance?.supersededBy) {
      const provenance = { ...rec.provenance };
      delete provenance.supersededBy;
      db.inMemoryData.listings[i] = { ...rec, provenance };
      cleared += 1;
    }
  }
  return { superseded, cleared };
}

/**
 * Reconcile cross-source duplicate listings sharing (state, parcel_key, unit)
 * or normalized (state, zip5, street_core, unit). Distinct units at one address
 * keep separate keys so multi-unit / condo records never collapse together.
 */
async function reconcileCrossSourceDuplicates(db, options = {}) {
  const at = typeof options.at === 'string' && isFiniteTime(options.at)
    ? new Date(Date.parse(options.at)).toISOString()
    : new Date().toISOString();

  const extractUnitToken = (address) => {
    const m = String(address || '').match(/\b(?:apt|apartment|unit|ste|suite|lot|bldg|fl|floor|#)\s*([a-z0-9-]+)\b/i);
    return m ? m[1].toLowerCase() : '';
  };
  const normalizeStreetKey = (address) => String(address || '')
    .split(',')[0]
    .toLowerCase()
    .replace(/\b(?:apt|apartment|unit|ste|suite|lot|bldg|fl|floor|#)\s*[a-z0-9-]+\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const groupKeyFor = (row) => {
    if (!row || typeof row !== 'object') return null;
    const st = String(row.state || '').trim().toUpperCase();
    if (!st) return null;
    const unit = extractUnitToken(row.address);
    const pk = String(row.parcelKey || row.provenance?.parcelKey || '').trim();
    if (pk) return `PK|${st}|${pk}|${unit}`;
    const zip5 = String(row.zip || '').trim().slice(0, 5);
    const street = normalizeStreetKey(row.address);
    if (zip5.length === 5 && street.length >= 6) {
      return `ADDR|${st}|${zip5}|${street}|${unit}`;
    }
    return null;
  };

  const scoreWinner = (a, b) => {
    const aActive = a.status && a.status !== 'unknown' && !['sold', 'closed', 'cancelled'].includes(a.status) ? 1 : 0;
    const bActive = b.status && b.status !== 'unknown' && !['sold', 'closed', 'cancelled'].includes(b.status) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aEst = a.estLow != null && a.estHigh != null ? 1 : 0;
    const bEst = b.estLow != null && b.estHigh != null ? 1 : 0;
    if (aEst !== bEst) return bEst - aEst;
    const aBid = Number(a.openingBid) > 0 ? 1 : 0;
    const bBid = Number(b.openingBid) > 0 ? 1 : 0;
    if (aBid !== bBid) return bBid - aBid;
    const aGeo = a.lat != null && a.lng != null ? 1 : 0;
    const bGeo = b.lat != null && b.lng != null ? 1 : 0;
    if (aGeo !== bGeo) return bGeo - aGeo;
    const aObs = a.sourceObservedAt ? Date.parse(a.sourceObservedAt) : 0;
    const bObs = b.sourceObservedAt ? Date.parse(b.sourceObservedAt) : 0;
    if (Number.isFinite(aObs) && Number.isFinite(bObs) && aObs !== bObs) return bObs - aObs;
    return String(a.id || '').localeCompare(String(b.id || ''));
  };

  let rows = [];
  if (db.isPg && db.pool) {
    const res = await db.pool.query(
      `SELECT id, source_key AS "source", state, zip, address, parcel_key AS "parcelKey",
              status, opening_bid::float8 AS "openingBid", est_low::float8 AS "estLow",
              est_high::float8 AS "estHigh", latitude::float8 AS "lat", longitude::float8 AS "lng",
              source_observed_at::text AS "sourceObservedAt", provenance
         FROM listings
        WHERE NOT COALESCE(discovery_terminal, FALSE)`
    );
    rows = (res.rows || []).map(mapPgListingRow);
  } else if (db.memoryInventoryRequested()) {
    rows = db.inMemoryData.listings.filter((r) => r && !['sold', 'closed', 'cancelled'].includes(String(r.status || '').toLowerCase()));
  } else {
    return { superseded: 0, cleared: 0 };
  }

  const groups = new Map();
  for (const row of rows) {
    const k = groupKeyFor(row);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }

  const toSupersede = [];
  const toClearIds = [];
  for (const [k, entries] of groups.entries()) {
    if (entries.length < 2) continue;
    entries.sort(scoreWinner);
    const winner = entries[0];
    if (winner.provenance?.supersededBy) toClearIds.push(winner.id);
    for (let i = 1; i < entries.length; i += 1) {
      const loser = entries[i];
      if (loser.provenance?.supersededBy?.byId === winner.id) continue;
      toSupersede.push({
        id: loser.id,
        marker: { byId: winner.id, at, reason: 'cross_source_duplicate', key: k },
      });
    }
  }

  if (db.isPg && db.pool) {
    for (let i = 0; i < toSupersede.length; i += 500) {
      const chunk = toSupersede.slice(i, i + 500);
      await db.pool.query(
        `UPDATE listings
            SET provenance = jsonb_set(COALESCE(listings.provenance, '{}'::jsonb), '{supersededBy}', u.marker::jsonb, true),
                updated_at = NOW()
           FROM UNNEST($1::text[], $2::text[]) AS u(id, marker)
          WHERE listings.id = u.id`,
        [chunk.map((item) => item.id), chunk.map((item) => JSON.stringify(item.marker))],
      );
    }
    if (toClearIds.length > 0) {
      await db.pool.query(
        `UPDATE listings
            SET provenance = provenance - 'supersededBy',
                updated_at = NOW()
          WHERE id = ANY($1::text[])
            AND provenance ? 'supersededBy'`,
        [toClearIds],
      );
    }
    return { superseded: toSupersede.length, cleared: toClearIds.length };
  }

  const supersedeMap = new Map(toSupersede.map((x) => [x.id, x.marker]));
  const clearSet = new Set(toClearIds);
  let superseded = 0;
  let cleared = 0;
  for (let i = 0; i < db.inMemoryData.listings.length; i += 1) {
    const rec = db.inMemoryData.listings[i];
    if (!rec) continue;
    if (supersedeMap.has(rec.id)) {
      db.inMemoryData.listings[i] = { ...rec, provenance: { ...(rec.provenance || {}), supersededBy: supersedeMap.get(rec.id) } };
      superseded += 1;
    } else if (clearSet.has(rec.id) && rec.provenance?.supersededBy) {
      const provenance = { ...rec.provenance };
      delete provenance.supersededBy;
      db.inMemoryData.listings[i] = { ...rec, provenance };
      cleared += 1;
    }
  }
  return { superseded, cleared };
}

module.exports = {
  reconcilePublisherAbsence,
  reconcileDuplicateDockets,
  reconcileCrossSourceDuplicates,
};
