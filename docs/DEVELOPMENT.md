# Development

How the extension is built and why. For installing and using it, see
[the README](../README.md) and [INSTALL.md](../INSTALL.md).

The popup is in Vietnamese; this document names its controls in Vietnamese to
match what is on screen.

## Behaviour

**Tự động chạy lại video** — the first switch, on by default — covers four
behaviours together:

- Resumes playback whenever the video pauses.
- Clicks through dialogs that block the player ("still watching?").
- Advances to the next lesson when a video ends.
- Keeps playback at your default speed.

There is no separate control for each; to pause for real, turn the switch off.

## Settings

Everything is saved in `chrome.storage.sync`, so it survives a page reload, a
browser restart, and follows the Chrome profile to another machine. Nothing has
to be set twice.

| Setting | Where | Default |
|---|---|---|
| Tự động chạy lại video | popup switch | on |
| Tự qua trang text | popup switch | off |
| Tốc độ mặc định | popup dropdown | 1× |

Reloading the extension at `chrome://extensions` gives the popup and the
background worker new code, but a tab that is already open keeps the content
script it was handed — which then ignores any message added since, silently.

`onInstalled` does not cover this: it never fires for a plain restart. So the
worker asks instead. The content script reports a `CONTRACT` number in its state,
and any tab answering with a different one is running older code and gets
reloaded. A tab that does not answer at all is left alone — that has other
causes, and reloading on silence could loop. Each tab is reloaded at most once
in five minutes, so a mismatch that a reload cannot fix costs one reload rather
than an endless cycle.

**When the message protocol changes, bump `CONTRACT` in both
`src/content/index.js` and `src/background/worker.js`.**

The popup also treats an unanswered command as a stale page: it reverts the
control and says to reload.

**Bật hết / Tắt hết** flips both switches at once. The button offers whichever
state is not the current one.

**Default speed** is a *floor*, not an exact target. Every new lesson is pinned
to at least this speed, and so is every resume; a faster speed set on the page is
left alone. A speed picked in the dropdown is applied exactly, even downwards.

Changing the speed with LinkedIn's own control also updates the saved default —
the two controls edit one value. A speed set on the page that is not in the
dropdown is added to it rather than snapping to 1×.

The one exception is the first four seconds after a lesson loads. A player sets
its own speed as it starts up, and that arrives as an event indistinguishable
from a deliberate choice — learning it is how LinkedIn's reset to 1× would
silently become the saved default. During that window the stored speed is
reasserted instead of overwritten, so a speed you pick in the first few seconds
of a lesson will not stick. Pick it a moment later, or use the popup.

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

## Building a release

    npm run build

Packs `manifest.json` and `src/` into `dist/linkedin-learning-auto-resume-<version>.zip`.
Tests, docs, and images are left out. Bump `version` in both `manifest.json` and
`package.json` first.

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

**Quickest check:** paste the whole of `tools/diagnose.js` into the DevTools
console on a real lesson. It reports which selector matched what, lists every
visible button label so a failed match can be corrected in one go, and copies
the result to the clipboard. It re-applies the selectors from the page rather
than reading the extension, because content scripts run in an isolated world the
page console cannot see. `test/diagnose.test.js` fails if its copy of the
selectors drifts from `player.js`.

**For a running commentary instead**, set this in the page console:

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
| `src/popup/` | Status line, two switches, the speed dropdown, the counters. |
| `tools/diagnose.js` | Pasted into the page console to report what the selectors match. |
| `scripts/build.sh` | Packs the loadable files into a zip. |

The split exists so that the fragile part (selectors) is isolated from the part
worth testing (logic), and so a LinkedIn redesign only requires editing
`player.js`.

## Limits

- Chrome and Edge only (Manifest V3).
- Does not answer chapter quizzes.
- The resume count is per-tab and resets on reload. The auto-next count does
  not — it is a running total kept in `chrome.storage.local`.
- Auto-next fires within one watchdog tick, so "immediately" means up to 2s.
