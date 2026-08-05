export function createFakePlayer(overrides = {}) {
  const player = {
    paused: true,
    ended: false,
    rate: 1,
    playRejections: 0,
    playCalls: 0,
    clickPlayButtonCalls: 0,
    goNextCalls: 0,
    dismissCalls: 0,
    modal: null,

    // Text-lesson state: no video, a Next button, and an SPA location.
    video: true,
    location: 'https://www.linkedin.com/learning/course/lesson-1',
    pageNextButton: false,
    pageNextClicks: 0,
    pageNextNavigates: true,

    hasVideo: () => player.video,
    getLocation: () => player.location,
    findPageNextButton() {
      if (!player.pageNextButton) return null;
      return {
        click: () => {
          player.pageNextClicks += 1;
          if (player.pageNextNavigates) {
            player.location = `${player.location}-next${player.pageNextClicks}`;
          }
          return true;
        },
      };
    },

    isPaused: () => player.paused,
    isEnded: () => player.ended,
    async play() {
      player.playCalls += 1;
      if (player.playRejections > 0) {
        player.playRejections -= 1;
        throw new Error('NotAllowedError');
      }
      player.paused = false;
    },
    clickPlayButton() {
      player.clickPlayButtonCalls += 1;
      player.paused = false;
      return true;
    },
    goNext() {
      player.goNextCalls += 1;
      return true;
    },
    findBlockingModal() {
      if (!player.modal) return null;
      return {
        dismiss: () => {
          player.dismissCalls += 1;
          player.modal = null;
          return true;
        },
      };
    },
    getRate: () => player.rate,
    setRate: (value) => {
      player.rate = value;
    },
    ...overrides,
  };
  return player;
}

export function createFakeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

export const noSleep = async () => {};
