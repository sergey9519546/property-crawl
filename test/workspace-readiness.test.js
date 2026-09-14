const test = require('node:test');
const assert = require('node:assert/strict');
const { checkWorkspace } = require('../scripts/workspace-readiness');

const health = (boot = 'same', timestamp = new Date().toISOString()) => ({ status: 'ok', uptime: 12, timestamp, workspaceBootId: boot });
test('readiness verifies custom API and UI endpoints and matching process identity', async () => {
  const urls = [];
  const result = await checkWorkspace({ PROPERTY_API_URL: 'http://localhost:3102/', WORKSPACE_UI_URL: 'http://localhost:3103/' },
    async (url) => { urls.push(url); return Response.json(health()); });
  assert.equal(result.ready, true);
  assert.deepEqual(urls, ['http://localhost:3102/api/health', 'http://localhost:3103/api/health']);
});
test('readiness rejects unrelated HTTP 200 pages, different boots and offline services', async () => {
  for (const response of [Response.json({ status: 'ok' }), new Response('<html>other app</html>')]) {
    const result = await checkWorkspace({}, async () => response.clone());
    assert.equal(result.ready, false);
  }
  let calls = 0;
  assert.equal((await checkWorkspace({}, async () => Response.json(health(String(++calls))))).ready, false);
  assert.equal((await checkWorkspace({}, async () => { throw new Error('offline'); })).ready, false);
});
test('readiness rejects stale and future health responses', async () => {
  const stale = new Date(Date.now() - 31_000).toISOString();
  assert.equal((await checkWorkspace({}, async () => Response.json(health('same', stale)))).ready, false);
  const future = new Date(Date.now() + 1_000).toISOString();
  assert.equal((await checkWorkspace({}, async () => Response.json(health('same', future)))).ready, false);
});
test('readiness supports an explicit bounded health age', async () => {
  const timestamp = new Date(Date.now() - 2_000).toISOString();
  const result = await checkWorkspace({ WORKSPACE_HEALTH_MAX_AGE_MS: '5000' }, async () => Response.json(health('same', timestamp)));
  assert.equal(result.ready, true);
});
