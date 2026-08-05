(() => {
  // Edit these when LinkedIn changes its player markup. Ordered by preference.
  const SELECTORS = {
    playButton: [
      '.vjs-play-control',
      'button[aria-label*="Play" i]',
      'button[data-live-test-classroom-layout-play]',
    ],
    nextButton: [
      'button[aria-label*="Next video" i]',
      'button[aria-label*="Next" i]',
      '.classroom-layout__next-button',
      '.vjs-next-button',
    ],
    modalContainer: [
      '[role="dialog"]',
      '.artdeco-modal',
      '.vjs-modal-dialog',
    ],
  };

  const MODAL_BUTTON_PATTERN = /tiếp tục|continue|resume|still watching|keep watching/i;

  function queryFirst(selectorList) {
    for (const selector of selectorList) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function createDomPlayer({ log = () => {} } = {}) {
    // The lesson video is the biggest one on the page; promo clips in the
    // sidebar are much smaller.
    function findVideo() {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) return null;
      return videos.reduce((largest, candidate) => {
        const area = candidate.clientWidth * candidate.clientHeight;
        const bestArea = largest.clientWidth * largest.clientHeight;
        return area > bestArea ? candidate : largest;
      });
    }

    return {
      getVideo: findVideo,

      isPaused() {
        const video = findVideo();
        return video ? video.paused : false;
      },

      isEnded() {
        const video = findVideo();
        return video ? video.ended : false;
      },

      async play() {
        const video = findVideo();
        if (!video) throw new Error('no video element found');
        await video.play();
      },

      clickPlayButton() {
        const button = queryFirst(SELECTORS.playButton);
        if (!button) {
          log('play button not found; tried', SELECTORS.playButton);
          return false;
        }
        button.click();
        const video = findVideo();
        return Boolean(video && !video.paused);
      },

      goNext() {
        const button = queryFirst(SELECTORS.nextButton);
        if (!button) {
          log('next button not found; tried', SELECTORS.nextButton);
          return false;
        }
        log('clicking next:', button.getAttribute('aria-label') || button.className);
        button.click();
        return true;
      },

      findBlockingModal() {
        for (const selector of SELECTORS.modalContainer) {
          for (const container of document.querySelectorAll(selector)) {
            if (!isVisible(container)) continue;
            const buttons = Array.from(container.querySelectorAll('button, a[role="button"]'));
            const match = buttons.find((button) =>
              MODAL_BUTTON_PATTERN.test((button.textContent || '').trim()),
            );
            if (!match) {
              log('visible dialog with no continue-style button:', container.className);
              continue;
            }
            return {
              dismiss() {
                log('clicking modal button:', (match.textContent || '').trim());
                match.click();
                return true;
              },
            };
          }
        }
        return null;
      },

      getRate() {
        const video = findVideo();
        return video ? video.playbackRate : 1;
      },

      setRate(rate) {
        const video = findVideo();
        if (video) video.playbackRate = rate;
      },
    };
  }

  window.__llAutoResume = window.__llAutoResume || {};
  window.__llAutoResume.createDomPlayer = createDomPlayer;
  window.__llAutoResume.SELECTORS = SELECTORS;
  window.__llAutoResume.MODAL_BUTTON_PATTERN = MODAL_BUTTON_PATTERN;
})();
