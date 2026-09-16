'use strict';

// test/security/validation.test.js
//
// Tests for the query-param validators at server/security/validation.js.
// These helpers are used by every public route (listings, parse, verify-docket)
// to harden user input before it reaches downstream code. They were
// previously untested.

const assert = require('node:assert/strict');
const test = require('node:test');

const Validator = require('../../server/security/validation');

// --- strictIntParam ------------------------------------------------

test('strictIntParam: returns default for null / undefined / empty string', () => {
  for (const input of [null, undefined, '']) {
    const result = Validator.strictIntParam(input, 'limit', 25, 1, 100);
    assert.equal(result.ok, true);
    assert.equal(result.value, 25);
  }
});

test('strictIntParam: trims whitespace before parsing', () => {
  const result = Validator.strictIntParam('  42  ', 'limit', 0, 1, 100);
  assert.equal(result.ok, true);
  assert.equal(result.value, 42);
});

test('strictIntParam: accepts numeric input directly', () => {
  const result = Validator.strictIntParam(42, 'limit', 0, 1, 100);
  assert.equal(result.ok, true);
  assert.equal(result.value, 42);
});

test('strictIntParam: rejects negative numbers outside the range', () => {
  const result = Validator.strictIntParam('-1', 'limit', 25, 0, 100);
  assert.equal(result.ok, false);
  assert.match(result.error, /between 0 and 100/);
});

test('strictIntParam: rejects scientific notation', () => {
  // The validator's contract is "base-10 integer only" — '1e2' would
  // parse to 100 but is not the literal the caller asked for.
  const result = Validator.strictIntParam('1e2', 'limit', 25, 1, 100);
  assert.equal(result.ok, false);
  assert.match(result.error, /base-10 integer/);
});

test('strictIntParam: rejects hex notation', () => {
  const result = Validator.strictIntParam('0xff', 'limit', 25, 1, 100);
  assert.equal(result.ok, false);
  assert.match(result.error, /base-10 integer/);
});

test('strictIntParam: rejects partial matches like "5abc"', () => {
  const result = Validator.strictIntParam('5abc', 'limit', 25, 1, 100);
  assert.equal(result.ok, false);
});

test('strictIntParam: rejects a leading plus sign', () => {
  // '+25' parses to 25 but is not the same as '25' — reject for clarity.
  const result = Validator.strictIntParam('+25', 'limit', 0, 1, 100);
  assert.equal(result.ok, false);
});

test('strictIntParam: rejects Infinity', () => {
  const result = Validator.strictIntParam(Infinity, 'limit', 0, 1, 100);
  assert.equal(result.ok, false);
});

test('strictIntParam: rejects non-string non-number inputs', () => {
  for (const input of [{}, [], true, NaN]) {
    const result = Validator.strictIntParam(input, 'limit', 25, 1, 100);
    assert.equal(result.ok, false, `should reject ${typeof input}`);
  }
});

test('strictIntParam: rejects numbers below the minimum', () => {
  const result = Validator.strictIntParam(0, 'limit', 25, 1, 100);
  assert.equal(result.ok, false);
  assert.match(result.error, /between 1 and 100/);
});

test('strictIntParam: rejects numbers above the maximum', () => {
  const result = Validator.strictIntParam(101, 'limit', 25, 1, 100);
  assert.equal(result.ok, false);
  assert.match(result.error, /between 1 and 100/);
});

// --- boundedStringParam --------------------------------------------

test('boundedStringParam: returns empty string for null / undefined', () => {
  for (const input of [null, undefined]) {
    const result = Validator.boundedStringParam(input, 'q', 100);
    assert.equal(result.ok, true);
    assert.equal(result.value, '');
  }
});

test('boundedStringParam: accepts strings within the length limit', () => {
  const result = Validator.boundedStringParam('hello', 'q', 100);
  assert.equal(result.ok, true);
  assert.equal(result.value, 'hello');
});

test('boundedStringParam: rejects strings above the length limit', () => {
  const result = Validator.boundedStringParam('A'.repeat(101), 'q', 100);
  assert.equal(result.ok, false);
  assert.match(result.error, /exceeds maximum length of 100/);
});

test('boundedStringParam: rejects non-string inputs', () => {
  for (const input of [42, {}, [], true]) {
    const result = Validator.boundedStringParam(input, 'q', 100);
    assert.equal(result.ok, false, `should reject ${typeof input}`);
  }
});

// --- stripControlChars ---------------------------------------------

test('stripControlChars: strips C0 control characters (excluding tab/newline)', () => {
  const cleaned = Validator.stripControlChars('hello\u0000\u0007world\u007f');
  assert.equal(cleaned, 'helloworld');
});

test('stripControlChars: returns empty string for non-string input', () => {
  for (const input of [null, undefined, 42, {}, []]) {
    assert.equal(Validator.stripControlChars(input), '');
  }
});

test('stripControlChars: removes the ESC character from ANSI sequences (printable [0-9;m stays)', () => {
  // The helper strips C0 controls + DEL only; it does not parse CSI
  // sequences. The ESC byte (\u001b) is removed but the printable
  // `[31m`/`[0m` markers remain in the output. Callers that need to
  // strip full ANSI sequences should pair this with a CSI parser.
  const payload = 'safe\u001b[31mRED\u001b[0mend';
  const cleaned = Validator.stripControlChars(payload);
  assert.equal(cleaned, 'safe[31mRED[0mend');
  assert.equal(cleaned.includes('\u001b'), false);
});

test('stripControlChars: removes \\r and \\n so smuggled log lines do not break out', () => {
  // Stripping \r\n leaves the smuggled text adjacent to the original
  // content on the same line, neutralizing the line-break attack. The
  // smuggled text remains in the string for forensic inspection — callers
  // that need full redaction should drop or replace the input entirely.
  const payload = 'safe\r\nINJECTED\r\nlog line';
  const cleaned = Validator.stripControlChars(payload);
  assert.equal(cleaned.includes('\n'), false);
  assert.equal(cleaned.includes('\r'), false);
  // The smuggled text is still present but cannot spawn a separate log entry.
  assert.equal(cleaned, 'safeINJECTEDlog line');
});

// --- validateNoticeInput -------------------------------------------

test('validateNoticeInput: rejects null / undefined / empty', () => {
  for (const input of [null, undefined, '']) {
    const result = Validator.validateNoticeInput(input);
    assert.equal(result.isValid, false);
  }
});

test('validateNoticeInput: rejects strings shorter than 10 characters', () => {
  const result = Validator.validateNoticeInput('short');
  assert.equal(result.isValid, false);
  assert.match(result.error, /at least 10 characters/);
});

test('validateNoticeInput: accepts a 10-character string (boundary)', () => {
  const result = Validator.validateNoticeInput('1234567890');
  assert.equal(result.isValid, true);
});

test('validateNoticeInput: rejects non-string inputs', () => {
  for (const input of [42, {}, [], true]) {
    const result = Validator.validateNoticeInput(input);
    assert.equal(result.isValid, false);
  }
});

test('validateNoticeInput: rejects strings longer than 50,000 characters', () => {
  const result = Validator.validateNoticeInput('A'.repeat(50_001));
  assert.equal(result.isValid, false);
  assert.match(result.error, /exceeds maximum size limit/);
});

test('validateNoticeInput: trims before measuring length', () => {
  const result = Validator.validateNoticeInput('   ab   ');
  // 'ab' is < 10 chars after trim → rejected.
  assert.equal(result.isValid, false);
});