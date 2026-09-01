'use strict';
/*
 * skill-router.js — ranked disambiguation for skill selection.
 * Given a natural-language query, scores every skill in the index and returns
 * the top-3 ranked candidates with a justification. If the top candidate
 * dominates (score >= 2x the second), it returns a single deterministic pick.
 * Otherwise it asks the user to choose from the ranked list.
 *
 * Answers Adversary scenario 1: "Deterministic routing under ambiguity."
 *
 * Usage:
 *   node scripts/skill-router.js "audit my site"
 *   node scripts/skill-router.js "scrape sheriff sales" --json
 */
const fs = require('fs');
const path = require('path');
const { buildIndex } = require('./gen-skills-index');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, '.agents', 'skills-index.json');

function loadIndex() {
  if (fs.existsSync(INDEX_PATH)) {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  }
  // fall back to building in-memory
  return buildIndex();
}

function tokenize(query) {
  return query.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function scoreSkill(skill, queryTokens) {
  let score = 0;
  const nameLower = skill.name.toLowerCase();
  const descLower = (skill.description || '').toLowerCase();
  const triggers = skill.trigger || [];

  for (const token of queryTokens) {
    // exact name match: highest weight
    if (nameLower === token) score += 10;
    // name contains token
    else if (nameLower.includes(token)) score += 5;
    // trigger keyword exact match
    else if (triggers.includes(token)) score += 3;
    // description contains token
    else if (descLower.includes(token)) score += 2;
    // trigger keyword contains token (partial)
    else if (triggers.some((t) => t.includes(token) || token.includes(t))) score += 1;
  }

  return score;
}

function route(query, opts) {
  opts = opts || {};
  const index = opts.index || loadIndex();
  const skills = index.skills || [];
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    return { query, candidates: [], recommendation: 'ask', reason: 'Empty query' };
  }

  const scored = skills
    .map((s) => ({ skill: s, score: scoreSkill(s, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { query, candidates: [], recommendation: 'none', reason: 'No skill matched any query token' };
  }

  const top3 = scored.slice(0, 3).map((s, i) => ({
    rank: i + 1,
    name: s.skill.name,
    score: s.score,
    domain: s.skill.domain,
    description: s.skill.description,
    justification: `Matched ${s.score} keyword(s) from "${query}"`
  }));

  // deterministic pick if top dominates 2x the second
  if (scored.length === 1 || (scored.length > 1 && scored[0].score >= 2 * scored[1].score)) {
    return {
      query,
      candidates: top3,
      recommendation: 'deterministic',
      pick: top3[0],
      reason: `Top candidate "${top3[0].name}" dominates (score ${top3[0].score} >= 2x runner-up)`
    };
  }

  return {
    query,
    candidates: top3,
    recommendation: 'ask',
    reason: `${scored.length} candidates within 2x of each other — ask user to disambiguate`
  };
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const query = args.filter((a) => !a.startsWith('--')).join(' ');

  if (!query) {
    console.error('Usage: node scripts/skill-router.js "your query" [--json]');
    process.exit(1);
  }

  const result = route(query);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Query: "${query}"`);
  console.log(`Recommendation: ${result.recommendation}`);
  console.log(`Reason: ${result.reason}`);
  if (result.pick) {
    console.log(`\n→ PICK: ${result.pick.name} (score ${result.pick.score})`);
    console.log(`  ${result.pick.description}`);
  } else if (result.candidates.length > 0) {
    console.log('\nRanked candidates:');
    for (const c of result.candidates) {
      console.log(`  ${c.rank}. ${c.name} (score ${c.score}) — ${c.justification}`);
    }
  }
}

module.exports = { route, scoreSkill, tokenize, loadIndex };
if (require.main === module) main();
