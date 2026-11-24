'use strict';

const { listingServingSourceSqlList } = require('../sources/catalog');
const { queryWithStatementTimeout } = require('./observations-persistence');

/**
 * Automatically purge non-live archive/seed rows, concluded/past-sale records,
 * and stale unrefreshed ServiceLink bulk while preserving active live-scraped inventory.
 */
async function purgeStaleListings(db, options = {}) {
  if (!db.isPg || !db.pool) {
    return { deleted: 0, observationsDeleted: 0, snapshotsDeleted: 0, skipped: 'postgres_unavailable' };
  }
  const batchSize = Math.min(2000, Math.max(1, Math.trunc(Number(options.batchSize) || 25)));
  const maxBatches = Math.min(500, Math.max(1, Math.trunc(Number(options.maxBatches) || 40)));
  const batchPauseMs = Math.min(1000, Math.max(0, Math.trunc(Number(options.batchPauseMs ?? 50))));
  const maxDurationMs = options.maxDurationMs === 0 ? 0 : Math.max(1000, Math.trunc(Number(options.maxDurationMs) || 25_000));
  const startedAt = Date.now();
  const budgetExceeded = () => maxDurationMs > 0 && (Date.now() - startedAt) >= maxDurationMs;
  const serviceLinkStaleDays = Math.max(1, Math.trunc(Number(options.serviceLinkStaleDays) || 5));
  const serviceLinkFreshWindowDays = Math.max(1, Math.trunc(Number(options.serviceLinkFreshWindowDays) || 2));
  const serviceLinkHardStaleDays = Math.max(serviceLinkStaleDays, Math.trunc(Number(options.serviceLinkHardStaleDays) || 7));
  const concludedGraceDays = Math.max(1, Math.trunc(Number(options.concludedGraceDays) || 1));
  const observationRetentionDays = Math.max(7, Math.trunc(Number(options.observationRetentionDays) || 10));
  const purgeQuery = (sql, params = [], timeoutMs = 12_000) => queryWithStatementTimeout(db.pool, sql, params, timeoutMs);

  let hasFreshServiceLinkLive = false;
  try {
    const freshCheck = await purgeQuery(
      `SELECT 1 FROM listings
        WHERE source_key = 'servicelink'
          AND discovery_is_live IS TRUE
          AND source_observed_at > NOW() - ($1::int * INTERVAL '1 day')
        LIMIT 1`,
      [serviceLinkFreshWindowDays],
    );
    hasFreshServiceLinkLive = freshCheck.rows.length > 0;
  } catch (freshErr) {
    console.warn('[DB] purgeStaleListings fresh ServiceLink check failed:', freshErr?.message || freshErr);
  }

  let freshFederalSources = [];
  try {
    const fedCheck = await purgeQuery(
      `SELECT DISTINCT source_key
         FROM listings
        WHERE source_key = ANY($1::text[])
          AND discovery_is_live IS TRUE
          AND source_observed_at > NOW() - INTERVAL '1 day'`,
      [['treasury', 'irs', 'gsa', 'usda']],
    );
    freshFederalSources = (fedCheck.rows || []).map((r) => r.source_key).filter(Boolean);
  } catch (fedErr) {
    console.warn('[DB] purgeStaleListings fresh federal check failed:', fedErr?.message || fedErr);
  }

  let deleted = 0;
  // Pass A: fast indexed purge of non-live, terminal, or stale ServiceLink bulk
  try {
    for (let batch = 0; batch < maxBatches && !budgetExceeded(); batch += 1) {
      const slRes = await purgeQuery(
        `DELETE FROM listings
          WHERE id IN (
            SELECT id
              FROM listings
             WHERE source_key = 'servicelink'
               AND (
                 ((NOT discovery_is_live)
                  AND source_key = 'servicelink')
                 OR discovery_terminal IS TRUE
                 OR COALESCE(source_observed_at, updated_at) < NOW() - ($3::int * INTERVAL '1 day')
                 OR (
                   $2::boolean
                   AND COALESCE(source_observed_at, updated_at) < NOW() - ($1::int * INTERVAL '1 day')
                 )
               )
             LIMIT $4
             FOR UPDATE SKIP LOCKED
          )`,
        [serviceLinkStaleDays, hasFreshServiceLinkLive, serviceLinkHardStaleDays, batchSize],
      );
      const slDeleted = slRes.rowCount || 0;
      deleted += slDeleted;
      if (slDeleted < batchSize) break;
      if (batchPauseMs > 0 && batch + 1 < maxBatches && !budgetExceeded()) {
        await new Promise((resolve) => setTimeout(resolve, batchPauseMs));
      }
    }
  } catch (purgeAErr) {
    console.warn('[DB] purgeStaleListings Pass A failed:', purgeAErr?.message || purgeAErr);
  }

  // Pass A2: remove non-listing DISCOVERY_ONLY sources (e.g. courtlistener, fl-dor-cadastral)
  try {
    for (let batch = 0; batch < maxBatches && !budgetExceeded(); batch += 1) {
      const nonServingRes = await purgeQuery(
        `DELETE FROM listings
          WHERE id IN (
            SELECT id
              FROM listings
             WHERE source_key NOT IN (${listingServingSourceSqlList()})
             LIMIT $1
             FOR UPDATE SKIP LOCKED
          )`,
        [batchSize],
      );
      const nonServingDeleted = nonServingRes.rowCount || 0;
      deleted += nonServingDeleted;
      if (nonServingDeleted < batchSize) break;
      if (batchPauseMs > 0 && batch + 1 < maxBatches && !budgetExceeded()) {
        await new Promise((resolve) => setTimeout(resolve, batchPauseMs));
      }
    }
  } catch (passA2Err) {
    console.warn('[DB] purgeStaleListings Pass A2 failed:', passA2Err?.message || passA2Err);
  }

  // Pass B: purge terminal, non-live, past-sale, and 30d stale rows without scanning TOAST provenance JSONB
  try {
    for (let batch = 0; batch < maxBatches && !budgetExceeded(); batch += 1) {
      const deletedRes = await purgeQuery(
        `DELETE FROM listings
          WHERE id IN (
            SELECT id
              FROM listings
             WHERE discovery_terminal IS TRUE
                OR NOT discovery_is_live
                OR LOWER(COALESCE(lifecycle_status, '')) IN ('sold', 'closed', 'ended', 'completed', 'cancelled', 'retired', 'withdrawn')
                OR LOWER(COALESCE(status, '')) IN ('sold', 'closed', 'ended', 'completed', 'cancelled', 'retired', 'withdrawn')
                OR (
                  sale_date IS NOT NULL
                  AND sale_date < CURRENT_DATE - ($1::int * INTERVAL '1 day')
                  AND LOWER(COALESCE(status, '')) NOT IN ('postponed', 'adjourned', 'stayed')
                  AND LOWER(COALESCE(lifecycle_status, '')) NOT IN ('postponed', 'adjourned', 'stayed')
                )
                OR (
                  sale_date IS NOT NULL
                  AND sale_date < CURRENT_DATE - INTERVAL '45 days'
                )
                OR (
                  source_key = 'servicelink'
                  AND (
                    COALESCE(source_observed_at, updated_at) < NOW() - ($4::int * INTERVAL '1 day')
                    OR (
                      $3::boolean
                      AND COALESCE(source_observed_at, updated_at) < NOW() - ($2::int * INTERVAL '1 day')
                    )
                  )
                )
                OR (
                  source_key = ANY($6::text[])
                  AND COALESCE(source_observed_at, updated_at) < NOW() - INTERVAL '3 days'
                )
                OR COALESCE(source_observed_at, updated_at) < NOW() - INTERVAL '30 days'
             LIMIT $5
             FOR UPDATE SKIP LOCKED
          )`,
        [
          concludedGraceDays,
          serviceLinkStaleDays,
          hasFreshServiceLinkLive,
          serviceLinkHardStaleDays,
          batchSize,
          freshFederalSources,
        ],
      );
      const batchDeleted = deletedRes.rowCount || 0;
      deleted += batchDeleted;
      if (batchDeleted < batchSize) break;
      if (batchPauseMs > 0 && batch + 1 < maxBatches && !budgetExceeded()) {
        await new Promise((resolve) => setTimeout(resolve, batchPauseMs));
      }
    }
  } catch (passBErr) {
    console.warn('[DB] purgeStaleListings Pass B failed:', passBErr?.message || passBErr);
  }

  let observationsDeleted = 0;
  const obsBatchSize = Math.min(5000, Math.max(1000, batchSize * 40));
  try {
    for (let batch = 0; batch < maxBatches && !budgetExceeded(); batch += 1) {
      const obsRes = await purgeQuery(
        `DELETE FROM source_observations
          WHERE id IN (
            SELECT so.id
              FROM source_observations so
             WHERE (so.source_key = 'servicelink' AND so.observed_at < NOW() - ($2::int * INTERVAL '1 day'))
                OR so.observed_at < NOW() - ($1::int * INTERVAL '1 day')
             LIMIT $3
          )`,
        [observationRetentionDays, serviceLinkFreshWindowDays, obsBatchSize],
      );
      const batchObs = obsRes.rowCount || 0;
      observationsDeleted += batchObs;
      if (batchObs < obsBatchSize) break;
      if (batchPauseMs > 0 && batch + 1 < maxBatches && !budgetExceeded()) {
        await new Promise((resolve) => setTimeout(resolve, batchPauseMs));
      }
    }
    for (let batch = 0; batch < Math.min(maxBatches, 15) && !budgetExceeded(); batch += 1) {
      const orphanRes = await purgeQuery(
        `DELETE FROM source_observations
          WHERE id IN (
            SELECT so.id
              FROM source_observations so
             WHERE so.listing_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.id = so.listing_id)
             LIMIT $1
          )`,
        [obsBatchSize],
      );
      const batchOrphan = orphanRes.rowCount || 0;
      observationsDeleted += batchOrphan;
      if (batchOrphan < obsBatchSize) break;
      if (batchPauseMs > 0 && batch + 1 < Math.min(maxBatches, 15) && !budgetExceeded()) {
        await new Promise((resolve) => setTimeout(resolve, batchPauseMs));
      }
    }
    // Bounded consecutive-duplicate compaction on source_observations (>2 obs per record)
    for (let batch = 0; batch < Math.min(maxBatches, 10) && !budgetExceeded(); batch += 1) {
      const dupRes = await purgeQuery(
        `WITH multi AS (
           SELECT source_key, record_id
             FROM source_observations
            GROUP BY source_key, record_id
           HAVING count(*) > 2
            ORDER BY count(*) DESC
            LIMIT 200
         ),
         ordered AS (
           SELECT so.id,
                  so.opening_bid,
                  so.sale_date,
                  so.status,
                  so.deposit,
                  so.notice_sha256,
                  LAG(so.id) OVER w AS prev_id,
                  LAG(so.opening_bid) OVER w AS prev_bid,
                  LAG(so.sale_date) OVER w AS prev_sale_date,
                  LAG(so.status) OVER w AS prev_status,
                  LAG(so.deposit) OVER w AS prev_deposit,
                  LAG(so.notice_sha256) OVER w AS prev_sha,
                  LEAD(so.id) OVER w AS next_id
             FROM source_observations so
             JOIN multi m ON m.source_key = so.source_key AND m.record_id = so.record_id
            WINDOW w AS (PARTITION BY so.source_key, so.record_id ORDER BY so.observed_at ASC, so.id ASC)
         ),
         redundant AS (
           SELECT id
             FROM ordered
            WHERE prev_id IS NOT NULL
              AND next_id IS NOT NULL
              AND opening_bid IS NOT DISTINCT FROM prev_bid
              AND sale_date IS NOT DISTINCT FROM prev_sale_date
              AND status IS NOT DISTINCT FROM prev_status
              AND deposit IS NOT DISTINCT FROM prev_deposit
              AND notice_sha256 IS NOT DISTINCT FROM prev_sha
            LIMIT $1
         )
         DELETE FROM source_observations
          WHERE id IN (SELECT id FROM redundant)`,
        [obsBatchSize],
      );
      const batchDups = dupRes.rowCount || 0;
      observationsDeleted += batchDups;
      if (batchDups < obsBatchSize) break;
      if (batchPauseMs > 0 && batch + 1 < Math.min(maxBatches, 10) && !budgetExceeded()) {
        await new Promise((resolve) => setTimeout(resolve, batchPauseMs));
      }
    }
  } catch (obsErr) {
    console.warn('[DB] purgeStaleListings observation cleanup failed:', obsErr?.message || obsErr);
  }

  if (observationsDeleted > 0 && options.skipVacuum !== true && !budgetExceeded()) {
    try {
      await db.pool.query('VACUUM (ANALYZE) source_observations');
    } catch {
      // Non-fatal inside transaction pools or read-only replicas
    }
  }

  let snapshotsDeleted = 0;
  try {
    const idxCheck = await purgeQuery(
      `SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'discovery_observations'
          AND indexname = 'idx_discovery_observations_snapshot'
        LIMIT 1`,
      [],
      5000,
    );
    if (idxCheck.rows.length > 0 && !budgetExceeded()) {
      for (let batch = 0; batch < maxBatches && !budgetExceeded(); batch += 1) {
        await purgeQuery(
          `DELETE FROM discovery_observations
            WHERE snapshot_id IN (
              SELECT snap.id
                FROM discovery_snapshots snap
               WHERE (snap.source_key = 'servicelink' AND snap.observed_at < NOW() - ($2::int * INTERVAL '1 day'))
                  OR snap.observed_at < NOW() - ($1::int * INTERVAL '1 day')
               LIMIT $3
            )`,
          [observationRetentionDays, serviceLinkFreshWindowDays, batchSize],
        );
        const snapRes = await purgeQuery(
          `DELETE FROM discovery_snapshots
            WHERE id IN (
              SELECT snap.id
                FROM discovery_snapshots snap
               WHERE (
                 (snap.source_key = 'servicelink' AND snap.observed_at < NOW() - ($2::int * INTERVAL '1 day'))
                 OR snap.observed_at < NOW() - ($1::int * INTERVAL '1 day')
               )
                 AND NOT EXISTS (SELECT 1 FROM discovery_observations o WHERE o.snapshot_id = snap.id)
               LIMIT $3
            )`,
          [observationRetentionDays, serviceLinkFreshWindowDays, batchSize],
        );
        const batchSnaps = snapRes.rowCount || 0;
        snapshotsDeleted += batchSnaps;
        if (batchSnaps < batchSize) break;
        if (batchPauseMs > 0 && batch + 1 < maxBatches) {
          await new Promise((resolve) => setTimeout(resolve, batchPauseMs));
        }
      }
    }
    await db.pool.query(
      `DELETE FROM discovery_checkpoints
        WHERE source_key = 'servicelink'
          AND updated_at < NOW() - INTERVAL '2 days'`,
    );
  } catch (snapErr) {
    console.warn('[DB] purgeStaleListings snapshot/checkpoint cleanup failed:', snapErr?.message || snapErr);
  }

  let historyDeleted = 0;
  try {
    const histBatchSize = Math.min(2000, Math.max(batchSize, 200));
    for (let batch = 0; batch < Math.min(maxBatches, 10) && !budgetExceeded(); batch += 1) {
      const histRes = await purgeQuery(
        `DELETE FROM listing_history
          WHERE id IN (
            SELECT id
              FROM listing_history
             WHERE recorded_at < NOW() - INTERVAL '21 days'
             LIMIT $1
          )`,
        [histBatchSize],
      );
      const batchHist = histRes.rowCount || 0;
      historyDeleted += batchHist;
      if (batchHist < histBatchSize) break;
      if (batchPauseMs > 0 && batch + 1 < Math.min(maxBatches, 10) && !budgetExceeded()) {
        await new Promise((resolve) => setTimeout(resolve, batchPauseMs));
      }
    }
  } catch (histErr) {
    console.warn('[DB] purgeStaleListings listing_history cleanup failed:', histErr?.message || histErr);
  }

  if (deleted > 0) {
    await db.pool.query("SELECT nextval('discovery_listing_revision_seq')").catch(() => {});
  }
  return { deleted, observationsDeleted, snapshotsDeleted, historyDeleted };
}

module.exports = {
  purgeStaleListings,
};
