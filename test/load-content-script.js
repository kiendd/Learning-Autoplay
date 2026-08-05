import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));

// The files under src/content are classic scripts, not ES modules, so they cannot
// be imported. Each one is evaluated in a sandbox where `window` is undefined,
// which makes it fall through to its module.exports branch.
export function loadContentScript(filename) {
  const source = readFileSync(join(here, '..', 'src', 'content', filename), 'utf8');
  const sandbox = { module: { exports: {} }, console, window: undefined, setTimeout, Date };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.module.exports;
}
