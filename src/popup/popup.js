const toggle = document.getElementById('toggle');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const autoNext = document.getElementById('auto-next');
const all = document.getElementById('all');
const rate = document.getElementById('rate');
const count = document.getElementById('count');
const nextCount = document.getElementById('next-count');
const note = document.getElementById('note');

const STALE = 'Trang đang chạy bản cũ của extension — hãy tải lại trang (F5).';

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

// A content script that predates a message type simply ignores it, and
// sendMessage then resolves to undefined instead of throwing. Without this
// check the popup reports success while nothing happened — which is exactly
// what a stale content script looks like after reloading the extension.
async function command(tabId, message) {
  const reply = await chrome.tabs.sendMessage(tabId, message);
  if (!reply || reply.ok !== true) throw new Error('stale');
  return reply;
}

// One button covers both directions: it offers whichever state is not current.
function renderAllButton() {
  all.textContent = toggle.checked && autoNext.checked ? 'Tắt hết' : 'Bật hết';
}

// The switches say what each feature does; this says whether anything is on.
function renderStatus() {
  const on = toggle.checked || autoNext.checked;
  statusText.textContent = on ? 'Đang bật' : 'Đang tắt';
  status.classList.toggle('on', on);
}

function render(state) {
  toggle.checked = Boolean(state.enabled);
  autoNext.checked = Boolean(state.autoNextText);
  renderStatus();
  count.textContent = String(state.resumeCount || 0);
  nextCount.textContent = String(state.autoNextCount || 0);
  // A speed set on the page rather than here may not be one of the listed
  // options, so keep the raw value visible instead of silently snapping to 1×.
  if (typeof state.rate === 'number' && state.rate > 0) {
    if (!Array.from(rate.options).some((option) => Number(option.value) === state.rate)) {
      const extra = new Option(`${String(state.rate).replace('.', ',')}×`, String(state.rate));
      rate.add(extra);
    }
    rate.value = String(state.rate);
  }
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
    rate.disabled = true;
    note.textContent = 'Hãy mở một bài học LinkedIn Learning.';
  }
}

toggle.addEventListener('change', async () => {
  const tabId = await activeTabId();
  if (tabId === null) return;
  try {
    await command(tabId, { type: 'll-autoresume:set-enabled', enabled: toggle.checked });
    renderStatus();
    renderAllButton();
    note.textContent = '';
  } catch (error) {
    toggle.checked = !toggle.checked;
    renderStatus();
    note.textContent = error.message === 'stale' ? STALE : 'Hãy mở một bài học LinkedIn Learning.';
  }
});

autoNext.addEventListener('change', async () => {
  const tabId = await activeTabId();
  if (tabId === null) return;
  try {
    await command(tabId, { type: 'll-autoresume:set-auto-next', autoNextText: autoNext.checked });
    renderStatus();
    renderAllButton();
    note.textContent = '';
  } catch (error) {
    autoNext.checked = !autoNext.checked;
    renderStatus();
    note.textContent = error.message === 'stale' ? STALE : 'Hãy mở một bài học LinkedIn Learning.';
  }
});

rate.addEventListener('change', async () => {
  const tabId = await activeTabId();
  if (tabId === null) return;
  try {
    await command(tabId, { type: 'll-autoresume:set-rate', rate: Number(rate.value) });
    note.textContent = '';
  } catch (error) {
    note.textContent = error.message === 'stale' ? STALE : 'Hãy mở một bài học LinkedIn Learning.';
  }
});

all.addEventListener('click', async () => {
  const tabId = await activeTabId();
  if (tabId === null) return;
  const turnOn = !(toggle.checked && autoNext.checked);
  try {
    await command(tabId, { type: 'll-autoresume:set-all', on: turnOn });
    await load();
  } catch (error) {
    note.textContent = error.message === 'stale' ? STALE : 'Hãy mở một bài học LinkedIn Learning.';
  }
});

load();
