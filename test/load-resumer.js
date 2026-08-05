import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'content', 'resumer.js'), 'utf8');

const sandbox = { module: { exports: {} }, console, window: undefined, setTimeout, Date };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

export const {
  createResumer,
  RETRY_DELAYS,
  BREAKER_LIMIT,
  BREAKER_WINDOW_MS,
  COOLDOWN_MS,
} = sandbox.module.exports;
