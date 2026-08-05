# Attention Gate — Design

**Date:** 2026-08-05
**Status:** Implemented
**Extends:** `2026-08-05-linkedin-autoresume-design.md`

## Problem

The original design resumes every pause unconditionally while the switch is ON.
That is wrong whenever nobody can see the lesson: the screen is locked, the
machine slept, or another tab or window sits in front. Playback advances, audio
plays to an empty room, and the course walks itself forward overnight.

The case that must keep working is narrower than "the user is here": the browser
window has **lost focus** while the LinkedIn tab is still the visible one. That
is somebody listening while they work in another app, and it is the reason the
extension exists.

## Rule

Intervene only when all three hold:

1. `document.visibilityState === 'visible'`
2. The machine is not locked.
3. The grace window has expired.

`document.hasFocus()` is deliberately **not** an input. Adding it would close the
gate on exactly the case above.

`visibilityState` alone covers three situations: a background tab, a minimised
window, and a window fully covered by another application (Chrome's occlusion
detection). It usually also covers a locked screen, but not dependably — which is
why condition 2 exists as a separate signal rather than being folded into it.

## Grace window

Five seconds, opened on either trigger:

- **The gate goes from closed to open** — the tab was reselected, or the machine
  was unlocked.
- **The watchdog sees a timer gap over 30s** while its interval is 2s — timers
  stop while a machine sleeps, so an outsized gap means we just woke up.

The purpose is to let the page settle: after a wake the network is reconnecting
and LinkedIn may be re-authenticating, and a resume fired into that lands badly.

No dedicated "catch-up" code path is needed. The existing 2s watchdog already
calls the pause handler whenever it finds a paused video, so a lesson paused
while the gate was shut resumes within 2s of the grace expiring.

## Idle is not locked

`chrome.idle` reports `active`, `idle`, or `locked`. Only `locked` closes the
gate. `idle` means no keyboard or mouse input for the detection interval, which
is precisely what a person watching a lesson looks like; treating it as a reason
to stand down would defeat the extension.

## Structure

New file `src/content/gate.js`, a pure state machine in the style of
`resumer.js` — `now` and `isVisible` are injected, so it is testable under Node
with no browser.

```
createGate({ now, isVisible, log })
  evaluate()      recompute; open a grace window on a closed -> open edge
  noteTick()      watchdog hook; detect a sleep gap, then evaluate()
  setLocked(bool) the worker reports a lock change
  isOpen()        pure read: rawOpen && now() >= graceUntil
  getState()      for debug logging
```

`evaluate()` owns every side effect and `isOpen()` is a pure read, so the pause
handler — which fires from a `<video>` event, unsynchronised with the watchdog —
can consult the gate without mutating it.

`resumer.js` gains one injected dependency, `canIntervene: () => true`, and
checks it in `onPause`, `onEnded`, and `checkModal`. `onRateChange` is not
gated: it only records the current speed, it does not act on the page.
`getState()` exposes `suppressed` for debugging.

## Lock plumbing

`chrome.idle` is unavailable to content scripts, so the service worker owns it:

- `chrome.idle.setDetectionInterval(15)` and an `onStateChanged` listener, both
  registered at top level so the ephemeral MV3 worker is woken by the event.
- On a change, `chrome.tabs.query({url: 'https://www.linkedin.com/learning/*'})`
  and `chrome.tabs.sendMessage` to each tab. Sending without a `frameId` reaches
  every frame, which matters because the content script runs in all frames. The
  URL filter is permitted by the existing host permission; no `tabs` permission
  is required.
- The content script also sends `ll-autoresume:query-lock` on load, because a tab
  opened while the screen is already locked has no event to wait for.

`manifest.json` adds the `idle` permission and lists `gate.js` before
`resumer.js`.

## Testing

`test/gate.test.js` covers: open on a fresh visible tab with no spurious grace;
closed while hidden; closed while locked; open while unfocused; grace after the
tab returns; grace after unlock; a sleep-sized timer gap opening a grace window;
normal ticks not doing so; the first tick not being mistaken for a wake; and
repeated evaluations not extending an active grace.

`test/resumer.test.js` adds four cases: no resume, no lesson advance, and no
modal dismissal while the gate is closed, and a resume once it reopens.

`test/load-resumer.js` is generalised to `test/load-content-script.js`, which
takes a filename, so both classic scripts share one vm sandbox helper.

## Manual verification

The parts that cannot be unit-tested are the browser signals themselves. With
`localStorage.llAutoResumeDebug = '1'`, the console logs each gate transition:

- Switch to another tab, pause the video via the console, switch back — expect a
  hold-off log and a resume about 5s later.
- Lock the screen with a lesson playing — expect `the machine is now locked` and
  silence.
- Move the LinkedIn window behind another app without switching tabs — behaviour
  depends on whether Chrome reports the window as occluded.
