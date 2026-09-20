'use strict';

/**
 * Keep src/lib/db/schema.sql byte-identical to server/db/schema.sql.
 * Usage:
 *   node scripts/sync-schema-mirror.js          # copy server → Next mirror
 *   node scripts/sync-schema-mirror.js --check  # fail if mirrors drift
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL = path.join(ROOT, 'server/db/schema.sql');
const MIRROR = path.join(ROOT, 'src/lib/db/schema.sql');

function read(pathname) {
  return fs.readFileSync(pathname, 'utf8');
}

function main() {
  const check = process.argv.includes('--check');
  if (!fs.existsSync(CANONICAL)) {
    console.error(`Missing canonical schema: ${CANONICAL}`);
    process.exit(1);
  }
  const canonical = read(CANONICAL);
  const mirror = fs.existsSync(MIRROR) ? read(MIRROR) : null;
  if (check) {
    if (mirror === canonical) {
      console.log('schema mirrors are identical');
      process.exit(0);
    }
    console.error('SCHEMA MIRROR DRIFT');
    console.error(`  canonical: ${CANONICAL}`);
    console.error(`  mirror:    ${MIRROR}`);
    console.error('Fix: node scripts/sync-schema-mirror.js');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(MIRROR), { recursive: true });
  fs.writeFileSync(MIRROR, canonical);
  console.log(`synced ${MIRROR} from ${CANONICAL} (${canonical.length} bytes)`);
}

if (require.main === module) main();
module.exports = { CANONICAL, MIRROR };
