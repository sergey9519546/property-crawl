'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach, test } = require('node:test');
const { setup } = require('../scripts/setup-source-operator');

const temporaryDirectories = [];

function paths() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'source-operator-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    envPath: path.join(directory, '.env.local'),
    credentialPath: path.join(directory, '.cache', 'source-operator-credential.txt'),
  };
}

function deterministic(byte) {
  let calls = 0;
  return {
    randomBytes(size) {
      calls++;
      assert.equal(size, 32);
      return Buffer.alloc(size, byte);
    },
    calls: () => calls,
  };
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory.startsWith(os.tmpdir())) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('creates a token while preserving every existing unrelated environment byte', () => {
  const { envPath, credentialPath } = paths();
  const original = '# existing configuration\r\nPROPERTY_API_URL=http://localhost:3000\r\nANOTHER_SECRET="keep exactly"';
  fs.writeFileSync(envPath, original);
  const generator = deterministic(0xab);

  const result = setup({ envPath, credentialPath, randomBytes: generator.randomBytes });
  const token = 'ab'.repeat(32);
  assert.deepEqual(result, { status: 'created', credentialPath: path.resolve(credentialPath) });
  assert.equal(generator.calls(), 1);
  assert.equal(fs.readFileSync(envPath, 'utf8'), `${original}\r\nSCRAPER_ADMIN_TOKEN=${token}\r\n`);
  assert.equal(fs.readFileSync(credentialPath, 'utf8'), `${token}\n`);
  if (process.platform !== 'win32') assert.equal(fs.statSync(credentialPath).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(`${envPath}.source-operator.lock`), false);
});

test('reuses an existing nonempty token without rotating or rewriting the environment', () => {
  const { envPath, credentialPath } = paths();
  const original = 'FIRST=value\nSCRAPER_ADMIN_TOKEN=keep-this-token\nLAST=unchanged\n';
  fs.writeFileSync(envPath, original);
  const generator = deterministic(0xcd);

  const first = setup({ envPath, credentialPath, randomBytes: generator.randomBytes });
  const second = setup({ envPath, credentialPath, randomBytes: generator.randomBytes });
  assert.equal(first.status, 'reused');
  assert.equal(second.status, 'reused');
  assert.equal(generator.calls(), 0);
  assert.equal(fs.readFileSync(envPath, 'utf8'), original);
  assert.equal(fs.readFileSync(credentialPath, 'utf8'), 'keep-this-token\n');
});

test('fills one empty token definition in place without adding a duplicate', () => {
  const { envPath, credentialPath } = paths();
  const original = 'BEFORE=one\nSCRAPER_ADMIN_TOKEN=   \nAFTER=two\n';
  fs.writeFileSync(envPath, original);
  const generator = deterministic(0x07);

  const result = setup({ envPath, credentialPath, randomBytes: generator.randomBytes });
  const body = fs.readFileSync(envPath, 'utf8');
  assert.equal(result.status, 'created');
  assert.equal((body.match(/^SCRAPER_ADMIN_TOKEN=/gm) || []).length, 1);
  assert.equal(body, `BEFORE=one\nSCRAPER_ADMIN_TOKEN=${'07'.repeat(32)}\nAFTER=two\n`);
  assert.equal(fs.readFileSync(credentialPath, 'utf8'), `${'07'.repeat(32)}\n`);
});

test('preserves a byte-order mark while filling a first-line empty definition', () => {
  const { envPath, credentialPath } = paths();
  const original = '\uFEFFSCRAPER_ADMIN_TOKEN=\r\nUNCHANGED=yes\r\n';
  fs.writeFileSync(envPath, original);
  setup({ envPath, credentialPath, randomBytes: deterministic(0x11).randomBytes });
  assert.equal(fs.readFileSync(envPath, 'utf8'),
    `\uFEFFSCRAPER_ADMIN_TOKEN=${'11'.repeat(32)}\r\nUNCHANGED=yes\r\n`);
});

test('conflicting or repeated empty definitions fail without changing either file', () => {
  for (const body of [
    'SCRAPER_ADMIN_TOKEN=first\nSCRAPER_ADMIN_TOKEN=second\n',
    'SCRAPER_ADMIN_TOKEN=\nSCRAPER_ADMIN_TOKEN=  \n',
  ]) {
    const { envPath, credentialPath } = paths();
    fs.writeFileSync(envPath, body);
    assert.throws(() => setup({ envPath, credentialPath, randomBytes: deterministic(1).randomBytes }), /definitions/);
    assert.equal(fs.readFileSync(envPath, 'utf8'), body);
    assert.equal(fs.existsSync(credentialPath), false);
  }
});

test('setup result and CLI success output never expose the credential', () => {
  const { directory, envPath, credentialPath } = paths();
  const token = 'private-operator-token';
  fs.writeFileSync(envPath, `SCRAPER_ADMIN_TOKEN='${token}'\n`);
  const result = setup({ envPath, credentialPath });
  assert.equal(JSON.stringify(result).includes(token), false);

  const scriptPath = path.resolve(__dirname, '../scripts/setup-source-operator.js');
  const rejected = spawnSync(process.execPath, [scriptPath, directory], { encoding: 'utf8' });
  assert.equal(rejected.status, 2);
  assert.equal(rejected.stdout, '');
  assert.equal(`${rejected.stdout}${rejected.stderr}`.includes(token), false);
  assert.match(rejected.stderr, /accepts no path arguments/);
});
