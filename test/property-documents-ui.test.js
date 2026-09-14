'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const loaded = new Map();
function loadTs(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = instance.require.bind(instance);
  instance.require = name => name.startsWith('@/')
    ? loadTs('src/' + name.slice(2) + '.ts')
    : originalRequire(name);
  loaded.set(filename, instance);
  instance._compile(transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, module: { type: 'commonjs' },
    jsc: { parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
  }).code, filename);
  return instance.exports;
}
const { PropertyDocuments } = loadTs('src/components/listings/property-documents.tsx');
const render = props => renderToStaticMarkup(React.createElement(PropertyDocuments, props));
const base = { status: 'observed', count: 1, observedAt: '2026-09-01T00:00:00Z', sourceUrl: 'https://publisher.example/property/1', items: [] };
function item(overrides = {}) {
  return { label: 'Sale terms', url: 'https://publisher.example/terms.pdf', accessState: 'registration_required',
    observedAt: '2025-03-04T10:00:00Z', provenance: { origin: 'archived_publisher_snapshot', sourceField: 'provenance.sourceFacts.documents[0]', sourceRecordUrl: base.sourceUrl }, ...overrides };
}

test('unknown document status is distinct from an observed empty document list', () => {
  const unknown = render({});
  assert.match(unknown, /haven.t been captured/);
  assert.doesNotMatch(unknown, /0 references|No documents were listed/);
  const empty = render({ evidence: { ...base, status: 'none_observed', count: 0 } });
  assert.match(empty, /0 references/);
  assert.match(empty, /No documents were listed/);
  assert.match(empty, /Sep 1, 2026/);
});

test('document cards retain archive observation dates and publisher registration requirements', () => {
  const html = render({ evidence: { ...base, items: [item()] } });
  assert.match(html, /Publisher registration required/);
  assert.match(html, /Archive reference/);
  assert.match(html, /Mar 4, 2025/);
  assert.match(html, /href="https:\/\/publisher.example\/terms.pdf"/);
  assert.match(html, /does not mean the file was downloaded or reviewed/);
});

test('unsafe links and document titles cannot execute in rendered property evidence', () => {
  const html = render({ evidence: { ...base, sourceUrl: 'javascript:alert(1)', items: [
    item({ label: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', accessState: 'unknown' }),
    item({ url: 'https://user:password@publisher.example/terms.pdf' }),
  ] } });
  assert.doesNotMatch(html, /href=|<img|user:password/);
  assert.match(html, /&lt;img/);
  assert.match(html, /Link not captured/);
});

test('conflicting or truncated evidence stays visible without claiming all files are accessible', () => {
  const html = render({ evidence: { ...base, disagreement: true, truncated: true, items: [item({ label: null, url: null, accessState: 'unavailable' })] } });
  assert.match(html, /Captured document lists differ/);
  assert.match(html, /Some captured references cannot be displayed/);
  assert.match(html, /Publisher document 1/);
  assert.match(html, /Reported unavailable/);
});
