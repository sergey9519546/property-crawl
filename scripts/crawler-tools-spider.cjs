#!/usr/bin/env node
'use strict';

const { crawlOnboardingSource } = require('../server/crawlers/onboarding-spider');

function usage() {
  return 'Usage: node scripts/crawler-tools-spider.cjs --source <source> --url <https-url> [--max-pages 3] [--max-depth 2]';
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--source', '--url', '--max-pages', '--max-depth'].includes(name)) throw new Error(`Unknown argument: ${name}`);
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
    values[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
  }
  if (!values.source || !values.url) throw new Error('--source and --url are required');
  for (const key of ['maxPages', 'maxDepth']) {
    if (values[key] === undefined) continue;
    const number = Number(values[key]);
    if (!Number.isInteger(number) || number < (key === 'maxPages' ? 1 : 0)) throw new Error(`--${key === 'maxPages' ? 'max-pages' : 'max-depth'} must be an integer`);
    values[key] = number;
  }
  return values;
}

if (require.main === module) {
  (async () => {
    const input = parseArgs(process.argv.slice(2));
    const result = await crawlOnboardingSource(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.complete) process.exitCode = 2;
  })().catch((error) => {
    console.error(`${error.code || 'SPIDER_ERROR'}: ${error.message}`);
    console.error(usage());
    process.exitCode = 1;
  });
}

module.exports = { parseArgs };
