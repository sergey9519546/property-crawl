import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPanoramaxViewer, loadPanoramaxViewer, PANORAMAX_SCRIPT } from '../src/lib/panoramax-viewer.ts';

class Element extends EventTarget {
  attributes = {}; style = {}; removed = false;
  setAttribute(key, value) { this.attributes[key] = value; }
  remove() { this.removed = true; }
}
const candidate = { pictureId: 'first', collectionId: 'sequence' };
function fixture() {
  const elements = [];
  globalThis.document = { createElement: () => { const e = new Element(); elements.push(e); return e; } };
  const states = [], selections = [];
  const host = { appendChild: e => { host.child = e; } };
  const dispose = mountPanoramaxViewer(host, candidate, s => states.push(s), id => selections.push(id), 25);
  const event = (name, detail) => host.child.dispatchEvent(new CustomEvent(name, { detail }));
  return { host, states, selections, dispose, event };
}

test('only the selected photograph confirms rendering; host navigation remains untouched', () => {
  const f = fixture();
  try {
    assert.equal(f.host.child.attributes['url-parameters'], 'false');
    assert.equal(f.host.child.attributes['keyboard-shortcuts'], 'false');
    assert.equal(f.host.child.attributes.endpoint, 'https://api.panoramax.xyz/api');
    f.event('ready', {}); f.event('psv:picture-loaded', { picId: 'unrelated' });
    assert.deepEqual(f.states, ['loading']);
    f.event('psv:picture-loaded', { picId: 'first' });
    assert.deepEqual(f.states, ['loading', 'loaded']);
    f.event('select', { picId: 'second' });
    assert.deepEqual(f.selections, ['second']);
    f.event('psv:picture-loaded', { picId: 'first' });
    assert.equal(f.states.at(-1), 'loading');
    f.event('psv:picture-loaded', { picId: 'second' });
    assert.equal(f.states.at(-1), 'loaded');
  } finally { f.dispose(); }
});

test('failure, timeout and disposal never leave a false loaded state or listeners', async () => {
  const f = fixture();
  f.event('psv:picture-failed', {});
  assert.equal(f.states.at(-1), 'failed');
  f.dispose();
  assert.equal(f.host.child.removed, true);
  const count = f.states.length;
  f.event('psv:picture-loaded', { picId: 'first' });
  assert.equal(f.states.length, count);
  const slow = fixture();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(slow.states.at(-1), 'failed');
  slow.dispose();
});

test('one pinned script is shared, script errors allow retry, and registration is required', async () => {
  const scripts = [];
  globalThis.window = { setTimeout: callback => setTimeout(callback, 25), clearTimeout };
  let defined = false;
  const registrations = [];
  globalThis.customElements = { get: () => defined ? Element : undefined, whenDefined: () => defined ? Promise.resolve(Element) : new Promise(resolve => registrations.push(resolve)) };
  const maps = [];
  globalThis.document = { createElement: () => new Element(), head: { appendChild: s => (s.type === 'importmap' ? maps : scripts).push(s) } };
  const first = loadPanoramaxViewer();
  assert.equal(loadPanoramaxViewer(), first);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, PANORAMAX_SCRIPT);
  assert.equal(scripts[0].type, 'module');
  assert.equal(maps.length, 1);
  assert.doesNotMatch(maps[0].textContent, /@latest|\.\/src/);
  scripts[0].onerror();
  await assert.rejects(first, /could not load/);
  assert.equal(scripts[0].removed, true);
  const retry = loadPanoramaxViewer();
  scripts[1].onload();
  await assert.rejects(retry, /timed out/);
  const success = loadPanoramaxViewer();
  let ready = false;
  void success.then(() => { ready = true; });
  scripts[2].onload();
  await Promise.resolve();
  assert.equal(ready, false, 'module load alone must not establish readiness');
  defined = true;
  registrations.forEach(resolve => resolve(Element));
  await success;
  await loadPanoramaxViewer();
  assert.equal(scripts.length, 3);
  assert.equal(maps.length, 1);
});
