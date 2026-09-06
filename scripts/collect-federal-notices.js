#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { collectFederalNotices, MAX_PER_PAGE } = require('../server/sources/federal-register');

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!['--per-page', '--days-back', '--store'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    if (flag === '--store') options.storePath = path.resolve(value);
    if (flag === '--per-page') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_PER_PAGE) throw new Error(`--per-page must be an integer between 1 and ${MAX_PER_PAGE}`);
      options.perPage = Number(value);
    }
    if (flag === '--days-back') {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 366) throw new Error('--days-back must be an integer between 1 and 366');
      options.daysBack = Number(value);
    }
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const result = await collectFederalNotices(parseOptions(argv));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`[collect-federal-notices] ${error.message}\n`);
  process.exitCode = 1;
});

module.exports = { main, parseOptions };
