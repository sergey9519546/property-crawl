'use strict';
// Detached production boot helper for verification stacks.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = process.argv[2] || '3920';
const apiPort = process.argv[3] || String(Number(port) + 2);
const logPath = path.join(root, '.cache', `start-production-${port}.log`);

const env = {
  ...process.env,
  PORT: port,
  INTERNAL_API_PORT: apiPort,
};
delete env.SCRAPER_ADMIN_TOKEN;
delete env.PROPERTY_OPERATOR_SECRET;

const out = fs.openSync(logPath, 'a');
const child = spawn(process.execPath, ['scripts/start-production.js'], {
  cwd: root,
  env,
  detached: true,
  stdio: ['ignore', out, out],
});
child.unref();
fs.writeFileSync(path.join(root, '.cache', `start-production-${port}.pid`), String(child.pid));
console.log(JSON.stringify({ pid: child.pid, port, apiPort, logPath }));
