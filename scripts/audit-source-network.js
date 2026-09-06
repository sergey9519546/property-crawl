#!/usr/bin/env node
'use strict';

// Runs the scheduler-backed collectors in isolated Node processes. It never
// rewrites data.js or snapshots; collect-source owns validated cache/history
// updates. A killed process gets a single failed-run observation here only when
// it did not already write one itself.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadObservations, recordSourceRun, DEFAULT_PATH } = require('../server/sources/observations');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache');
const SOURCE_KEYS = Object.freeze([
  'treasury', 'gsa', 'irs', 'usda', 'landbank', 'civilview', 'bid4assets',
  'sheriff', 'hud', 'fannie', 'freddie', 'va', 'marshals'
]);
const MAX_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_LOG_BYTES = 24 * 1024;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function clip(text) {
  const value = String(text || '');
  return value.length <= MAX_LOG_BYTES ? value : `${value.slice(0, MAX_LOG_BYTES)}\n[truncated]`;
}

function runCount(sourceId, filePath) {
  try { return loadObservations({ filePath }).runs[sourceId]?.runs || 0; } catch (_) { return 0; }
}

function commandFor(sourceId) {
  const args = [path.join('scripts', 'collect-source.js'), sourceId];
  const env = { ...process.env };
  if (sourceId === 'civilview') args.push('--state', 'NJ', '--counties', '1', '--limit', '2');
  if (sourceId === 'hud') Object.assign(env, {
    HUD_MAX_STATES: '1', HUD_MAX_PAGES_PER_STATE: '1', HUD_PAGE_SIZE: '10', HUD_STATE_CONCURRENCY: '1'
  });
  return { args, env };
}

function collectorSummary(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value === 'object' && typeof value.source === 'string') {
        return {
          accepted: Number(value.accepted) || 0,
          rejected: Number(value.rejected) || 0,
          retained: Number(value.retained) || 0,
          coverage: value.coverage || null
        };
      }
    } catch (_) {}
  }
  return null;
}

function classificationFor({ timedOut, exitCode, stdout, stderr }) {
  const output = `${stdout}\n${stderr}`.toLowerCase();
  const summary = collectorSummary(stdout);
  if (timedOut) return { classification: 'timeout', summary, auditError: null };
  if (/waf bot challenge|captcha|turnstile|cloudflare|akamai/.test(output)) return { classification: 'blocked', summary, auditError: null };
  if (/fetch failed|upstream_transport_error|upstream_timeout|enotfound|econnreset|econnrefused|eai_again/.test(output)) return { classification: 'network_error', summary, auditError: null };
  if (exitCode !== 0) return { classification: 'collector_error', summary, auditError: null };
  if (summary && summary.accepted > 0) return { classification: 'records_collected', summary, auditError: null };
  if (summary?.coverage?.outcome === 'empty') return { classification: 'verified_empty', summary, auditError: null };
  return {
    classification: 'zero_yield_unverified',
    summary,
    auditError: 'Collector returned zero records without a verified-empty run report; upstream failure may have been swallowed, so this is not evidence of zero inventory.'
  };
}

function diagnosticEndpoint(sourceId) {
  const endpoints = {
    sheriff: 'https://cuyahoga.sheriffsaleauction.ohio.gov/index.cfm?zaction=AUCTION&zmethod=PREVIEW',
    fannie: 'https://www.homepath.fanniemae.com/search-service/v1/properties?state=TX&pageSize=25',
    freddie: 'https://www.homesteps.com/homesteps/api/propertysearch?state=TX',
    va: 'https://vrmproperties.com/api/properties?state=TX',
    marshals: 'https://www.usmarshals.gov/what-we-do/asset-forfeiture/real-property'
  };
  return endpoints[sourceId] || null;
}

async function diagnoseEndpoint(sourceId) {
  const endpoint = diagnosticEndpoint(sourceId);
  if (!endpoint) return null;
  // The request is made through the existing source collector's requestText(),
  // which preserves circuit-breaker policy. It records only host and error
  // codes, never response content, credentials, or headers.
  const modulePath = path.join(ROOT, 'server', 'scrapers', `${sourceId}.js`);
  const code = [
    'const scraper=require(process.argv[1]);',
    'const endpoint=process.argv[2];',
    'const host=new URL(endpoint).hostname;',
    'scraper.requestText(endpoint,{timeoutMs:15000}).then(body=>console.log(JSON.stringify({host,ok:true,bytes:Buffer.byteLength(body)}))).catch(error=>console.log(JSON.stringify({host,ok:false,code:error.code||null,causeCode:error.cause?.code||null,message:String(error.message||\'\').slice(0,160)})));'
  ].join('');
  const start = Date.now();
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(process.execPath, ['-e', code, modulePath, endpoint], {
      cwd: ROOT, env: process.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const deadline = setTimeout(() => child.kill(), 15_000);
    child.stdout.on('data', (chunk) => { output = clip(output + chunk); });
    child.once('error', (error) => { clearTimeout(deadline); resolve({ host: new URL(endpoint).hostname, ok: false, code: error.code || null, causeCode: error.cause?.code || null, durationMs: Date.now() - start }); });
    child.once('close', () => {
      clearTimeout(deadline);
      try { resolve({ ...JSON.parse(output.trim()), durationMs: Date.now() - start }); }
      catch (_) { resolve({ host: new URL(endpoint).hostname, ok: false, code: 'DIAGNOSTIC_NO_RESULT', causeCode: null, durationMs: Date.now() - start }); }
    });
  });
}

