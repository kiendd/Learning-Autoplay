// The content script reports state; this worker only renders the badge.
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
