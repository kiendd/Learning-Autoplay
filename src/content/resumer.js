const RETRY_DELAYS = [250, 1000, 3000];
const BREAKER_LIMIT = 5;
const BREAKER_WINDOW_MS = 10000;
const COOLDOWN_MS = 60000;

// Auto-next on text lessons clicks the moment it sees the button, so a course
// made of consecutive text pages would be walked end to end in seconds. These
// bound a runaway.
//
// The tally must outlive the page: advancing destroys the content script and
// builds a fresh one, so a counter held in memory here is wiped by the very
// action it is counting. It is injected and persisted instead.
const AUTO_NEXT_LIMIT = 10;
const AUTO_NEXT_WINDOW_MS = 60000;

const DEFAULTS = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: () => {},
  onResumed: () => {},
  onBlocked: () => {},
  onCooldown: () => {},
  onAutoNext: () => {},
  onAutoNextStopped: () => {},
  getStoredRate: () => 1,
  saveRate: () => {},
  canIntervene: () => true,
};

function createResumer(options) {
  const {
    player, now, sleep, log,
    onResumed, onBlocked, onCooldown, onAutoNext, onAutoNextStopped,
    getStoredRate, saveRate, canIntervene,
  } = { ...DEFAULTS, ...options };

  let enabled = true;
  let resumeCount = 0;
  let blocked = false;
  let cooldownUntil = 0;
  let recentResumes = [];

  let autoNextText = false;
  let autoNextStopped = false;
  let advancedFrom = null;

  // Defaults to per-instance memory, which is enough for tests; index.js injects
  // storage-backed versions so the tally survives the navigation it records.
  let memoryLog = { log: [], total: 0 };
  const loadAdvanceLog = options.loadAdvanceLog || (async () => memoryLog);
  const saveAdvanceLog = options.saveAdvanceLog || (async (value) => {
    memoryLog = value;
  });
  let autoNextCount = 0;

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
    if (!canIntervene()) return;
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
    // Without this the extension would walk through the whole course while the
    // screen is locked overnight.
    if (!canIntervene()) return;
    log('video ended, advancing to the next lesson');
    player.goNext();
  }

  async function checkModal() {
    if (!enabled) return;
    if (!canIntervene()) return;
    if (!player.isPaused()) return;
    dismissModal();
  }

  // Text and document lessons never fire `ended`, so advancing them needs its
  // own trigger: the watchdog calls this and it clicks Next as soon as it sees
  // one. Opt-in, because it skips past content nobody has read.
  async function checkTextLesson() {
    if (!enabled) return;
    if (!autoNextText) return;
    if (autoNextStopped) return;
    if (!canIntervene()) return;
    // Video lessons advance on `ended`; leave them alone.
    if (player.hasVideo()) return;

    const here = player.getLocation();
    // One advance per page, whatever happens. If the click does not navigate,
    // this is what stops the watchdog clicking the same button every 2s.
    if (here === advancedFrom) return;

    const next = player.findPageNextButton();
    if (!next) return;

    const stored = await loadAdvanceLog();
    const cutoff = now() - AUTO_NEXT_WINDOW_MS;
    const recent = stored.log.filter((stamp) => stamp > cutoff);
    if (recent.length >= AUTO_NEXT_LIMIT) {
      autoNextStopped = true;
      log('auto-next advanced', AUTO_NEXT_LIMIT, 'times in a minute; stopping');
      onAutoNextStopped();
      return;
    }

    advancedFrom = here;
    recent.push(now());
    // Recorded before the click, because the click may tear this page down
    // before a later write could land.
    await saveAdvanceLog({ log: recent, total: stored.total + 1 });
    autoNextCount = stored.total + 1;

    if (next.click() !== true) return;
    onAutoNext();
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
    checkTextLesson,
    restoreRate,
    setEnabled(value) {
      enabled = value;
    },
    // `reset` marks a deliberate flip of the switch, as opposed to restoring
    // the saved setting on page load. Only a deliberate flip clears the tally:
    // clearing it on every load would wipe the very record that bounds a
    // runaway, since each advance reloads the page.
    setAutoNextText(value, { reset = false } = {}) {
      autoNextText = Boolean(value);
      if (!autoNextText || !reset) return;
      autoNextStopped = false;
      loadAdvanceLog()
        .then((stored) => saveAdvanceLog({ log: [], total: stored.total }))
        .catch(() => {});
    },
    // Lets the popup show a running total that a page load does not reset.
    async syncAutoNextCount() {
      const stored = await loadAdvanceLog();
      autoNextCount = stored.total;
    },
    getState: () => ({
      enabled,
      resumeCount,
      blocked,
      cooldownUntil,
      suppressed: !canIntervene(),
      autoNextText,
      autoNextCount,
      autoNextStopped,
    }),
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
  window.__llAutoResume.AUTO_NEXT_LIMIT = AUTO_NEXT_LIMIT;
  window.__llAutoResume.AUTO_NEXT_WINDOW_MS = AUTO_NEXT_WINDOW_MS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createResumer,
    RETRY_DELAYS,
    BREAKER_LIMIT,
    BREAKER_WINDOW_MS,
    COOLDOWN_MS,
    AUTO_NEXT_LIMIT,
    AUTO_NEXT_WINDOW_MS,
  };
}
