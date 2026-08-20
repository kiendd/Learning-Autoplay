// Paste this into the DevTools console on a real LinkedIn Learning lesson.
//
// It reports what the extension's selectors would match on the page in front of
// you. It cannot read the extension's own state: content scripts run in an
// isolated world that the page console cannot see. So it re-applies the same
// selectors from the outside, which is the part that actually breaks when
// LinkedIn redesigns.
//
// The constants below are checked against src/content/player.js by
// test/diagnose.test.js, so they cannot drift out of sync unnoticed.
(() => {
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
  const PAGE_NEXT_PATTERN = /^(next|tiếp theo|kế tiếp)/i;

  const seen = (element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const label = (element) => (element.textContent || '').replace(/\s+/g, ' ').trim();
  const describe = (element) => (element
    ? `<${element.tagName.toLowerCase()}> aria-label=${JSON.stringify(element.getAttribute('aria-label'))} text=${JSON.stringify(label(element).slice(0, 40))}`
    : null);

  const firstMatch = (list) => {
    for (const selector of list) {
      const found = document.querySelector(selector);
      if (found) return { selector, element: found };
    }
    return null;
  };

  const videos = [...document.querySelectorAll('video')];
  const biggest = videos.length
    ? videos.reduce((a, b) => (b.clientWidth * b.clientHeight > a.clientWidth * a.clientHeight ? b : a))
    : null;

  const buttons = [...document.querySelectorAll('button, a[role="button"]')].filter(seen);
  const pageNext = buttons.filter((b) => PAGE_NEXT_PATTERN.test(label(b)));

  const play = firstMatch(SELECTORS.playButton);
  const next = firstMatch(SELECTORS.nextButton);

  const dialogs = SELECTORS.modalContainer
    .flatMap((selector) => [...document.querySelectorAll(selector)])
    .filter(seen);

  const report = {
    url: location.href,
    lessonKind: biggest ? 'video' : 'text/document (no video element)',
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),

    video: biggest
      ? { size: `${biggest.clientWidth}x${biggest.clientHeight}`, paused: biggest.paused, ended: biggest.ended, rate: biggest.playbackRate, count: videos.length }
      : `none (${videos.length} video elements)`,

    playButton: play ? { matchedBy: play.selector, element: describe(play.element) } : 'NOT FOUND',
    nextButtonForVideo: next ? { matchedBy: next.selector, element: describe(next.element) } : 'NOT FOUND',

    pageNextButton: pageNext.length
      ? pageNext.map(describe)
      : 'NOT FOUND — auto-next on text lessons would do nothing here',

    visibleDialogs: dialogs.length
      ? dialogs.map((d) => ({
        classes: d.className,
        continueButton: describe([...d.querySelectorAll('button, a[role="button"]')]
          .find((b) => MODAL_BUTTON_PATTERN.test(label(b)))) || 'none matched the continue pattern',
      }))
      : 'none on screen',

    // Everything the page shows that could plausibly be a Next control, so a
    // failed match can be corrected without another round trip.
    allButtonLabels: [...new Set(buttons.map(label).filter(Boolean))].slice(0, 60),
  };

  console.log('%c[ll-autoresume] diagnosis', 'font-weight:bold');
  console.log(report);
  try {
    copy(JSON.stringify(report, null, 2));
    console.log('%cCopied to clipboard — paste it back.', 'color:#1a7f37');
  } catch (error) {
    console.log('Select the object above, right-click, "Copy object".');
  }
  return report;
})();
