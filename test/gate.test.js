import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContentScript } from './load-content-script.js';
import { createFakeClock } from './fake-player.js';

const { createGate, GRACE_MS, WAKE_GAP_MS } = loadContentScript('gate.js');

function setup(startVisible = true) {
  const clock = createFakeClock();
  const state = { visible: startVisible };
  const gate = createGate({
    now: clock.now,
    isVisible: () => state.visible,
    log: () => {},
  });
  return { clock, state, gate };
}

test('is open on a freshly loaded visible tab, with no grace window', () => {
  const { gate } = setup();

  assert.equal(gate.isOpen(), true);
  gate.evaluate();
  assert.equal(gate.isOpen(), true);
});

test('is closed while the tab is hidden behind another tab', () => {
  const { state, gate } = setup();
  state.visible = false;
  gate.evaluate();

  assert.equal(gate.isOpen(), false);
});

test('is closed while the machine is locked, even with the tab visible', () => {
  const { gate } = setup();
  gate.setLocked(true);

  assert.equal(gate.isOpen(), false);
  assert.equal(gate.getState().visible, true);
});

test('window focus is not an input: an unfocused but visible tab stays open', () => {
  // There is no focus signal to set — this test documents that the gate has no
  // way to close on focus loss, which is the behaviour the extension exists for.
  const { gate } = setup();
  gate.evaluate();

  assert.equal(gate.isOpen(), true);
});

test('reopening after the tab was hidden holds off for the grace window', () => {
  const { clock, state, gate } = setup();
  gate.evaluate();

  state.visible = false;
  gate.evaluate();
  assert.equal(gate.isOpen(), false);

  state.visible = true;
  gate.evaluate();
  assert.equal(gate.isOpen(), false, 'still holding off right after the tab returns');

  clock.advance(GRACE_MS - 1);
  assert.equal(gate.isOpen(), false);

  clock.advance(1);
  assert.equal(gate.isOpen(), true);
});

test('unlocking the machine holds off for the grace window', () => {
  const { clock, gate } = setup();
  gate.evaluate();
  gate.setLocked(true);

  gate.setLocked(false);
  assert.equal(gate.isOpen(), false);

  clock.advance(GRACE_MS);
  assert.equal(gate.isOpen(), true);
});

test('a timer gap far longer than the watchdog interval counts as waking from sleep', () => {
  const { clock, gate } = setup();
  gate.noteTick();

  clock.advance(WAKE_GAP_MS + 1);
  gate.noteTick();

  assert.equal(gate.isOpen(), false, 'the page gets a moment to settle after a wake');

  clock.advance(GRACE_MS);
  assert.equal(gate.isOpen(), true);
});

test('normal watchdog ticks do not trigger a grace window', () => {
  const { clock, gate } = setup();
  gate.noteTick();

  for (let i = 0; i < 5; i += 1) {
    clock.advance(2000);
    gate.noteTick();
    assert.equal(gate.isOpen(), true);
  }
});

test('the first tick is not mistaken for a wake', () => {
  const { clock, gate } = setup();
  clock.advance(WAKE_GAP_MS * 10);

  gate.noteTick();

  assert.equal(gate.isOpen(), true);
});

test('repeated evaluations while open do not extend the grace window', () => {
  const { clock, state, gate } = setup();
  gate.evaluate();
  state.visible = false;
  gate.evaluate();
  state.visible = true;
  gate.evaluate();

  clock.advance(GRACE_MS - 1);
  gate.evaluate();
  clock.advance(1);

  assert.equal(gate.isOpen(), true);
});
