const { executeDag } = require('../swarm/dag-orchestrator');
const db = require('../db/client');
const { createHash } = require('node:crypto');
const { loadObservationsForRecord, loadCountyObservationStats } = require('../db/observations-persistence');
const { buildPropertyDossier } = require('../intelligence/dossier');
const { evaluateOpportunitySignals } = require('../intelligence/signals');
const { validateListingForIngestion } = require('../scrapers/validation');
const durableEvidence = require('../discovery/evidence');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');
const { auditDocketEvidence, summarizeDocketHits } = require('./verify-docket');
const { loadPeerListingsForDeedComps } = require('../enrichment/deed-comps');

function createPropertyIntelligenceHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const publicRecords = dependencies.buildPublicRecordEvidence || ((listing) => require('../public-records').buildPublicRecordEvidence(listing, { allowNetwork: true, timeoutMs: 7000 }));
  const evidenceStore = dependencies.durableEvidence || durableEvidence;
  const countyStatsLoader = dependencies.loadCountyObservationStats || loadCountyObservationStats;
  const peerListingsLoader = dependencies.loadPeerListingsForDeedComps || loadPeerListingsForDeedComps;
  const dagRunner = dependencies.executeDag || executeDag;
  const env = dependencies.env || process.env;
  const cache = new Map();
  const inFlight = new Map();
  return async function handlePropertyIntelligence(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Use GET to inspect or POST to research a property' });
    const url = new URL(req.url, 'http://localhost');
    const snapshotId = url.searchParams.get('snapshotId');
    if ((req.method === 'POST' || snapshotId) && !requireWorkspaceIdentity(req, res, env)) return;
    const id = req.method === 'GET' ? url.searchParams.get('listingId') : req.body?.listingId;
    if (typeof id !== 'string' || !id.trim() || id.length > 160) return res.status(400).json({ error: 'A listing ID is required' });
    try {
      const listing = await database.getListingById(id);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });
      if (req.method === 'GET' && snapshotId) {
        if (!/^[a-f0-9-]{36}$/i.test(snapshotId)) return res.status(400).json({ error: 'Invalid snapshot ID' });
        if (!database.isPg) return res.status(503).json({ error: 'Snapshot evidence requires PostgreSQL' });
        const snapshot = await evidenceStore.readSnapshot(database.pool, listing, snapshotId);
        return snapshot ? res.json(snapshot) : res.status(404).json({ error: 'Snapshot does not belong to this publisher record' });
      }
      const verified = (listing.provenance?.origin === 'live' || listing.provenance?.origin === 'email_notice') && validateListingForIngestion(listing).isValid
        && Date.parse(listing.sourceObservedAt || listing.provenance?.observedAt) <= Date.now() + 300_000;
      if (req.method === 'POST' && !verified) return res.status(422).json({ error: 'Public-record research requires a validated source-observed property record' });
      // Research belongs to this exact evidence and lookup input, even when an
      // upstream correction accidentally retains an observation timestamp.
      const key = createHash('sha256').update(JSON.stringify(listing)).digest('hex');
      let evidence = database.isPg ? await evidenceStore.readResearch(database.pool, listing.id, key) : cache.get(key);
      if (!verified) evidence = null;
      if (evidence && Date.now() - evidence.savedAt > 3600_000) { cache.delete(key); evidence = null; }
      if (req.method === 'POST' && !evidence) {
        if (!inFlight.has(key) && inFlight.size >= 2) return res.status(429).json({ error: 'Two property investigations are already running. Retry shortly.' });
        if (!inFlight.has(key)) {
          const dagAllowNetwork = dependencies.allowDagNetwork === true
            || (dependencies.allowDagNetwork !== false && (typeof dependencies.fetchFn === 'function' || process.env.NODE_ENV !== 'test'));
          const work = Promise.resolve().then(() => publicRecords(listing)).then(async (result) => {
            if (result && !result.docketVerification && (dependencies.courtlistenerClient || env.COURTLISTENER_VERIFY_DOCKET === '1')) {
              try {
                result.docketVerification = await auditDocketEvidence(listing, {
                  lookup: true,
                  courtlistenerClient: dependencies.courtlistenerClient,
                  env,
                });
              } catch {
                // Non-fatal: fail closed without blocking public-record research
              }
            }
            let cachedExecution = null;
            if (dagAllowNetwork) {
              try {
                const dagExec = await dagRunner({
                  ...listing,
                  property: listing,
                  parcel: result?.parcel || null,
                  countyParcel: result?.countyParcel || null,
                  municipalRecords: result?.municipalRecords || null,
                }, {
                  allowNetwork: true,
                  nodeTimeoutMs: 4500,
                  ...(dependencies.fetchFn ? { fetchFn: dependencies.fetchFn } : {}),
                });
                cachedExecution = {
                  success: dagExec.success,
                  dossier: dagExec.context.dossier || null,
                  telemetry: dagExec.telemetry,
                };
              } catch {
                cachedExecution = null;
              }
            }
            const toPersist = cachedExecution && result && typeof result === 'object'
              ? { ...result, _enrichmentExecution: cachedExecution }
              : result;
            if (database.isPg) await evidenceStore.saveResearch(database.pool, listing.id, key, toPersist);
            if (cache.size >= 100) cache.delete(cache.keys().next().value);
            const entry = { savedAt: Date.now(), result, enrichmentExecution: cachedExecution }; cache.set(key, entry); return entry;
          }).finally(() => inFlight.delete(key));
          inFlight.set(key, work);
        }
        evidence = await inFlight.get(key);
      }
      let observations = { records: {}, signals: [] }, historyUnavailable = false, stored = null;
      if (database.isPg && database.pool) {
        stored = await evidenceStore.loadEvidence(database.pool, listing);
        // source_observations (migrations 025 + 027) is the operational
        // history. While it is still filling for a record, the durable
        // discovery-evidence timeline supplies the evaluator's history — both
        // are Postgres, and both replay the same compareSnapshots classifier,
        // so a transition cannot be classified two different ways.
        const pgHistory = await loadObservationsForRecord(database.pool, listing);
        observations = Object.keys(pgHistory.records).length ? pgHistory : (stored.observations || observations);
      } else {
        // No Postgres: observation history is unavailable, and the dossier
        // must not read a stale local file to pretend otherwise.
        historyUnavailable = true;
      }
      let countyStats = null;
      if (database.isPg && database.pool && listing.state && listing.county) {
        try {
          countyStats = await countyStatsLoader(database.pool, { state: listing.state, county: listing.county });
        } catch {
          countyStats = null;
        }
      }
      const { observations: _observations, ...extensions } = stored || {};
      // Anonymous GET must never leak operator-funded research, durable
      // evidence extensions, or public-record lookup results.
      const authorized = requireWorkspaceIdentity.isAuthorized
        ? requireWorkspaceIdentity.isAuthorized(req, env)
        : Boolean(snapshotId || req.method === 'POST');
      const scopedObservations = authorized ? observations : { records: {}, signals: [] };

      // Non-PII postponement counts are safe to expose publicly on GET even when
      // raw observation history / personal names remain gated.
      const nonPiiTrajectory = evaluateOpportunitySignals(listing, {
        observations,
        publicRecords: null,
        historyUnavailable,
      }).trajectory;
      const postponementCounts = {
        priorPostponements: nonPiiTrajectory?.priorPostponements ?? 0,
        statutoryStayExhausted: Boolean(nonPiiTrajectory?.statutoryStayExhausted),
      };

      // Extract non-PII aggregate docket status for public & authorized views
      const rawDocketSummary = evidence?.result?.docketVerification?.docketSummary
        || stored?.docketVerification?.docketSummary
        || listing.docketSummary
        || listing.docketVerification?.docketSummary
        || null;
      const rawDocketHits = rawDocketSummary?.dockets
        || evidence?.result?.docketVerification?.matchedDockets
        || stored?.docketVerification?.matchedDockets
        || listing.courtlistenerDockets
        || listing.bankruptcyDockets
        || [];
      const docketSummary = rawDocketSummary || rawDocketHits.length > 0
        ? summarizeDocketHits(rawDocketHits, {
            checkedAt: rawDocketSummary?.checkedAt,
            lookupExecuted: Boolean(rawDocketSummary?.lookupExecuted),
          })
        : null;

      let peerListings = [];
      if (database.isPg && database.pool && listing.state && (listing.zip || listing.county)) {
        try {
          peerListings = await peerListingsLoader(database.pool, listing);
        } catch {
          peerListings = [];
        }
      }
      const rawPublicRecords = authorized ? (evidence?.result || null) : null;
      const persistedExecution = evidence?.enrichmentExecution || rawPublicRecords?._enrichmentExecution || null;
      const sanitizedPublicRecords = rawPublicRecords && typeof rawPublicRecords === 'object' && Object.hasOwn(rawPublicRecords, '_enrichmentExecution')
        ? (({ _enrichmentExecution: _omit, ...rest }) => rest)(rawPublicRecords)
        : rawPublicRecords;
      const publicPayload = buildPropertyDossier(listing, {
        observations: scopedObservations,
        publicRecords: sanitizedPublicRecords,
        historyUnavailable,
        countyStats,
        peerListings,
        docketSummary,
        trajectoryOverride: authorized ? null : postponementCounts,
      });
      if (!authorized) {
        return res.json({
          ...publicPayload,
          postponementCounts,
          historyUnavailable,
          researchRestricted: true,
        });
      }
      const enrichmentExecution = persistedExecution || await (async () => {
        const execution = await dagRunner({
          ...listing,
          property: listing,
          parcel: sanitizedPublicRecords?.parcel || null,
          countyParcel: sanitizedPublicRecords?.countyParcel || null,
          municipalRecords: sanitizedPublicRecords?.municipalRecords || null,
          observations: scopedObservations,
        }, { allowNetwork: false });
        return {
          success: execution.success,
          dossier: execution.context.dossier || null,
          telemetry: execution.telemetry,
        };
      })();
      return res.json({
        ...publicPayload,
        ...extensions,
        postponementCounts,
        historyUnavailable,
        enrichmentExecution,
      });
    } catch (error) {
      console.error('[Property Intelligence]', error.message);
      return res.status(503).json({ error: 'Property research is temporarily unavailable. Stored listing evidence was preserved.' });
    }
  };
}

module.exports = createPropertyIntelligenceHandler();
module.exports.createPropertyIntelligenceHandler = createPropertyIntelligenceHandler;
