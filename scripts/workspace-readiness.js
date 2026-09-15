'use strict';

async function inspect(name, url, fetchImpl = fetch, env = process.env) {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    const timestampMs = typeof body.timestamp === 'string' ? Date.parse(body.timestamp) : NaN;
    // Reject stale or future health responses so promotion cannot rely on an old process.
    const maxHealthAgeMs = Number(env.WORKSPACE_HEALTH_MAX_AGE_MS || 30_000);
    const nowMs = Date.now();
    const valid = response.ok && body.status === 'ok' && Number.isFinite(body.uptime) && body.uptime >= 0
      && typeof body.timestamp === 'string' && Number.isFinite(timestampMs)
      && Number.isInteger(maxHealthAgeMs) && maxHealthAgeMs >= 1_000
      && timestampMs <= nowMs && nowMs - timestampMs <= maxHealthAgeMs
      && typeof body.workspaceBootId === 'string' && body.workspaceBootId.length > 0;
    return { name, url, ready: valid, status: response.status, latencyMs: Date.now() - started,
      ...(typeof body.workspaceBootId === 'string' ? { workspaceBootId: body.workspaceBootId } : {}),
      ...(!valid ? { error: 'Unexpected property API health response' } : {}) };
  } catch (error) {
    return { name, url, ready: false, error: error instanceof Error ? error.message : 'request failed', latencyMs: Date.now() - started };
  }
}

async function checkWorkspace(env = process.env, fetchImpl = fetch) {
  const api = (env.PROPERTY_API_URL || 'http://localhost:3000').replace(/\/$/, '');
  const ui = (env.WORKSPACE_UI_URL || 'http://localhost:3001').replace(/\/$/, '');
  const services = await Promise.all([
    inspect('property-api', api + '/api/health', fetchImpl, env),
    inspect('workspace-ui-proxy', ui + '/api/health', fetchImpl, env),
  ]);
  const [direct, proxied] = services;
  const sameBoot = direct.workspaceBootId === proxied.workspaceBootId;
  return { ready: services.every((result) => result.ready) && sameBoot, services,
    ...(!sameBoot ? { error: 'UI proxy and API belong to different workspace processes' } : {}) };
}

if (require.main === module) checkWorkspace().then((result) => {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
});

module.exports = { inspect, checkWorkspace };
