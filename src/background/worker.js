// Two jobs: render the badge from state the content script reports, and tell the
// content script when the machine is locked. The lock half lives here because
// chrome.idle is not exposed to content scripts.

// 15s is the minimum Chrome accepts. It only affects how long "no input" takes to
// count as idle; the lock transition we care about is reported immediately.
const IDLE_DETECTION_SECONDS = 15;
const LEARNING_URL = 'https://www.linkedin.com/learning/*';

chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);

// Reloading the extension swaps this worker and the popup for new code, but a
// tab that is already open keeps running the content script it was given —
// which then silently ignores any message type added since.
//
// onInstalled is not enough: it does not fire when the extension is merely
// restarted, which is the common case while developing. So ask instead. A tab
// that answers with a different CONTRACT is running older code and gets
// reloaded; one that does not answer at all is left alone, because that has
// other causes and reloading on silence could loop.
//
// Keep this in step with CONTRACT in src/content/index.js.
const CONTRACT = 2;

// A reload is only supposed to be needed once per tab. If the contract still
// does not match afterwards then the assumption behind this whole mechanism is
// wrong, and retrying would hammer a page the user is watching. This worker is
// ephemeral, so the record has to outlive it.
const RELOAD_COOLDOWN_MS = 300000;
const RELOADED_KEY = 'reloadedTabs';

async function reloadStaleTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: LEARNING_URL });
  } catch (error) {
    return;
  }

  const stored = await chrome.storage.session.get({ [RELOADED_KEY]: {} }).catch(() => null);
  if (!stored) return;
  const seen = stored[RELOADED_KEY] || {};
  const cutoff = Date.now() - RELOAD_COOLDOWN_MS;
  let changed = false;

  for (const tab of tabs) {
    if (typeof tab.id !== 'number' || tab.status !== 'complete') continue;
    if (seen[tab.id] > cutoff) continue;

    let reply = null;
    try {
      reply = await chrome.tabs.sendMessage(tab.id, { type: 'll-autoresume:get-state' });
    } catch (error) {
      continue;
    }
    if (!reply || reply.contract === CONTRACT) continue;

    seen[tab.id] = Date.now();
    changed = true;
    chrome.tabs.reload(tab.id).catch(() => {});
  }

  for (const id of Object.keys(seen)) {
    if (seen[id] <= cutoff) {
      delete seen[id];
      changed = true;
    }
  }
  if (changed) chrome.storage.session.set({ [RELOADED_KEY]: seen }).catch(() => {});
}

reloadStaleTabs();

// Only 'locked' matters. 'idle' merely means nobody has touched the keyboard for
// a while, which is the normal state of someone watching a lesson — treating it
// as a reason to stand down would defeat the whole extension.
chrome.idle.onStateChanged.addListener((state) => {
  broadcastLock(state === 'locked');
});

async function broadcastLock(locked) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: LEARNING_URL });
  } catch (error) {
    return;
  }
  for (const tab of tabs) {
    if (typeof tab.id !== 'number') continue;
    // No frameId, so this reaches every frame the content script runs in.
    chrome.tabs.sendMessage(tab.id, { type: 'll-autoresume:lock-state', locked }).catch(() => {});
  }
}

// A content script that starts up while the screen is already locked would never
// see an onStateChanged event, so it asks once on load.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'll-autoresume:query-lock') return undefined;
  chrome.idle
    .queryState(IDLE_DETECTION_SECONDS)
    .then((state) => sendResponse({ locked: state === 'locked' }))
    .catch(() => sendResponse({ locked: false }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== 'll-autoresume:state') return undefined;
  const tabId = sender.tab && sender.tab.id;
  if (typeof tabId !== 'number') return undefined;

  let text = '';
  let colour = '#0a66c2';

  if (message.blocked) {
    text = '!';
    colour = '#8c2020';
  } else if (message.enabled) {
    text = message.resumeCount > 0 ? String(message.resumeCount) : 'on';
  }

  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: colour }).catch(() => {});
  return undefined;
});
