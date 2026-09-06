const { validateListingForIngestion } = require('../scrapers/validation');

function buildSourceNetwork({ catalog, adapters, observations, listings = [], evidenceCollectors = [], evidenceSummary = {}, now = Date.now() }) {
  const registered = new Set(adapters.map((adapter) => adapter.sourceKey));
  const counts = new Map();
  for (const listing of listings) {
    if (listing.provenance?.origin !== 'live' || !validateListingForIngestion(listing).isValid) continue;
    const entry = counts.get(listing.source) || { observedRecords: 0, latestObservation: null, states: new Set() };
    entry.observedRecords++;
    if (listing.state) entry.states.add(listing.state);
    const time = listing.sourceObservedAt || listing.provenance.observedAt;
    if (Date.parse(time) <= now + 300_000 && (!entry.latestObservation || Date.parse(time) > Date.parse(entry.latestObservation))) entry.latestObservation = time;
    counts.set(listing.source, entry);
  }
  const sources = catalog.map((source) => {
    const automatedEvidence = evidenceCollectors.includes(source.id);
    const automated = Boolean(source.adapterKey && registered.has(source.adapterKey)) || automatedEvidence;
    const run = observations.runs[source.adapterKey || source.id] || null;
    const inventory = counts.get(source.adapterKey || source.id);
    const cadenceHours = source.workflow.cadenceHours || 24;
    const dueAt = run?.lastRunAt ? new Date(Date.parse(run.lastRunAt) + cadenceHours * 3600_000).toISOString() : null;
    let status = automated ? 'awaiting_run' : source.propertyLookup ? 'lookup_available' : 'import_available';
    if (automated && run) {
      if (run.error) status = 'attention';
      else if (dueAt && Date.parse(dueAt) < now) status = 'stale';
      else if (run.acceptedCount === 0) status = 'empty';
      else status = 'collected';
    }
    if (automatedEvidence && !run && evidenceSummary[source.id]?.count) status = 'evidence_queued';
    if (automatedEvidence && run && !run.error && status !== 'stale') status = run.evidenceCount ? 'evidence_queued' : 'empty';
    return {
      ...source, automated, automatedEvidence, status, dueAt,
      evidencePackets: evidenceSummary[source.id]?.count || 0,
      // These are observations in our store, not a claim about total publisher inventory.
      observedRecords: inventory?.observedRecords || 0,
      observedStates: inventory ? [...inventory.states].sort() : [],
      latestObservation: inventory?.latestObservation || null,
      lastRun: run,
      nextAction: status === 'attention' ? source.workflow.fallback
        : automatedEvidence ? 'Collect official notices into the evidence review queue; confirm any underlying offering before treating it as inventory.'
          : automated ? 'Collect current records; compare changes with saved observations.' : source.workflow.primary,
    };
  });
  return {
    generatedAt: new Date(now).toISOString(), sources,
    summary: {
      catalogSources: sources.length,
      automatedCollectors: sources.filter((source) => source.automated).length,
      propertyCollectors: sources.filter((source) => source.automated && !source.automatedEvidence).length,
      evidenceCollectors: sources.filter((source) => source.automatedEvidence).length,
      collected: sources.filter((source) => source.status === 'collected').length,
      needsAttention: sources.filter((source) => ['attention', 'stale', 'empty'].includes(source.status)).length,
      importSources: sources.filter((source) => !source.automated).length,
      observedRecords: sources.reduce((sum, source) => sum + source.observedRecords, 0),
      trackedRecords: Object.keys(observations.records).length,
    },
    signals: observations.signals.slice(0, 100),
    scope: 'Catalog entries describe source workflows. A registered collector does not imply complete geographic coverage or a successful collection. Imported evidence requires review.',
  };
}

function enrolledSources(evidence, catalog) {
  const known = new Set(catalog.map((source) => source.id));
  const enrolled = [];
  for (const packet of evidence) {
    if (!packet.customSource || known.has(packet.sourceId) || packet.review?.decision !== 'approved') continue;
    known.add(packet.sourceId);
    enrolled.push({
      id: packet.sourceId, label: packet.customSource.name, category: 'local_source', role: 'discovery',
      organization: packet.customSource.organization,
      coverage: packet.customSource.description || 'Locally enrolled publisher; coverage depends on submitted evidence.',
      discoveryUrl: packet.customSource.homepageUrl || packet.sourceUrl, access: 'jurisdiction', adapterKey: null,
      workflow: { primary: 'Capture current publisher records and import their evidence.', fallback: 'Use the publisher contact or an authorized export.', cadenceHours: 24, steps: ['Open the enrolled publisher.', 'Save the exact record URL and capture time.', 'Import the notice or authorized export for review.'] },
      requiredEvidence: ['exact publisher record URL', 'source-observed timestamp', 'original notice or authorized export'],
      notes: 'Enrollment records an evidence workflow; it does not establish a live property feed.',
    });
  }
  return enrolled;
}

module.exports = { buildSourceNetwork, enrolledSources };
