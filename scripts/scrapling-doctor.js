'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { defaultPython } = require('../server/scrapers/scrapling-bridge');

const PINNED_VERSION = '0.4.15';
const REQUIREMENTS = path.resolve(__dirname, 'crawlers', 'requirements.txt');

function readPinnedVersion(file = REQUIREMENTS) {
  const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find(value => /^\s*scrapling==/.test(value));
  return line ? line.trim().slice('scrapling=='.length) : null;
}

function checkScraplingReadiness({ python = defaultPython(), requirementsFile = REQUIREMENTS, runner = execFileSync } = {}) {
  const checks = [];
  const pinned = readPinnedVersion(requirementsFile);
  checks.push({ name: 'requirements-pin', ok: pinned === PINNED_VERSION, detail: pinned ? `scrapling==${pinned}` : 'missing scrapling== pin' });
  if (!python || !fs.existsSync(python) || !fs.statSync(python).isFile()) {
    checks.push({ name: 'python-runtime', ok: false, detail: 'configured Scrapling Python runtime is missing' });
    return { ready: false, python: python || null, version: null, checks };
  }
  try {
    const output = runner(python, ['-c', 'import scrapling; print(getattr(scrapling, "__version__", "unknown"))'], { encoding: 'utf8', timeout: 5000 }).trim();
    checks.push({ name: 'scrapling-import', ok: output === PINNED_VERSION, detail: output });
    return { ready: checks.every(check => check.ok), python: path.resolve(python), version: output, checks };
  } catch (error) {
    checks.push({ name: 'scrapling-import', ok: false, detail: error.code || 'import failed' });
    return { ready: false, python: path.resolve(python), version: null, checks };
  }
}

if (require.main === module) {
  const result = checkScraplingReadiness();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
}

module.exports = { PINNED_VERSION, readPinnedVersion, checkScraplingReadiness };
