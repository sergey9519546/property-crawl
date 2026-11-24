'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  stageVercelApiBundle,
  smokeTestStagedApi,
  measureStagedBundle,
  shouldIncludeSeedData,
  REQUIRED_RUNTIME_SCRIPTS,
} = require('../scripts/deploy-vercel-api');

const ROOT = path.resolve(__dirname, '..');

function collectAllPaths(dir, baseDir = dir, out = { dirs: [], files: [] }) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(baseDir, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      out.dirs.push(rel);
      collectAllPaths(full, baseDir, out);
    } else if (entry.isFile()) {
      out.files.push(rel);
    }
  }
  return out;
}

test('stageVercelApiBundle stages a slimmed API bundle excluding heavy seed/snapshot/python/fixture files by default and passes /api/health smoke test', async () => {
  const stageDir = stageVercelApiBundle();
  try {
    for (const rel of [
      'api/index.js',
      'vercel.json',
      'package.json',
      'server/vercel-handler.js',
      'server/db/schema.sql',
      'server/db/migrations/043_lifecycle_terminal_parity.sql',
      'config/nationwide-civilview.js',
      'src/lib/county-seo.js',
      'src/lib/form-submissions.js',
      ...REQUIRED_RUNTIME_SCRIPTS.map((name) => `scripts/${name}`),
    ]) {
      assert.ok(fs.existsSync(path.join(stageDir, rel)), `expected ${rel} in staged bundle`);
    }

    for (const omitted of [
      'data.js',
      'data/listings.snapshot.json',
      'data',
      'test',
      'scripts/build-data.js',
      'scripts/seed-from-v0.js',
      'scripts/isolated-fixtures.js',
      'scripts/crawlers',
      'scripts/prepare-discovery-import.py',
      'scripts/record-workspace-walkthrough.py',
    ]) {
      assert.equal(
        fs.existsSync(path.join(stageDir, omitted)),
        false,
        `expected heavy/non-runtime entry ${omitted} to be excluded from default staged bundle`,
      );
    }

    const { dirs, files } = collectAllPaths(stageDir);
    const forbiddenDirs = new Set(['__pycache__', '.pytest_cache', '.venv', 'venv', 'node_modules', 'fixtures', '__tests__']);
    for (const dirRel of dirs) {
      assert.equal(
        forbiddenDirs.has(path.posix.basename(dirRel)),
        false,
        `unexpected excluded directory in staged bundle: ${dirRel}`,
      );
    }
    for (const fileRel of files) {
      assert.equal(
        /\.(?:pyc|pyo|py|pt|pth|onnx|safetensors|bin|ckpt|weights)$|\.(?:test\.(?:js|mjs|cjs|py))$/i.test(fileRel),
        false,
        `unexpected python/weight/test file in staged bundle: ${fileRel}`,
      );
    }

    const apiEntry = fs.readFileSync(path.join(stageDir, 'api', 'index.js'), 'utf8');
    const injectedMatch = apiEntry.match(/PROPERTY_RELEASE_SHA\s*=\s*'([a-f0-9]{40})'/i);
    assert.ok(injectedMatch, 'expected api/index.js to inject 40-char PROPERTY_RELEASE_SHA');

    const expectedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (/^[a-f0-9]{40}$/i.test(expectedSha) && !process.env.VERCEL_GIT_COMMIT_SHA && !process.env.PROPERTY_RELEASE_SHA) {
      assert.equal(injectedMatch[1], expectedSha);
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(stageDir, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'property-crawl-api');
    assert.equal(pkg.dependencies.pg, '^8.16.0');
    assert.equal(pkg.dependencies['robots-parser'], '3.0.1');

    const vercelConfig = JSON.parse(fs.readFileSync(path.join(stageDir, 'vercel.json'), 'utf8'));
    assert.equal(vercelConfig.framework, null);
    assert.deepEqual(vercelConfig.rewrites, [{ source: '/(.*)', destination: '/api' }]);

    const stats = measureStagedBundle(stageDir);
    assert.ok(stats.files > 0 && stats.bytes > 0, 'expected non-empty staged bundle metrics');
    assert.ok(stats.bytes < 8 * 1024 * 1024, `expected slimmed bundle < 8 MB, got ${stats.bytes} bytes`);

    const health = await smokeTestStagedApi(stageDir);
    assert.equal(health.status, 'ok');
    assert.equal(health.dataMode, 'unavailable');
    assert.equal(health.collection?.reason, 'scraper_background_disabled');
    assert.match(String(health.release?.commit || ''), /^[a-f0-9]{40}$/i);
    if (!process.env.VERCEL_GIT_COMMIT_SHA && !process.env.RENDER_GIT_COMMIT && !process.env.PROPERTY_RELEASE_SHA) {
      assert.equal(health.release?.commit, injectedMatch[1]);
    }

    execFileSync(
      process.execPath,
      [
        '-e',
        [
          "const path = require('node:path');",
          "require(path.join(process.argv[1], 'server', 'swarm', 'capability-graph.js'));",
          "require(path.join(process.argv[1], 'scripts', 'discovery-migrate.js'));",
          "const db = require(path.join(process.argv[1], 'server', 'db', 'client.js'));",
          "if (db.dataMode() !== 'memory' && db.dataMode() !== 'unavailable') process.exit(2);",
        ].join(' '),
        stageDir,
      ],
      {
        cwd: stageDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          NODE_PATH: [path.join(ROOT, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
        },
        stdio: 'pipe',
      },
    );
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
});

test('stageVercelApiBundle({ includeSeedData: true }) includes data.js and listings.snapshot.json while keeping python/fixtures excluded', async () => {
  assert.equal(shouldIncludeSeedData([]), false);
  assert.equal(shouldIncludeSeedData(['--include-seed']), true);

  const stageDir = stageVercelApiBundle({ includeSeedData: true });
  try {
    assert.ok(fs.existsSync(path.join(stageDir, 'data.js')), 'expected data.js when includeSeedData is true');
    assert.ok(
      fs.existsSync(path.join(stageDir, 'data', 'listings.snapshot.json')),
      'expected data/listings.snapshot.json when includeSeedData is true',
    );
    assert.equal(
      fs.existsSync(path.join(stageDir, 'scripts', 'crawlers')),
      false,
      'expected scripts/crawlers to remain excluded even when includeSeedData is true',
    );

    const health = await smokeTestStagedApi(stageDir);
    assert.equal(health.status, 'ok');
    assert.equal(health.dataMode, 'unavailable');
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
