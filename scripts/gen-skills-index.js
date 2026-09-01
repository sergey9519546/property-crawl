'use strict';
/*
 * gen-skills-index.js — generate a typed capability index from the canonical
 * skill root (.agents/skills/). Each entry declares name, description, domain,
 * version, trigger keywords, and file path — the substrate for ranked
 * disambiguation (skill-router.js) and the skills doctor.
 *
 * Drift-gated: test/agent-system.test.js asserts the index is current.
 *
 * Usage:
 *   node scripts/gen-skills-index.js            # write .agents/skills-index.json
 *   node scripts/gen-skills-index.js --check    # exit 1 if stale
 *   node scripts/gen-skills-index.js --json     # print index as JSON
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, '.agents', 'skills');
const INDEX_PATH = path.join(ROOT, '.agents', 'skills-index.json');

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const yaml = m[1];
  const fields = {};
  // simple YAML parser for flat + one-level nested keys
  let currentKey = null;
  for (const line of yaml.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    const nested = line.match(/^\s{2}(\w+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      fields[currentKey] = kv[2] || '';
    } else if (nested && currentKey) {
      if (typeof fields[currentKey] === 'string' && !fields[currentKey]) {
        fields[currentKey] = {};
      }
      if (typeof fields[currentKey] === 'object') {
        fields[currentKey][nested[1]] = nested[2] || '';
      }
    }
  }
  return fields;
}

function extractKeywords(text) {
  if (!text) return [];
  // pull meaningful words from description, lowercased, deduped
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['this', 'that', 'with', 'from', 'your', 'have', 'been', 'will', 'they', 'them', 'what', 'when', 'which', 'their', 'also', 'must', 'after', 'into', 'only', 'such', 'than', 'then'].includes(w));
  return [...new Set(words)].sort();
}

function buildIndex() {
  if (!fs.existsSync(SKILLS_DIR)) return { skills: [], digest: '' };
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const skillDir = path.join(SKILLS_DIR, e.name);
      const mdPath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(mdPath)) return null;
      const content = fs.readFileSync(mdPath, 'utf8');
      const fm = parseFrontmatter(content);
      const description = (fm.description || '').replace(/^\|?\s*/, '').trim();
      const metadata = fm.metadata || {};
      return {
        name: fm.name || e.name,
        description,
        domain: metadata.domain || 'general',
        version: metadata.version || 'v1',
        trigger: extractKeywords(fm.name + ' ' + description),
        dir: `.agents/skills/${e.name}`,
        file: `.agents/skills/${e.name}/SKILL.md`
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));

  const digest = crypto.createHash('sha256')
    .update(JSON.stringify(entries.map((e) => e.name + e.description + e.domain + e.version)))
    .digest('hex');

  return { skills: entries, digest };
}

function main() {
  const args = process.argv.slice(2);
  const index = buildIndex();

  if (args.includes('--json')) {
    console.log(JSON.stringify(index, null, 2));
    return;
  }

  if (args.includes('--check')) {
    if (!fs.existsSync(INDEX_PATH)) {
      console.error('skills-index.json missing — run `node scripts/gen-skills-index.js`');
      process.exit(1);
    }
    const existing = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (existing.digest !== index.digest) {
      console.error(`skills-index.json is STALE. Regenerate: node scripts/gen-skills-index.js`);
      process.exit(1);
    }
    console.log('skills-index.json is current.');
    return;
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
  console.log(`Wrote ${INDEX_PATH} (${index.skills.length} skills indexed)`);
}

module.exports = { buildIndex, parseFrontmatter, extractKeywords, INDEX_PATH };
if (require.main === module) main();
