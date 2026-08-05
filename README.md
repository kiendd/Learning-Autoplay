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

## Auto-next on text lessons

A second switch, **off by default**. Text and document lessons have no video, so
they never fire `ended` and the four behaviours above never apply — they just sit
there until you click **Next**.

With this on, the extension clicks Next as soon as it finds it. That means it
**skips past content you have not read**, which is why it is opt-in and separate
from the main switch.

The Next button is matched by its label, not its class: LinkedIn's class names
are build hashes (`_button_ps32ck`) that change on every deploy. The pattern is
anchored at the start of the label so the Previous button sitting next to it can
never match.

**Runaway guard.** Five advances within a minute stops it until you toggle the
switch off and on. The tally lives in `chrome.storage.local`, not in memory,
because each advance reloads the page and destroys the content script — a
counter held in memory would be wiped by the very action it counts. Without
this, a course of consecutive text pages is walked end to end in seconds.

## When it stands down

Resuming a video nobody is looking at is worse than useless, so the extension
keeps quiet unless the lesson is actually on screen:

| Situation | Behaviour |
|---|---|
| Window not focused, tab still the visible one | **Resumes** — this is the case it exists for |
| Another tab is in front | Stands down |
| Window minimised or fully covered by another app | Stands down |
| Screen locked or on a screensaver | Stands down |
| First 5s after unlocking, waking from sleep, or returning to the tab | Waits, then resumes |

The `idle` permission exists only for the locked-screen check. Being *idle* — not
touching the keyboard for a while — is the normal state of someone watching a
lesson and is never treated as a reason to stop.

Nothing is lost while it stands down: when the lesson comes back on screen, the
watchdog picks up the paused video and resumes it once the 5s settling period is
over.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open a lesson at `https://www.linkedin.com/learning/...`.

The toolbar badge shows `on` when active and switches to a resume count as it
works. `!` means Chrome blocked autoplay — click anywhere on the page once.

## Tests

    npm test

Unit tests cover the decision logic in `src/content/resumer.js` against a fake
player, and the stand-down rules in `src/content/gate.js` against a fake clock,
so no browser is needed.

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
| `src/content/gate.js` | Decides whether intervening is allowed at all. Also unit-tested. |
| `src/content/player.js` | The only file with LinkedIn CSS selectors. |
| `src/content/toast.js` | The brief on-video notification. |
| `src/content/index.js` | Wires the pieces, attaches listeners, runs the 2s watchdog. |
| `src/background/worker.js` | Renders the toolbar badge, and reports screen lock (`chrome.idle` is not reachable from a content script). |
| `src/popup/` | The two switches and the counters. |

The split exists so that the fragile part (selectors) is isolated from the part
worth testing (logic), and so a LinkedIn redesign only requires editing
`player.js`.

## Limits

- Chrome and Edge only (Manifest V3).
- Does not answer chapter quizzes.
- The resume count is per-tab and resets on reload. The auto-next count does
  not — it is a running total kept in `chrome.storage.local`.
- Auto-next fires within one watchdog tick, so "immediately" means up to 2s.
