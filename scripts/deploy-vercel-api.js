'use strict';

const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const RESULT_MARKER = '__VERCEL_API_SMOKE_HEALTH__:';

// Scripts imported directly at runtime by server/ (migrations, unbrowse, capability graph).
// All other dev/CLI/Python crawler/fixture scripts are excluded from the serverless bundle.
const REQUIRED_RUNTIME_SCRIPTS = [
  'discovery-migrate.js',
  'crawler-tools-unbrowse.cjs',
  'capability-graph.js',
];

const EXCLUDED_DIR_NAMES = new Set([
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
  'node_modules',
  'fixtures',
  '__tests__',
]);

const EXCLUDED_FILE_SUFFIXES = [
  '.pyc',
  '.pyo',
  '.py',
  '.pt',
  '.pth',
  '.onnx',
  '.safetensors',
  '.bin',
  '.ckpt',
  '.weights',
  '.test.js',
  '.test.mjs',
  '.test.cjs',
  '.test.py',
];

function shouldIncludeSeedData(argv = process.argv.slice(2)) {
  return Array.isArray(argv) && argv.includes('--include-seed');
}

function copyRuntimeFilter(src) {
  const base = path.basename(src);
  if (EXCLUDED_DIR_NAMES.has(base)) return false;
  const lower = base.toLowerCase();
  return !EXCLUDED_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function measureStagedBundle(stageDir) {
  let files = 0;
  let bytes = 0;
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(fullPath).size;
      }
    }
  }
  walk(stageDir);
  return { files, bytes };
}

function stageVercelApiBundle({ rootDir = DEFAULT_ROOT, stageDir, includeSeedData = false } = {}) {
  const targetDir = stageDir
    ? path.resolve(stageDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'property-crawl-vercel-api-'));
  fs.mkdirSync(targetDir, { recursive: true });

  for (const dirName of ['server', 'config']) {
    const srcDir = path.join(rootDir, dirName);
    if (!fs.existsSync(srcDir)) {
      throw new Error(`Required directory missing from rootDir: ${srcDir}`);
    }
    fs.cpSync(srcDir, path.join(targetDir, dirName), {
      recursive: true,
      filter: copyRuntimeFilter,
    });
  }

  const scriptsSrcDir = path.join(rootDir, 'scripts');
  if (!fs.existsSync(scriptsSrcDir)) {
    throw new Error(`Required directory missing from rootDir: ${scriptsSrcDir}`);
  }
  const scriptsDstDir = path.join(targetDir, 'scripts');
  fs.mkdirSync(scriptsDstDir, { recursive: true });
  for (const scriptName of REQUIRED_RUNTIME_SCRIPTS) {
    const scriptSrc = path.join(scriptsSrcDir, scriptName);
    if (!fs.existsSync(scriptSrc)) {
      throw new Error(`Required runtime script missing from rootDir: ${scriptSrc}`);
    }
    fs.copyFileSync(scriptSrc, path.join(scriptsDstDir, scriptName));
  }

  // Omit static v0 seed (~10MB data.js) and fixture snapshot (data/listings.snapshot.json)
  // from the default production bundle; server/db/client.js and server/scrapers/base.js
  // guard both behind fs.existsSync and production defaults to Postgres/unavailable.
  if (includeSeedData) {
    const dataJsSrc = path.join(rootDir, 'data.js');
    if (!fs.existsSync(dataJsSrc)) {
      throw new Error(`Required file missing from rootDir: ${dataJsSrc}`);
    }
    fs.copyFileSync(dataJsSrc, path.join(targetDir, 'data.js'));

    const dataDir = path.join(targetDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const snapshotSrc = path.join(rootDir, 'data', 'listings.snapshot.json');
    if (!fs.existsSync(snapshotSrc)) {
      throw new Error(`Required snapshot missing from rootDir: ${snapshotSrc}`);
    }
    fs.copyFileSync(snapshotSrc, path.join(dataDir, 'listings.snapshot.json'));
  }

  const srcLibDir = path.join(rootDir, 'src', 'lib');
  const dstLibDir = path.join(targetDir, 'src', 'lib');
  fs.mkdirSync(dstLibDir, { recursive: true });
  if (fs.existsSync(srcLibDir)) {
    for (const entry of fs.readdirSync(srcLibDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js') && copyRuntimeFilter(entry.name)) {
        fs.copyFileSync(path.join(srcLibDir, entry.name), path.join(dstLibDir, entry.name));
      }
    }
  }

  let releaseSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.PROPERTY_RELEASE_SHA || '';
  if (!/^[a-f0-9]{40}$/i.test(releaseSha)) {
    try {
      const shaOut = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
      if (/^[a-f0-9]{40}$/i.test(shaOut)) releaseSha = shaOut;
    } catch {}
  }
  const shaBanner = /^[a-f0-9]{40}$/i.test(releaseSha)
    ? `if (!process.env.PROPERTY_RELEASE_SHA) process.env.PROPERTY_RELEASE_SHA = '${releaseSha}';\n`
    : '';
  const apiDir = path.join(targetDir, 'api');
  fs.mkdirSync(apiDir, { recursive: true });
  fs.writeFileSync(
    path.join(apiDir, 'index.js'),
    `${shaBanner}module.exports = require('../server/vercel-handler');\n`,
  );

  fs.writeFileSync(
    path.join(targetDir, 'vercel.json'),
    JSON.stringify(
      {
        $schema: 'https://openapi.vercel.sh/vercel.json',
        framework: null,
        rewrites: [{ source: '/(.*)', destination: '/api' }],
        functions: { 'api/index.js': { maxDuration: 60 } },
      },
      null,
      2,
    ) + '\n',
  );

  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify(
      {
        name: 'property-crawl-api',
        version: '2.0.0',
        private: true,
        engines: { node: '>=22.0.0' },
        dependencies: {
          pg: '^8.16.0',
          'robots-parser': '3.0.1',
        },
      },
      null,
      2,
    ) + '\n',
  );

  return targetDir;
}

