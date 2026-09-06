#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { submitEvidence, listEvidence, reviewEvidence, MAX_PAYLOAD_BYTES } = require('../server/sources/intake');

function usage() {
  return [
    'Usage:',
    '  node scripts/source-intake.js submit --source <id> --url <https-url> --captured-at <ISO> --kind <text|csv|json> --file <path>',
    '       [--name <custom name> --organization <publisher> --description <text> --homepage <https-url>] [--store <path>]',
    '  node scripts/source-intake.js list [--status <status>] [--source <id>] [--limit <1-200>] [--include-content] [--store <path>]',
    '  node scripts/source-intake.js review --id <intake-id> --decision <approve|reject> [--reviewer <name>] [--note <text>] [--store <path>]',
  ].join('\n');
}

function parseOptions(argv) {
  const command = argv[0];
  if (!['submit', 'list', 'review'].includes(command)) throw new Error(usage());
  const options = { command };
  const values = new Set([
    '--source', '--url', '--captured-at', '--kind', '--file', '--store', '--status', '--limit',
    '--name', '--organization', '--description', '--homepage', '--id', '--decision', '--reviewer', '--note',
  ]);
  const keyFor = (flag) => flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--include-content') { options.includeContent = true; continue; }
    if (!values.has(flag)) throw new Error(`Unknown source intake option: ${flag}`);
    const value = argv[++index];
    if (value == null || value === '') throw new Error(`${flag} requires a value`);
    options[keyFor(flag)] = value;
  }
  if (options.limit != null && (!/^\d+$/.test(options.limit) || Number(options.limit) < 1 || Number(options.limit) > 200)) {
    throw new Error('--limit must be an integer between 1 and 200');
  }
  return options;
}

function readEvidenceFile(filePath) {
  if (!filePath) throw new Error('--file is required');
  const resolved = path.resolve(filePath);
  const stats = fs.statSync(resolved);
  if (!stats.isFile()) throw new Error('--file must refer to a regular file');
  if (stats.size > MAX_PAYLOAD_BYTES) throw new Error(`Evidence file exceeds the ${MAX_PAYLOAD_BYTES}-byte CLI limit`);
  return fs.readFileSync(resolved, 'utf8');
}

function requireOptions(options, names) {
  for (const name of names) if (!options[name]) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
}

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const storePath = options.store ? path.resolve(options.store) : undefined;
  if (options.command === 'submit') {
    requireOptions(options, ['source', 'url', 'capturedAt', 'kind', 'file']);
    const body = readEvidenceFile(options.file);
    const hasCustomMetadata = options.name || options.organization || options.description || options.homepage;
    const customSource = hasCustomMetadata ? {
      id: options.source.toLowerCase(),
      name: options.name,
      organization: options.organization,
      description: options.description,
      homepageUrl: options.homepage,
    } : undefined;
    const result = submitEvidence({
      sourceId: options.source,
      sourceUrl: options.url,
      capturedAt: options.capturedAt,
      kind: options.kind,
      body,
      customSource,
    }, { storePath });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  }
  if (options.command === 'list') {
    const result = listEvidence({
      status: options.status,
      sourceId: options.source?.toLowerCase(),
      limit: options.limit == null ? undefined : Number(options.limit),
      includeContent: options.includeContent === true,
    }, { storePath });
    process.stdout.write(`${JSON.stringify({ records: result }, null, 2)}\n`);
    return result;
  }
  requireOptions(options, ['id', 'decision']);
  const result = reviewEvidence(options.id, {
    decision: options.decision,
    reviewer: options.reviewer,
    note: options.note,
  }, { storePath });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`[source-intake] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseOptions, readEvidenceFile };
