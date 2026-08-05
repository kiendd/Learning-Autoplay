// Decides whether the extension is allowed to touch playback at all.
//
// The one case this exists to protect: the browser window has lost focus but the
// tab is still the visible one. That is somebody listening while they work in
// another app, and it must keep resuming. So window focus is deliberately not an
// input here — only visibility, screen lock, and a short settling period.

// Wrapped in an IIFE because every content script shares one lexical scope in
// the isolated world: a bare top-level `const` here would collide with the same
// name in a sibling file and kill that file at parse time.
(() => {

const GRACE_MS = 5000;
const WAKE_GAP_MS = 30000;

const DEFAULTS = {
  now: () => Date.now(),
  isVisible: () => true,
  log: () => {},
};

function createGate(options) {
  const { now, isVisible, log } = { ...DEFAULTS, ...options };

  let locked = false;
  let graceUntil = 0;
  let lastTickAt = null;
  let wasOpen = null;

  function rawOpen() {
    return isVisible() && !locked;
  }

  function openGrace(reason) {
    graceUntil = now() + GRACE_MS;
    log('holding off for', GRACE_MS, 'ms after', reason);
  }

  // Recomputes the gate and starts a grace window on a closed -> open edge.
  // This is the only function with side effects; isOpen() stays a pure read so
  // the pause handler can call it from a video event without disturbing state.
  function evaluate() {
    const open = rawOpen();
    // The very first call only records a baseline. A page that loads with its
    // tab already visible must not sit through a grace window for nothing.
    if (wasOpen !== null && open && !wasOpen) openGrace('the gate reopened');
    wasOpen = open;
    return open;
  }

  // Called by the watchdog. Timers stop while the machine sleeps, so a gap far
  // longer than the watchdog interval means we just woke up — the page may still
  // be reconnecting, so let it settle before resuming anything.
  function noteTick() {
    const at = now();
    const gap = lastTickAt === null ? 0 : at - lastTickAt;
    lastTickAt = at;
    if (gap > WAKE_GAP_MS) openGrace('a timer gap of ' + gap + 'ms (the machine slept)');
    return evaluate();
  }

  function setLocked(value) {
    const next = Boolean(value);
    if (next === locked) return;
    locked = next;
    log('the machine is now', next ? 'locked' : 'unlocked');
    evaluate();
  }

  function isOpen() {
    if (!rawOpen()) return false;
    return now() >= graceUntil;
  }

  return {
    evaluate,
    noteTick,
    setLocked,
    isOpen,
    getState: () => ({
      visible: isVisible(),
      locked,
      graceUntil,
      open: isOpen(),
    }),
  };
}

// Dual target: Chrome loads this as a classic content script and picks up the
// global; the test loader evaluates it in a vm sandbox and reads module.exports.
if (typeof window !== 'undefined') {
  window.__llAutoResume = window.__llAutoResume || {};
  window.__llAutoResume.createGate = createGate;
  window.__llAutoResume.GRACE_MS = GRACE_MS;
  window.__llAutoResume.WAKE_GAP_MS = WAKE_GAP_MS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createGate, GRACE_MS, WAKE_GAP_MS };
}

})();
