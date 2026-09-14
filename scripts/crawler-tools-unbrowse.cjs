'use strict';
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { SOURCE_HOSTS } = require('../server/scrapers/source-policy');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_DIR = path.join(ROOT, '.cache', 'crawler-tools', 'unbrowse');
const CANDIDATE_SCHEMA = 'property-crawl.unbrowse-route-candidate/v1';
const MAX_INPUT_BYTES = 1024 * 1024;
const SECRET_KEY = /(?:^|[_-])(auth|authorization|cookie|credential|key|password|secret|session|signature|token)(?:$|[_-])/i;
const TOP_KEYS = new Set(['schemaVersion', 'source', 'sourceUrl', 'method', 'reviewStatus', 'generatedAt', 'evidence']);
const EVIDENCE_KEYS = new Set(['provider', 'version', 'endpointUrl', 'observedAt', 'notes']);

function isSecretKey(key) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_KEY.test(String(key)) ||
    ['apikey', 'accesstoken', 'authtoken', 'authorization', 'cookie', 'credential', 'password', 'secret', 'sessionid', 'signature'].includes(normalized);
}

function defaultPackageRoot() {
  if (process.env.UNBROWSE_PACKAGE_ROOT) return path.resolve(process.env.UNBROWSE_PACKAGE_ROOT);
  if (process.env.APPDATA) return path.join(process.env.APPDATA, 'npm', 'node_modules', 'unbrowse');
  // Common npm global roots on Linux/macOS: check nvm and standard locations.
  const candidates = [
    process.env.NVM_DIR && path.join(process.env.NVM_DIR, 'current', 'lib', 'node_modules', 'unbrowse'),
    process.env.NVM_DIR && path.join(process.env.NVM_DIR, 'current', 'bin', 'node_modules', 'unbrowse'),
    process.env.HOME && path.join(process.env.HOME, '.nvm', 'current', 'lib', 'node_modules', 'unbrowse'),
    process.env.HOME && path.join(process.env.HOME, '.npm-global', 'lib', 'node_modules', 'unbrowse'),
    path.join('/usr', 'local', 'lib', 'node_modules', 'unbrowse'),
    path.join('/usr', 'lib', 'node_modules', 'unbrowse'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate; } catch (_) {}
  }
  return candidates[candidates.length - 1];
}

function inspectInstallation(packageRoot = defaultPackageRoot(), configDir = DEFAULT_CONFIG_DIR) {
  const packageFile = path.join(packageRoot, 'package.json');
  const wrapper = path.join(packageRoot, 'bin', 'unbrowse-wrapper.mjs');
  let version = null;
  let config = null;
  try { version = JSON.parse(fs.readFileSync(packageFile, 'utf8')).version || null; } catch (_) {}
  try { config = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8')); } catch (_) {}
  const tosAccepted = Boolean(config && typeof config.tos_accepted_version === 'string' && config.tos_accepted_version.trim());
  return {
    installed: Boolean(version && fs.existsSync(wrapper)), version, packageRoot, wrapper, configDir,
    setupReady: tosAccepted, tosAccepted,
  };
}

function configuredHosts(source) {
  const roots = SOURCE_HOSTS[source];
  if (!roots) throw new Error('Unknown source');
  const hosts = new Set();
  for (const value of roots) {
    const host = value.toLowerCase();
    hosts.add(host);
    hosts.add(host.startsWith('www.') ? host.slice(4) : `www.${host}`);
  }
  return hosts;
}

function validatePublisherUrl(raw, source) {
  let url;
  try { url = new URL(String(raw || '')); } catch (_) { throw new Error('URL must be absolute'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:') throw new Error('URL must use HTTPS');
  if (url.username || url.password) throw new Error('URL must not contain user information');
  if (url.port) throw new Error('URL must not use a non-default port');
  if (url.hash) throw new Error('URL must not contain a fragment');
  if (net.isIP(host)) throw new Error('IP address URLs are not allowed');
  if (!configuredHosts(source).has(host)) throw new Error('URL host is not configured for source');
  for (const key of url.searchParams.keys()) {
    if (isSecretKey(key)) throw new Error('Secret-like query parameter is not allowed');
  }
  return url;
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key) || isSecretKey(key)) throw new Error(`${label} contains forbidden field: ${key}`);
  }
}

