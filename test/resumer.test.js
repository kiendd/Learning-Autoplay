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
