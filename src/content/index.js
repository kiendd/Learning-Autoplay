(() => {
  const ns = window.__llAutoResume;
  if (!ns || !ns.createResumer || !ns.createDomPlayer || !ns.createToast || !ns.createGate) {
    console.warn('[ll-autoresume] content scripts loaded out of order; aborting');
    return;
  }

  const WATCHDOG_MS = 2000;
  const DEBUG_KEY = 'llAutoResumeDebug';
  const ADVANCE_LOG_KEY = 'autoNextLog';

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
    // chrome.storage.local, not memory: an advance destroys this page and its
    // content script, so an in-memory tally could never bound a runaway.
    loadAdvanceLog: async () => {
      const stored = await chrome.storage.local.get({ [ADVANCE_LOG_KEY]: null });
      const value = stored[ADVANCE_LOG_KEY];
      if (!value || !Array.isArray(value.log)) return { log: [], total: 0 };
      return { log: value.log, total: typeof value.total === 'number' ? value.total : 0 };
    },
    saveAdvanceLog: (value) => chrome.storage.local.set({ [ADVANCE_LOG_KEY]: value }),
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
    onAutoNext: () => {
      toast.show('Tự chuyển sang bài tiếp theo');
      pushState();
    },
    onAutoNextStopped: () => {
      toast.show('Tự qua trang bị dừng — chuyển quá nhanh', 'warn');
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
    resumer
      .checkTextLesson()
      .catch((error) => log('checkTextLesson threw:', error && error.message));
    // A pause that fired before the listener was attached still needs handling.
    if (attachedVideo && attachedVideo.paused && !attachedVideo.ended) {
      handlePause();
    }
  }

  chrome.storage.sync.get({ enabled: true, rate: 1, autoNextText: false }).then((stored) => {
    resumer.setEnabled(stored.enabled !== false);
    resumer.setAutoNextText(stored.autoNextText === true);
    cachedRate = typeof stored.rate === 'number' && stored.rate > 0 ? stored.rate : 1;
    log('initialised; enabled =', stored.enabled, 'autoNextText =', stored.autoNextText,
      'rate =', cachedRate);
    resumer.syncAutoNextCount().catch(() => {}).then(pushState);
    tick();
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

    // One message rather than two, so the popup's "Bật hết" button produces a
    // single toast instead of a pair.
    if (message.type === 'll-autoresume:set-all') {
      const on = Boolean(message.on);
      resumer.setEnabled(on);
      resumer.setAutoNextText(on, { reset: true });
      chrome.storage.sync.set({ enabled: on, autoNextText: on }).catch(() => {});
      toast.show(on ? 'Đã bật hết' : 'Đã tắt hết');
      pushState();
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'll-autoresume:set-auto-next') {
      const on = Boolean(message.autoNextText);
      resumer.setAutoNextText(on, { reset: true });
      chrome.storage.sync.set({ autoNextText: on }).catch(() => {});
      toast.show(on ? 'Tự qua trang text: BẬT' : 'Tự qua trang text: TẮT');
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
        autoNextText: state.autoNextText,
        autoNextCount: state.autoNextCount,
        autoNextStopped: state.autoNextStopped,
      });
      return true;
    }

    return undefined;
  });
})();
