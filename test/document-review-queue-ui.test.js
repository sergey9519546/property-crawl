'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// --- Stub the workspace shell: the queue only consumes
//     `useWorkspaceSession` and `PrivateWorkspaceGate`. We replace the
//     real implementation with a deterministic stub so we can drive
//     authenticated vs. unauthenticated states from each test.
let workspaceSession = () => ({
  authenticated: true,
  configured: true,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  loading: false,
  requestUnlock() {},
  refresh: async () => true,
});

const workspaceShellStub = {
  useWorkspaceSession: () => workspaceSession(),
  PrivateWorkspaceGate: ({ title, children }) => {
    const value = workspaceSession();
    if (value.authenticated) return React.createElement(React.Fragment, null, children);
    return React.createElement('div', { 'data-testid': 'private-gate' },
      React.createElement('h2', null, title || 'Unlock your research workspace'),
    );
  },
  WorkspaceShell: ({ children }) => React.createElement(React.Fragment, null, children),
};

// --- loadTs (mirrors property-documents-ui.test.js). The hook also
//     intercepts the workspace-shell path before the real component is
//     resolved.
const loaded = new Map();
function loadTs(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = instance.require.bind(instance);
  instance.require = function (name) {
    if (name === '@/components/workspace/workspace-shell' || name === '@/components/workspace/workspace-shell.tsx') {
      return workspaceShellStub;
    }
    if (name.startsWith('@/')) {
      const base = 'src/' + name.slice(2);
      const root = path.resolve(__dirname, '..');
      if (fs.existsSync(path.join(root, base + '.tsx'))) return loadTs(base + '.tsx');
      return loadTs(base + '.ts');
    }
    return originalRequire(name);
  };
  loaded.set(filename, instance);
  instance._compile(transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, module: { type: 'commonjs' },
    jsc: { parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
  }).code, filename);
  return instance.exports;
}

const { DocumentReviewQueue } = loadTs('src/components/documents/document-review-queue.tsx');
const queueRender = () => renderToStaticMarkup(React.createElement(DocumentReviewQueue));

const APPROVE_BUTTON = /data-action="approve"/;
const REJECT_BUTTON = /data-action="reject"/;

test('DocumentReviewQueue renders the private gate prompt when not authenticated', () => {
  const previous = workspaceSession;
  workspaceSession = () => ({
    authenticated: false,
    configured: true,
    expiresAt: null,
    loading: false,
    requestUnlock() {},
    refresh: async () => false,
  });
  try {
    const html = queueRender();
    // Heading and the unlock gate are visible. Queue chrome is hidden.
    assert.match(html, /Document review queue/);
    assert.match(html, /Unlock the document review queue/);
    assert.doesNotMatch(html, /Reviewer identifier/);
    assert.doesNotMatch(html, APPROVE_BUTTON);
  } finally {
    workspaceSession = previous;
  }
});

test('DocumentReviewQueue renders the empty-state chrome when authenticated', () => {
  // Static markup does not run useEffect, so `data` is null and the queue
  // shows the loading-and-empty scaffolding instead of fetched reviews.
  const html = queueRender();
  assert.match(html, /Document review queue/);
  assert.match(html, /Awaiting review/);
  assert.match(html, /Approved/);
  assert.match(html, /Rejected/);
  assert.match(html, /Needs more/);
  assert.match(html, /Reviewer identifier/);
  // Approve / Reject controls only render per review row, so they must
  // NOT appear when there are no reviews.
  assert.doesNotMatch(html, APPROVE_BUTTON);
  assert.doesNotMatch(html, REJECT_BUTTON);
});

test('DocumentReviewQueue empty-state copy states durability honestly', () => {
  const html = queueRender();
  assert.match(html, /documentReviewStore/);
  assert.match(html, /volume|PostgreSQL/i);
  assert.doesNotMatch(html, /when PostgreSQL is not configured\)/);
});

test('DocumentReviewQueue page module exists and uses the queue + shell imports', () => {
  const pagePath = path.resolve(__dirname, '..', 'src/app/workspace/documents-review/page.tsx');
  assert.ok(fs.existsSync(pagePath), 'page.tsx must exist on disk');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  assert.match(pageSource, /DataModeBanner/);
  const compiled = transformSync(pageSource, {
    filename: pagePath,
    module: { type: 'commonjs' },
    jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
  }).code;
  assert.match(compiled, /DocumentReviewQueue/);
  assert.match(compiled, /WorkspaceShell/);
  assert.match(compiled, /Document Review Queue \| PerfectProperty/);
});

test('workspace shell nav exposes the Reviews entry pointing at the queue', () => {
  const shellPath = path.resolve(__dirname, '..', 'src/components/workspace/workspace-shell.tsx');
  const source = fs.readFileSync(shellPath, 'utf8');
  assert.match(source, /\/workspace\/documents-review/);
  assert.match(source, /label: "Reviews"/);
  assert.match(source, /FileWarning/);
  // The nav is a horizontally scrollable row, not a fixed six-column grid.
  // It used to be `grid-cols-6`, which got cramped at narrow widths once
  // Reviews joined the five originals. Pin the property that matters -- every
  // entry stays reachable and the links refuse to compress -- rather than the
  // Tailwind class that happens to achieve it, so the next layout change does
  // not read as a regression.
  assert.match(source, /aria-label="Research workspace"/);
  assert.match(source, /overflow-x-auto/, 'the nav must remain scrollable rather than clipped');
  assert.match(source, /shrink-0/, 'nav links must not compress below their content width');
});