import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, '..', 'manifest.json'), 'utf8'));

// Chrome evaluates every content script into ONE shared lexical scope in the
// isolated world. Loading each file in its own sandbox — which the other test
// files do, because it is what makes them testable — cannot catch a top-level
// `const` in one file colliding with the same name in another. That collision
// is a parse error, so the second file never runs at all and the extension
// silently does nothing. This test reproduces the real loading conditions.
test('every content script loads into one shared scope without colliding', () => {
  const files = manifest.content_scripts[0].js;
  assert.ok(files.length > 1, 'expected several content scripts in the manifest');

  const sandbox = {
    window: {},
    console: { log: () => {}, warn: () => {} },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} },
    setTimeout,
    setInterval: () => 0,
    Date,
    chrome: {
      storage: { sync: { get: () => new Promise(() => {}), set: () => Promise.resolve() } },
      runtime: { sendMessage: () => new Promise(() => {}), onMessage: { addListener: () => {} } },
    },
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.getComputedStyle = () => ({});
  vm.createContext(sandbox);

  for (const relative of files) {
    const source = readFileSync(join(here, '..', relative), 'utf8');
    assert.doesNotThrow(
      () => vm.runInContext(source, sandbox, { filename: relative }),
      `${relative} failed to load alongside the scripts before it`,
    );
  }

  const ns = sandbox.window.__llAutoResume;
  for (const name of ['createGate', 'createResumer', 'createDomPlayer', 'createToast']) {
    assert.equal(typeof ns[name], 'function', `${name} is missing from the shared namespace`);
  }
});
