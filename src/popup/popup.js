const toggle = document.getElementById('toggle');
const toggleLabel = document.getElementById('toggle-label');
const autoNext = document.getElementById('auto-next');
const all = document.getElementById('all');
const count = document.getElementById('count');
const nextCount = document.getElementById('next-count');
const note = document.getElementById('note');

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

// One button covers both directions: it offers whichever state is not current.
function renderAllButton() {
  all.textContent = toggle.checked && autoNext.checked ? 'Tắt hết' : 'Bật hết';
}

function render(state) {
  toggle.checked = Boolean(state.enabled);
  toggleLabel.textContent = state.enabled ? 'Đang bật' : 'Đang tắt';
  autoNext.checked = Boolean(state.autoNextText);
  count.textContent = String(state.resumeCount || 0);
  nextCount.textContent = String(state.autoNextCount || 0);
  renderAllButton();

  if (state.blocked) {
    note.textContent = 'Chrome đang chặn tự phát — bấm vào trang một lần.';
  } else if (state.autoNextStopped) {
    note.textContent = 'Tự qua trang đã dừng vì chuyển quá nhanh. Tắt/bật lại để tiếp tục.';
  } else {
    note.textContent = '';
  }
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
    autoNext.disabled = true;
    all.disabled = true;
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
    renderAllButton();
  } catch (error) {
    note.textContent = 'Hãy mở một bài học LinkedIn Learning.';
  }
});

autoNext.addEventListener('change', async () => {
  const tabId = await activeTabId();
  if (tabId === null) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'll-autoresume:set-auto-next',
      autoNextText: autoNext.checked,
    });
    renderAllButton();
    note.textContent = '';
  } catch (error) {
    note.textContent = 'Hãy mở một bài học LinkedIn Learning.';
  }
});

all.addEventListener('click', async () => {
  const tabId = await activeTabId();
  if (tabId === null) return;
  const turnOn = !(toggle.checked && autoNext.checked);
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'll-autoresume:set-all', on: turnOn });
    await load();
  } catch (error) {
    note.textContent = 'Hãy mở một bài học LinkedIn Learning.';
  }
});

load();
