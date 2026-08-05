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
