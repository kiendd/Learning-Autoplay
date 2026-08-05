const toggle = document.getElementById('toggle');
const toggleLabel = document.getElementById('toggle-label');
const count = document.getElementById('count');
const note = document.getElementById('note');

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

function render(state) {
  toggle.checked = Boolean(state.enabled);
  toggleLabel.textContent = state.enabled ? 'Đang bật' : 'Đang tắt';
  count.textContent = String(state.resumeCount || 0);
  note.textContent = state.blocked ? 'Chrome đang chặn tự phát — bấm vào trang một lần.' : '';
}

async function load() {
  const tabId = await activeTabId();
  if (tabId === null) {
    note.textContent = 'Không tìm thấy tab.';
    toggle.disabled = true;
    return;
  }
  try {
    const state = await chrome.tabs.sendMessage(tabId, { type: 'll-autoresume:get-state' });
    render(state || {});
  } catch (error) {
    toggle.disabled = true;
    note.textContent = 'Hãy mở một bài học LinkedIn Learning.';
  }
}

toggle.addEventListener('change', async () => {
  const tabId = await activeTabId();
  if (tabId === null) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'll-autoresume:set-enabled',
      enabled: toggle.checked,
    });
    toggleLabel.textContent = toggle.checked ? 'Đang bật' : 'Đang tắt';
  } catch (error) {
    note.textContent = 'Hãy mở một bài học LinkedIn Learning.';
  }
});

load();
