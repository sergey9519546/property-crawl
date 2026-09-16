// server/routes/property-image-providers.js
//
// Provider-status surface for /api/property-image/providers. Reports the
// configuration + runtime health of every imagery provider the property-image
// service knows about, so operators can verify keys are set and circuit
// breakers aren't open without making a real lookup call.
//
// The handler is read-only: it never touches the upstream APIs. The shape
// is intentionally flat and stable; the property-image route already adds
// its own provider info to every response so consumers don't need to
// correlate two endpoints.

const { ProviderCircuit } = require('./property-image');

function snapshotCircuit(circuit, now = Date.now) {
  if (!circuit) return { available: null, note: 'no circuit configured' };
  const timestamp = now();
  const openedUntil = Number(circuit.openedUntil) || 0;
  const available = openedUntil <= timestamp;
  return {
    available,
    failures: Number(circuit.failures) || 0,
    openedUntil: openedUntil > timestamp ? new Date(openedUntil).toISOString() : null,
    retryAfterSeconds: available ? 0 : Math.max(1, Math.ceil((openedUntil - timestamp) / 1000))
  };
}

function buildProviderSnapshot({ provider, env = process.env, circuits = {}, cache = null, now = Date.now }) {
  const keyEnvVar = provider.keyEnvVar || null;
  const requiresKey = Boolean(keyEnvVar);
  const keyLength = requiresKey && typeof env[keyEnvVar] === 'string' ? env[keyEnvVar].trim().length : 0;
  // A provider is "configured" if it either doesn't require a key
  // (community/free providers like Panoramax) or its required key is set.
  const keyConfigured = !requiresKey || keyLength > 0;
  const circuit = circuits[provider.id] || null;
  const status = snapshotCircuit(circuit, now);
  return {
    id: provider.id,
    label: provider.label,
    role: provider.role,
    keyEnvVar,
    requiresKey,
    keyConfigured,
    keyLength: keyConfigured ? keyLength : 0,
    circuit: status,
    cache: cache && provider.cacheable ? cache.stats() : null,
    lastCheckedAt: new Date(now()).toISOString()
  };
}

// Default provider list — extend as new imagery providers are added.
const DEFAULT_PROVIDERS = [
  { id: 'google-geocoding', label: 'Google Maps Geocoding API', role: 'geocoding', keyEnvVar: 'GOOGLE_MAPS_API_KEY' },
  { id: 'google-streetview', label: 'Google Street View Static API', role: 'streetview', keyEnvVar: 'GOOGLE_MAPS_API_KEY' },
  { id: 'panoramax', label: 'Panoramax (community street-level imagery)', role: 'streetview-alternative', keyEnvVar: null, cacheable: true },
  { id: 'mapillary', label: 'Mapillary (community street-level imagery)', role: 'streetview-alternative', keyEnvVar: 'MAPILLARY_ACCESS_TOKEN', cacheable: true }
];

function createProviderStatusHandler({
  env = process.env,
  circuits = {},
  cache = null,
  now = () => Date.now(),
  providers = DEFAULT_PROVIDERS
} = {}) {
  return async function handleProviderStatus(req, res) {
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      return res.json({ error: 'method_not_allowed' });
    }
    res.setHeader('Cache-Control', 'no-store');
    const snapshot = providers.map((provider) => buildProviderSnapshot({ provider, env, circuits, cache, now }));
    const availableCount = snapshot.filter((entry) => entry.keyConfigured && entry.circuit.available !== false).length;
    const summary = {
      total: snapshot.length,
      available: availableCount,
      missingKey: snapshot.filter((entry) => !entry.keyConfigured && entry.keyEnvVar).length,
      circuitOpen: snapshot.filter((entry) => entry.circuit && entry.circuit.available === false).length
    };
    return res.json({ schema: 'property-crawl.property-image-providers/v1', summary, providers: snapshot });
  };
}

module.exports = {
  DEFAULT_PROVIDERS,
  buildProviderSnapshot,
  createProviderStatusHandler,
  snapshotCircuit
};
