(() => {
  const ns = window.__llAutoResume;
  if (!ns || !ns.createResumer || !ns.createDomPlayer || !ns.createToast || !ns.createGate) {
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

  // visibilityState is 'visible' whenever this is the selected tab in a window
  // that is not minimised or fully covered — and it stays 'visible' when the
  // window merely loses focus, which is exactly the case we want to keep serving.
  const gate = ns.createGate({
    log,
    isVisible: () => document.visibilityState === 'visible',
  });

  let cachedRate = 1;

  const resumer = ns.createResumer({
    player,
    log,
    canIntervene: () => gate.isOpen(),
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
    gate.noteTick();
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

  document.addEventListener('visibilitychange', () => {
    gate.evaluate();
    log('visibility changed;', gate.getState());
  });

  // The worker pushes lock changes, but a tab that loads while the screen is
  // already locked has no event to wait for.
  chrome.runtime
    .sendMessage({ type: 'll-autoresume:query-lock' })
    .then((reply) => gate.setLocked(Boolean(reply && reply.locked)))
    .catch(() => {});

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

    if (message.type === 'll-autoresume:lock-state') {
      gate.setLocked(Boolean(message.locked));
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