function shortString(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} must be a bounded non-empty string`);
  if (/\bubr_[A-Za-z0-9._-]+/.test(value)) throw new Error(`${label} contains credential-like content`);
  if (/\b(?:authorization|cookie|password|secret|token)\s*[:=]/i.test(value)) throw new Error(`${label} contains credential-like content`);
  return value;
}

function validateCandidate(candidate) {
  exactKeys(candidate, TOP_KEYS, 'candidate');
  if (candidate.schemaVersion !== CANDIDATE_SCHEMA) throw new Error('candidate schemaVersion is invalid');
  const source = shortString(candidate.source, 'candidate source', 50).toLowerCase();
  const sourceUrl = validatePublisherUrl(candidate.sourceUrl, source).href;
  if (candidate.method !== 'GET') throw new Error('candidate method must be GET');
  if (candidate.reviewStatus !== 'pending') throw new Error('candidate reviewStatus must be pending');
  if (!candidate.generatedAt || Number.isNaN(Date.parse(candidate.generatedAt))) throw new Error('candidate generatedAt must be an ISO timestamp');
  exactKeys(candidate.evidence, EVIDENCE_KEYS, 'candidate evidence');
  if (candidate.evidence.provider !== 'unbrowse') throw new Error('candidate evidence provider must be unbrowse');
  const evidence = {
    provider: 'unbrowse',
    version: shortString(candidate.evidence.version, 'evidence version', 40),
    endpointUrl: validatePublisherUrl(candidate.evidence.endpointUrl, source).href,
    observedAt: candidate.evidence.observedAt,
  };
  if (!evidence.observedAt || Number.isNaN(Date.parse(evidence.observedAt))) throw new Error('evidence observedAt must be an ISO timestamp');
  if (candidate.evidence.notes !== undefined) evidence.notes = shortString(candidate.evidence.notes, 'evidence notes');
  return { schemaVersion: CANDIDATE_SCHEMA, source, sourceUrl, method: 'GET', reviewStatus: 'pending', generatedAt: candidate.generatedAt, evidence };
}

function candidateToIntake(candidate, options = {}) {
  const validated = validateCandidate(candidate);
  const intake = options.intake || require('../server/sources/intake');
  const now = options.now || new Date('2026-01-02T00:00:00.000Z');
  const result = intake.submitEvidence({
    sourceId: validated.source,
    sourceUrl: validated.sourceUrl,
    capturedAt: validated.evidence.observedAt,
    kind: 'json',
    records: [{
      route: validated.evidence.endpointUrl,
      method: validated.method,
      provider: validated.evidence.provider,
      providerVersion: validated.evidence.version,
      observedAt: validated.evidence.observedAt,
      generatedAt: validated.generatedAt,
      notes: validated.evidence.notes || null,
    }],
  }, { ...options, now });
  return { ...result, provenance: 'unbrowse-route-candidate', candidateSchema: CANDIDATE_SCHEMA };
}

function importCandidate(file) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('candidate file path is required');
  const absolute = path.resolve(file);
  let stat;
  try { stat = fs.statSync(absolute); } catch (_) { throw new Error('candidate file does not exist'); }
  if (!stat.isFile()) throw new Error('candidate path must be a file');
  if (stat.size > MAX_INPUT_BYTES) throw new Error('candidate input exceeds 1 MiB');
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(absolute, 'utf8')); }
  catch (error) { throw new Error(`candidate file is not valid JSON: ${error.message}`); }
  return validateCandidate(parsed);
}

function prepareInspection({ source, url: rawUrl, state = inspectInstallation() }) {
  const normalizedSource = shortString(source, 'source', 50).toLowerCase();
  const url = validatePublisherUrl(rawUrl, normalizedSource);
  return {
    ok: false, status: 'manual-review-required', source: normalizedSource, url: url.href,
    installedVersion: state.version, setupReady: state.setupReady, isolatedConfigDir: state.configDir,
    reason: state.setupReady ? 'resolve-can-probe-or-capture-and-is-not-run-by-this-wrapper' : 'isolated-config-has-no-tos_accepted_version',
    reviewPlan: [
      'Review and accept Unbrowse terms manually if appropriate; setup contacts the hosted service and creates an agent identity.',
      'Verify capture, publication, authentication, and payment settings against the installed version.',
      'Run resolve manually for this exact URL and inspect its route metadata.',
      `Save only a ${CANDIDATE_SCHEMA} GET candidate, then run import-candidate for validation.`,
    ],
  };
}

const USAGE = [
  'crawler-tools-unbrowse — safe route candidate intake',
  '',
  'Usage:',
  '  status | health | doctor',
  '  prepare --source SOURCE --url HTTPS_URL',
  '  import-candidate --file FILE',
  '  intake-candidate --file FILE [--store PATH]',
  '',
  'Manual-hosted-operation policy:',
  '  prepare only prints a review plan; it never runs Unbrowse or contacts hosted services.',
  '  Candidate files are restricted to configured HTTPS publisher hosts and pending GET routes.',
  '  Intake validates the candidate before handing it to the local source intake store.',
].join('\\n');

function parseArgs(argv) {
  const command = (!argv[0] || argv[0] === '-h' || argv[0] === '--help') ? 'help' : argv[0];
  const flags = {};
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { command: command === 'status' ? 'help' : command, flags: { help: true } };
    if (!arg.startsWith('--')) throw new Error(`Expected --name value, got: ${arg}`);
    const name = arg.slice(2);
    if (!name) throw new Error('Flag name must not be empty');
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`Flag --${name} requires a value (use --help for examples)`);
    flags[name] = argv[i + 1];
    i += 2;
  }
  return { command, flags };
}

async function main(argv = process.argv.slice(2)) {
  const { command, flags } = parseArgs(argv);
  if (command === 'help' || flags.help) return { help: USAGE };
  if (command === 'status' || command === 'health' || command === 'doctor') return inspectInstallation();
  if (command === 'prepare' || command === 'inspect-url') return prepareInspection({ source: flags.source, url: flags.url });
  if (command === 'import-candidate') return importCandidate(flags.file);
  if (command === 'intake-candidate') {
    const candidate = importCandidate(flags.file);
    return candidateToIntake(candidate, { storePath: flags.store ? path.resolve(flags.store) : undefined });
  }
  throw new Error('Usage: doctor | status | health | prepare --source SOURCE --url URL | import-candidate --file FILE | intake-candidate --file FILE [--store PATH]');
}

if (require.main === module) {
  main().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch((error) => {
    process.stderr.write(`Unbrowse onboarding request was rejected: ${error.message}\n`);
    process.exitCode = 1;
  });
}
module.exports = {
  CANDIDATE_SCHEMA, DEFAULT_CONFIG_DIR, MAX_INPUT_BYTES, candidateToIntake, configuredHosts, importCandidate,
  inspectInstallation, main, prepareInspection, validateCandidate, validatePublisherUrl,
};
