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
