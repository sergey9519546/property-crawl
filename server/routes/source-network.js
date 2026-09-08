const db = require('../db/client');
const scheduler = require('../scrapers/scheduler');
const { presentedRunToken, tokensMatch } = require('./scrapers');
const { loadObservations, recordSourceRun } = require('../sources/observations');
const { buildSourceNetwork, enrolledSources } = require('../sources/network');
const { attachDiscoveryCoverage } = require('../sources/discovery-coverage');

function createSourceNetworkHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const collector = dependencies.scheduler || scheduler;
  const observations = dependencies.loadObservations || loadObservations;
  const recordRun = dependencies.recordSourceRun || recordSourceRun;
  // The production scheduler owns this singleton. Tests and alternative
  // schedulers may inject a coordinator explicitly.
  const coordinator = dependencies.coordinator || collector.collectionCoordinator || null;
  const evidenceCollectors = dependencies.evidenceCollectors || { 'federal-register': (options) => require('../sources/federal-register').collectFederalNotices(options) };
  const evidenceJobs = new Set();
  return async function handleSourceNetwork(req, res) {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    const catalog = dependencies.catalog || require('../sources/catalog').SOURCE_CATALOG;
    const intake = dependencies.intake || require('../sources/intake');
    const env = dependencies.env || process.env;
    try {
      if (req.method === 'GET' && url.pathname === '/api/source-network') {
        const inventory = await database.getListings({ limit: 10000 });
        let packets = [], evidenceQueueError = false, historyUnavailable = false;
        const completeEvidenceSummaries = typeof intake.listEvidenceSummaries === 'function';
        let history;
        try {
          packets = completeEvidenceSummaries ? intake.listEvidenceSummaries() : intake.listEvidence({ limit: 200 });
          if (!Array.isArray(packets)) throw new Error('Evidence summaries are unavailable');
        } catch (_) { packets = []; evidenceQueueError = true; }
        try { history = observations(); } catch (_) { historyUnavailable = true; history = { runs: {}, records: {}, signals: [] }; }
        const evidenceSummary = {};
        for (const packet of packets) { evidenceSummary[packet.sourceId] ||= { count: 0 }; evidenceSummary[packet.sourceId].count++; }
        const network = buildSourceNetwork({ catalog: [...catalog, ...enrolledSources(packets, catalog)], adapters: collector.realScrapers, observations: history, listings: inventory.listings, evidenceCollectors: Object.keys(evidenceCollectors), evidenceSummary });
        if (historyUnavailable) for (const source of network.sources) { if (source.automated) source.status = 'history_unavailable'; }
        const discoveryNetwork = await attachDiscoveryCoverage(network, database, env);
        return res.json({ ...discoveryNetwork, inventoryTruncated: !database.pool && inventory.total > inventory.listings.length, evidenceSummaryLimited: !completeEvidenceSummaries && packets.length === 200, evidenceQueueError, historyUnavailable, collectionRunning: collector.isRunning || evidenceJobs.size > 0 });
      }
      const jobMatch = url.pathname.match(/^\/api\/source-network\/jobs\/(job_[a-f0-9]{24})$/);
      // Raw evidence and operational mutations use the existing operator credential.
      const configuredToken = String(env.SCRAPER_ADMIN_TOKEN || '').trim();
      if (!configuredToken) return res.status(503).json({ error: 'Source operations need SCRAPER_ADMIN_TOKEN on the API server. Public coverage remains available.' });
      if (!tokensMatch(presentedRunToken(req), configuredToken)) return res.status(401).json({ error: 'Source operator credential required' });
      if (req.method === 'GET' && url.pathname === '/api/source-network/jobs') {
        if (!coordinator) return res.json({ items: [], total: 0, available: false });
        return res.json({ ...await coordinator.store.list(url.searchParams.get('limit')), available: true });
      }
      if (req.method === 'GET' && jobMatch) {
        if (!coordinator) return res.status(404).json({ error: 'Collection jobs are unavailable' });
        const job = await coordinator.store.get(jobMatch[1]);
        return job ? res.json({ job }) : res.status(404).json({ error: 'Collection job was not found' });
      }
      if (url.pathname === '/api/source-network/intake') {
        if (req.method === 'GET') return res.json({ items: intake.listEvidence({ sourceId: url.searchParams.get('sourceId') || undefined, includeContent: url.searchParams.get('includeContent') === 'true', limit: 50 }) });
        if (req.method === 'POST') {
          const validation = intake.validateSubmission(req.body || {});
          if (!validation.isValid) return res.status(400).json({ error: 'Evidence packet needs corrections', details: validation.errors });
          const result = intake.submitEvidence(req.body);
          return res.status(result.deduplicated ? 200 : 201).json({ ...result, message: 'Evidence saved for review. It has not been published as a property listing.' });
        }
      }
      if (url.pathname === '/api/source-network/review' && req.method === 'POST') {
        const { id, ...review } = req.body || {};
        if (!/^intake_[a-f0-9]{24}$/.test(id || '') || !['approve', 'reject'].includes(review.decision)) return res.status(400).json({ error: 'Evidence ID and an approve or reject decision are required' });
        return res.json({ record: intake.reviewEvidence(id, review) });
      }
      if (url.pathname === '/api/source-network/run' && req.method === 'POST') {
        if (req.body?.scope === 'all') {
          if (req.body?.sourceId != null) return res.status(400).json({ error: 'Choose either scope all or one source, not both' });
          if (!collector.networkEnabled) return res.status(503).json({ error: 'Network collection is disabled in this environment' });
          if (!coordinator) return res.status(503).json({ error: 'Collection jobs are unavailable' });
          let sourceIds;
          if (env.DISCOVERY_MODE === 'advanced') {
            const rolloutStore = dependencies.discoveryStore || require('../discovery/store').createDiscoveryStore(database);
            sourceIds = await rolloutStore.promotedSources();
            if (!sourceIds.length) return res.status(409).json({ error: 'No sources have passed the collection release gate. Review individual sources before enabling a full cycle.' });
          }
          const job = await coordinator.start({ ...(sourceIds ? { sourceIds } : {}), trigger: 'source_network', idempotencyKey: req.body?.idempotencyKey });
          return res.status(202).json({ status: 'collecting', sourceId: null, accepted: true, job });
        }
        const source = catalog.find((item) => item.id === req.body?.sourceId);
        if (source && evidenceCollectors[source.id]) {
          if (!collector.networkEnabled) return res.status(503).json({ error: 'Network collection is disabled in this environment' });
          if (evidenceJobs.has(source.id)) return res.status(409).json({ error: 'This evidence collection is already running' });
          evidenceJobs.add(source.id);
          const startedAt = Date.now();
          Promise.resolve().then(() => evidenceCollectors[source.id]({ perPage: 10, daysBack: 30 }))
            .then((result) => recordRun(source.id, { listings: [], evidenceCount: result.submitted, error: null, durationMs: Date.now() - startedAt }))
            .catch((error) => {
              try { recordRun(source.id, { listings: [], error: error.message, durationMs: Date.now() - startedAt }); }
              catch (storeError) { console.error('[Source Network] Evidence history unavailable:', storeError.message); }
            }).finally(() => evidenceJobs.delete(source.id));
          return res.status(202).json({ status: 'collecting', sourceId: source.id, message: 'Collecting official notices into the evidence review queue.' });
        }
        if (!source?.adapterKey || !collector.realScraperKeys.has(source.adapterKey)) return res.status(400).json({ error: 'This source uses the evidence import workflow', workflow: source?.workflow || null });
        if (!collector.networkEnabled) return res.status(503).json({ error: 'Network collection is disabled in this environment' });
        if (coordinator) {
          const job = await coordinator.start({
            sourceIds: [source.adapterKey], trigger: 'source_network',
            idempotencyKey: req.body?.idempotencyKey,
          });
          return res.status(202).json({ status: 'collecting', sourceId: source.id, accepted: true, job });
        }
        if (collector.isRunning) return res.status(409).json({ error: 'A collection is already running; refresh coverage to see its result' });
        collector.runAll({ sourceIds: [source.adapterKey] }).catch((error) => console.error('[Source Network] Collection failed:', error.message));
        return res.status(202).json({ status: 'collecting', sourceId: source.id, accepted: true });
      }
      return res.status(404).json({ error: 'Source network endpoint not found' });
    } catch (error) {
      console.error('[Source Network]', error.message);
      return res.status(String(error.code || '').startsWith('SOURCE_INTAKE_INVALID') ? 400 : 503).json({ error: 'Source operation could not be completed' });
    }
  };
}

module.exports = createSourceNetworkHandler();
module.exports.createSourceNetworkHandler = createSourceNetworkHandler;
