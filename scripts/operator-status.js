'use strict';

/**
 * Operator Status Dashboard
 * 
 * Inspects live Render service status, PostgreSQL health, deployment history,
 * and confirms GitHub Actions zero-cost CI safety.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_LOCAL = path.join(ROOT, '.env.local');

function loadLocalEnv() {
  if (!fs.existsSync(ENV_LOCAL)) return {};
  const content = fs.readFileSync(ENV_LOCAL, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      env[key] = val;
    }
  }
  return env;
}

async function reportStatus() {
  console.log('========================================================================');
  console.log('🔍 OPERATOR STATUS DASHBOARD — PERFECTPROPERTY');
  console.log('========================================================================');

  // 1. Git Status & Heads
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  console.log(`[Git] Branch: ${branch} | Local Head: ${sha}`);

  // 2. Worktree Count
  const worktrees = execSync('git worktree list', { encoding: 'utf8' }).trim().split('\n');
  console.log(`[Git] Active Worktrees: ${worktrees.length}`);

  // 3. Live Public Endpoint Health
  const appOrigin = process.env.PUBLIC_APP_ORIGIN || 'https://property-crawl.onrender.com';
  try {
    const res = await fetch(`${appOrigin}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const health = await res.json();
      console.log(`[Live Web] URL: ${appOrigin}`);
      console.log(`[Live Web] Status: ${health.status} | Data Mode: ${health.dataMode} | Uptime: ${Math.round(health.uptime)}s`);
      console.log(`[Live Web] PostgreSQL Connected: ${health.postgresReachable} | Listings: ${health.inventoryFreshness?.listings ?? 'N/A'}`);
    } else {
      console.log(`[Live Web] Healthcheck returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.log(`[Live Web] Could not reach healthcheck: ${err.message}`);
  }

  // 4. Render API Status (if key present)
  const localEnv = loadLocalEnv();
  const apiKey = process.env.RENDER_API_KEY || localEnv.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID || localEnv.RENDER_SERVICE_ID || 'srv-dbbc3vgm7kps73eehimg';

  if (apiKey) {
    try {
      const deploysRes = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=2`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000)
      });
      if (deploysRes.ok) {
        const deploys = await deploysRes.json();
        console.log(`------------------------------------------------------------------------`);
        console.log(`[Render Service] ID: ${serviceId}`);
        deploys.forEach((d, idx) => {
          const commit = d.deploy.commit ? d.deploy.commit.id.slice(0, 7) : 'no-commit';
          console.log(`[Render Deploy #${idx + 1}] ID: ${d.deploy.id} | Status: ${d.deploy.status} | Commit: ${commit} | At: ${d.deploy.createdAt}`);
        });
      }
    } catch {
      // transient
    }
  }

  // 5. Zero-Cost CI Invariants
  console.log(`------------------------------------------------------------------------`);
  try {
    const workflows = execSync('gh workflow list --all', { encoding: 'utf8' }).trim().split('\n');
    console.log(`[CI Safeguard] GitHub Actions Workflows:`);
    workflows.forEach(w => console.log(`  • ${w}`));
  } catch {
    console.log(`[CI Safeguard] GitHub CLI not authenticated or unavailable.`);
  }

  console.log('========================================================================');
}

reportStatus().catch(err => {
  console.error('[operator:status] Error:', err);
});