async function auditOne(sourceId, options) {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const observationRunsBefore = runCount(sourceId, options.observationPath);
  const { args, env } = commandFor(sourceId);
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let child;

  const exit = await new Promise((resolve, reject) => {
    try {
      child = spawn(process.execPath, args, {
        cwd: ROOT,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) { reject(error); return; }
    child.stdout.on('data', (chunk) => { stdout = clip(stdout + chunk); });
    child.stderr.on('data', (chunk) => { stderr = clip(stderr + chunk); });
    child.once('error', reject);
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill();
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 2_000).unref();
    }, options.timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(deadline);
      resolve({ code, signal });
    });
  });

  const durationMs = Date.now() - start;
  const observationRunsAfter = runCount(sourceId, options.observationPath);
  let status = timedOut ? 'timeout' : exit.code === 0 ? 'completed' : 'failed';
  const classification = classificationFor({ timedOut, exitCode: exit.code, stdout, stderr });
  const endpointDiagnostic = classification.classification === 'zero_yield_unverified'
    ? await diagnoseEndpoint(sourceId)
    : null;
  let observationWrittenByAudit = false;
  let error = timedOut
    ? `Audit process deadline exceeded after ${options.timeoutMs}ms`
    : exit.code === 0
      ? null
      : clip(stderr || stdout || `collector exited with code ${exit.code ?? 'unknown'}`);
  if (classification.auditError) {
    status = 'unverified_zero_yield';
    error = classification.auditError;
  }

  if (error && (observationRunsAfter === observationRunsBefore || classification.auditError)) {
    try {
      recordSourceRun(sourceId, { listings: [], error, rejectedCount: 0, durationMs }, { filePath: options.observationPath });
      observationWrittenByAudit = true;
    } catch (recordError) {
      status = 'failed';
      stderr = clip(`${stderr}\n[audit observation failure] ${recordError.message}`);
    }
  }

  const result = {
    sourceId, status, classification: classification.classification, collectorSummary: classification.summary, endpointDiagnostic, startedAt, finishedAt: new Date().toISOString(), durationMs,
    timeoutMs: options.timeoutMs, exitCode: exit.code, signal: exit.signal,
    observationPath: options.observationPath, liveStorePath: options.liveStorePath,
    observationWrittenByCollector: observationRunsAfter > observationRunsBefore,
    observationWrittenByAudit, command: { executable: process.execPath, args },
    stdout: clip(stdout), stderr: clip(stderr), error
  };
  fs.writeFileSync(path.join(options.runDirectory, `${sourceId}.log`), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await worker(items[index]); }
      catch (error) { results[index] = { sourceId: items[index], status: 'failed', error: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const runDirectory = path.join(CACHE_DIR, `source-live-audit-${timestamp()}`);
  fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  const options = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    observationPath: process.env.PROPERTY_OBSERVATIONS_PATH || DEFAULT_PATH,
    liveStorePath: process.env.PROPERTY_LIVE_CACHE_PATH || path.join(CACHE_DIR, 'live-listings.json'),
    runDirectory
  };
  const sources = process.argv.slice(2).length ? process.argv.slice(2) : [...SOURCE_KEYS];
  if (sources.some((source) => !SOURCE_KEYS.includes(source))) throw new Error(`Only scheduler-backed sources may be audited: ${SOURCE_KEYS.join(', ')}`);
  const results = await mapWithConcurrency(sources, MAX_CONCURRENCY, (source) => auditOne(source, options));
  const report = {
    startedAt: results.map((result) => result.startedAt).filter(Boolean).sort()[0] || new Date().toISOString(),
    finishedAt: new Date().toISOString(), concurrency: MAX_CONCURRENCY, timeoutMs: options.timeoutMs,
    runDirectory, observationPath: options.observationPath, liveStorePath: options.liveStorePath,
    results
  };
  fs.writeFileSync(path.join(runDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report));
}

main().catch((error) => { console.error(`[audit-source-network] ${error.message}`); process.exitCode = 1; });
