'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Local operator secrets live in .env.local (same contract as start:api).
 * Next.js loads that file itself; the plain Node listing API does not.
 * Values already present in process.env always win (cloud secret injection).
 */
function loadLocalEnvFiles(env, files = ['.env.local', '.env'], root = path.resolve(__dirname, '..')) {
  const merged = { ...env };
  for (const name of files) {
    const filePath = path.join(root, name);
    if (!fs.existsSync(filePath)) continue;
    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key || key in merged) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
        || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      merged[key] = value;
    }
  }
  return merged;
}

function resolveInternalApiPort(publicPort, explicitInternalPort) {
  const explicit = Number(explicitInternalPort);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  // Cloud PORT=3000 keeps the historical 3002 internal port; any other
  // public port uses publicPort+2 so local multi-stack runs do not collide.
  return publicPort === 3000 ? 3002 : publicPort + 2;
}

module.exports = { loadLocalEnvFiles, resolveInternalApiPort };
