'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverDir = path.join(root, '.next', 'server');

if (fs.existsSync(serverDir)) {
  const middlewareJs = path.join(serverDir, 'middleware.js');
  const middlewareNft = path.join(serverDir, 'middleware.js.nft.json');

  if (!fs.existsSync(middlewareJs)) {
    fs.writeFileSync(middlewareJs, '// Turbopack proxy compatibility stub\nmodule.exports = {};\n');
  }
  if (!fs.existsSync(middlewareNft)) {
    fs.writeFileSync(middlewareNft, JSON.stringify({ version: 1, files: [] }));
  }
  console.log('[ensure-nft-manifests] verified middleware NFT stubs for deployment platforms');
}
