// Two jobs: render the badge from state the content script reports, and tell the
// content script when the machine is locked. The lock half lives here because
// chrome.idle is not exposed to content scripts.

// 15s is the minimum Chrome accepts. It only affects how long "no input" takes to
// count as idle; the lock transition we care about is reported immediately.
const IDLE_DETECTION_SECONDS = 15;
const LEARNING_URL = 'https://www.linkedin.com/learning/*';

chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);

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
