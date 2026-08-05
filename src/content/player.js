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

  // The Previous/Next pair at the foot of a text lesson carries no aria-label and
  // its class names are build hashes (`_button_ps32ck`) that change on every
  // LinkedIn deploy, so match the label instead. Anchored at the start so
  // "Previous" can never match.
  const PAGE_NEXT_PATTERN = /^(next|tiếp theo|kế tiếp)\b/i;

  function labelOf(element) {
    return (element.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isClickable(element) {
    if (element.disabled) return false;
    if (element.getAttribute('aria-disabled') === 'true') return false;
    return isVisible(element);
  }

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

      hasVideo() {
        return findVideo() !== null;
      },

      getLocation() {
        return window.location.href;
      },

      // The Next button on a text or document lesson, which has no `ended`
      // event to advance on.
      findPageNextButton() {
        const candidates = Array.from(document.querySelectorAll('button, a[role="button"]'));
        const match = candidates.find(
          (element) => isClickable(element) && PAGE_NEXT_PATTERN.test(labelOf(element)),
        );
        if (!match) {
          log('no page Next button on this lesson');
          return null;
        }
        return {
          click() {
            log('clicking the page Next button:', labelOf(match));
            match.click();
            return true;
          },
        };
      },

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
  window.__llAutoResume.PAGE_NEXT_PATTERN = PAGE_NEXT_PATTERN;
})();
