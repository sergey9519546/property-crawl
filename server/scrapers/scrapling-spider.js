'use strict';

/**
 * server/scrapers/scrapling-spider.js
 *
 * Hardened Scrapling Spider Engine bridge for property-crawl.
 * Resolves the dual-scheduler impedance mismatch by invoking Scrapling as a
 * streaming stateless batch worker over stdin/stdout JSON lines.
 *
 * Directives:
 * 1. Node.js scheduler retains exclusive control over DB cursor, rate limits,
 *    circuit breakers, and checkpoints (setCheckpoint).
 * 2. Distinct session IDs (sid) partition TLS fingerprints, cookie jars, and UA pools.
 * 3. Fail-Closed Legal Moat: Disallowed robots.txt or WAF blocks emit explicit typed
 *    audit events (ACCESS_POLICY_VIOLATION, SOURCE_OBSERVATION_ERROR) - never silent drop.
 * 4. Provenance tracking: engine, engineVersion, contentSha256, profile, sessionType.
 * 5. Process Boundedness: child process reaped cleanly with CHILD_EXIT_GRACE_MS.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { defaultPython, getScraplingRuntimeStatus } = require('./scrapling-bridge');

const DEFAULT_TIMEOUT_MS = 30000;
const CHILD_EXIT_GRACE_MS = 2000;

class SpiderExecutionError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SpiderExecutionError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Generates an isolated session ID (sid) partitioned by source key and publisher tier.
 */
function allocateSessionId(sourceKey, scope = 'default') {
  const safeSource = String(sourceKey || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const safeScope = String(scope || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `pub:${safeSource}:${safeScope}`;
}

/**
 * Executes a streaming stateless spider batch via scripts/crawlers/scrapling_spider.py.
 */
async function runSpiderBatch({
  sourceKey,
  urls = [],
  profile,
  sid,
  sessionType = 'fetcher',
  impersonate = 'chrome131',
  obeyRobots = true,
  maxBlockedRetries = 2,
  mockResponses = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  python = defaultPython(),
  scriptPath,
  signal,
} = {}) {
  if (!sourceKey || typeof sourceKey !== 'string') {
    throw new SpiderExecutionError('sourceKey is required', 'SPIDER_INVALID_ARGUMENT');
  }
  if (!Array.isArray(urls) || urls.length === 0) {
    return { items: [], events: [], stats: { total: 0, succeeded: 0, blocked: 0, disallowed: 0 } };
  }
  if (!profile || typeof profile !== 'string') {
    throw new SpiderExecutionError('profile is required', 'SPIDER_INVALID_ARGUMENT');
  }

  const runtime = getScraplingRuntimeStatus(python);
  if (!runtime.available) {
    throw new SpiderExecutionError('Scrapling Python runtime not found', runtime.code || 'SCRAPLING_RUNTIME_MISSING');
  }

  const resolvedScript = scriptPath || path.resolve(__dirname, '..', '..', 'scripts', 'crawlers', 'scrapling_spider.py');
  if (!fs.existsSync(resolvedScript)) {
    throw new SpiderExecutionError(`Spider script not found at ${resolvedScript}`, 'SPIDER_SCRIPT_NOT_FOUND');
  }

  const sessionIdentifier = sid || allocateSessionId(sourceKey);
  const payload = JSON.stringify({
    version: 1,
    sourceKey,
    urls,
    profile,
    sid: sessionIdentifier,
    sessionType,
    impersonate,
    obeyRobots,
    maxBlockedRetries,
    mockResponses,
    timeoutSeconds: Math.ceil(timeoutMs / 1000),
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const stdoutChunks = [];
    const stderrChunks = [];
    const items = [];
    const events = [];

    const stats = {
      total: urls.length,
      succeeded: 0,
      blocked: 0,
      disallowed: 0,
    };

    const childEnv = Object.fromEntries(
      ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'PYTHONPATH']
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]])
    );
    childEnv.PYTHONIOENCODING = 'utf-8';
    childEnv.PYTHONUTF8 = '1';

    const child = spawn(runtime.python, [resolvedScript], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    });

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };

    const kill = () => {
      if (!child.killed) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    };

    let terminating = false;
    const terminate = (error) => {
      if (terminating) return finish(error);
      terminating = true;
      if (child.exitCode !== null || child.signalCode !== null) return finish(error);
      const grace = setTimeout(() => finish(error), CHILD_EXIT_GRACE_MS);
      grace.unref?.();
      child.once('exit', () => finish(error));
      kill();
    };

    const abort = () => terminate(new SpiderExecutionError('Spider execution aborted', 'SPIDER_ABORTED'));
    const timer = setTimeout(() => terminate(new SpiderExecutionError('Spider execution timed out', 'SPIDER_TIMEOUT')), timeoutMs);

    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();

    child.once('error', (err) => finish(new SpiderExecutionError(`Failed to spawn spider process: ${err.message}`, 'SPIDER_SPAWN_FAILED')));

    let buffer = '';
    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk);
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep partial line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          events.push(parsed);

          if (parsed.event === 'EXTRACTION_SUCCESS') {
            stats.succeeded += 1;
            items.push(parsed);
          } else if (parsed.event === 'SOURCE_OBSERVATION_ERROR') {
            stats.blocked += 1;
          } else if (parsed.event === 'ACCESS_POLICY_VIOLATION') {
            stats.disallowed += 1;
          }
        } catch (_) {
          // Non-JSON line from child process
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      if (stderrChunks.length < 50) stderrChunks.push(chunk);
    });

    child.once('close', (code) => {
      if (settled) return;
      if (terminating) return;

      // Handle any trailing line in buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          events.push(parsed);
          if (parsed.event === 'EXTRACTION_SUCCESS') {
            stats.succeeded += 1;
            items.push(parsed);
          } else if (parsed.event === 'SOURCE_OBSERVATION_ERROR') {
            stats.blocked += 1;
          } else if (parsed.event === 'ACCESS_POLICY_VIOLATION') {
            stats.disallowed += 1;
          }
        } catch (_) {}
      }

      // Check for policy violation or block errors
      const blockEvent = events.find((e) => e.event === 'SOURCE_OBSERVATION_ERROR');
      if (blockEvent) {
        return finish(new SpiderExecutionError(
          `Scrapling spider observed block on ${blockEvent.url}: ${blockEvent.reason}`,
          'SOURCE_OBSERVATION_ERROR',
          blockEvent
        ));
      }

      const policyEvent = events.find((e) => e.event === 'ACCESS_POLICY_VIOLATION');
      if (policyEvent) {
        return finish(new SpiderExecutionError(
          `Scrapling spider access policy violation on ${policyEvent.url}: ${policyEvent.reason}`,
          'ACCESS_POLICY_VIOLATION',
          policyEvent
        ));
      }

      if (code !== 0 && items.length === 0) {
        const errDetails = Buffer.concat(stderrChunks).toString('utf8').trim() || `exit code ${code}`;
        return finish(new SpiderExecutionError(`Spider worker failed: ${errDetails}`, 'SPIDER_PROCESS_FAILED'));
      }

      finish(null, { items, events, stats });
    });

    child.stdin.once('error', (err) => {
      terminate(new SpiderExecutionError(`Unable to write payload to spider worker: ${err.message}`, 'SPIDER_STDIN_FAILED'));
    });
    child.stdin.end(payload);
  });
}

module.exports = {
  runSpiderBatch,
  allocateSessionId,
  SpiderExecutionError,
  DEFAULT_TIMEOUT_MS,
  CHILD_EXIT_GRACE_MS,
};
