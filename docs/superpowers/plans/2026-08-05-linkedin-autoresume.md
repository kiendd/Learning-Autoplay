# LinkedIn Learning Auto-Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension that automatically resumes LinkedIn Learning videos when playback stops, so a learner who is still listening does not have to notice the silence and click play.

**Architecture:** A content script listens for the `pause` event on the page's `<video>` element and calls `play()`. All decision logic lives in a DOM-free state machine (`resumer.js`) that talks to the page only through a narrow player interface, so it is unit-testable under plain Node. Every fragile LinkedIn CSS selector is confined to `player.js`. A 2-second watchdog re-attaches listeners when LinkedIn's SPA swaps the video element on lesson change.

**Tech Stack:** Chrome Extension Manifest V3, vanilla ES modules, `node:test` + `node:assert` for unit tests (no dependencies, no build step).

## Global Constraints

- Manifest V3 only. No Manifest V2 syntax.
- Zero runtime dependencies. Zero build step. Source files load directly into Chrome.
- Zero test dependencies. Tests use Node's built-in `node:test` and `node:assert/strict`. Requires Node 18+.
- Host permission is exactly `https://www.linkedin.com/learning/*`. Do not request `<all_urls>` or `tabs`.
- All four playback behaviors (resume, modal dismissal, lesson advance, rate restore) are governed by one ON/OFF switch. No per-behavior settings.
- `resumer.js` must never reference `document`, `window`, `chrome`, or `Date.now()`. It receives everything through injected dependencies. This is what makes it testable.
- Time is injected as a `now()` function so the circuit breaker and backoff are testable without real delays.
- Circuit breaker: more than **5** resumes within **10000** ms triggers a **60000** ms cooldown.
- Play retry backoff delays: **250**, **1000**, **3000** ms — exactly 3 retries.
- Watchdog interval: **2000** ms.
- Toast duration: **2000** ms.
- Modal button text pattern, verbatim: `/tiếp tục|continue|resume|still watching|keep watching/i`
- Storage area is `chrome.storage.sync`. Keys: `enabled` (boolean, default `true`), `rate` (number, default `1`).
- Resume count is per-tab and in-memory only. It is never written to storage and resets on page reload.

---

### Task 1: Project scaffold and manifest

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `.gitignore`
- Create: `icons/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a loadable (but inert) extension. Later tasks fill in the files this manifest references.

- [ ] **Step 1: Create `package.json`**

No dependencies. The `test` script uses Node's built-in runner.

```json
{
  "name": "linkedin-learning-autoresume",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Automatically resumes LinkedIn Learning videos that stop on their own.",
  "scripts": {
    "test": "node --test test/*.test.js"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.DS_Store
*.log
```

- [ ] **Step 3: Create `manifest.json`**

The service worker gets `"type": "module"` and can use `import`. Content scripts cannot be ES modules in MV3, so every file under `src/content/` is a **classic script** — no `import`, no `export`. They share state through a global namespace object created by `namespace.js`, which is why manifest order matters: `namespace.js` first, `index.js` last. Tasks 2 and 6 build them that way from the start.

```json
{
  "manifest_version": 3,
  "name": "LinkedIn Learning Auto-Resume",
  "version": "0.1.0",
  "description": "Automatically resumes LinkedIn Learning videos that stop on their own.",
  "permissions": ["storage"],
  "host_permissions": ["https://www.linkedin.com/learning/*"],
  "background": {
    "service_worker": "src/background/worker.js",
    "type": "module"
  },
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_title": "LinkedIn Learning Auto-Resume"
  },
  "content_scripts": [
    {
      "matches": ["https://www.linkedin.com/learning/*"],
      "all_frames": true,
      "run_at": "document_idle",
      "js": [
        "src/content/namespace.js",
        "src/content/resumer.js",
        "src/content/player.js",
        "src/content/toast.js",
        "src/content/index.js"
      ]
    }
  ]
}
```

- [ ] **Step 4: Create `icons/README.md`**

The extension ships without icon files — Chrome falls back to a default puzzle-piece icon, and the badge still works. Document this so it is a deliberate choice, not an oversight.

```markdown
# Icons

This extension intentionally ships without icon PNGs. Chrome renders a default
placeholder icon, and the badge text set by `src/background/worker.js` displays
correctly on top of it.

To add real icons later, drop `icon16.png`, `icon48.png`, and `icon128.png` here
and add to `manifest.json`:

    "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }

Also add the same map under the `"action"` key so the toolbar picks them up.
```

- [ ] **Step 5: Verify the manifest is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`
Expected: prints `manifest ok`

- [ ] **Step 6: Commit**

```bash
git add manifest.json package.json .gitignore icons/README.md
git commit -m "feat: add MV3 manifest and project scaffold"
```

---

### Task 2: Resumer state machine — resume on pause

The core decision logic. Built test-first with a fake player, so no browser is involved.

**Files:**
- Create: `src/content/resumer.js`
- Test: `test/resumer.test.js`
- Create: `test/fake-player.js`
- Create: `test/load-resumer.js`

**Why the loader exists:** `resumer.js` must be a classic script (Chrome content
scripts cannot be ES modules), so it cannot use `export`. But the tests need to
import it. `test/load-resumer.js` bridges the two by evaluating the classic script
in a `node:vm` sandbox and reading its `module.exports`. This is why `resumer.js`
ends with a dual-target footer rather than `export` statements.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createResumer({ player, now, log })` → resumer object.
    - `player` implements the player interface (see `test/fake-player.js` below).
    - `now` is `() => number` returning milliseconds.
    - `log` is `(...args) => void`.
  - Resumer object methods:
    - `async onPause()` → `Promise<void>` — handle a pause event.
    - `async onEnded()` → `Promise<void>` — handle an ended event (Task 4).
    - `onRateChange()` → `void` (Task 5).
    - `setEnabled(boolean)` → `void`.
    - `getState()` → `{ enabled: boolean, resumeCount: number, blocked: boolean, cooldownUntil: number }`
  - `createResumer` also accepts an optional `sleep` dependency, `(ms) => Promise<void>`, defaulting to a real timer. Task 3 uses it to test backoff instantly.
  - Player interface (all synchronous except `play`):
    - `isPaused()` → `boolean`
    - `isEnded()` → `boolean`
    - `play()` → `Promise<void>`, rejects when blocked
    - `clickPlayButton()` → `boolean`
    - `goNext()` → `boolean`
    - `findBlockingModal()` → `{ dismiss(): boolean } | null`
    - `getRate()` → `number`
    - `setRate(rate)` → `void`
  - Resumer notifies the outside world through optional callbacks passed to `createResumer`: `onResumed()`, `onBlocked()`, `onCooldown()`. Task 6 wires these to the toast, Task 7 to the badge.

- [ ] **Step 1: Write `test/fake-player.js`**

A controllable stand-in for the real DOM. `playRejections` is a countdown: while it is above zero, `play()` rejects and decrements.

```js
export function createFakePlayer(overrides = {}) {
  const player = {
    paused: true,
    ended: false,
    rate: 1,
    playRejections: 0,
    playCalls: 0,
    clickPlayButtonCalls: 0,
    goNextCalls: 0,
    dismissCalls: 0,
    modal: null,

    isPaused: () => player.paused,
    isEnded: () => player.ended,
    async play() {
      player.playCalls += 1;
      if (player.playRejections > 0) {
        player.playRejections -= 1;
        throw new Error('NotAllowedError');
      }
      player.paused = false;
    },
    clickPlayButton() {
      player.clickPlayButtonCalls += 1;
      player.paused = false;
      return true;
    },
    goNext() {
      player.goNextCalls += 1;
      return true;
    },
    findBlockingModal() {
      if (!player.modal) return null;
      return {
        dismiss: () => {
          player.dismissCalls += 1;
          player.modal = null;
          return true;
        },
      };
    },
    getRate: () => player.rate,
    setRate: (value) => {
      player.rate = value;
    },
    ...overrides,
  };
  return player;
}

export function createFakeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

export const noSleep = async () => {};
```

- [ ] **Step 2: Write `test/load-resumer.js`**

Evaluates the classic script in a sandbox and re-exports what it assigned to
`module.exports`. Setting `window` to `undefined` makes the script's browser branch
skip itself.

```js
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
```

- [ ] **Step 3: Write the failing tests**

Create `test/resumer.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createResumer } from './load-resumer.js';
import { createFakePlayer, createFakeClock, noSleep } from './fake-player.js';

