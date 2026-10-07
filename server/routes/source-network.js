const db = require('../db/client');
const { scanAllListings } = require('../db/listings-scan');
const scheduler = require('../scrapers/scheduler');
const { presentedRunToken, tokensMatch } = require('./scrapers');
const { loadObservations, recordSourceRun } = require('../sources/observations');
const { buildSourceNetwork, enrolledSources } = require('../sources/network');
const { attachDiscoveryCoverage } = require('../sources/discovery-coverage');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');
const { resolveOperatorToken } = require('../security/operator-token');
// Cached at module load so the per-request path doesn't pay require-resolve cost
// on every /api/source-network/unbrowse/intake or /unbrowse/status hit. The tool
// is small but its module-graph walks scripts/, and Node caches modules anyway,
// so this is mostly about making the dependency obvious in one place.
const unbrowseTool = require('../../scripts/crawler-tools-unbrowse.cjs');

function createSourceNetworkHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const collector = dependencies.scheduler || scheduler;
  const observations = dependencies.loadObservations || loadObservations;
  const recordRun = dependencies.recordSourceRun || recordSourceRun;
  // The production scheduler owns this singleton. Tests and alternative
  // schedulers may inject a coordinator explicitly.
  const coordinator = dependencies.coordinator || collector.collectionCoordinator || null;
  // The release gate lives on the discovery store. It was never read from
  // dependencies, so scope=all had no way to ask which sources were promoted.
  const discoveryStore = dependencies.discoveryStore || null;
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
        // A cap of 10,000 against a 9,831-row store is correct today and silently
        // wrong at 10,001. The store grows every collection cycle, so read to
        // the end and report whether we got it all.
        const scanned = await scanAllListings(database, {}, { pageSize: 10000 });
        const inventory = scanned.pool;
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
        const network = buildSourceNetwork({ catalog: [...catalog, ...enrolledSources(packets, catalog)], adapters: collector.realScrapers, observations: history, listings: inventory, evidenceCollectors: Object.keys(evidenceCollectors), evidenceSummary });
        if (historyUnavailable) for (const source of network.sources) { if (source.automated) source.status = 'history_unavailable'; }
        const discoveryNetwork = await attachDiscoveryCoverage(network, database, env);
        return res.json({ ...discoveryNetwork, inventoryTruncated: scanned.truncated, evidenceSummaryLimited: !completeEvidenceSummaries && packets.length === 200, evidenceQueueError, historyUnavailable, collectionRunning: collector.isRunning || evidenceJobs.size > 0 });
      }
      if (req.method === 'GET' && url.pathname === '/api/source-network/jobs') {
        if (!requireWorkspaceIdentity(req, res, env)) return;
        if (!coordinator) return res.json({ items: [], total: 0, available: false });
        const jobs = await coordinator.store.list(url.searchParams.get('limit'));
        return res.json({ ...jobs, available: true });
      }
      const jobMatch = url.pathname.match(/^\/api\/source-network\/jobs\/(job_[a-f0-9]{24})$/);
      if (req.method === 'GET' && jobMatch) {
        if (!requireWorkspaceIdentity(req, res, env)) return;
        if (!coordinator) return res.status(404).json({ error: 'Collection jobs are unavailable' });
        const job = await coordinator.store.get(jobMatch[1]);
        return job ? res.json({ job }) : res.status(404).json({ error: 'Collection job was not found' });
      }
      // Raw evidence and operational mutations use the existing operator credential.
      // resolveOperatorToken honours the documented PROPERTY_OPERATOR_SECRET alias,
      // which is the name Render generates; reading SCRAPER_ADMIN_TOKEN alone would
      // 503 every source operation on a correctly-configured Render deployment.
      const configuredToken = resolveOperatorToken(env);
      if (!configuredToken) return res.status(503).json({ error: 'Source operations need SCRAPER_ADMIN_TOKEN on the API server. Public coverage remains available.' });
      if (!tokensMatch(presentedRunToken(req), configuredToken)) return res.status(401).json({ error: 'Source operator credential required' });
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
      if (url.pathname === '/api/source-network/onboarding' && req.method === 'GET') {
        return res.json({ items: (dependencies.onboarding || require('../discovery/onboarding-pass')).listCachedSources() });
      }
      if (url.pathname === '/api/source-network/onboarding' && req.method === 'POST') {
        const body = req.body || {};
        const onboarding = dependencies.onboarding || require('../discovery/onboarding-pass');
        const summary = await onboarding.runOnboardingPass({
          sources: Array.isArray(body.sources) ? body.sources : null,
          env: process.env
        });
        return res.json(summary);
      }
      if (url.pathname === '/api/source-network/unbrowse/intake' && req.method === 'POST') {
        // HTTP counterpart of `scripts/crawler-tools-unbrowse.cjs intake-candidate`.
        // Validates the body against the unbrowse route-candidate schema and,
        // on success, hands it to the same source-intake store the CLI uses.
        // Auth is required because the intake store mutates evidence packets.
        const intakeAdapter = dependencies.intake || require('../sources/intake');
        let validated;
        try { validated = unbrowseTool.validateCandidate(req.body || {}); }
        catch (validationError) {
          return res.status(400).json({
            error: 'Unbrowse route candidate was rejected',
            reason: validationError.message,
            provenance: 'unbrowse-route-candidate',
            candidateSchema: unbrowseTool.CANDIDATE_SCHEMA
          });
        }
        try {
          const result = unbrowseTool.candidateToIntake(req.body, { intake: intakeAdapter });
          return res.status(result.deduplicated ? 200 : 201).json({
            ...result,
            schemaVersion: validated.schemaVersion,
            source: validated.source,
            endpointUrl: validated.evidence.endpointUrl
          });
        } catch (intakeError) {
          return res.status(400).json({
            error: 'Unbrowse intake could not be saved',
            reason: intakeError.message,
            provenance: 'unbrowse-route-candidate'
          });
        }
      }
      if (url.pathname === '/api/source-network/unbrowse/status' && req.method === 'GET') {
        // Diagnostics only: the wrapper never executes Unbrowse and never
        // contacts hosted services from this route. Token still required so
        // the route does not leak installation probe results to anonymous
        // callers. The tool reads UNBROWSE_PACKAGE_ROOT from process.env and
        // falls back to UNBROWSE_CONFIG_DIR for the consent directory; we
        // forward both so dependency-injected env values drive the probe.
        const previousRoot = process.env.UNBROWSE_PACKAGE_ROOT;
        const syntheticRoot = env.UNBROWSE_PACKAGE_ROOT;
        if (syntheticRoot) process.env.UNBROWSE_PACKAGE_ROOT = syntheticRoot;
        const configDir = env.UNBROWSE_CONFIG_DIR || unbrowseTool.DEFAULT_CONFIG_DIR;
        try { return res.json(unbrowseTool.inspectInstallation(undefined, configDir)); }
        finally {
          if (previousRoot === undefined) delete process.env.UNBROWSE_PACKAGE_ROOT;
          else process.env.UNBROWSE_PACKAGE_ROOT = previousRoot;
        }
      }
      if (url.pathname === '/api/source-network/run' && req.method === 'POST') {
        if (req.body?.scope === 'all') {
          if (req.body?.sourceId != null) return res.status(400).json({ error: 'Choose either scope all or one source, not both' });
          if (!collector.networkEnabled) return res.status(503).json({ error: 'Network collection is disabled in this environment' });
          if (!coordinator) return res.status(503).json({ error: 'Collection jobs are unavailable' });
          // The release gate decides which sources have earned promotion, so where
          // promotion exists it must bound a bulk collection. Consult it before
          // starting anything: an empty gate has to fail closed, and a populated
          // one has to restrict the job to exactly those sources.
          //
          // This was missing. scope=all called coordinator.start() with no
          // sourceIds, which means no restriction at all -- every registered
          // adapter, promoted or not -- and the route answered 202.
          //
          // Scoped to deployments that actually have a discovery store. Promotion
          // is a concept of the advanced discovery mode; with no store there is
          // no promotion record to gate on, and refusing to collect at all would
          // be a different failure rather than a safer one.
          let sourceIds;
          if (discoveryStore && typeof discoveryStore.promotedSources === 'function') {
            const promoted = await discoveryStore.promotedSources();
            sourceIds = Array.isArray(promoted) ? promoted.filter(Boolean) : [];
            if (!sourceIds.length) {
              return res.status(409).json({ error: 'No source has passed the release gate; promote a source before running a full collection' });
            }
          }
          const job = await coordinator.start({ trigger: 'source_network', ...(sourceIds ? { sourceIds } : {}), idempotencyKey: req.body?.idempotencyKey });
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