async function smokeTestStagedApi(stageDir, { rootDir = DEFAULT_ROOT } = {}) {
  if (!stageDir || typeof stageDir !== 'string') {
    throw new Error('stageDir is required for smokeTestStagedApi');
  }
  const entryPath = path.join(stageDir, 'api', 'index.js');
  const handlerPath = path.join(stageDir, 'server', 'vercel-handler.js');
  if (!fs.existsSync(entryPath) || !fs.existsSync(handlerPath)) {
    throw new Error(
      `Staged bundle in ${stageDir} is missing api/index.js or server/vercel-handler.js`,
    );
  }

  const entrySource = fs.readFileSync(entryPath, 'utf8');
  const expectsReleaseSha = /PROPERTY_RELEASE_SHA\s*=\s*'[a-f0-9]{40}'/i.test(entrySource);

  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.npm_lifecycle_event;
  delete childEnv.SCRAPER_BACKGROUND_ENABLED;
  delete childEnv.RUN_REAL_SCRAPERS;
  delete childEnv.DISCOVERY_MODE;
  delete childEnv.DATABASE_URL;
  delete childEnv.PROPERTY_DB;
  delete childEnv.PROPERTY_PG_DATA_DIR;
  delete childEnv.PROPERTY_INVENTORY_BACKEND;
  childEnv.NODE_ENV = 'production';
  childEnv.VERCEL = '1';
  childEnv.NODE_PATH = [path.join(rootDir, 'node_modules'), process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);

  const smokeScript = [
    "const http = require('node:http');",
    "const path = require('node:path');",
    'const stageDir = process.argv[1];',
    'const marker = process.argv[2];',
    "const expectsSha = process.argv[3] === '1';",
    'console.log = (...args) => console.error(...args);',
    "const handler = require(path.join(stageDir, 'api', 'index.js'));",
    'const server = http.createServer(handler);',
    "server.listen(0, '127.0.0.1', () => {",
    '  const addr = server.address();',
    "  const port = typeof addr === 'object' && addr ? addr.port : 0;",
    '  const req = http.get(`http://127.0.0.1:${port}/api/health`, { agent: false }, (res) => {',
    "    let body = '';",
    "    res.setEncoding('utf8');",
    "    res.on('data', (chunk) => { body += chunk; });",
    "    res.on('end', () => {",
    '      let exitCode = 0;',
    '      try {',
    '        if (res.statusCode !== 200) {',
    '          throw new Error(`Expected HTTP 200 from /api/health, got ${res.statusCode}: ${body}`);',
    '        }',
    '        const health = JSON.parse(body);',
    "        if (health?.status !== 'ok') {",
    '          throw new Error(`Expected status === "ok", got ${JSON.stringify(health?.status)}`);',
    '        }',
    "        if (health?.dataMode !== 'unavailable') {",
    '          throw new Error(`Expected dataMode === "unavailable", got ${JSON.stringify(health?.dataMode)}`);',
    '        }',
    "        if (health?.collection?.reason !== 'scraper_background_disabled') {",
    '          throw new Error(`Expected collection.reason === "scraper_background_disabled", got ${JSON.stringify(health?.collection)}`);',
    '        }',
    "        if (expectsSha && !/^[a-f0-9]{40}$/i.test(String(health?.release?.commit || ''))) {",
    '          throw new Error(`Expected 40-char release.commit, got ${JSON.stringify(health?.release)}`);',
    '        }',
    '        process.stdout.write(`\\n${marker}${JSON.stringify(health)}\\n`);',
    '      } catch (err) {',
    '        console.error(err && err.stack ? err.stack : String(err));',
    '        exitCode = 1;',
    '      } finally {',
    '        server.closeAllConnections?.();',
    '        server.close(() => process.exit(exitCode));',
    '      }',
    '    });',
    '  });',
    "  req.on('error', (err) => {",
    '    console.error(err && err.stack ? err.stack : String(err));',
    '    server.closeAllConnections?.();',
    '    server.close(() => process.exit(1));',
    '  });',
    '});',
  ].join('\n');

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['-e', smokeScript, stageDir, RESULT_MARKER, expectsReleaseSha ? '1' : '0'],
      {
        env: childEnv,
        cwd: stageDir,
        timeout: 25_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || stdout || err.message || '').trim();
          reject(new Error(`Staged Vercel API smoke test failed: ${detail}`));
          return;
        }
        const markerLine = String(stdout || '')
          .split(/\r?\n/)
          .find((line) => line.startsWith(RESULT_MARKER));
        if (!markerLine) {
          reject(new Error(`Staged Vercel API smoke test produced no health payload. stderr=${stderr}`));
          return;
        }
        try {
          const parsed = JSON.parse(markerLine.slice(RESULT_MARKER.length));
          if (
            parsed?.status !== 'ok'
            || parsed?.dataMode !== 'unavailable'
            || parsed?.collection?.reason !== 'scraper_background_disabled'
            || (expectsReleaseSha && !/^[a-f0-9]{40}$/i.test(String(parsed?.release?.commit || '')))
          ) {
            reject(
              new Error(
                `Unexpected health payload from staged API: ${JSON.stringify({
                  status: parsed?.status,
                  dataMode: parsed?.dataMode,
                  collectionReason: parsed?.collection?.reason,
                  release: parsed?.release,
                })}`,
              ),
            );
            return;
          }
          resolve(parsed);
        } catch (parseErr) {
          reject(new Error(`Failed to parse staged API smoke payload: ${parseErr.message}`));
        }
      },
    );
  });
}

