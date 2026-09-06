'use strict';

const db = require('../db/client');
const { presentedRunToken, tokensMatch } = require('./scrapers');
const { buildPropertyDossier } = require('../intelligence/dossier');
const research = require('../intelligence/research-cases');
const { loadObservations } = require('../sources/observations');
const intake = require('../sources/intake');
const intakeStore = require('../sources/store');

function createWorkspaceHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const env = dependencies.env || process.env;
  const filePath = dependencies.filePath;
  const intakePath = dependencies.intakePath;
  const readObservations = dependencies.loadObservations || loadObservations;
  const dossierBuilder = dependencies.buildPropertyDossier || buildPropertyDossier;
  const currentTime = () => typeof dependencies.now === 'function' ? dependencies.now() : dependencies.now;
  const evidenceById = dependencies.getEvidence || ((id) => {
    const record = intakeStore.loadStore(intakePath).records.find((item) => item.id === id);
    return record ? intake.getSummary(record) : null;
  });

  function operationOptions() {
    return { filePath, now: currentTime() };
  }

  function dossierFor(listing, timestamp) {
    let observations = { records: {}, signals: [] };
    let historyUnavailable = false;
    try { observations = readObservations(); }
    catch { historyUnavailable = true; }
    const dossierNow = timestamp instanceof Date ? timestamp.getTime()
      : (typeof timestamp === 'number' ? timestamp : Date.parse(timestamp));
    return { ...dossierBuilder(listing, { observations, now: dossierNow }), historyUnavailable };
  }

  return async function handleWorkspace(req, res, urlInput) {
    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    const configuredToken = String(env.SCRAPER_ADMIN_TOKEN || '').trim();
    if (!configuredToken) return res.status(503).json({
      error: 'Research workspace needs SCRAPER_ADMIN_TOKEN on the API server.',
      requiredConfiguration: 'SCRAPER_ADMIN_TOKEN',
    });
    if (!tokensMatch(presentedRunToken(req), configuredToken)) return res.status(401).json({ error: 'Source operator credential required' });

    try {
      if (url.pathname === '/api/workspace/cases') {
        if (req.method === 'GET') {
          return res.json(research.listCases({
            state: url.searchParams.get('state') || undefined,
            sourceId: url.searchParams.get('sourceId') || undefined,
            limit: url.searchParams.get('limit'), offset: url.searchParams.get('offset'),
          }, { filePath }));
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
          const result = research.createCase({
            listing, sourceRef: req.body?.sourceRef, origin: req.body?.origin,
            dossier: dossierFor(listing, timestamp),
          }, { filePath, now: timestamp });
          return res.status(result.created ? 201 : 200).json(result);
        }
        return res.status(405).json({ error: 'Use GET to list cases or POST to create one' });
      }

      if (url.pathname === '/api/workspace/import/preview' || url.pathname === '/api/workspace/import/commit') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST for browser import' });
        const options = { database, filePath, now: currentTime() };
        if (url.pathname.endsWith('/preview')) {
          return res.json({ preview: await research.previewBrowserImport(req.body?.listingIds, options) });
        }
        const result = await research.commitBrowserImport(req.body?.listingIds, req.body?.previewHash, {
          ...options,
          buildDossier: (listing, timestamp) => dossierFor(listing, timestamp),
        });
        return res.json({ result });
      }

      if (url.pathname === '/api/workspace/alachua/pilot') {
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
        const packet = research.buildPacket(id, { filePath });
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
        return res.json(research.getCase(id, { filePath }));
      }

      if (action === 'evidence') {
        if (intakeId) {
          if (req.method !== 'DELETE') return res.status(405).json({ error: 'Use DELETE to unlink evidence' });
          return res.json({ case: research.unlinkEvidence(id, intakeId, req.body || {}, operationOptions()) });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST to link reviewed evidence' });
        const evidence = evidenceById(req.body?.intakeId);
        if (!evidence) throw new research.ResearchCaseError('RESEARCH_EVIDENCE_NOT_FOUND', 'Evidence packet was not found');
        return res.json({ case: research.linkEvidence(id, evidence, req.body || {}, operationOptions()) });
      }

      if (req.method === 'GET') return res.json(research.getCase(id, { filePath }));
      if (req.method === 'PATCH') return res.json({ case: research.updateCase(id, req.body || {}, operationOptions()) });
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
