# LinkedIn Learning Auto-Resume — Design

**Date:** 2026-08-05
**Status:** Approved

## Problem

LinkedIn Learning stops video playback when it detects no user interaction, even
though the learner is still listening. Recovering requires noticing the silence
and clicking play, which breaks concentration.

## Goal

A Chrome extension that detects the stop and resumes playback automatically, with
a toggle for when the user genuinely wants to pause.

## Scope

In scope:

- Resume playback when the video pauses.
- Dismiss blocking dialogs that overlay the player ("still watching?").
- Advance to the next lesson when a video ends.
- Preserve playback rate across resumes and lesson changes.
- Popup with an ON/OFF switch and a resume counter.
- Badge on the extension icon reflecting state.
- Brief on-video toast when a resume happens.

Out of scope:

- Answering chapter quizzes.
- Any browser other than Chrome/Edge (Manifest V3).
- A keyboard shortcut for the toggle.

## Pause Semantics

The extension resumes **every** pause while it is ON. It does not try to infer
whether the user or LinkedIn triggered the pause. To pause for real, the user
turns the extension OFF via the popup. State persists in `chrome.storage.sync`.

Rationale: heuristics that guess intent from recent input events are ambiguous —
a click on the page for an unrelated reason looks identical to a click on the
pause button. An explicit switch is predictable.

## Detection Approach

Event-driven with a watchdog:

- Listen for `pause` on the `<video>` element — near-zero latency.
- A 2-second interval re-checks state and re-attaches listeners if the video
  element identity changed (LinkedIn is an SPA and replaces the element on
  lesson change).

Rejected alternatives:

- **Polling only** — up to 1s latency, burns cycles while playback is healthy.
- **Overriding `HTMLMediaElement.prototype.pause`** — would prevent LinkedIn from
  pausing at all, but also disables the user's own pause button and breaks when
  LinkedIn changes players.

## Architecture

```
manifest.json
src/shared/settings.js            chrome.storage read/write, defaults
src/content/player.js             DOM adapter: <video>, Next button, modals
src/content/resumer.js            decision state machine — no DOM knowledge
src/content/toast.js              on-video notification
src/content/index.js              bootstrap: wire player + resumer
src/background/worker.js          badge, state sync
src/popup/popup.{html,js,css}     ON/OFF switch, resume count
test/resumer.test.js              unit tests against a fake player
```

`resumer.js` holds all decision logic and communicates only through a narrow
player interface:

```
isPaused()          -> boolean
isEnded()           -> boolean
play()              -> Promise<void>   rejects if blocked
clickPlayButton()   -> boolean         DOM fallback
goNext()            -> boolean
findBlockingModal() -> { dismiss(): boolean } | null
getRate()           -> number
setRate(rate)       -> void
```

This keeps `resumer.js` testable under Node with no browser. Everything fragile —
LinkedIn's CSS selectors — is confined to `player.js`, so UI changes on
LinkedIn's side require editing one file.

`manifest.json` matches `https://www.linkedin.com/learning/*` only, with
`all_frames: true` in case the player is framed.

## Behavior

### Resume

On `pause`, if enabled and not ended, call `play()`. On success: increment the
counter, show a ~2s toast, update the badge.

### Play rejection

Chrome's autoplay policy can reject a scripted `play()` when the page lacks user
activation. LinkedIn Learning normally has enough media engagement for this to
succeed, but the failure path is handled explicitly:

1. Retry with backoff: 250ms, 1s, 3s.
2. Fall back to `clickPlayButton()` on the real DOM control.
3. If still failing, toast "cần bấm vào trang một lần" and set the badge to `!`.

No silent failures.

### Circuit breaker

If more than 5 resumes occur within 10 seconds, LinkedIn is likely re-pausing
deliberately. Stop for 60 seconds and toast that the extension is pausing itself.
The ON/OFF switch stays responsive during the cooldown.

### Lesson end

On `ended`, do not resume. If next-lesson advance is enabled, call `goNext()`.

### Blocking modal

While the video is paused, look for a visible dialog overlaying the player and
click the button whose text matches
`/tiếp tục|continue|resume|still watching|keep watching/i`. Text matching is used
instead of class names because LinkedIn's class names change frequently.

### Playback rate

Remember the observed rate in storage. After a resume or lesson change, if the
rate has reset, restore the remembered value. No UI.

## Error Handling

| Condition | Response |
|---|---|
| `play()` rejects | Backoff retry ×3, then DOM click, then toast + `!` badge |
| Rapid re-pause loop | 60s cooldown after 5 resumes / 10s |
| Selectors not found | Log once at debug level, keep running; core resume is unaffected |
| Video element replaced | Watchdog re-attaches within 2s |

## Testing

Unit tests via `node:test` with a fake player, covering:

- Resumes on pause when enabled.
- Does not resume when disabled.
- Does not resume when ended.
- Circuit breaker trips at 5 resumes in 10s and recovers after 60s.
- Retries with backoff when `play()` rejects, then falls back to DOM click.
- Restores playback rate after a resume.
- Dismisses a blocking modal when one is present.

Time is injected as a dependency so the breaker and backoff can be tested without
real delays.

Manual verification: load unpacked in Chrome, open a LinkedIn Learning lesson,
pause the video and confirm it resumes with a toast.

## Known Unknown

The selectors for LinkedIn's Next button and "still watching" dialog cannot be
verified without an authenticated session. They are declared as a config list at
the top of `player.js`, alongside a debug mode that logs what the adapter finds.
After the first real run, the logs will be used to correct them. The core resume
path depends only on `document.querySelector('video')` and works without any
LinkedIn-specific selector.
