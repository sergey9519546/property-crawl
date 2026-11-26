'use strict';

const db = require('../db/client');
const { presentedRunToken, tokensMatch } = require('./scrapers');
const { buildPropertyDossier } = require('../intelligence/dossier');
const research = require('../intelligence/research-cases');
const researchStore = require('../intelligence/research-store');
const { loadObservationsForRecord } = require('../db/observations-persistence');
const intake = require('../sources/intake');
const intakeStore = require('../sources/store');
const { memberAccountId } = require('../security/workspace-identity');
const { loadPeerListingsForDeedComps } = require('../enrichment/deed-comps');

function createWorkspaceHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const env = dependencies.env || process.env;
  const filePath = dependencies.filePath;
  const intakePath = dependencies.intakePath;
  const dossierBuilder = dependencies.buildPropertyDossier || buildPropertyDossier;
  const currentTime = () => typeof dependencies.now === 'function' ? dependencies.now() : dependencies.now;
  const evidenceById = dependencies.getEvidence || ((id) => {
    const record = intakeStore.loadStore(intakePath).records.find((item) => item.id === id);
    return record ? intake.getSummary(record) : null;
  });

  async function dossierFor(listing, timestamp) {
    let observations = { records: {}, signals: [] };
    let historyUnavailable = false;
    // Postgres is the only observation history. Without a reachable database
    // the dossier says historyUnavailable rather than reading a stale local
    // file, so a degraded evaluation can never pass for a current one.
    if (database.pool) {
      try { observations = await loadObservationsForRecord(database.pool, listing); }
      catch { historyUnavailable = true; }
    } else {
      historyUnavailable = true;
    }
    let peerListings = [];
    if (database.isPg && database.pool && listing.state && (listing.zip || listing.county)) {
      try { peerListings = await loadPeerListingsForDeedComps(database.pool, listing); }
      catch { peerListings = []; }
    }
    const dossierNow = timestamp instanceof Date ? timestamp.getTime()
      : (typeof timestamp === 'number' ? timestamp : Date.parse(timestamp));
    return { ...dossierBuilder(listing, { observations, now: dossierNow, historyUnavailable, peerListings }), historyUnavailable };
  }

  return async function handleWorkspace(req, res, urlInput) {
    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    const { resolveOperatorToken } = require('../security/operator-token');
    const configuredToken = resolveOperatorToken(env);
    if (!configuredToken) return res.status(503).json({
      error: 'Research workspace needs SCRAPER_ADMIN_TOKEN on the API server.',
      requiredConfiguration: 'SCRAPER_ADMIN_TOKEN',
    });
    if (!tokensMatch(presentedRunToken(req), configuredToken)) return res.status(401).json({ error: 'Source operator credential required' });

    const account = memberAccountId(req);
    if (req.headers && req.headers['x-pp-account'] && !account) {
      return res.status(400).json({ error: 'Invalid member account' });
    }
    const ownerId = account || 'operator';
    const usePg = Boolean(database && database.isPg && database.pool);
    const scopedFilePath = researchStore.resolveStorePath(filePath, ownerId);

    function operationOptions() {
      return { filePath: scopedFilePath, now: currentTime(), ownerId };
    }

    try {
      if (url.pathname === '/api/workspace/cases') {
        if (req.method === 'GET') {
          const filters = {
            state: url.searchParams.get('state') || undefined,
            sourceId: url.searchParams.get('sourceId') || undefined,
            listingId: url.searchParams.get('listingId') || undefined,
            limit: url.searchParams.get('limit'),
            offset: url.searchParams.get('offset'),
          };
          const result = usePg
            ? await researchStore.listCasesPg(database, ownerId, filters)
            : research.listCases(filters, { filePath: scopedFilePath });
          return res.json(result);
        }
        if (req.method === 'POST') {
          const listingId = req.body?.listingId;
          if (typeof listingId !== 'string' || !listingId.trim() || listingId.length > 256) {
            throw new research.ResearchCaseError('RESEARCH_INVALID', 'listingId is required');
          }
          const listing = await database.getListingById(listingId);
          if (!listing) return res.status(404).json({ error: 'Listing not found' });
          const configuredNow = currentTime();
          const timestamp = configuredNow === undefined ? Date.now() : configuredNow;
          const payload = {
            listing,
            sourceRef: req.body?.sourceRef,
            origin: req.body?.origin,
            dossier: await dossierFor(listing, timestamp),
            underwriteScenario: req.body?.underwriteScenario,
          };
          const result = usePg
            ? await researchStore.createCasePg(database, ownerId, payload, { now: timestamp })
            : research.createCase(payload, { filePath: scopedFilePath, now: timestamp });
          return res.status(result.created ? 201 : 200).json(result);
        }
        return res.status(405).json({ error: 'Use GET to list cases or POST to create one' });
      }

      if (url.pathname === '/api/workspace/import/preview' || url.pathname === '/api/workspace/import/commit') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST for browser import' });
        const options = { database, filePath: scopedFilePath, now: currentTime(), ownerId };
        if (url.pathname.endsWith('/preview')) {
          const preview = usePg
            ? await researchStore.previewBrowserImportPg(database, ownerId, req.body?.listingIds, options)
            : await research.previewBrowserImport(req.body?.listingIds, options);
          return res.json({ preview });
        }
        const commitOptions = {
          ...options,
          buildDossier: (listing, timestamp) => dossierFor(listing, timestamp),
        };
        const result = usePg
          ? await researchStore.commitBrowserImportPg(database, ownerId, req.body?.listingIds, req.body?.previewHash, commitOptions)
          : await research.commitBrowserImport(req.body?.listingIds, req.body?.previewHash, commitOptions);
        return res.json({ result });
      }

      if (url.pathname === '/api/workspace/alachua/pilot') {
        if (account) return res.status(403).json({ error: 'This workspace tool is for the operator account only' });
        if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST for the county reviewed-packet workflow' });
        const intakeId = req.body?.intakeId;
        if (!/^intake_[a-f0-9]{24}$/.test(intakeId || '')) {
          return res.status(400).json({ error: 'A reviewed county intake ID is required' });
        }
        const allowNetwork = req.body?.lookupParcels === true;
        const maxParcelLookups = allowNetwork ? Math.max(1, Math.min(20, Math.floor(Number(req.body?.maxParcelLookups) || 5))) : 5;
        const { buildAlachuaPilot } = require('../sources/alachua');
        const pilot = await buildAlachuaPilot(intakeId, {
          storePath: intakePath,
          allowNetwork,
          maxParcelLookups,
          now: currentTime(),
        });
        return res.json({ pilot });
      }

      const match = url.pathname.match(/^\/api\/workspace\/cases\/(rcase_[a-f0-9]{24})(?:\/(dossier|packet|evidence)(?:\/(intake_[a-f0-9]{24}))?)?$/);
      if (!match) return res.status(404).json({ error: 'Research-workspace endpoint not found' });
      const [, id, action, intakeId] = match;

      if (action === 'packet') {
        if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET to export a research packet' });
        const packet = usePg
          ? await researchStore.buildPacketPg(database, ownerId, id)
          : research.buildPacket(id, { filePath: scopedFilePath });
        const format = url.searchParams.get('format') || 'json';
        if (format === 'md' || format === 'markdown') {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="research-${id}.md"`);
          res.setHeader('X-Content-SHA256', packet.digest.value);
          return res.send(research.packetToMarkdown(packet));
        }
        if (format !== 'json') throw new research.ResearchCaseError('RESEARCH_FORMAT_INVALID', 'Packet format must be json or md');
        return res.json(packet);
      }

      if (action === 'dossier') {
        if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET to read a case dossier' });
        const result = usePg
          ? await researchStore.getCasePg(database, ownerId, id)
          : research.getCase(id, { filePath: scopedFilePath });
        return res.json(result);
      }

      if (action === 'evidence') {
        if (intakeId) {
          if (req.method !== 'DELETE') return res.status(405).json({ error: 'Use DELETE to unlink evidence' });
          const updated = usePg
            ? await researchStore.unlinkEvidencePg(database, ownerId, id, intakeId, req.body || {}, operationOptions())
            : research.unlinkEvidence(id, intakeId, req.body || {}, operationOptions());
          return res.json({ case: updated });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST to link reviewed evidence' });
        const evidence = evidenceById(req.body?.intakeId);
        if (!evidence) throw new research.ResearchCaseError('RESEARCH_EVIDENCE_NOT_FOUND', 'Evidence packet was not found');
        const updated = usePg
          ? await researchStore.linkEvidencePg(database, ownerId, id, evidence, req.body || {}, operationOptions())
          : research.linkEvidence(id, evidence, req.body || {}, operationOptions());
        return res.json({ case: updated });
      }

      if (req.method === 'GET') {
        const result = usePg
          ? await researchStore.getCasePg(database, ownerId, id)
          : research.getCase(id, { filePath: scopedFilePath });
        return res.json(result);
      }
      if (req.method === 'PATCH') {
        const updated = usePg
          ? await researchStore.updateCasePg(database, ownerId, id, req.body || {}, operationOptions())
          : research.updateCase(id, req.body || {}, operationOptions());
        return res.json({ case: updated });
      }
      return res.status(405).json({ error: 'Use GET or PATCH for this research case' });
    } catch (error) {
      if (error instanceof research.ResearchCaseError) {
        const status = error.code === 'RESEARCH_CASE_NOT_FOUND' || error.code === 'RESEARCH_EVIDENCE_NOT_FOUND' ? 404
          : error.code === 'RESEARCH_REVISION_CONFLICT' || error.code === 'RESEARCH_IMPORT_CHANGED' || error.code === 'RESEARCH_CASE_LIMIT' ? 409
            : error.code === 'RESEARCH_LISTING_UNVERIFIED' || error.code === 'RESEARCH_EVIDENCE_NOT_APPROVED' ? 422 : 400;
        return res.status(status).json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
      }
      console.error('[Research Workspace]', error.message);
      return res.status(503).json({ error: 'Research workspace is temporarily unavailable. Existing cases were preserved.' });
    }
  };
}

module.exports = createWorkspaceHandler();
module.exports.createWorkspaceHandler = createWorkspaceHandler;
