'use strict';
/*
 * skills-doctor.js — diagnose skill-root hygiene: duplicates, empty dirs,
 * epoch-stamped files, stale/empty bundles. Report-first; --apply only removes
 * verifiably-empty, unreferenced directories.
 *
 * Usage:
 *   node scripts/skills-doctor.js [--json] [--apply] [--roots <csv>]
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const os = require('os');
const HOME = os.homedir();

function defaultRoots() {
  const proj = path.resolve(__dirname, '..', '.agents', 'skills');
  const kilo = path.join(HOME, '.kilocode', 'skills');
  const agents = path.join(HOME, '.agents', 'skills');
  return [proj, kilo, agents].filter((p) => fs.existsSync(p));
}

function parseArgs(argv) {
  const a = { json: false, apply: false, roots: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--json') a.json = true;
    else if (v === '--apply') a.apply = true;
    else if (v === '--roots') a.roots = argv[++i].split(',').map((s) => s.trim());
  }
  return a;
}

function skillName(skillDir) {
  const md = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(md)) return null;
  const head = fs.readFileSync(md, 'utf8').slice(0, 2000);
  const m = head.match(/^name:\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim().replace(/["']/g, '');
}

function scoreFiles(mtime) {
  return mtime < new Date('1981-01-01T00:00:00Z');
}

function countFiles(d) {
  let n = 0;
  let entries = [];
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return 0; }
  for (const e of entries) {
    const p = path.join(d, e.name);
    if (e.isSymbolicLink()) continue; // broken links/junctions: don't chase
    if (e.isDirectory()) n += countFiles(p);
    else n++;
  }
  return n;
}

function tryMtime(p) {
  try { return fs.statSync(p).mtime; } catch (_) { return null; }
}

// Recursively collect every directory containing a SKILL.md (a "skill") and
// every epoch-stamped file, tolerating broken symlinks. A directory with no own
// SKILL.md but with sub-skills beneath it is a *grouping* dir (e.g. coding/,
// docs/) — NOT empty. Only a directory whose subtree has zero files is dead.
function walkSkills(root) {
  const found = { skills: [], emptydirs: [], epoch: [] };
  if (!fs.existsSync(root)) return found;
  const seen = new Set();

  (function rec(dir) {
    if (seen.has(dir)) return;
    seen.add(dir);
    const md = path.join(dir, 'SKILL.md');
    if (fs.existsSync(md)) found.skills.push({ name: skillName(dir), dir });
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) rec(p);
      else {
        const m = tryMtime(p);
        if (m && scoreFiles(m)) found.epoch.push({ dir, file: p });
      }
    }
  })(root);

  let top = [];
  try { top = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return found; }
  for (const e of top) {
    if (!e.isDirectory()) continue;
    const p = path.join(root, e.name);
    // "dead" = zero immediate entries (ignores junction/symlink nuance: a dir of
    // junction-linked skills is still populated, not empty).
    let n = 0;
    try { n = fs.readdirSync(p).length; } catch (_) { n = 0; }
    if (n === 0) found.emptydirs.push(p);
  }
  return found;
}

function listFiles(dir) {
  const out = [];
  (function rec(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else {
        const st = fs.statSync(p);
        out.push({ file: p, mtime: st.mtime });
      }
    }
  })(dir);
  return out;
}

function isGitTracked(p) {
  try {
    const rel = path.relative(process.cwd(), p).split(path.sep).join('/');
    const out = execSync(`git ls-files -- "${rel}"`, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out.length > 0;
  } catch (_) {
    return false;
  }
}

function dirEmpty(p) {
  if (!fs.existsSync(p)) return true;
  try { return fs.readdirSync(p).length === 0; } catch (_) { return false; }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const roots = args.roots || defaultRoots();

  const byName = new Map();
  const emptydirs = [];
  const epoch = [];

  for (const root of roots) {
    const r = walkSkills(root);
    for (const s of r.skills) {
      if (!byName.has(s.name)) byName.set(s.name, []);
      byName.get(s.name).push(s.dir);
    }
    emptydirs.push(...r.emptydirs);
    epoch.push(...r.epoch);
  }

  const dups = [...byName.entries()].filter(([, dirs]) => dirs.length > 1);

  // stale/empty bundle dirs at repo root (e.g. .gemini)
  const staleBundles = [path.resolve(__dirname, '..', '.gemini')].filter((p) => dirEmpty(p));

  const report = { dups, emptydirs, epoch, staleBundles };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('== skills-doctor report ==');
    console.log(`roots scanned: ${roots.length}`);
    console.log(`duplicate skill names across roots: ${dups.length}`);
    for (const [name, dirs] of dups) {
      console.log(`  [DUP] ${name}`);
      dirs.forEach((d) => console.log(`        ${d}`));
    }
    console.log(`empty skill dirs (no SKILL.md): ${emptydirs.length}`);
    emptydirs.forEach((d) => console.log(`  [EMPTY] ${d}`));
    console.log(`epoch-stamped files (mtime < 1981): ${epoch.length}`);
    epoch.forEach((e) => console.log(`  [EPOCH] ${e.file}`));
    console.log(`stale/empty bundle dirs: ${staleBundles.length}`);
    staleBundles.forEach((d) => console.log(`  [BUNDLE] ${d}`));
  }

  let removed = 0;
  if (args.apply) {
    for (const d of emptydirs) {
      if (dirEmpty(d) && !isGitTracked(d) && !d.includes('node_modules')) {
        try { fs.rmSync(d, { recursive: true, force: true }); removed++; } catch (_) {}
      }
    }
    for (const d of staleBundles) {
      if (dirEmpty(d) && !isGitTracked(d) && !d.includes('node_modules')) {
        try { fs.rmSync(d, { recursive: true, force: true }); removed++; } catch (_) {}
      }
    }
    console.log(`--apply removed ${removed} empty, untracked directories`);
  }

  // exit non-zero only if hard problems found AND not json (json callers watch stdout)
  const problems = dups.length + emptydirs.length + epoch.length + staleBundles.length;
  if (!args.json && problems > 0) process.exitCode = 0;
  return report;
}

if (require.main === module) main();
module.exports = { main, parseArgs, skillName, walkSkills, defaultRoots };