function setup(overrides = {}) {
  const player = createFakePlayer(overrides.player);
  const clock = createFakeClock();
  const events = { resumed: 0, blocked: 0, cooldown: 0 };
  const resumer = createResumer({
    player,
    now: clock.now,
    sleep: noSleep,
    log: () => {},
    onResumed: () => {
      events.resumed += 1;
    },
    onBlocked: () => {
      events.blocked += 1;
    },
    onCooldown: () => {
      events.cooldown += 1;
    },
    ...overrides.resumer,
  });
  return { player, clock, resumer, events };
}

test('resumes playback when the video pauses and it is enabled', async () => {
  const { player, resumer, events } = setup();
  player.paused = true;

  await resumer.onPause();

  assert.equal(player.playCalls, 1);
  assert.equal(player.paused, false);
  assert.equal(resumer.getState().resumeCount, 1);
  assert.equal(events.resumed, 1);
});

test('does not resume when disabled', async () => {
  const { player, resumer, events } = setup();
  resumer.setEnabled(false);
  player.paused = true;

  await resumer.onPause();

  assert.equal(player.playCalls, 0);
  assert.equal(resumer.getState().resumeCount, 0);
  assert.equal(events.resumed, 0);
});

test('does not resume when the video has ended', async () => {
  const { player, resumer } = setup();
  player.paused = true;
  player.ended = true;

  await resumer.onPause();

  assert.equal(player.playCalls, 0);
});

