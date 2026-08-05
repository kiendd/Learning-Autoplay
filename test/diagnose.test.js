import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(here, '..', ...parts), 'utf8');

function playerConstants() {
  const sandbox = { window: {}, document: {}, console };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(read('src', 'content', 'player.js'), sandbox);
  return sandbox.window.__llAutoResume;
}

// tools/diagnose.js repeats the selectors because it runs pasted into the page
// console, where the extension's isolated world is out of reach. A copy that
// drifts reports on selectors the extension no longer uses, which is worse than
// no diagnosis at all.
function diagnoseConstants() {
  const source = read('tools', 'diagnose.js');
  const captured = {};
  const sandbox = {
    console: { log: () => {} },
    location: { href: 'about:blank' },
    getComputedStyle: () => ({}),
    document: {
      querySelectorAll: () => [],
      querySelector: () => null,
      visibilityState: 'visible',
      hasFocus: () => true,
    },
    copy: () => {},
  };
  // The snippet is an IIFE that keeps its constants private, so read them from
  // the source it was built with rather than from a run.
  sandbox.capture = captured;
  vm.createContext(sandbox);
  vm.runInContext(
    source.replace('(() => {', '(() => {\n  const __export = (v) => Object.assign(capture, v);')
      .replace(
        'const seen = (element) => {',
        '__export({ SELECTORS, MODAL_BUTTON_PATTERN, PAGE_NEXT_PATTERN });\n  const seen = (element) => {',
      ),
    sandbox,
  );
  return captured;
}

test('the diagnostic snippet uses exactly the selectors the extension uses', () => {
  const player = playerConstants();
  const snippet = diagnoseConstants();

  // Compared as JSON: the two objects come from different vm realms, so their
  // prototypes differ and deepStrictEqual would fail even when they match.
  assert.equal(
    JSON.stringify(snippet.SELECTORS),
    JSON.stringify(player.SELECTORS),
    'SELECTORS drifted from player.js',
  );
  assert.equal(
    String(snippet.MODAL_BUTTON_PATTERN),
    String(player.MODAL_BUTTON_PATTERN),
    'MODAL_BUTTON_PATTERN drifted from player.js',
  );
  assert.equal(
    String(snippet.PAGE_NEXT_PATTERN),
    String(player.PAGE_NEXT_PATTERN),
    'PAGE_NEXT_PATTERN drifted from player.js',
  );
});
