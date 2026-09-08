'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceNetworkHandler } = require('../server/routes/source-network');

async function run(promoted) {
  const started = [];
  const handler = createSourceNetworkHandler({
    database: {}, scheduler: { networkEnabled: true },
    env: { DISCOVERY_MODE: 'advanced', SCRAPER_ADMIN_TOKEN: 'release-gate-test' },
    discoveryStore: { promotedSources: async () => promoted },
    coordinator: { start: async input => { started.push(input); return { id: 'job_test', sourceIds: input.sourceIds }; } },
  });
  const response = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ method: 'POST', url: '/api/source-network/run', headers: { authorization: 'Bearer release-gate-test' }, body: { scope: 'all' } }, response);
  return { started, response };
}

test('advanced complete cycles collect only sources which passed the release gate', async () => {
  const { started, response } = await run(['gsa', 'hud']);
  assert.equal(response.statusCode, 202);
  assert.deepEqual(started[0].sourceIds, ['gsa', 'hud']);
});

test('an empty release gate cannot fall through to all registered adapters', async () => {
  const { started, response } = await run([]);
  assert.equal(response.statusCode, 409);
  assert.equal(started.length, 0);
});