function runVercelCli(args, cwd) {
  if (process.platform === 'win32') {
    return execFileSync('cmd.exe', ['/d', '/s', '/c', 'vercel.cmd', ...args], {
      cwd,
      stdio: 'inherit',
    });
  }
  return execFileSync('vercel', args, {
    cwd,
    stdio: 'inherit',
  });
}

async function main(argv = process.argv.slice(2)) {
  const includeSeedData = shouldIncludeSeedData(argv);
  const stageDir = stageVercelApiBundle({ includeSeedData });
  try {
    const stats = measureStagedBundle(stageDir);
    const mb = (stats.bytes / (1024 * 1024)).toFixed(2);
    console.log(
      `[deploy-vercel-api] staged bundle: files=${stats.files} bytes=${stats.bytes} (${mb} MB) includeSeedData=${includeSeedData}`,
    );
    const health = await smokeTestStagedApi(stageDir);
    console.log(
      `[deploy-vercel-api] smoke ok: status=${health.status} dataMode=${health.dataMode} collectionReason=${health.collection?.reason} releaseCommit=${health.release?.commit || 'none'}`,
    );
    if (argv.includes('--deploy')) {
      runVercelCli(['link', '--yes', '--project', 'property-crawl-api'], stageDir);
      runVercelCli(['deploy', '--prod', '--yes'], stageDir);
      console.log('[deploy-vercel-api] deployed property-crawl-api to production');
    }
  } finally {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (cleanupErr) {
      console.warn(`[deploy-vercel-api] temp dir cleanup deferred (${stageDir}):`, cleanupErr?.message || cleanupErr);
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[deploy-vercel-api] failed:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  stageVercelApiBundle,
  smokeTestStagedApi,
  measureStagedBundle,
  shouldIncludeSeedData,
  REQUIRED_RUNTIME_SCRIPTS,
};
