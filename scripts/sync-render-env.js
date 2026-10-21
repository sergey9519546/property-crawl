'use strict';

/**
 * Operator Render Environment Synchronizer
 * 
 * Safely synchronizes local operator secrets from .env.local to the live Render web service.
 * Preserves all existing remote variables and only adds/updates declared keys.
 */

const fs = require('fs');
const path = require('path');

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

async function syncRenderEnv() {
  const localEnv = loadLocalEnv();
  const apiKey = process.env.RENDER_API_KEY || localEnv.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID || localEnv.RENDER_SERVICE_ID || 'srv-dbbc3vgm7kps73eehimg';

  if (!apiKey) {
    console.error('[operator:sync] RENDER_API_KEY is not set in environment or .env.local.');
    process.exit(1);
  }

  console.log(`[operator:sync] Connecting to Render API for service ${serviceId}...`);

  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (!res.ok) {
    console.error(`[operator:sync] Failed to fetch current Render env vars (${res.status}):`, await res.text());
    process.exit(1);
  }

  const remoteVars = await res.json();
  const varMap = new Map();
  for (const item of remoteVars) {
    varMap.set(item.envVar.key, item.envVar.value);
  }

  const candidateKeys = [
    'GOOGLE_MAPS_API_KEY',
    'NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY',
    'GOOGLE_API_KEY',
    'SCRAPER_ADMIN_TOKEN',
    'WORKSPACE_SESSION_SECRET',
    'WORKSPACE_SESSION_EPOCH',
    'PUBLIC_APP_ORIGIN',
    'NEWSLETTER_ENDPOINT',
    'CONTACT_ENDPOINT',
    'RESEND_API_KEY',
    'RESEND_FROM'
  ];

  let addedCount = 0;
  for (const key of candidateKeys) {
    const localVal = process.env[key] || localEnv[key];
    if (localVal && (!varMap.has(key) || varMap.get(key) !== localVal)) {
      varMap.set(key, localVal);
      console.log(`[operator:sync] + ${key}`);
      addedCount++;
    }
  }

  if (addedCount === 0) {
    console.log('[operator:sync] All candidate keys are already synchronized on Render.');
    return;
  }

  const payload = Array.from(varMap.entries()).map(([key, value]) => ({ key, value }));
  console.log(`[operator:sync] Uploading ${payload.length} environment variables to Render...`);

  const updateRes = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!updateRes.ok) {
    console.error(`[operator:sync] Failed to update Render env vars (${updateRes.status}):`, await updateRes.text());
    process.exit(1);
  }

  console.log(`[operator:sync] Successfully synchronized ${addedCount} environment variables to Render!`);
}

syncRenderEnv().catch(err => {
  console.error('[operator:sync] Fatal error:', err);
  process.exit(1);
});
