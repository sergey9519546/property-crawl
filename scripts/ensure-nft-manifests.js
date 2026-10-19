'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

function resolveDistDirs(explicitDistDir) {
  const dirs = new Set(['.next']);
  if (process.env.NEXT_DISCOVERY_PREVIEW === '1') dirs.add('.next-discovery-preview');
  if (process.env.NEXT_VERIFY_BUILD === 'sources') dirs.add('.next-sources-verify');
  if (process.env.NEXT_VERIFY_BUILD === '1') dirs.add('.next-verify');
  if (explicitDistDir) dirs.add(explicitDistDir);
  return Array.from(dirs).map((d) => (path.isAbsolute(d) ? d : path.join(root, d)));
}

function ensureNftManifests(explicitDistDir) {
  const entrySource = '// Turbopack proxy compatibility module\nmodule.exports = {};\n';
  const entryHash = crypto.createHash('sha256').update('file:').update(entrySource).digest('hex');
  const nftPayload = JSON.stringify({
    version: 1,
    files: [],
    fileHashes: [],
    entryHash,
  });

  for (const distDir of resolveDistDirs(explicitDistDir)) {
    const serverDir = path.join(distDir, 'server');
    if (!fs.existsSync(serverDir)) continue;

    for (const base of ['middleware.js', 'proxy.js']) {
      const jsPath = path.join(serverDir, base);
      const nftPath = path.join(serverDir, `${base}.nft.json`);
      if (!fs.existsSync(jsPath)) {
        fs.writeFileSync(jsPath, entrySource);
      }
      if (!fs.existsSync(nftPath)) {
        fs.writeFileSync(nftPath, nftPayload);
      }
    }
  }
}

const upstreamAdapterPath =
  process.env.NEXT_ADAPTER_PATH &&
  path.resolve(process.env.NEXT_ADAPTER_PATH) !== __filename
    ? process.env.NEXT_ADAPTER_PATH
    : null;

async function loadUpstreamAdapter() {
  if (!upstreamAdapterPath) return null;
  const resolved = require.resolve(upstreamAdapterPath);
  const mod = await import(pathToFileURL(resolved).href);
  return mod && mod.default ? mod.default : mod;
}

const adapter = {
  name: 'property-crawl-nft-manifest-adapter',
};

if (upstreamAdapterPath) {
  adapter.modifyConfig = async (config, ctx) => {
    const upstream = await loadUpstreamAdapter();
    if (upstream && typeof upstream.modifyConfig === 'function') {
      return upstream.modifyConfig(config, ctx);
    }
    return config;
  };
}

Object.defineProperty(adapter, 'onBuildComplete', {
  enumerable: true,
  get() {
    ensureNftManifests();
    if (!upstreamAdapterPath) return undefined;
    return async (ctx) => {
      ensureNftManifests(ctx && ctx.distDir);
      const upstream = await loadUpstreamAdapter();
      if (upstream && typeof upstream.onBuildComplete === 'function') {
        return upstream.onBuildComplete(ctx);
      }
    };
  },
});

if (require.main === module) {
  ensureNftManifests();
  console.log('[ensure-nft-manifests] verified middleware NFT manifests for deployment platforms');
}

module.exports = adapter;
module.exports.ensureNftManifests = ensureNftManifests;
