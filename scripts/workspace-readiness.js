'use strict';

async function inspect(name, url) {
  const started = Date.now();
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    return { name, url, ready: response.ok, status: response.status, latencyMs: Date.now() - started };
  } catch (error) {
    return { name, url, ready: false, error: error instanceof Error ? error.message : 'request failed', latencyMs: Date.now() - started };
  }
}

Promise.all([
  inspect('property-api', 'http://localhost:3000/api/health'),
  inspect('workspace-ui-proxy', 'http://localhost:3001/api/health'),
]).then((results) => {
  console.log(JSON.stringify({ ready: results.every((result) => result.ready), services: results }, null, 2));
  if (results.some((result) => !result.ready)) process.exitCode = 1;
});