test('does nothing when the video is already playing', async () => {
  const { player, resumer } = setup();
  player.paused = false;

  await resumer.onPause();

  assert.equal(player.playCalls, 0);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `ENOENT` reading `src/content/resumer.js`

- [ ] **Step 5: Write the minimal implementation**

Create `src/content/resumer.js`. Only what the four tests need — retries, breaker, ended-advance, and rate come in later tasks. Note there is **no `export` keyword anywhere** in this file; the footer serves both Chrome and the test loader.

```js
const DEFAULTS = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: () => {},
  onResumed: () => {},
  onBlocked: () => {},
  onCooldown: () => {},
};

function createResumer(options) {
  const { player, now, sleep, log, onResumed, onBlocked, onCooldown } = {
    ...DEFAULTS,
    ...options,
  };

  let enabled = true;
  let resumeCount = 0;
  let blocked = false;
  let cooldownUntil = 0;

  async function onPause() {
    if (!enabled) return;
    if (player.isEnded()) return;
    if (!player.isPaused()) return;

    await player.play();
    resumeCount += 1;
    onResumed();
  }

  async function onEnded() {}

  function onRateChange() {}

  return {
    onPause,
    onEnded,
    onRateChange,
    setEnabled(value) {
      enabled = value;
    },
    getState: () => ({ enabled, resumeCount, blocked, cooldownUntil }),
  };
}

// Dual target: Chrome loads this as a classic content script and picks up the
// global; the test loader evaluates it in a vm sandbox and reads module.exports.
if (typeof window !== 'undefined') {
  window.__llAutoResume = window.__llAutoResume || {};
  window.__llAutoResume.createResumer = createResumer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createResumer };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 4 passing

- [ ] **Step 7: Verify the file is a valid classic script**

Run: `node --check src/content/resumer.js && echo "classic script ok"`
Expected: prints `classic script ok`. A failure here means an `export` keyword slipped in.

- [ ] **Step 8: Commit**

```bash
git add src/content/resumer.js test/resumer.test.js test/fake-player.js test/load-resumer.js
git commit -m "feat: resume playback on pause when enabled"
```

---

### Task 3: Play-rejection retries and the circuit breaker

Chrome's autoplay policy can reject a scripted `play()`. And if LinkedIn re-pauses aggressively, the extension must not fight it forever.

**Files:**
- Modify: `src/content/resumer.js`
- Modify: `test/resumer.test.js`

**Interfaces:**
- Consumes: `createResumer` and the player interface from Task 2. The `setup()` helper and `createFakePlayer` from Task 2's test files are reused as written.
- Produces: `getState()` now reports meaningful `blocked` and `cooldownUntil` values. Constants exported for reuse: `RETRY_DELAYS`, `BREAKER_LIMIT`, `BREAKER_WINDOW_MS`, `COOLDOWN_MS`.

- [ ] **Step 1: Write the failing tests**

Append to `test/resumer.test.js`:

```js
test('retries with backoff when play() is rejected, then succeeds', async () => {
  const { player, resumer, events } = setup();
  player.paused = true;
  player.playRejections = 2;

  await resumer.onPause();

  assert.equal(player.playCalls, 3);
  assert.equal(player.paused, false);
  assert.equal(resumer.getState().resumeCount, 1);
  assert.equal(events.resumed, 1);
  assert.equal(events.blocked, 0);
});

test('falls back to clicking the play button after retries are exhausted', async () => {
  const { player, resumer, events } = setup();
  player.paused = true;
  player.playRejections = 4;

  await resumer.onPause();

  assert.equal(player.playCalls, 4);
  assert.equal(player.clickPlayButtonCalls, 1);
  assert.equal(player.paused, false);
  assert.equal(resumer.getState().blocked, false);
  assert.equal(events.resumed, 1);
});

test('reports blocked when play() and the button fallback both fail', async () => {
  const { player, resumer, events } = setup({
    player: { clickPlayButton: () => false },
  });
  player.paused = true;
  player.playRejections = 99;

  await resumer.onPause();

  assert.equal(resumer.getState().blocked, true);
  assert.equal(events.blocked, 1);
  assert.equal(events.resumed, 0);
});

test('clears the blocked flag once a later resume succeeds', async () => {
  const { player, resumer } = setup({
    player: { clickPlayButton: () => false },
  });
  player.paused = true;
  player.playRejections = 99;
  await resumer.onPause();
  assert.equal(resumer.getState().blocked, true);

  player.playRejections = 0;
  player.paused = true;
  await resumer.onPause();

  assert.equal(resumer.getState().blocked, false);
});

test('trips the circuit breaker after 5 resumes within 10 seconds', async () => {
  const { player, clock, resumer, events } = setup();

  for (let i = 0; i < 5; i += 1) {
    player.paused = true;
    await resumer.onPause();
    clock.advance(1000);
  }
  assert.equal(resumer.getState().resumeCount, 5);

  player.paused = true;
  await resumer.onPause();

  assert.equal(player.playCalls, 5, 'sixth pause must not call play()');
  assert.equal(resumer.getState().resumeCount, 5);
  assert.equal(events.cooldown, 1);
  assert.equal(resumer.getState().cooldownUntil, 5000 + 60000);
});

test('resumes normally again after the cooldown expires', async () => {
  const { player, clock, resumer } = setup();

  for (let i = 0; i < 5; i += 1) {
    player.paused = true;
    await resumer.onPause();
    clock.advance(1000);
  }
  player.paused = true;
  await resumer.onPause();

  clock.advance(60001);
  player.paused = true;
  await resumer.onPause();

  assert.equal(player.playCalls, 6);
  assert.equal(player.paused, false);
});

test('does not trip the breaker when resumes are spread out', async () => {
  const { player, clock, resumer, events } = setup();

  for (let i = 0; i < 8; i += 1) {
    player.paused = true;
    await resumer.onPause();
    clock.advance(5000);
  }

  assert.equal(player.playCalls, 8);
  assert.equal(events.cooldown, 0);
});

test('emits the cooldown notice only once per cooldown period', async () => {
  const { player, clock, resumer, events } = setup();

  for (let i = 0; i < 5; i += 1) {
    player.paused = true;
    await resumer.onPause();
    clock.advance(1000);
  }
  player.paused = true;
  await resumer.onPause();
  player.paused = true;
  await resumer.onPause();
  player.paused = true;
  await resumer.onPause();

  assert.equal(events.cooldown, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the retry test reports `playCalls` of 1 instead of 3; the breaker test reports 6 instead of 5.

- [ ] **Step 3: Implement retries and the breaker**

Replace the whole body of `src/content/resumer.js` with the following. Still no `export` keyword anywhere.

```js
const RETRY_DELAYS = [250, 1000, 3000];
const BREAKER_LIMIT = 5;
const BREAKER_WINDOW_MS = 10000;
const COOLDOWN_MS = 60000;

const DEFAULTS = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: () => {},
  onResumed: () => {},
  onBlocked: () => {},
  onCooldown: () => {},
};

function createResumer(options) {
  const { player, now, sleep, log, onResumed, onBlocked, onCooldown } = {
    ...DEFAULTS,
    ...options,
  };

  let enabled = true;
  let resumeCount = 0;
  let blocked = false;
  let cooldownUntil = 0;
  let recentResumes = [];

  function inCooldown() {
    return now() < cooldownUntil;
  }

  // Returns true when the breaker just tripped, meaning this resume must not run.
  function breakerTripped() {
    const cutoff = now() - BREAKER_WINDOW_MS;
    recentResumes = recentResumes.filter((stamp) => stamp > cutoff);
    if (recentResumes.length < BREAKER_LIMIT) return false;

    cooldownUntil = now() + COOLDOWN_MS;
    recentResumes = [];
    log('breaker tripped, cooling down for', COOLDOWN_MS, 'ms');
    onCooldown();
    return true;
  }

  // Tries play() with backoff, then the DOM button. Returns true on success.
  async function attemptPlay() {
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
      try {
        await player.play();
        return true;
      } catch (error) {
        log('play() rejected on attempt', attempt + 1, error && error.message);
        if (attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt]);
        }
      }
    }
    log('falling back to the DOM play button');
    return player.clickPlayButton() === true;
  }

  async function onPause() {
    if (!enabled) return;
    if (player.isEnded()) return;
    if (!player.isPaused()) return;
    if (inCooldown()) return;
    if (breakerTripped()) return;

    const succeeded = await attemptPlay();
    if (!succeeded) {
      if (!blocked) {
        blocked = true;
        onBlocked();
      }
      return;
    }

    blocked = false;
    resumeCount += 1;
    recentResumes.push(now());
    onResumed();
  }

  async function onEnded() {}

  function onRateChange() {}

  return {
    onPause,
    onEnded,
    onRateChange,
    setEnabled(value) {
      enabled = value;
    },
    getState: () => ({ enabled, resumeCount, blocked, cooldownUntil }),
  };
}

if (typeof window !== 'undefined') {
  window.__llAutoResume = window.__llAutoResume || {};
  window.__llAutoResume.createResumer = createResumer;
  window.__llAutoResume.RETRY_DELAYS = RETRY_DELAYS;
  window.__llAutoResume.BREAKER_LIMIT = BREAKER_LIMIT;
  window.__llAutoResume.BREAKER_WINDOW_MS = BREAKER_WINDOW_MS;
  window.__llAutoResume.COOLDOWN_MS = COOLDOWN_MS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createResumer, RETRY_DELAYS, BREAKER_LIMIT, BREAKER_WINDOW_MS, COOLDOWN_MS };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && node --check src/content/resumer.js`
Expected: PASS — 12 passing, no parse error

- [ ] **Step 5: Commit**

```bash
git add src/content/resumer.js test/resumer.test.js
git commit -m "feat: add play retry backoff and resume circuit breaker"
```

---

### Task 4: Lesson advance and blocking-modal dismissal

**Files:**
- Modify: `src/content/resumer.js`
- Modify: `test/resumer.test.js`

**Interfaces:**
- Consumes: `createResumer` from Task 3; `player.goNext()` and `player.findBlockingModal()` from the Task 2 interface.
- Produces: `onEnded()` now advances the lesson. `checkModal()` is added to the returned object — Task 7's watchdog calls it on every tick.

- [ ] **Step 1: Write the failing tests**

Append to `test/resumer.test.js`:

```js
test('advances to the next lesson when the video ends', async () => {
  const { player, resumer } = setup();
  player.ended = true;

  await resumer.onEnded();

  assert.equal(player.goNextCalls, 1);
  assert.equal(player.playCalls, 0);
});

test('does not advance when disabled', async () => {
  const { player, resumer } = setup();
  resumer.setEnabled(false);
  player.ended = true;

  await resumer.onEnded();

  assert.equal(player.goNextCalls, 0);
});

test('dismisses a blocking modal while paused, then resumes', async () => {
  const { player, resumer } = setup();
  player.paused = true;
  player.modal = { present: true };

  await resumer.onPause();

  assert.equal(player.dismissCalls, 1);
  assert.equal(player.paused, false);
});

test('checkModal dismisses a modal while paused', async () => {
  const { player, resumer } = setup();
  player.paused = true;
  player.modal = { present: true };

  await resumer.checkModal();

  assert.equal(player.dismissCalls, 1);
});

test('checkModal ignores modals while the video is playing', async () => {
  const { player, resumer } = setup();
  player.paused = false;
  player.modal = { present: true };

  await resumer.checkModal();

  assert.equal(player.dismissCalls, 0);
});

test('checkModal does nothing when disabled', async () => {
  const { player, resumer } = setup();
  resumer.setEnabled(false);
  player.paused = true;
  player.modal = { present: true };

  await resumer.checkModal();

  assert.equal(player.dismissCalls, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `goNextCalls` is 0, and `resumer.checkModal is not a function`

- [ ] **Step 3: Implement lesson advance and modal handling**

In `src/content/resumer.js`, add a `dismissModal` helper above `onPause`:

```js
  // Dismisses a dialog overlaying the paused player. Returns true if one was closed.
  function dismissModal() {
    const modal = player.findBlockingModal();
    if (!modal) return false;
    log('dismissing a blocking modal');
    return modal.dismiss() === true;
  }
```

Then, inside `onPause`, insert the dismissal immediately after the cooldown and breaker guards and before `attemptPlay()`:

```js
    if (breakerTripped()) return;

    dismissModal();

    const succeeded = await attemptPlay();
```

Replace the empty `onEnded` with:

```js
  async function onEnded() {
    if (!enabled) return;
    log('video ended, advancing to the next lesson');
    player.goNext();
  }
```

Add a `checkModal` function next to `onEnded`:

```js
  async function checkModal() {
    if (!enabled) return;
    if (!player.isPaused()) return;
    dismissModal();
  }
```

And add `checkModal` to the returned object:

```js
  return {
    onPause,
    onEnded,
    onRateChange,
    checkModal,
    setEnabled(value) {
      enabled = value;
    },
    getState: () => ({ enabled, resumeCount, blocked, cooldownUntil }),
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 18 passing

- [ ] **Step 5: Commit**

```bash
git add src/content/resumer.js test/resumer.test.js
git commit -m "feat: advance lesson on end and dismiss blocking modals"
```

---

### Task 5: Playback rate memory

**Files:**
- Modify: `src/content/resumer.js`
- Modify: `test/resumer.test.js`

**Interfaces:**
- Consumes: `createResumer` from Task 4; `player.getRate()` / `player.setRate()`.
- Produces:
  - `createResumer` accepts two new optional dependencies: `getStoredRate()` → `number`, and `saveRate(rate)` → `void`. Both default to no-ops returning `1`. Task 7 wires them to `chrome.storage.sync`.
  - `onRateChange()` records the current rate when the video is playing.
  - `restoreRate()` is added to the returned object — Task 7 calls it after a lesson change.

- [ ] **Step 1: Write the failing tests**

Append to `test/resumer.test.js`:

```js
function setupWithRate(initialStoredRate = 1) {
  const player = createFakePlayer();
  const clock = createFakeClock();
  const saved = [];
  let stored = initialStoredRate;
  const resumer = createResumer({
    player,
    now: clock.now,
    sleep: noSleep,
    log: () => {},
    getStoredRate: () => stored,
    saveRate: (rate) => {
      stored = rate;
      saved.push(rate);
    },
  });
  return { player, clock, resumer, saved, getStored: () => stored };
}

test('records the rate when it changes during playback', () => {
  const { player, resumer, getStored } = setupWithRate(1);
  player.paused = false;
  player.rate = 1.5;

  resumer.onRateChange();

  assert.equal(getStored(), 1.5);
});

test('ignores rate changes while the video is paused', () => {
  const { player, resumer, getStored } = setupWithRate(1);
  player.paused = true;
  player.rate = 2;

  resumer.onRateChange();

  assert.equal(getStored(), 1);
});

test('restores the stored rate when the current rate differs', () => {
  const { player, resumer } = setupWithRate(1.5);
  player.rate = 1;

  resumer.restoreRate();

  assert.equal(player.rate, 1.5);
});

test('does not touch the rate when it already matches', () => {
  const { player, resumer } = setupWithRate(1.5);
  player.rate = 1.5;
  let setCalls = 0;
  player.setRate = () => {
    setCalls += 1;
  };

  resumer.restoreRate();

  assert.equal(setCalls, 0);
});

test('restores the rate after a successful resume', async () => {
  const { player, resumer } = setupWithRate(1.5);
  player.paused = true;
  player.rate = 1;

  await resumer.onPause();

  assert.equal(player.rate, 1.5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `resumer.restoreRate is not a function`, and the recorded rate stays 1

- [ ] **Step 3: Implement rate memory**

In `src/content/resumer.js`, add to `DEFAULTS`:

```js
  getStoredRate: () => 1,
  saveRate: () => {},
```

Add both to the destructured options:

```js
  const {
    player, now, sleep, log,
    onResumed, onBlocked, onCooldown,
    getStoredRate, saveRate,
  } = { ...DEFAULTS, ...options };
```

Replace the empty `onRateChange` and add `restoreRate`:

```js
  function onRateChange() {
    if (player.isPaused()) return;
    const rate = player.getRate();
    log('remembering playback rate', rate);
    saveRate(rate);
  }

  function restoreRate() {
    const wanted = getStoredRate();
    if (typeof wanted !== 'number' || wanted <= 0) return;
    if (player.getRate() === wanted) return;
    log('restoring playback rate to', wanted);
    player.setRate(wanted);
  }
```

In `onPause`, call `restoreRate()` right after a successful resume — insert it just before `onResumed()`:

```js
    blocked = false;
    resumeCount += 1;
    recentResumes.push(now());
    restoreRate();
    onResumed();
```

Add `restoreRate` to the returned object alongside `checkModal`:

```js
  return {
    onPause,
    onEnded,
    onRateChange,
    checkModal,
    restoreRate,
    setEnabled(value) {
      enabled = value;
    },
    getState: () => ({ enabled, resumeCount, blocked, cooldownUntil }),
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 23 passing

- [ ] **Step 5: Commit**

```bash
git add src/content/resumer.js test/resumer.test.js
git commit -m "feat: remember and restore playback rate"
```

---

### Task 6: DOM adapter, namespace, and toast

The browser-facing half. `player.js` is where every fragile LinkedIn selector lives, with a debug mode that logs what it finds so selectors can be corrected against a real session.

**Files:**
- Create: `src/content/namespace.js`
- Create: `src/content/player.js`
- Create: `src/content/toast.js`

**Interfaces:**
- Consumes: the player interface contract from Task 2 (`isPaused`, `isEnded`, `play`, `clickPlayButton`, `goNext`, `findBlockingModal`, `getRate`, `setRate`).
- Produces:
  - Global `window.__llAutoResume` namespace object, since MV3 content scripts are classic scripts and cannot use `import`.
  - `window.__llAutoResume.createDomPlayer({ log })` → an object implementing the player interface, plus `getVideo()` → `HTMLVideoElement | null` for the watchdog's element-identity check.
  - `window.__llAutoResume.SELECTORS` → the editable selector config.
  - `window.__llAutoResume.MODAL_BUTTON_PATTERN` → the button text regex.
  - `window.__llAutoResume.createToast({ log })` → `{ show(message, variant) }` where `variant` is `'info'` or `'warn'`.

- [ ] **Step 1: Create `src/content/namespace.js`**

This loads first and is what the later content scripts attach to. `resumer.js` is loaded as a classic script too, so it also needs a home here — a small shim at the end of this task handles that.

```js
// MV3 content scripts are classic scripts, so the files listed in the manifest
// share state through this global instead of ES module imports.
window.__llAutoResume = window.__llAutoResume || {};
```

- [ ] **Step 2: Create `src/content/player.js`**

Selectors are grouped at the top and ordered most-specific first. `findVideo` prefers the largest video on the page, which avoids picking up autoplaying promo clips in the "Related courses" rail.

```js
(() => {
  // Edit these when LinkedIn changes its player markup. Ordered by preference.
  const SELECTORS = {
    playButton: [
      '.vjs-play-control',
      'button[aria-label*="Play" i]',
      'button[data-live-test-classroom-layout-play]',
    ],
    nextButton: [
      'button[aria-label*="Next video" i]',
      'button[aria-label*="Next" i]',
      '.classroom-layout__next-button',
      '.vjs-next-button',
    ],
    modalContainer: [
      '[role="dialog"]',
      '.artdeco-modal',
      '.vjs-modal-dialog',
    ],
  };

  const MODAL_BUTTON_PATTERN = /tiếp tục|continue|resume|still watching|keep watching/i;

  function queryFirst(selectorList) {
    for (const selector of selectorList) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function createDomPlayer({ log = () => {} } = {}) {
    // The lesson video is the biggest one on the page; promo clips in the
    // sidebar are much smaller.
    function findVideo() {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) return null;
      return videos.reduce((largest, candidate) => {
        const area = candidate.clientWidth * candidate.clientHeight;
        const bestArea = largest.clientWidth * largest.clientHeight;
        return area > bestArea ? candidate : largest;
      });
    }

    return {
      getVideo: findVideo,

      isPaused() {
        const video = findVideo();
        return video ? video.paused : false;
      },

      isEnded() {
        const video = findVideo();
        return video ? video.ended : false;
      },

      async play() {
        const video = findVideo();
        if (!video) throw new Error('no video element found');
        await video.play();
      },

      clickPlayButton() {
        const button = queryFirst(SELECTORS.playButton);
        if (!button) {
          log('play button not found; tried', SELECTORS.playButton);
          return false;
        }
        button.click();
        const video = findVideo();
        return Boolean(video && !video.paused);
      },

      goNext() {
        const button = queryFirst(SELECTORS.nextButton);
        if (!button) {
          log('next button not found; tried', SELECTORS.nextButton);
          return false;
        }
        log('clicking next:', button.getAttribute('aria-label') || button.className);
        button.click();
        return true;
      },

      findBlockingModal() {
        for (const selector of SELECTORS.modalContainer) {
          for (const container of document.querySelectorAll(selector)) {
            if (!isVisible(container)) continue;
            const buttons = Array.from(container.querySelectorAll('button, a[role="button"]'));
            const match = buttons.find((button) =>
              MODAL_BUTTON_PATTERN.test((button.textContent || '').trim()),
            );
            if (!match) {
              log('visible dialog with no continue-style button:', container.className);
              continue;
            }
            return {
              dismiss() {
                log('clicking modal button:', (match.textContent || '').trim());
                match.click();
                return true;
              },
            };
          }
        }
        return null;
      },

      getRate() {
        const video = findVideo();
        return video ? video.playbackRate : 1;
      },

      setRate(rate) {
        const video = findVideo();
        if (video) video.playbackRate = rate;
      },
    };
  }

  window.__llAutoResume = window.__llAutoResume || {};
  window.__llAutoResume.createDomPlayer = createDomPlayer;
  window.__llAutoResume.SELECTORS = SELECTORS;
  window.__llAutoResume.MODAL_BUTTON_PATTERN = MODAL_BUTTON_PATTERN;
})();
```

- [ ] **Step 3: Create `src/content/toast.js`**

Styles are inlined on the element so LinkedIn's stylesheets cannot override them, and `pointer-events: none` keeps the toast from stealing clicks from the player.

```js
(() => {
  const TOAST_MS = 2000;

  function createToast({ log = () => {} } = {}) {
    let element = null;
    let hideTimer = null;

    function ensureElement() {
      if (element && element.isConnected) return element;
      element = document.createElement('div');
      element.setAttribute('data-ll-autoresume-toast', '');
      Object.assign(element.style, {
        position: 'fixed',
        bottom: '96px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        padding: '10px 16px',
        borderRadius: '8px',
        font: '500 14px/1.4 system-ui, -apple-system, sans-serif',
        color: '#fff',
        background: 'rgba(17, 17, 17, 0.92)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
        pointerEvents: 'none',
        opacity: '0',
        transition: 'opacity 160ms ease',
      });
      document.body.appendChild(element);
      return element;
    }

    return {
      show(message, variant = 'info') {
        try {
          const node = ensureElement();
          node.textContent = message;
          node.style.background =
            variant === 'warn' ? 'rgba(140, 32, 32, 0.94)' : 'rgba(17, 17, 17, 0.92)';
          node.style.opacity = '1';
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            node.style.opacity = '0';
          }, TOAST_MS);
        } catch (error) {
          log('toast failed:', error && error.message);
        }
      },
    };
  }

  window.__llAutoResume = window.__llAutoResume || {};
  window.__llAutoResume.createToast = createToast;
  window.__llAutoResume.TOAST_MS = TOAST_MS;
})();
```

- [ ] **Step 4: Verify all files parse as classic scripts and tests still pass**

Run: `node --check src/content/namespace.js && node --check src/content/player.js && node --check src/content/toast.js && npm test`
Expected: no parse errors, 23 passing

- [ ] **Step 5: Commit**

```bash
git add src/content/namespace.js src/content/player.js src/content/toast.js
git commit -m "feat: add DOM player adapter, toast, and shared namespace"
```

---

### Task 7: Content script bootstrap and watchdog

Wires the pieces together, attaches listeners, and handles LinkedIn's SPA swapping the video element between lessons.

**Files:**
- Create: `src/content/index.js`

**Interfaces:**
- Consumes: `window.__llAutoResume.createResumer` (Tasks 2–5), `createDomPlayer` (Task 6), `createToast` (Task 6).
- Produces: a running extension. Listens for `{ type: 'll-autoresume:set-enabled', enabled }` and `{ type: 'll-autoresume:get-state' }` messages from the popup (Task 8), replying to the latter with `{ enabled, resumeCount, blocked }`.

- [ ] **Step 1: Create `src/content/index.js`**

```js
(() => {
  const ns = window.__llAutoResume;
  if (!ns || !ns.createResumer || !ns.createDomPlayer || !ns.createToast) {
    console.warn('[ll-autoresume] content scripts loaded out of order; aborting');
    return;
  }

  const WATCHDOG_MS = 2000;
  const DEBUG_KEY = 'llAutoResumeDebug';

  // Set localStorage.llAutoResumeDebug = '1' on the page to see what the
  // selectors are matching. Off by default so the console stays clean.
  function isDebug() {
    try {
      return window.localStorage.getItem(DEBUG_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function log(...args) {
    if (isDebug()) console.log('[ll-autoresume]', ...args);
  }

  const player = ns.createDomPlayer({ log });
  const toast = ns.createToast({ log });

  let cachedRate = 1;

  const resumer = ns.createResumer({
    player,
    log,
    getStoredRate: () => cachedRate,
    saveRate: (rate) => {
      cachedRate = rate;
      chrome.storage.sync.set({ rate }).catch(() => {});
    },
    onResumed: () => {
      toast.show('Đã tự phát lại');
      pushState();
    },
    onBlocked: () => {
      toast.show('Không tự phát được — hãy bấm vào trang một lần', 'warn');
      pushState();
    },
    onCooldown: () => {
      toast.show('Tạm ngưng 60 giây — LinkedIn đang dừng liên tục', 'warn');
      pushState();
    },
  });

  // The background worker owns the badge, so it needs the current numbers.
  function pushState() {
    const state = resumer.getState();
    chrome.runtime
      .sendMessage({
        type: 'll-autoresume:state',
        enabled: state.enabled,
        resumeCount: state.resumeCount,
        blocked: state.blocked,
      })
      .catch(() => {});
  }

  const handlePause = () => {
    resumer.onPause().catch((error) => log('onPause threw:', error && error.message));
  };
  const handleEnded = () => {
    resumer.onEnded().catch((error) => log('onEnded threw:', error && error.message));
  };
  const handleRateChange = () => resumer.onRateChange();

  let attachedVideo = null;

  function attach(video) {
    if (attachedVideo === video) return;
    if (attachedVideo) {
      attachedVideo.removeEventListener('pause', handlePause);
      attachedVideo.removeEventListener('ended', handleEnded);
      attachedVideo.removeEventListener('ratechange', handleRateChange);
    }
    attachedVideo = video;
    if (!video) return;
    log('attaching to video element');
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('ratechange', handleRateChange);
    resumer.restoreRate();
  }

  function tick() {
    attach(player.getVideo());
    resumer.checkModal().catch((error) => log('checkModal threw:', error && error.message));
    // A pause that fired before the listener was attached still needs handling.
    if (attachedVideo && attachedVideo.paused && !attachedVideo.ended) {
      handlePause();
    }
  }

  chrome.storage.sync.get({ enabled: true, rate: 1 }).then((stored) => {
    resumer.setEnabled(stored.enabled !== false);
    cachedRate = typeof stored.rate === 'number' && stored.rate > 0 ? stored.rate : 1;
    log('initialised; enabled =', stored.enabled, 'rate =', cachedRate);
    tick();
    pushState();
  });

  setInterval(tick, WATCHDOG_MS);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return undefined;

    if (message.type === 'll-autoresume:set-enabled') {
      resumer.setEnabled(Boolean(message.enabled));
      chrome.storage.sync.set({ enabled: Boolean(message.enabled) }).catch(() => {});
      toast.show(message.enabled ? 'Tự phát lại: BẬT' : 'Tự phát lại: TẮT');
      pushState();
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'll-autoresume:get-state') {
      const state = resumer.getState();
      sendResponse({
        enabled: state.enabled,
        resumeCount: state.resumeCount,
        blocked: state.blocked,
      });
      return true;
    }

    return undefined;
  });
})();
```

- [ ] **Step 2: Verify it parses**

Run: `node --check src/content/index.js && echo "parses ok"`
Expected: prints `parses ok`

- [ ] **Step 3: Confirm the unit tests still pass**

Run: `npm test`
Expected: PASS — 23 passing. This task adds no tests; `index.js` is browser glue whose logic all lives in the already-tested resumer.

- [ ] **Step 4: Commit**

```bash
git add src/content/index.js
git commit -m "feat: wire content script bootstrap and SPA watchdog"
```

---

### Task 8: Background worker and popup

**Files:**
- Create: `src/background/worker.js`
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.css`
- Create: `src/popup/popup.js`

**Interfaces:**
- Consumes: the `ll-autoresume:state` message from Task 7; the `ll-autoresume:set-enabled` and `ll-autoresume:get-state` messages handled by Task 7.
- Produces: a per-tab badge and a working popup. This task completes the extension.

- [ ] **Step 1: Create `src/background/worker.js`**

The badge is set per-tab using `sender.tab.id`, which is why the count resets naturally on reload.

```js
// The content script reports state; this worker only renders the badge.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'll-autoresume:state') return undefined;
  const tabId = sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') return undefined;

  let text = '';
  let colour = '#0a66c2';

  if (message.blocked) {
    text = '!';
    colour = '#8c2020';
  } else if (message.enabled) {
    text = message.resumeCount > 0 ? String(message.resumeCount) : 'on';
  }

  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: colour }).catch(() => {});
  return undefined;
});
```

- [ ] **Step 2: Create `src/popup/popup.html`**

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <h1>Tự phát lại</h1>

    <label class="row">
      <input type="checkbox" id="toggle" />
      <span id="toggle-label">Đang bật</span>
    </label>

    <p class="stat">Đã tự phát lại: <strong id="count">0</strong> lần</p>
    <p class="note" id="note"></p>

    <script src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/popup/popup.css`**

```css
body {
  width: 240px;
  margin: 0;
  padding: 14px 16px;
  font: 14px/1.45 system-ui, -apple-system, sans-serif;
  color: #1d2226;
  background: #fff;
}

h1 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.stat {
  margin: 12px 0 0;
  color: #555;
}

.note {
  margin: 8px 0 0;
  min-height: 1em;
  font-size: 12px;
  color: #8c2020;
}
```

- [ ] **Step 4: Create `src/popup/popup.js`**

`chrome.tabs.query` needs no `tabs` permission when used with `active: true, currentWindow: true`. If the active tab is not a LinkedIn Learning page, the content script is absent and `sendMessage` rejects — handled by disabling the toggle with an explanation rather than throwing.

```js
const toggle = document.getElementById('toggle');
const toggleLabel = document.getElementById('toggle-label');
const count = document.getElementById('count');
const note = document.getElementById('note');

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

function render(state) {
  toggle.checked = Boolean(state.enabled);
  toggleLabel.textContent = state.enabled ? 'Đang bật' : 'Đang tắt';
  count.textContent = String(state.resumeCount || 0);
  note.textContent = state.blocked ? 'Chrome đang chặn tự phát — bấm vào trang một lần.' : '';
}

async function load() {
  const tabId = await activeTabId();
  if (tabId === null) {
    note.textContent = 'Không tìm thấy tab.';
    toggle.disabled = true;
    return;
  }
  try {
    const state = await chrome.tabs.sendMessage(tabId, { type: 'll-autoresume:get-state' });
    render(state || {});
  } catch (error) {
    toggle.disabled = true;
    note.textContent = 'Hãy mở một bài học LinkedIn Learning.';
  }
}

toggle.addEventListener('change', async () => {
  const tabId = await activeTabId();
  if (tabId === null) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'll-autoresume:set-enabled',
      enabled: toggle.checked,
    });
    toggleLabel.textContent = toggle.checked ? 'Đang bật' : 'Đang tắt';
  } catch (error) {
    note.textContent = 'Hãy mở một bài học LinkedIn Learning.';
  }
});

load();
```

- [ ] **Step 5: Verify everything parses and tests pass**

Run: `node --check src/background/worker.js && node --check src/popup/popup.js && npm test`
Expected: no parse errors, 23 tests passing

- [ ] **Step 6: Commit**

```bash
git add src/background/worker.js src/popup/
git commit -m "feat: add background badge worker and popup toggle"
```

---

### Task 9: README with install and selector-tuning instructions

The spec's known unknown — LinkedIn's Next button and modal selectors cannot be verified without an authenticated session. This task documents how to correct them.

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything built in Tasks 1–8.
- Produces: nothing consumed by later tasks. Final task.

- [ ] **Step 1: Create `README.md`**

```markdown
# LinkedIn Learning Auto-Resume

Resumes LinkedIn Learning videos that stop on their own, so losing focus for a
moment does not mean losing the lesson.

## What it does

While the switch is ON:

- Resumes playback whenever the video pauses.
- Clicks through dialogs that block the player ("still watching?").
- Advances to the next lesson when a video ends.
- Restores your playback speed if it gets reset.

One switch controls all four. To pause for real, turn the switch OFF.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open a lesson at `https://www.linkedin.com/learning/...`.

The toolbar badge shows `on` when active and switches to a resume count as it
works. `!` means Chrome blocked autoplay — click anywhere on the page once.

## Tests

    npm test

Unit tests cover the decision logic in `src/content/resumer.js` against a fake
player, so no browser is needed.

## Tuning the selectors

The resume path needs no LinkedIn-specific selector — it uses
`document.querySelector('video')`. But the **Next button** and the
**"still watching" dialog** are matched by CSS selectors that LinkedIn changes
from time to time.

To see what the extension is matching, run this in the page console on a lesson:

    localStorage.llAutoResumeDebug = '1'

Reload. The console then logs every attach, click, and failed lookup under
`[ll-autoresume]`. If you see `next button not found` or
`visible dialog with no continue-style button`, copy those lines and update the
`SELECTORS` object at the top of `src/content/player.js`, then reload the
extension.

Turn logging off with:

    localStorage.removeItem('llAutoResumeDebug')

## Architecture

| File | Responsibility |
|---|---|
| `src/content/resumer.js` | All decision logic. No DOM access — fully unit-tested. |
| `src/content/player.js` | The only file with LinkedIn CSS selectors. |
| `src/content/toast.js` | The brief on-video notification. |
| `src/content/index.js` | Wires the pieces, attaches listeners, runs the 2s watchdog. |
| `src/background/worker.js` | Renders the toolbar badge. |
| `src/popup/` | The ON/OFF switch and resume counter. |

The split exists so that the fragile part (selectors) is isolated from the part
worth testing (logic), and so a LinkedIn redesign only requires editing
`player.js`.

## Limits

- Chrome and Edge only (Manifest V3).
- Does not answer chapter quizzes.
- The resume count is per-tab and resets on reload.
```

- [ ] **Step 2: Confirm the full suite passes**

Run: `npm test`
Expected: PASS — 23 passing

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with install and selector-tuning guide"
```

---

## Manual Verification

Automated tests cover the decision logic but cannot verify the DOM adapter. After
Task 9, verify by hand:

1. Load unpacked at `chrome://extensions`.
2. Open a LinkedIn Learning lesson and start playing.
3. Set `localStorage.llAutoResumeDebug = '1'` in the page console and reload.
4. Click pause. Expected: video resumes within ~100ms, a "Đã tự phát lại" toast
   appears, and the badge shows `1`.
5. Open the popup, turn the switch OFF, click pause. Expected: video stays paused
   and the badge clears.
6. Turn the switch back ON. Let a lesson run to its end. Expected: the next lesson
   loads. If it does not, check the console for `next button not found` and tune
   `SELECTORS.nextButton`.
7. Set speed to 1.5x, then let a lesson change happen. Expected: the new lesson
   plays at 1.5x.
8. Report any `[ll-autoresume]` warnings so the selectors can be corrected.
