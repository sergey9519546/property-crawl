const fs = require('node:fs');
const path = require('node:path');
const { SOURCES } = require('./build-data');

// Update only the generated source taxonomy, preserving every listing byte and its capture date.
const root = path.resolve(__dirname, '..');
const dataPath = path.join(root, 'data.js');
const original = fs.readFileSync(dataPath, 'utf8');
const start = original.indexOf('window.SOURCES = ');
const end = original.indexOf('window.LISTINGS = ');
if (start < 0 || end <= start) throw new Error('Generated data markers not found; no files changed');
fs.writeFileSync(dataPath, original.slice(0, start) + `window.SOURCES = ${JSON.stringify(SOURCES, null, 2)};\n\n` + original.slice(end));
const snapshotPath = path.join(root, 'data/sources.snapshot.json');
if (fs.existsSync(snapshotPath)) fs.writeFileSync(snapshotPath, JSON.stringify(Object.values(SOURCES), null, 2));
console.log(`Synchronized ${Object.keys(SOURCES).length} sources; listing contents preserved.`);
