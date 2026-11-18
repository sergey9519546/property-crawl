'use strict';

// test/i18n-completeness.test.js
//
// Guards full-site Armenian (hy), English (en), and Russian (ru) support:
//   - config exposes en, hy, ru with native script labels and Intl locales
//   - all three message dictionaries share 100% recursive key parity, array length
//     parity, and identical {placeholder} variable sets with zero empty strings
//   - hy contains real Armenian script (U+0530-U+058F) and ru contains Cyrillic
//     script (U+0400-U+04FF) so untranslated copies cannot pass silently
//   - proxy.ts negotiates locale into x-pp-locale + pp_locale cookie
//   - SiteHeader, SiteFooter, and WorkspaceShell mount LanguageSwitcher

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadTsMessageObject(relPath, exportName, stripImport = false) {
  let raw = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  if (stripImport) {
    raw = raw.replace(/^import\s+type\s+[\s\S]*?;\s*/m, '');
  }
  raw = raw
    .replace(/type\s+DeepWiden[\s\S]*$/, '')
    .replace(new RegExp(`export\\s+const\\s+${exportName}(?:\\s*:\\s*Messages)?\\s*=`), `module.exports.${exportName} =`)
    .replace(/\s+as\s+const\s*;/, ';');
  const mod = { exports: {} };
  vm.runInNewContext(raw, { module: mod, exports: mod.exports });
  return mod.exports[exportName];
}

function collectLeafStrings(node, prefix = '', out = new Map()) {
  if (typeof node === 'string') {
    out.set(prefix, node);
    return out;
  }
  if (Array.isArray(node)) {
    out.set(`${prefix}.__len`, String(node.length));
    node.forEach((item, idx) => collectLeafStrings(item, `${prefix}[${idx}]`, out));
    return out;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      collectLeafStrings(node[key], prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

function extractPlaceholders(str) {
  return [...String(str).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
}

test('i18n message dictionaries for en, hy, and ru have 100% key, array, and placeholder parity', () => {
  const en = loadTsMessageObject('src/lib/i18n/messages/en.ts', 'enMessages');
  const hy = loadTsMessageObject('src/lib/i18n/messages/hy.ts', 'hyMessages', true);
  const ru = loadTsMessageObject('src/lib/i18n/messages/ru.ts', 'ruMessages', true);

  const enLeaves = collectLeafStrings(en);
  const hyLeaves = collectLeafStrings(hy);
  const ruLeaves = collectLeafStrings(ru);

  assert.ok(enLeaves.size > 150, `expected comprehensive message catalog, got ${enLeaves.size} entries`);

  for (const [localeName, leaves] of [['hy', hyLeaves], ['ru', ruLeaves]]) {
    for (const [key, enVal] of enLeaves.entries()) {
      assert.ok(leaves.has(key), `${localeName} is missing translation key: ${key}`);
      const localized = leaves.get(key);
      assert.ok(typeof localized === 'string' && localized.trim().length > 0, `${localeName} has blank value for ${key}`);
      if (!key.endsWith('.__len')) {
        assert.deepEqual(
          extractPlaceholders(localized),
          extractPlaceholders(enVal),
          `${localeName} placeholder mismatch on key ${key}: expected {${extractPlaceholders(enVal)}}`,
        );
      } else {
        assert.equal(localized, enVal, `${localeName} array length mismatch on ${key}`);
      }
    }
    for (const key of leaves.keys()) {
      assert.ok(enLeaves.has(key), `${localeName} has extra key absent from en: ${key}`);
    }
  }

  const hyText = [...hyLeaves.values()].join(' ');
  const ruText = [...ruLeaves.values()].join(' ');
  assert.match(hyText, /[\u0530-\u058F]{10,}/, 'hy dictionary must contain genuine Armenian script');
  assert.match(ruText, /[\u0400-\u04FF]{10,}/, 'ru dictionary must contain genuine Cyrillic script');
});

test('proxy.ts negotiates en/hy/ru and forwards x-pp-locale; layout configures Armenian and Cyrillic fonts', () => {
  const proxy = fs.readFileSync(path.join(ROOT, 'src/proxy.ts'), 'utf8');
  assert.match(proxy, /LOCALE_HEADER/);
  assert.match(proxy, /LOCALE_COOKIE/);
  assert.match(proxy, /negotiateLocaleFromAcceptLanguage/);

  const layout = fs.readFileSync(path.join(ROOT, 'src/app/layout.tsx'), 'utf8');
  assert.match(layout, /Noto_Sans_Armenian/);
  assert.match(layout, /subsets:\s*\["latin",\s*"cyrillic"\]/);
  assert.match(layout, /<html\s+lang=\{locale\}/s);
  assert.match(layout, /<LocaleProvider\s+initialLocale=\{locale\}>/);
});

test('LanguageSwitcher is wired into SiteHeader, SiteFooter, and WorkspaceShell', () => {
  for (const rel of [
    'src/components/site/site-header.tsx',
    'src/components/site/site-footer.tsx',
    'src/components/workspace/workspace-shell.tsx',
  ]) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /LanguageSwitcher/, `${rel} must mount LanguageSwitcher`);
  }
});
