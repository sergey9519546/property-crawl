'use strict';

/*
 * verify-gate module-load smoke.
 *
 * The runtime gate runs test/server.test.js, test/suite.test.js and
 * test/hardening.test.js. Measured against the tree, those three load 124 of
 * the 149 modules under server/. The remaining 25 — server/public-records/*,
 * server/crawlers/*, server/discovery/onboarding-pass.js, server/forms/store.js,
 * server/audit/property-image-routing.js and a few others — are reached only
 * through lazy requires inside handlers.
 *
 * That means a change to one of those files was certified "runtime, all
 * passed" by suites that never loaded it. The gate reported success on code it
 * never executed, which is the same failure shape as an unwired test: an
 * unexercised path reporting a pass.
 *
 * This closes that gap directly: it requires the changed modules themselves.
 * A syntax error, a bad require path, a throw at module scope, or a broken
 * import graph now fails the gate for the file you actually touched.
 *
 * Usage:  node scripts/verify-module-load.js <file> [<file> ...]
 * Or:     node scripts/verify-module-load.js --changed
 *
 * Modules that construct a credentialed client at import time (ZillowMcpClient
 * requires ZILLOW_MCP_API_KEY) are config-gated: require.resolve() must still
 * succeed, proving the file parses and its graph resolves, but the missing
 * secret is not this gate's problem to report.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const CONFIG_GATED = /^\s*Error: [A-Z0-9_]+ is required\b/;
const LOADABLE_SUFFIXES = ['.js', '.mjs', '.cjs'];

function isCandidate(file) {
  if (!LOADABLE_SUFFIXES.includes(path.extname(file))) return false;
  // Only project code the gate can meaningfully load in isolation.
  if (file.startsWith('src/')) return false; // Next.js sources need the bundler.
  if (file.startsWith('test/')) return false; // test entry points run elsewhere.
  if (file.startsWith('scripts/')) return false;
  return file.startsWith('server/');
}

function classifyLoadError(stderr) {
  const first = String(stderr || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('Error:'));
  if (first && CONFIG_GATED.test(first)) return { configGated: true, message: first };
  const syntax = /SyntaxError/.test(String(stderr || ''));
  return { configGated: false, message: first || 'module failed to load', syntax };
}

function loadOne(file) {
  const abs = path.join(ROOT, file);

  // Always prove the file parses and its import graph resolves.
  try {
    execFileSync(process.execPath, ['-e', `require.resolve(${JSON.stringify(abs)})`], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    });
  } catch (err) {
    return {
      file,
      status: 'failed',
      reason: 'does not resolve (syntax error or bad import path)',
      detail: String(err.stderr || '').split('\n')[0].trim(),
    };
  }

  try {
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(abs)})`], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { file, status: 'loaded' };
  } catch (err) {
    const { configGated, message } = classifyLoadError(err.stderr);
    if (configGated) {
      return { file, status: 'config-gated', reason: message };
    }
    return { file, status: 'failed', reason: message, detail: String(err.stderr || '').split('\n')[0].trim() };
  }
}

function changedFiles() {
  // Must match verify-gate's getChangedFiles, including untracked files: a new
  // server module with a syntax error is exactly the case worth catching, and
  // it appears in no git diff.
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n').map((l) => l.trim()).filter(Boolean);
    } catch (_) { return []; }
  };
  return [
    ...new Set([
      ...run(['diff', '--name-only', 'HEAD']),
      ...run(['diff', '--cached', '--name-only']),
      ...run(['ls-files', '--others', '--exclude-standard']),
    ]),
  ];
}

function main() {
  const args = process.argv.slice(2);
  let files;
  if (args.includes('--changed')) {
    files = changedFiles();
  } else if (args.length) {
    files = args;
  } else {
    console.error('usage: node scripts/verify-module-load.js --changed | <file> [...]');
    process.exit(2);
  }

  const candidates = files.filter(isCandidate);
  if (candidates.length === 0) {
    console.log('module-load smoke: no loadable server modules among the changed files.');
    return;
  }

  const results = candidates.map(loadOne);
  const failed = results.filter((r) => r.status === 'failed');
  const gated = results.filter((r) => r.status === 'config-gated');

  for (const r of results) {
    if (r.status === 'loaded') console.log(`  ok           ${r.file}`);
    else if (r.status === 'config-gated') console.log(`  config-gated ${r.file}  (${r.reason})`);
    else console.log(`  FAILED       ${r.file}  (${r.reason}${r.detail ? ` — ${r.detail}` : ''})`);
  }

  console.log(
    `module-load smoke: ${results.length - failed.length - gated.length} loaded, `
      + `${gated.length} config-gated, ${failed.length} failed of ${results.length}.`,
  );
  if (failed.length) process.exit(1);
}

module.exports = { isCandidate, classifyLoadError, loadOne };
if (require.main === module) main();
