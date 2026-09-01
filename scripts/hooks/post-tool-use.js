'use strict';
/*
 * post-tool-use.js — Non-blocking telemetry hook (T3.4, de-scoped).
 * Appends a one-line usage record to memory/episodes/telemetry.log so the
 * system has a lightweight signal of which tools/skills fire and their outcome.
 *
 * This is intentionally NOT a second system — it's a single append-only log
 * that a future "sleep" step could turn into tuned trigger weights.
 *
 * Usage:
 *   node scripts/hooks/post-tool-use.js --tool <name> --outcome <pass|fail> [--skill <name>]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const LOG_PATH = path.join(ROOT, 'memory', 'episodes', 'telemetry.log');

function main() {
  const args = process.argv.slice(2);
  const tool = (args.find((a) => a.startsWith('--tool')) || '').split('=')[1] || args[args.indexOf('--tool') + 1] || 'unknown';
  const outcome = (args.find((a) => a.startsWith('--outcome')) || '').split('=')[1] || args[args.indexOf('--outcome') + 1] || 'unknown';
  const skill = (args.find((a) => a.startsWith('--skill')) || '').split('=')[1] || args[args.indexOf('--skill') + 1] || '';

  const ts = new Date().toISOString();
  const line = `${ts}\t${tool}\t${outcome}\t${skill}\n`;

  // Ensure directory exists
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.appendFileSync(LOG_PATH, line);
  // Silent success — non-blocking hook should not produce output
}

main();
