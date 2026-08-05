# LinkedIn Learning Auto-Resume

Resumes LinkedIn Learning videos that stop on their own, so losing focus for a
moment does not mean losing the lesson.

## What it does

While the switch is ON:

- Resumes playback whenever the video pauses.
- Clicks through dialogs that block the player ("still watching?").
- Advances to the next lesson when a video ends.
- Restores your playback speed if it gets reset.

One switch controls all four. To pause for real, turn the switch OFF.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open a lesson at `https://www.linkedin.com/learning/...`.

The toolbar badge shows `on` when active and switches to a resume count as it
works. `!` means Chrome blocked autoplay — click anywhere on the page once.

## Tests

    npm test

Unit tests cover the decision logic in `src/content/resumer.js` against a fake
player, so no browser is needed.

## Tuning the selectors

The resume path needs no LinkedIn-specific selector — it uses
`document.querySelector('video')`. But the **Next button** and the
**"still watching" dialog** are matched by CSS selectors that LinkedIn changes
from time to time.

To see what the extension is matching, run this in the page console on a lesson:

    localStorage.llAutoResumeDebug = '1'

Reload. The console then logs every attach, click, and failed lookup under
`[ll-autoresume]`. If you see `next button not found` or
`visible dialog with no continue-style button`, copy those lines and update the
`SELECTORS` object at the top of `src/content/player.js`, then reload the
extension.

Turn logging off with:

    localStorage.removeItem('llAutoResumeDebug')

## Architecture

| File | Responsibility |
|---|---|
| `src/content/resumer.js` | All decision logic. No DOM access — fully unit-tested. |
| `src/content/player.js` | The only file with LinkedIn CSS selectors. |
| `src/content/toast.js` | The brief on-video notification. |
| `src/content/index.js` | Wires the pieces, attaches listeners, runs the 2s watchdog. |
| `src/background/worker.js` | Renders the toolbar badge. |
| `src/popup/` | The ON/OFF switch and resume counter. |

The split exists so that the fragile part (selectors) is isolated from the part
worth testing (logic), and so a LinkedIn redesign only requires editing
`player.js`.

## Limits

- Chrome and Edge only (Manifest V3).
- Does not answer chapter quizzes.
- The resume count is per-tab and resets on reload.
