'use strict';

/**
 * run-scrapling-parser-tests.js — run the Scrapling parser suite on the
 * interpreter the product actually uses.
 *
 * WHY THIS EXISTS
 *
 * test/scrapling_parser_test.py is the only direct test of
 * scripts/crawlers/scrapling_extract.py, and 16 of its tests were never
 * executed by anything: not by a test:* script, not by CI. A test nobody runs
 * cannot catch the thing it was written to catch, and its passing-looking
 * presence in the tree is an illusion.
 *
 * It must run under the pinned interpreter. Production resolves its Scrapling
 * runtime through defaultPython() in server/scrapers/scrapling-bridge.js, which
 * prefers SCRAPLING_PYTHON and otherwise .cache/crawler-tools/venv. Running the
 * suite under whatever `python` is on PATH tests a different environment than
 * the product, and the suite's engineVersion pin makes that visible as a
 * failure that looks like dependency drift but is not.
 *
 * So this asks defaultPython() rather than repeating its precedence. One
 * answer, two callers.
 *
 * Fails closed: if the pinned runtime is missing, that is reported as a
 * failure, not a skip. "The parser was not checked" is not the same as "the
 * parser passed", and a silent skip is the bug this whole file exists to end.
 *
 * Usage: node scripts/run-scrapling-parser-tests.js
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SUITE = path.join(ROOT, 'test', 'scrapling_parser_test.py');

const { defaultPython } = require('../server/scrapers/scrapling-bridge');

function main() {
  const python = defaultPython();
  if (!python) {
    console.error('[scrapling-parser] FAILED - the pinned Scrapling runtime is not present.');
    console.error('[scrapling-parser] Production resolves it via defaultPython(): SCRAPLING_PYTHON,');
    console.error('[scrapling-parser] else .cache/crawler-tools/venv. Create it with:');
    console.error('[scrapling-parser]   python -m venv .cache/crawler-tools/venv');
    console.error('[scrapling-parser]   .cache/crawler-tools/venv/bin/pip install -r scripts/crawlers/requirements.txt');
    console.error('[scrapling-parser] The parser was NOT checked. This is not a pass.');
    process.exit(1);
  }

  const result = spawnSync(python, [SUITE], { cwd: ROOT, stdio: 'inherit' });
  const code = result.status === null ? 1 : result.status;
  if (code !== 0) {
    console.error(`[scrapling-parser] FAILED under ${python} (exit ${code})`);
    process.exit(code);
  }
  console.log(`[scrapling-parser] parser suite passed under ${python}`);
}

if (require.main === module) main();

module.exports = { main };
