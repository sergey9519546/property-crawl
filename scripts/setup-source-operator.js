#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV_PATH = path.join(REPO_ROOT, '.env.local');
const DEFAULT_CREDENTIAL_PATH = path.join(REPO_ROOT, '.cache', 'source-operator-credential.txt');
const TOKEN_KEY = 'SCRAPER_ADMIN_TOKEN';
const MAX_ENV_BYTES = 2 * 1024 * 1024;
const MAX_TOKEN_LENGTH = 4096;

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return '';
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const closing = trimmed.indexOf(quote, 1);
    if (closing < 0 || !/^(?:\s*#.*)?$/.test(trimmed.slice(closing + 1))) {
      throw new Error(`${TOKEN_KEY} has invalid quoting`);
    }
    return trimmed.slice(1, closing).trim();
  }
  const comment = trimmed.search(/\s+#/);
  return (comment >= 0 ? trimmed.slice(0, comment) : trimmed).trim();
}

function tokenDefinitions(body) {
  const definitions = [];
  const linePattern = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let match;
  while ((match = linePattern.exec(body)) && match[0]) {
    const fullLine = match[0];
    const content = fullLine.replace(/(?:\r\n|\n|\r)$/, '');
    const lineEnding = fullLine.slice(content.length);
    const byteOrderMark = match.index === 0 && content.startsWith('\uFEFF') ? '\uFEFF' : '';
    const normalized = byteOrderMark ? content.slice(1) : content;
    const definition = normalized.match(/^([ \t]*(?:export[ \t]+)?SCRAPER_ADMIN_TOKEN[ \t]*=[ \t]*)(.*)$/);
    if (definition) {
      definitions.push({
        start: match.index,
        end: match.index + fullLine.length,
        fullLine,
        lineEnding,
        prefix: `${byteOrderMark}${definition[1].replace(/[ \t]+$/, '')}`,
        rawValue: definition[2],
        value: parseEnvValue(definition[2]),
      });
    }
    if (linePattern.lastIndex === match.index) linePattern.lastIndex++;
  }
  return definitions;
}

function generatedToken(randomBytes) {
  const bytes = randomBytes(32);
  if (!bytes || typeof bytes.length !== 'number' || bytes.length !== 32) {
    throw new Error('Secure token generator must return exactly 32 bytes');
  }
  return Buffer.from(bytes).toString('hex');
}

function validateToken(token) {
  if (typeof token !== 'string' || !token.trim() || token.length > MAX_TOKEN_LENGTH
    || /[\r\n\u0000-\u001f\u007f]/.test(token)) {
    throw new Error(`${TOKEN_KEY} must be a nonempty single-line value`);
  }
  return token.trim();
}

function appendDefinition(body, token) {
  const newline = body.includes('\r\n') ? '\r\n' : body.includes('\r') && !body.includes('\n') ? '\r' : '\n';
  const separator = body.length && !/[\r\n]$/.test(body) ? newline : '';
  return `${body}${separator}${TOKEN_KEY}=${token}${newline}`;
}

function replaceEmptyDefinition(body, definition, token) {
  const replacement = `${definition.prefix}${token}${definition.lineEnding}`;
  return `${body.slice(0, definition.start)}${replacement}${body.slice(definition.end)}`;
}

function atomicWrite(filePath, contents, options = {}) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', options.mode ?? 0o600);
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (options.mode !== undefined) fs.chmodSync(temporaryPath, options.mode);
    fs.renameSync(temporaryPath, filePath);
    if (options.mode !== undefined) fs.chmodSync(filePath, options.mode);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function setup({ envPath, credentialPath, randomBytes = crypto.randomBytes } = {}) {
  const resolvedEnvPath = path.resolve(envPath || DEFAULT_ENV_PATH);
  const resolvedCredentialPath = path.resolve(credentialPath || DEFAULT_CREDENTIAL_PATH);
  if (resolvedEnvPath === resolvedCredentialPath) throw new Error('Environment and credential paths must differ');
  if (typeof randomBytes !== 'function') throw new TypeError('randomBytes must be a function');

  fs.mkdirSync(path.dirname(resolvedEnvPath), { recursive: true });
  const lockPath = `${resolvedEnvPath}.source-operator.lock`;
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Source operator setup is already running');
    throw error;
  }

  try {
    let body = '';
    let envMode = 0o600;
    if (fs.existsSync(resolvedEnvPath)) {
      const stats = fs.statSync(resolvedEnvPath);
      if (!stats.isFile() || stats.size > MAX_ENV_BYTES) throw new Error('Environment file exceeds its safe size limit');
      envMode = stats.mode & 0o777;
      body = fs.readFileSync(resolvedEnvPath, 'utf8');
    }

    const definitions = tokenDefinitions(body);
    const existingValues = [...new Set(definitions.map((definition) => definition.value).filter(Boolean))];
    if (existingValues.length > 1) {
      throw new Error(`Conflicting ${TOKEN_KEY} definitions must be resolved before setup`);
    }

    let token;
    let status;
    if (existingValues.length === 1) {
      token = validateToken(existingValues[0]);
      status = 'reused';
    } else {
      token = generatedToken(randomBytes);
      status = 'created';
      const emptyDefinitions = definitions.filter((definition) => !definition.value);
      if (emptyDefinitions.length > 1) {
        throw new Error(`Multiple empty ${TOKEN_KEY} definitions must be reduced to one before setup`);
      }
      const nextBody = emptyDefinitions.length === 1
        ? replaceEmptyDefinition(body, emptyDefinitions[0], token)
        : appendDefinition(body, token);
      atomicWrite(resolvedEnvPath, nextBody, { mode: envMode });
    }

    atomicWrite(resolvedCredentialPath, `${token}\n`, { mode: 0o600 });
    return { status, credentialPath: resolvedCredentialPath };
  } finally {
    if (lock !== undefined) fs.closeSync(lock);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

if (require.main === module) {
  if (process.argv.length > 2) {
    console.error('Source operator setup accepts no path arguments.');
    process.exitCode = 2;
  } else {
    try {
      const result = setup();
      process.stdout.write(`${result.status}\n${result.credentialPath}\n`);
    } catch (error) {
      console.error(`Source operator setup failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  DEFAULT_CREDENTIAL_PATH,
  DEFAULT_ENV_PATH,
  MAX_ENV_BYTES,
  TOKEN_KEY,
  setup,
};
