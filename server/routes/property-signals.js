'use strict';
const db = require('../db/client');
const { loadObservations } = require('../sources/observations');
const { evaluateOpportunitySignals } = require('../intelligence/signals');
const { loadObservationsForRecord, updateTriagePriority } = require('../db/observations-persistence');

function createPropertySignalsHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const readHistory = dependencies.loadObservations || loadObservations;
  const readDbHistory = dependencies.loadObservationsForRecord || loadObservationsForRecord;
  const persistTriagePriority = dependencies.persistTriagePriority
    || ((client, listingId, priority) => updateTriagePriority(client.pool, listingId, priority));

  return async function handlePropertySignals(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) {
      return res.status(405).json({ error: 'Use GET or POST to evaluate property opportunity signals' });
    }

    const url = new URL(req.url, 'http://localhost');
    const id = req.method === 'GET' ? url.searchParams.get('listingId') : req.body?.listingId;
    if (typeof id !== 'string' || !id.trim() || id.length > 160) {
      return res.status(400).json({ error: 'A listing ID is required' });
    }

    try {
      const listing = await database.getListingById(id);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });

      let observations = { records: {}, signals: [] };
      // A store that cannot be read is not the same as a store with no
      // history. Sibling routes (source-network, property-intelligence,
      // workspace) all report this; swallowing it here would let the
      // evaluation assert "no bid reduction observed" without ever looking.
      let historyUnavailable = false;
      let haveHistory = false;
      // PostgreSQL first: the source_observations table is the durable
      // mirror and outlives filesystem-store compaction. While it is still
      // filling, fall back to the filesystem store so no history is lost.
      if (database.isPg && database.pool) {
        try {
          observations = await readDbHistory(database.pool, listing);
          haveHistory = Object.keys(observations.records).length > 0;
        } catch (error) {
          console.warn('[Property Signals] PostgreSQL observation history unavailable:', error.message);
        }
      }
      if (!haveHistory) {
        try {
          observations = readHistory();
        } catch (_) {
          historyUnavailable = true;
        }
      }

      const evaluation = evaluateOpportunitySignals(listing, { observations, historyUnavailable });

      // Write-through refresh of the persisted triage_priority (migration
      // 025). The score is recomputed on every evaluation, so persisting the
      // just-computed value keeps the column current exactly when it was
      // produced. A score computed over an unreadable history is a degraded
      // view, not a fact about the listing, and is never persisted.
      if (!historyUnavailable && database.isPg && database.pool) {
        try {
          await persistTriagePriority(database, id, evaluation.triagePriority);
        } catch (error) {
          console.warn('[Property Signals] triage_priority was not persisted:', error.message);
        }
      }

      return res.json(evaluation);
    } catch (error) {
      console.error('[Property Signals]', error.message);
      return res.status(503).json({ error: 'Opportunity signal evaluation is temporarily unavailable.' });
    }
  };
}

module.exports = createPropertySignalsHandler();
module.exports.createPropertySignalsHandler = createPropertySignalsHandler;
