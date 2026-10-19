'use strict';
/**
 * scripts/keep-alive-ping.js
 *
 * Lightweight periodic heartbeat ping to prevent free-tier containers
 * (Render, Koyeb, Hugging Face) from spinning down due to idle timeouts.
 *
 * Usage:
 *   node scripts/keep-alive-ping.js [url] [--interval=600] [--once]
 *
 * Default URL: process.env.DEPLOY_SMOKE_URL || 'https://property-crawl.onrender.com'
 */

function getTargetUrl() {
  const targetArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  const base = (targetArg || process.env.DEPLOY_SMOKE_URL || 'https://property-crawl.onrender.com').replace(/\/$/, '');
  return base.endsWith('/api/health') ? base : `${base}/api/health`;
}

async function ping(customUrl) {
  const healthUrl = customUrl || getTargetUrl();
  const start = Date.now();
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
    const elapsed = Date.now() - start;
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {}

    const isOk = res.ok && payload && payload.status === 'ok';
    const statusNote = isOk ? 'HEALTHY' : `HTTP_${res.status}`;
    const modeNote = payload?.dataMode ? `dataMode=${payload.dataMode}` : 'unknown_mode';
    const storeNote = payload?.documentReviewStore ? `store=${payload.documentReviewStore}` : '';

    console.log(`[${new Date().toISOString()}] [${statusNote}] ${healthUrl} (${elapsed}ms) ${modeNote} ${storeNote}`.trim());
    return { ok: isOk, status: res.status, elapsed, payload };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`[${new Date().toISOString()}] [ERROR] ${healthUrl} (${elapsed}ms): ${err.message}`);
    return { ok: false, error: err.message, elapsed };
  }
}

async function main() {
  const once = process.argv.includes('--once');
  const intervalArg = process.argv.find((arg) => arg.startsWith('--interval='));
  const intervalSeconds = intervalArg ? Number(intervalArg.slice('--interval='.length)) : 600;
  const healthUrl = getTargetUrl();

  console.log(`Keep-alive ping targeting: ${healthUrl}`);
  const result = await ping(healthUrl);

  if (once) {
    process.exit(result.ok ? 0 : 1);
  }

  const intervalMs = Math.max(30, intervalSeconds) * 1000;
  console.log(`Scheduling periodic heartbeat every ${intervalMs / 1000}s. Press Ctrl+C to stop.`);
  setInterval(() => ping(healthUrl), intervalMs);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal keep-alive error:', err);
    process.exit(1);
  });
}

module.exports = { ping, getTargetUrl };
