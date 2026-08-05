import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContentScript } from './load-content-script.js';
import { createFakePlayer, createFakeClock, noSleep } from './fake-player.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
function loadPlayerInto(sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(here, '..', 'src', 'content', 'player.js'), 'utf8'), sandbox);
}

const { createResumer, AUTO_NEXT_LIMIT } = loadContentScript('resumer.js');

// Stands in for chrome.storage.local: outlives any one content script.
function createFakeStore(initial = { log: [], total: 0 }) {
  let value = initial;
  return {
    writes: 0,
    load: async () => ({ log: [...value.log], total: value.total }),
    save: async (next) => {
      value = next;
    },
    peek: () => value,
  };
}

// A text lesson: no video element, a Next button at the foot of the page.
function setup(overrides = {}) {
  const player = createFakePlayer({ video: false, pageNextButton: true, ...overrides.player });
  const clock = overrides.clock || createFakeClock();
  const store = overrides.store || createFakeStore();
  const events = { autoNext: 0, stopped: 0 };
  const resumer = createResumer({
    player,
    now: clock.now,
    sleep: noSleep,
    log: () => {},
    loadAdvanceLog: store.load,
    saveAdvanceLog: store.save,
    onAutoNext: () => {
      events.autoNext += 1;
    },
    onAutoNextStopped: () => {
      events.stopped += 1;
    },
    ...overrides.resumer,
  });
  resumer.setAutoNextText(true);
  return { player, clock, store, resumer, events };
}

test('is off unless it has been switched on', async () => {
  const { player, resumer } = setup();
  resumer.setAutoNextText(false);

  await resumer.checkTextLesson();

  assert.equal(player.pageNextClicks, 0);
});

test('clicks Next on a text lesson', async () => {
  const { player, resumer, events } = setup();

  await resumer.checkTextLesson();

  assert.equal(player.pageNextClicks, 1);
  assert.equal(resumer.getState().autoNextCount, 1);
  assert.equal(events.autoNext, 1);
});

test('leaves video lessons alone — those advance on ended', async () => {
  const { player, resumer } = setup({ player: { video: true } });

  await resumer.checkTextLesson();

  assert.equal(player.pageNextClicks, 0);
});

test('does nothing on a text lesson with no Next button', async () => {
  const { player, resumer } = setup({ player: { pageNextButton: false } });

  await resumer.checkTextLesson();

  assert.equal(player.pageNextClicks, 0);
});

test('does not advance while the extension is off', async () => {
  const { player, resumer } = setup();
  resumer.setEnabled(false);

  await resumer.checkTextLesson();

  assert.equal(player.pageNextClicks, 0);
});

test('does not advance while the gate is closed', async () => {
  const { player, resumer } = setup({ resumer: { canIntervene: () => false } });

  await resumer.checkTextLesson();

  assert.equal(player.pageNextClicks, 0);
});

test('advances once per page as the watchdog keeps ticking', async () => {
  const { player, resumer } = setup();

  await resumer.checkTextLesson();
  const afterFirst = player.pageNextClicks;
  await resumer.checkTextLesson();
  await resumer.checkTextLesson();

  assert.equal(afterFirst, 1);
  assert.equal(player.pageNextClicks, 3, 'each new page gets one advance');
});

test('clicks only once when the click does not navigate', async () => {
  const { player, resumer } = setup({ player: { pageNextNavigates: false } });

  for (let i = 0; i < 5; i += 1) await resumer.checkTextLesson();

  assert.equal(player.pageNextClicks, 1, 'a dead Next button must not be hammered');
});

test('stops itself after too many advances in a minute', async () => {
  const { player, clock, resumer, events } = setup();

  for (let i = 0; i < AUTO_NEXT_LIMIT + 3; i += 1) {
    await resumer.checkTextLesson();
    clock.advance(1000);
  }

  assert.equal(player.pageNextClicks, AUTO_NEXT_LIMIT);
  assert.equal(resumer.getState().autoNextStopped, true);
  assert.equal(events.stopped, 1);
});

test('does not stop when advances are spread out', async () => {
  const { player, clock, resumer, events } = setup();

  for (let i = 0; i < AUTO_NEXT_LIMIT + 3; i += 1) {
    await resumer.checkTextLesson();
    clock.advance(30000);
  }

  assert.equal(player.pageNextClicks, AUTO_NEXT_LIMIT + 3);
  assert.equal(events.stopped, 0);
});

test('switching the option off and on clears a runaway stop', async () => {
  const { player, clock, resumer } = setup();
  for (let i = 0; i < AUTO_NEXT_LIMIT + 1; i += 1) {
    await resumer.checkTextLesson();
    clock.advance(100);
  }
  assert.equal(resumer.getState().autoNextStopped, true);

  resumer.setAutoNextText(false);
  resumer.setAutoNextText(true, { reset: true });
  await Promise.resolve();
  await resumer.checkTextLesson();

  assert.equal(resumer.getState().autoNextStopped, false);
  assert.equal(player.pageNextClicks, AUTO_NEXT_LIMIT + 1);
});

// The bug that shipped past the first round of tests: advancing tears the page
// down and builds a fresh resumer, so a tally kept in memory is wiped by the
// very action it counts. Each iteration below is a new page load.
test('the runaway guard survives the page reload that each advance causes', async () => {
  const store = createFakeStore();
  const clock = createFakeClock();
  let clicks = 0;
  let stops = 0;
  let location = 'https://www.linkedin.com/learning/course/text-0';

  for (let load = 0; load < AUTO_NEXT_LIMIT + 5; load += 1) {
    const { player, resumer } = setup({
      store,
      clock,
      player: { location },
      resumer: {
        onAutoNextStopped: () => {
          stops += 1;
        },
      },
    });
    await resumer.checkTextLesson();
    clicks += player.pageNextClicks;
    location = player.location;
    clock.advance(1000);
  }

  assert.equal(clicks, AUTO_NEXT_LIMIT, 'must stop at the limit despite the reloads');
  assert.equal(stops, 5);
  assert.equal(store.peek().total, AUTO_NEXT_LIMIT);
});

test('restoring the saved setting on page load does not clear the tally', async () => {
  const store = createFakeStore({ log: [1, 2, 3], total: 3 });
  const { resumer } = setup({ store });

  // setup() restores the setting without `reset`, the way index.js does on load.
  await Promise.resolve();

  assert.deepEqual(store.peek().log, [1, 2, 3]);
});

test('the advance total survives a page load', async () => {
  const store = createFakeStore();
  const clock = createFakeClock();

  const first = setup({ store, clock });
  await first.resumer.checkTextLesson();
  assert.equal(first.resumer.getState().autoNextCount, 1);

  const second = setup({ store, clock, player: { location: first.player.location } });
  await second.resumer.syncAutoNextCount();

  assert.equal(second.resumer.getState().autoNextCount, 1);
});

test('the Next label pattern never matches the Previous button beside it', () => {
  const sandbox = { window: {}, document: {}, console };
  sandbox.window.window = sandbox.window;
  const { PAGE_NEXT_PATTERN: pattern } = (() => {
    loadPlayerInto(sandbox);
    return sandbox.window.__llAutoResume;
  })();

  for (const label of ['Next', 'next', 'Next video', 'Tiếp theo', 'Kế tiếp']) {
    assert.ok(pattern.test(label), `expected "${label}" to match`);
  }
  for (const label of ['Previous', 'Prev', 'Back', 'Trước', 'Bài trước', 'Skip to next section']) {
    assert.ok(!pattern.test(label), `expected "${label}" NOT to match`);
  }
});
