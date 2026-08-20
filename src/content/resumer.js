const RETRY_DELAYS = [250, 1000, 3000];
const BREAKER_LIMIT = 5;
const BREAKER_WINDOW_MS = 10000;
const COOLDOWN_MS = 60000;

// A fresh player sets its own playback rate while it starts up, and that rate
// arrives as a `ratechange` indistinguishable from the user picking one. For
// this long after a video element appears, such a change is treated as the
// player initialising: the stored rate is reasserted instead of overwritten.
// Without it, LinkedIn's reset to 1× quietly becomes the saved default.
const RATE_SETTLE_MS = 4000;

// Auto-next on text lessons clicks the moment it sees the button, so a course
// made of consecutive text pages would be walked end to end in seconds. These
// bound a runaway.
//
// The tally must outlive the page: advancing destroys the content script and
// builds a fresh one, so a counter held in memory here is wiped by the very
// action it is counting. It is injected and persisted instead.
const AUTO_NEXT_LIMIT = 5;
const AUTO_NEXT_WINDOW_MS = 60000;

// A stall is the playhead standing still while the video reports itself as
// playing: `paused` is false, `ended` is false, and no `waiting` or `stalled`
// event ever fires. It happens when the playhead ends up outside the buffered
// range and the player never asks for the missing segment — it is waiting for
// data it has not requested and never will. Nothing pause-driven can see this,
// so it is detected by watching the clock instead of by listening for an event.
//
// STALL_EPSILON is below one frame at any rate the player offers, so a real
// advance always clears it; the numbers a stalled player reports are identical
// between readings rather than merely close.
const STALL_EPSILON = 0.05;

// Long enough that a brief rebuffer on a slow connection recovers on its own
// first — seeking through one of those would cost more than it saves.
const STALL_MS = 3000;

// The recovery: move the playhead a hair forward. That makes the player
// recompute which segment it needs and fetch it. Small enough that nothing
// audible is skipped.
const NUDGE_SECONDS = 0.15;

// If nudging has not restored playback this many times in a window, the cause
// is something a seek cannot fix — a dead network, a revoked stream — and
// repeating it would seek through the lesson a fifth of a second at a time.
const STALL_LIMIT = 5;
const STALL_WINDOW_MS = 60000;

const DEFAULTS = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: () => {},
  onResumed: () => {},
  onBlocked: () => {},
  onCooldown: () => {},
  onAutoNext: () => {},
  onAutoNextStopped: () => {},
  onUnstuck: () => {},
  onStallGaveUp: () => {},
  getStoredRate: () => 1,
  saveRate: () => {},
  canIntervene: () => true,
};

function createResumer(options) {
  const {
    player, now, sleep, log,
    onResumed, onBlocked, onCooldown, onAutoNext, onAutoNextStopped,
    onUnstuck, onStallGaveUp,
    getStoredRate, saveRate, canIntervene,
  } = { ...DEFAULTS, ...options };

  let enabled = true;
  let resumeCount = 0;
  let blocked = false;
  let cooldownUntil = 0;
  let recentResumes = [];

  // Stall tracking. lastTime is the previous reading of the playhead and
  // lastProgressAt when it last differed; a stall is the gap between them
  // growing past STALL_MS.
  let lastTime = null;
  let lastProgressAt = 0;
  let unstickCount = 0;
  let recentNudges = [];
  let stallStopped = false;

  let rateSettleUntil = 0;
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

  function resetStall() {
    lastTime = null;
    lastProgressAt = now();
  }

  // Called by the watchdog on every tick. Compares the playhead against the
  // previous tick and nudges it when it has not moved while the video claims to
  // be playing.
  function checkStall() {
    if (!enabled) return;
    if (!canIntervene()) return;
    if (stallStopped) return;
    if (inCooldown()) return;

    const current = player.getCurrentTime();
    // No video, or a paused or finished one: nothing is expected to move, so
    // start the clock fresh rather than accumulating a false stall.
    if (current === null || player.isPaused() || player.isEnded()) {
      resetStall();
      return;
    }

    if (lastTime === null || Math.abs(current - lastTime) > STALL_EPSILON) {
      lastTime = current;
      lastProgressAt = now();
      return;
    }

    if (now() - lastProgressAt < STALL_MS) return;

    const cutoff = now() - STALL_WINDOW_MS;
    recentNudges = recentNudges.filter((stamp) => stamp > cutoff);
    if (recentNudges.length >= STALL_LIMIT) {
      stallStopped = true;
      log('nudged', STALL_LIMIT, 'times in a minute without recovering; stopping');
      onStallGaveUp();
      return;
    }

    log('playhead stuck at', current, 'for', now() - lastProgressAt, 'ms; nudging');
    recentNudges.push(now());
    // Restarted before the seek rather than after: the seek changes
    // currentTime, and treating that change as progress would hide a nudge that
    // achieved nothing.
    lastProgressAt = now();
    lastTime = null;
    if (player.nudge(NUDGE_SECONDS) !== true) return;
    unstickCount += 1;
    onUnstuck();
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
    if (now() < rateSettleUntil) {
      log('ignoring a rate change while the player settles');
      restoreRate();
      return;
    }
    const rate = player.getRate();
    log('remembering playback rate', rate);
    saveRate(rate);
  }

  // A floor rather than an exact match: the stored rate is the slowest the
  // lesson should ever run at, so a faster one set on the page is left alone.
  function restoreRate() {
    const wanted = getStoredRate();
    if (typeof wanted !== 'number' || wanted <= 0) return;
    if (player.getRate() >= wanted) return;
    log('raising playback rate to', wanted);
    player.setRate(wanted);
  }

  // Called when a new video element appears — a page load or a lesson change.
  function onVideoChanged() {
    rateSettleUntil = now() + RATE_SETTLE_MS;
    // A new lesson is a fresh start: the previous one's playhead readings and
    // its record of failed nudges say nothing about this one.
    resetStall();
    recentNudges = [];
    stallStopped = false;
    restoreRate();
  }

  // The watchdog keeps reasserting the rate for as long as the player might
  // still be overriding it.
  function keepRate() {
    if (now() >= rateSettleUntil) return;
    restoreRate();
  }

  return {
    onPause,
    onEnded,
    onRateChange,
    checkStall,
    checkModal,
    checkTextLesson,
    restoreRate,
    onVideoChanged,
    keepRate,
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
      unstickCount,
      stallStopped,
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
  window.__llAutoResume.RATE_SETTLE_MS = RATE_SETTLE_MS;
  window.__llAutoResume.AUTO_NEXT_LIMIT = AUTO_NEXT_LIMIT;
  window.__llAutoResume.AUTO_NEXT_WINDOW_MS = AUTO_NEXT_WINDOW_MS;
  window.__llAutoResume.STALL_EPSILON = STALL_EPSILON;
  window.__llAutoResume.STALL_MS = STALL_MS;
  window.__llAutoResume.NUDGE_SECONDS = NUDGE_SECONDS;
  window.__llAutoResume.STALL_LIMIT = STALL_LIMIT;
  window.__llAutoResume.STALL_WINDOW_MS = STALL_WINDOW_MS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createResumer,
    RETRY_DELAYS,
    BREAKER_LIMIT,
    BREAKER_WINDOW_MS,
    COOLDOWN_MS,
    RATE_SETTLE_MS,
    AUTO_NEXT_LIMIT,
    AUTO_NEXT_WINDOW_MS,
    STALL_EPSILON,
    STALL_MS,
    NUDGE_SECONDS,
    STALL_LIMIT,
    STALL_WINDOW_MS,
  };
}
