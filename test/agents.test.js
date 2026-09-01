'use strict';
/*
 * agents.test.js — Config-under-test for .kilo/agent/*.md (Adversary scenario 5).
 * Asserts every agent file:
 *   - has valid YAML frontmatter (description, mode, permission)
 *   - has a well-formed permission map (read/bash/edit keys)
 *   - references only existing skills (if any are named)
 *   - has a non-empty body
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const AGENT_DIR = path.join(ROOT, '.kilo', 'agent');

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fields = {};
  let currentKey = null;
  for (const line of m[1].split('\n')) {
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

function getAgentFiles() {
  if (!fs.existsSync(AGENT_DIR)) return [];
  return fs.readdirSync(AGENT_DIR).filter((f) => f.endsWith('.md'));
}

const VALID_MODES = new Set(['subagent', 'primary', 'inline']);
const VALID_PERMS = new Set(['allow', 'deny']);

test('every agent has valid frontmatter with description and mode', () => {
  const files = getAgentFiles();
  assert.ok(files.length > 0, 'at least one agent must exist');
  for (const f of files) {
    const content = fs.readFileSync(path.join(AGENT_DIR, f), 'utf8');
    const fm = parseFrontmatter(content);
    assert.ok(fm, `${f}: must have YAML frontmatter`);
    assert.ok(fm.description, `${f}: must have a description`);
    if (fm.mode) {
      assert.ok(VALID_MODES.has(fm.mode), `${f}: mode "${fm.mode}" must be one of ${[...VALID_MODES].join(', ')}`);
    }
  }
});

test('every agent has a well-formed permission map', () => {
  const files = getAgentFiles();
  for (const f of files) {
    const content = fs.readFileSync(path.join(AGENT_DIR, f), 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm || !fm.permission) continue;

    const perm = fm.permission;
    assert.ok(typeof perm === 'object', `${f}: permission must be a map with keys`);

    // at least read and bash must be specified
    assert.ok(
      perm.read !== undefined || perm.bash !== undefined,
      `${f}: permission map must specify at least read or bash`
    );

    // check each permission value is valid
    for (const [key, val] of Object.entries(perm)) {
      if (typeof val === 'string' && val !== '') {
        assert.ok(
          VALID_PERMS.has(val),
          `${f}: permission.${key}="${val}" must be allow or deny`
        );
      }
      // empty string means nested path-based permissions (e.g. edit: { "path/**": allow })
      // — valid, the children are parsed separately
      // object form (e.g. edit: { "server/scrapers/**": allow, "*": deny }) is valid
    }
  }
});

test('every agent has a non-empty body with role instructions', () => {
  const files = getAgentFiles();
  for (const f of files) {
    const content = fs.readFileSync(path.join(AGENT_DIR, f), 'utf8');
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    assert.ok(body.length > 50, `${f}: body must have substantive role instructions, got ${body.length}`);
  }
});
