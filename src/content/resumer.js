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
  getStoredRate: () => 1,
  saveRate: () => {},
};

function createResumer(options) {
  const {
    player, now, sleep, log,
    onResumed, onBlocked, onCooldown,
    getStoredRate, saveRate,
  } = { ...DEFAULTS, ...options };

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

  // Dismisses a dialog overlaying the paused player. Returns true if one was closed.
  function dismissModal() {
    const modal = player.findBlockingModal();
    if (!modal) return false;
    log('dismissing a blocking modal');
    return modal.dismiss() === true;
  }

  async function onPause() {
    if (!enabled) return;
    if (player.isEnded()) return;
    if (!player.isPaused()) return;
    if (inCooldown()) return;
    if (breakerTripped()) return;

    dismissModal();

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
    restoreRate();
    onResumed();
  }

  async function onEnded() {
    if (!enabled) return;
    log('video ended, advancing to the next lesson');
    player.goNext();
  }

  async function checkModal() {
    if (!enabled) return;
    if (!player.isPaused()) return;
    dismissModal();
  }

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
}

// Dual target: Chrome loads this as a classic content script and picks up the
// global; the test loader evaluates it in a vm sandbox and reads module.exports.
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
