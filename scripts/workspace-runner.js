'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const production = process.argv.includes('--production');
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const children = [];
const bootId = crypto.randomUUID();
let closing = false;

function start(name, args, env = process.env) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (closing) return;
    console.error(`[Workspace] ${name} stopped (${signal || code}). Stopping the other process.`);
    shutdown(code || 1);
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 250).unref();
}

async function ready(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const body = await response.json();
  if (body.workspaceBootId !== bootId) throw new Error(`${url} belongs to another workspace process`);
}

async function announceReadiness() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && !closing) {
    try {
      await Promise.all([ready('http://localhost:3000/api/health'), ready('http://localhost:3001/api/health')]);
      console.log('[Workspace] Ready: UI http://localhost:3001/listings · API http://localhost:3000/api/health');
      return;
    } catch { await new Promise((resolve) => setTimeout(resolve, 750)); }
  }
  if (!closing) console.error('[Workspace] Readiness timed out. Review the process errors above.');
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (error) => { console.error(error); shutdown(1); });

const childEnvironment = { ...process.env, WORKSPACE_BOOT_ID: bootId };
start('property API', ['--env-file-if-exists=.env.local', path.join('server', 'server.js')], childEnvironment);
start('Next UI', [nextBin, production ? 'start' : 'dev', '-p', '3001'], childEnvironment);
void announceReadiness();
