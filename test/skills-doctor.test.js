'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { walkSkills } = require('../scripts/skills-doctor.js');

function makeSkill(root, name) {
  const d = path.join(root, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: x\n---\n`);
  return d;
}

test('walkSkills: classifies skill / grouping / empty / epoch correctly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skilldoc-'));
  try {
    // a real skill
    makeSkill(root, 'alpha');
    // a grouping dir holding a nested skill (NOT empty)
    const group = path.join(root, 'group');
    fs.mkdirSync(group, { recursive: true });
    makeSkill(group, 'nested-skill');
    // a genuinely empty dir (dead)
    fs.mkdirSync(path.join(root, 'empty-skill'), { recursive: true });

    const r = walkSkills(root);

    const names = r.skills.map((s) => s.name).sort();
    assert.deepStrictEqual(names, ['alpha', 'nested-skill'], 'finds skills at both levels');

    assert.ok(!r.emptydirs.includes(group), 'grouping dir is NOT flagged empty');
    assert.ok(r.emptydirs.some((d) => d.endsWith('empty-skill')), 'dead dir is flagged empty');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('walkSkills: flags epoch-stamped (1980) files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skilldoc-'));
  try {
    const d = makeSkill(root, 'oldy');
    const f = path.join(d, 'SKILL.md');
    const t = new Date('1980-01-01T00:00:00Z');
    fs.utimesSync(f, t, t);

    const r = walkSkills(root);
    assert.ok(r.epoch.some((e) => e.file.endsWith('SKILL.md')), 'epoch file detected');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('walkSkills: treats a junction-populated dir as non-empty (not dead)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skilldoc-'));
  try {
    const target = makeSkill(root, 'real-skill');
    // skip on platforms where symlink creation is not permitted
    let linked = false;
    try {
      fs.symlinkSync(target, path.join(root, 'linked'), 'junction');
      linked = true;
    } catch (_) {
      linked = false;
    }
    if (linked) {
      const r = walkSkills(root);
      // 'linked' has an immediate entry (its target), not zero — must not be flagged
      assert.ok(!r.emptydirs.includes(path.join(root, 'linked')), 'junction dir not flagged empty');
    } else {
      test.skip('symlink unsupported');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});