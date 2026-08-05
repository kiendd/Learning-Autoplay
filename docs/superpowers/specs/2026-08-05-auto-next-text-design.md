# Auto-Next on Text Lessons — Design

**Date:** 2026-08-05
**Status:** Implemented
**Extends:** `2026-08-05-linkedin-autoresume-design.md`

## Problem

Not every lesson is a video. Text and document lessons — including the role-play
pages a learner may want to skip — have no `<video>`, so they never fire `ended`
and none of the existing behaviours apply. The lesson sits there until somebody
clicks the **Next** button at the foot of the page.

## Rule

A second switch, `autoNextText`, **off by default**. While it is on, the watchdog
clicks Next as soon as it finds one, subject to every existing guard: the main
ON/OFF switch, and the attention gate (so a locked screen does not walk the
course overnight).

Immediate rather than delayed, at the user's request. The consequence is
explicit: this skips content nobody has read. That is why it is opt-in and why
it does not ride on the main switch.

Video lessons are excluded outright — `player.hasVideo()` must be false. Those
still advance on `ended`.

## Finding the button

Matched by label, not by selector. The markup is:

```html
<button id="ember268" class="ember-view _button_ps32ck _medium_ps32ck …" type="button">Next</button>
```

The class names are build hashes that change on every LinkedIn deploy, and there
is no `aria-label`. `PAGE_NEXT_PATTERN` is `/^(next|tiếp theo|kế tiếp)\b/i`,
anchored at the start so the **Previous** button beside it can never match. The
button must also be visible and not disabled.

## Runaway guard

Ten advances within sixty seconds stops auto-next until the switch is toggled
off and on.

**The tally cannot live in memory.** Advancing navigates, which destroys the
content script and builds a fresh one with an empty counter — the counter is
wiped by the very action it is counting. The first implementation made exactly
this mistake and walked 490 pages in 12 seconds in a browser test while
reporting `autoNextCount: 0`.

So the tally is injected (`loadAdvanceLog` / `saveAdvanceLog`) and backed by
`chrome.storage.local`, holding `{ log: number[], total: number }`. Two details
matter:

- **The timestamp is written before the click**, because the click may tear the
  page down before a later write could land.
- **Restoring the saved setting on page load must not clear the log.**
  `setAutoNextText(value, { reset })` distinguishes a deliberate flip of the
  switch, which clears the log, from restoring state on load, which must not.
  Without that flag every page load wipes the record and the guard is useless
  again.

`total` is a running lifetime count, surfaced in the popup; it is deliberately
not reset by a page load, unlike the per-tab resume count.

## Testing

`test/auto-next.test.js`, against the fake player and a fake store:

- Off unless switched on; clicks Next on a text lesson; ignores video lessons;
  ignores pages with no Next button; respects the main switch and the gate.
- One advance per page, and only one click when the click does not navigate —
  otherwise the watchdog hammers a dead button every 2s.
- The limit trips, spread-out advances do not trip it, and toggling clears it.
- **The guard survives the reload each advance causes** — a loop that builds a
  fresh resumer per iteration over a shared store. This is the regression test
  for the bug above; it fails if the tally is put back in memory.
- The label pattern matches Next/Tiếp theo and never Previous/Trước/Back.

Browser verification with a fake lesson reproducing the real markup: off by
default stays put, on advances forward and stops at exactly 10, and a video
lesson is untouched.
