'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { stageVercelApiBundle, smokeTestStagedApi } = require('../scripts/deploy-vercel-api');

test('stageVercelApiBundle stages the standalone API bundle and passes /api/health smoke test', async () => {
  const stageDir = stageVercelApiBundle();
  try {
    for (const rel of [
      'api/index.js',
      'vercel.json',
      'package.json',
      'server/vercel-handler.js',
      'config/nationwide-civilview.js',
      'data.js',
      'data/listings.snapshot.json',
      'src/lib/county-seo.js',
      'src/lib/form-submissions.js',
    ]) {
      assert.ok(fs.existsSync(path.join(stageDir, rel)), `expected ${rel} in staged bundle`);
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(stageDir, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'property-crawl-api');
    assert.equal(pkg.dependencies.pg, '^8.16.0');
    assert.equal(pkg.dependencies['robots-parser'], '3.0.1');

    const vercelConfig = JSON.parse(fs.readFileSync(path.join(stageDir, 'vercel.json'), 'utf8'));
    assert.equal(vercelConfig.framework, null);
    assert.deepEqual(vercelConfig.rewrites, [{ source: '/(.*)', destination: '/api' }]);

    const health = await smokeTestStagedApi(stageDir);
    assert.equal(health.status, 'ok');
    assert.equal(health.collection?.reason, 'scraper_background_disabled');
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
});

test('smokeTestStagedApi rejects an empty or incomplete directory', async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-vercel-api-empty-'));
  try {
    await assert.rejects(() => smokeTestStagedApi(emptyDir));
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});
