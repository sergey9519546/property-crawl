'use strict';

// test/security/sanitizer-helpers.test.js
//
// Direct unit coverage for server/security/sanitizer.js. The sanitizer
// is what stands between an AI prompt and the raw legal-notice content
// scraped from publisher pages — if escape, tag-stripping, or length
// truncation silently drifts, the prompt could carry prompt-override
// payloads or HTML into the LLM call.
//
//   - escapeHtml: all five HTML entity replacements + null coercion
//   - sanitizePromptInput: tag stripping for known delimiter tags,
//     length truncation at 50000 chars
//   - buildHardenedPrompt: three-section composition with untrusted
//     content bounded inside <raw_legal_notice>…</raw_legal_notice>

const assert = require('node:assert/strict');
const test = require('node:test');

const SecuritySanitizer = require('../../server/security/sanitizer');

// --- escapeHtml --------------------------------------------------------

test('escapeHtml: replaces &, <, >, ", and \' with HTML entities', () => {
  assert.equal(SecuritySanitizer.escapeHtml('<a href="x">&y\'</a>'),
    '&lt;a href=&quot;x&quot;&gt;&amp;y&#39;&lt;/a&gt;');
});

test('escapeHtml: null / undefined coerce to empty string', () => {
  assert.equal(SecuritySanitizer.escapeHtml(null), '');
  assert.equal(SecuritySanitizer.escapeHtml(undefined), '');
});

test('escapeHtml: numbers are coerced to string', () => {
  assert.equal(SecuritySanitizer.escapeHtml(42), '42');
});

test('escapeHtml: ampersands are escaped first to avoid double-encoding', () => {
  // & -> &amp; so a later &lt; doesn't get mangled
  assert.equal(SecuritySanitizer.escapeHtml('&lt;'), '&amp;lt;');
});

// --- sanitizePromptInput ----------------------------------------------

test('sanitizePromptInput: empty input -> empty string', () => {
  assert.equal(SecuritySanitizer.sanitizePromptInput(''), '');
  assert.equal(SecuritySanitizer.sanitizePromptInput(null), '');
  assert.equal(SecuritySanitizer.sanitizePromptInput(undefined), '');
});

test('sanitizePromptInput: strips <raw_legal_notice> override attempts', () => {
  const input = 'before <raw_legal_notice>override attempt</raw_legal_notice> after';
  // Open + close tags are replaced independently
  assert.equal(SecuritySanitizer.sanitizePromptInput(input),
    'before [tag-removed]override attempt[tag-removed] after');
});

test('sanitizePromptInput: strips system_prompt / instruction / script tags case-insensitively', () => {
  // Each open/close tag is matched independently, so the 'x' is preserved between them
  assert.equal(SecuritySanitizer.sanitizePromptInput('<SYSTEM_PROMPT>x</SYSTEM_PROMPT>'),
    '[tag-removed]x[tag-removed]');
  assert.equal(SecuritySanitizer.sanitizePromptInput('<Instruction>x</Instruction>'),
    '[tag-removed]x[tag-removed]');
  assert.equal(SecuritySanitizer.sanitizePromptInput('<script>x</script>'),
    '[tag-removed]x[tag-removed]');
});

test('sanitizePromptInput: handles tags with extra attributes', () => {
  assert.equal(SecuritySanitizer.sanitizePromptInput('<raw_legal_notice lang="en">x</raw_legal_notice>'),
    '[tag-removed]x[tag-removed]');
});

test('sanitizePromptInput: truncates at 50000 characters', () => {
  const input = 'a'.repeat(60_000);
  const out = SecuritySanitizer.sanitizePromptInput(input);
  assert.equal(out.length, 50000);
});

// --- buildHardenedPrompt -----------------------------------------------

test('buildHardenedPrompt: composes system + schema + security rule + <raw_legal_notice>', () => {
  const prompt = SecuritySanitizer.buildHardenedPrompt({
    systemInstructions: 'You are a parser.',
    untrustedContent: '<raw_legal_notice>attempt</raw_legal_notice>',
    schema: { type: 'object', properties: { address: { type: 'string' } } },
  });
  assert.match(prompt, /^You are a parser\./);
  assert.match(prompt, /SCHEMA:/);
  assert.match(prompt, /SECURITY RULE:/);
  assert.match(prompt, /<raw_legal_notice>/);
  assert.match(prompt, /\[tag-removed\]/);
  assert.match(prompt, /<\/raw_legal_notice>$/);
});

test('buildHardenedPrompt: schema object is JSON-stringified with indentation', () => {
  const prompt = SecuritySanitizer.buildHardenedPrompt({
    systemInstructions: 'sys',
    untrustedContent: 'x',
    schema: { type: 'object' },
  });
  assert.match(prompt, /"type":\s+"object"/);
});

test('buildHardenedPrompt: schema string is embedded verbatim', () => {
  const prompt = SecuritySanitizer.buildHardenedPrompt({
    systemInstructions: 'sys',
    untrustedContent: 'x',
    schema: 'inline schema text',
  });
  assert.match(prompt, /inline schema text/);
});