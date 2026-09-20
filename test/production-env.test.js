'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadLocalEnvFiles, resolveInternalApiPort } = require('../scripts/production-env');

test('loadLocalEnvFiles never overrides keys already present in the parent env', () => {
  const merged = loadLocalEnvFiles({ SCRAPER_ADMIN_TOKEN: 'from-process' }, [], os.tmpdir());
  assert.equal(merged.SCRAPER_ADMIN_TOKEN, 'from-process');
});

test('loadLocalEnvFiles reads .env.local from an explicit root and strips quotes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'property-crawl-env-'));
  fs.writeFileSync(path.join(dir, '.env.local'), [
    '# comment',
    'SCRAPER_ADMIN_TOKEN=local-secret',
    'QUOTED="hello world"',
    "SINGLE='raw'",
    'EMPTY=',
    'BADLINE',
    '',
  ].join('\n'));
  const merged = loadLocalEnvFiles({}, ['.env.local'], dir);
  assert.equal(merged.SCRAPER_ADMIN_TOKEN, 'local-secret');
  assert.equal(merged.QUOTED, 'hello world');
  assert.equal(merged.SINGLE, 'raw');
  assert.equal(merged.EMPTY, '');
  assert.ok(!('BADLINE' in merged));
});

test('resolveInternalApiPort keeps cloud 3000→3002 and local publicPort+2', () => {
  assert.equal(resolveInternalApiPort(3000), 3002);
  assert.equal(resolveInternalApiPort(3700), 3702);
  assert.equal(resolveInternalApiPort(3700, '3902'), 3902);
  assert.equal(resolveInternalApiPort(3700, 'not-a-number'), 3702);
});
