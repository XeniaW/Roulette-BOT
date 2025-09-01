const TIME_FMT = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

const tgl = document.getElementById('toggleTrack');
const statusEl = document.getElementById('status');
const statusMsg = document.getElementById('statusMsg');

const domList = document.getElementById('domList');
const inpPattern = document.getElementById('inpPattern');
const btnAddPattern = document.getElementById('btnAddPattern');
const btnAddCurrent = document.getElementById('btnAddCurrent');

const tbody = document.getElementById('tbody');
const countEl = document.getElementById('count');
const btnExport = document.getElementById('btnExport');
const btnClear = document.getElementById('btnClear');

function fmtLocal(msOrIso) {
  const tms =
    typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso);
  return new Date(tms).toLocaleString(undefined, TIME_FMT);
}

// ---- STATUS ----
function renderStatus(s) {
  const state = s?.state || 'off';
  const msg =
    s?.message ||
    (state === 'off'
      ? 'Трекинг выключен'
      : state === 'waiting'
      ? 'Ожидаем контейнер...'
      : state === 'ok'
      ? 'Трекинг активен'
      : state === 'error'
      ? 'Ошибка селекторов'
      : '');
  statusEl.className = state;
  statusEl.textContent = state.toUpperCase();
  statusMsg.textContent = msg;
}

async function loadStatus() {
  const { trackerStatus = { state: 'off', message: '' } } =
    await chrome.storage.local.get({
      trackerStatus: { state: 'off', message: '' },
    });
  renderStatus(trackerStatus);
}

// ---- DOMAINS ----
async function loadDomains() {
  const { domains = [] } = await chrome.storage.local.get({
    domains: [],
  });
  domList.innerHTML = '';
  domains.forEach((p) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = p;
    const rm = document.createElement('button');
    rm.textContent = 'Remove';
    rm.addEventListener('click', async () => {
      const { domains: cur = [] } = await chrome.storage.local.get({
        domains: [],
      });
      const next = cur.filter((x) => x !== p);
      await chrome.storage.local.set({ domains: next });
      try {
        await chrome.permissions.remove({ origins: [p] });
      } catch {}
      await chrome.runtime.sendMessage({ type: 'REREGISTER_CS' });
      loadDomains();
    });
    li.append(span, rm);
    domList.appendChild(li);
  });
}

async function ensureDomainStored(pattern) {
  const { domains = [] } = await chrome.storage.local.get({
    domains: [],
  });
  if (!domains.includes(pattern)) {
    domains.push(pattern);
    await chrome.storage.local.set({ domains });
  }
}

async function addPattern(pattern) {
  pattern = (pattern || '').trim();
  if (!pattern) return;
  // request permission first
  const granted = await chrome.permissions.request({
    origins: [pattern],
  });
  if (!granted) {
    alert('Permission denied: ' + pattern);
    return;
  }
  // ensure visible immediately
  await ensureDomainStored(pattern);
  await chrome.runtime.sendMessage({ type: 'REREGISTER_CS' });
  loadDomains();
}

// ---- LOGS ----
function renderRow(e) {
  const tr = document.createElement('tr');
  const tdT = document.createElement('td');
  const tdN = document.createElement('td');
  tdT.textContent = fmtLocal(e.t ?? e.t_iso);
  tdN.textContent = String(e.n);
  tdN.className = 'num';
  tr.append(tdT, tdN);
  return tr;
}
function renderAll(logs) {
  tbody.innerHTML = '';
  logs.forEach((e) => tbody.appendChild(renderRow(e)));
  countEl.textContent = String(logs.length);
  const list = document.getElementById('list');
  list.scrollTop = list.scrollHeight;
}
function appendNew(added) {
  added.forEach((e) => tbody.appendChild(renderRow(e)));
  countEl.textContent = String(
    Number(countEl.textContent) + added.length
  );
  const list = document.getElementById('list');
  list.scrollTop = list.scrollHeight;
}
function loadLogs(cb) {
  chrome.storage.local.get({ spinLogs: [] }, (data) =>
    cb(Array.isArray(data.spinLogs) ? data.spinLogs : [])
  );
}
function exportCSV() {
  loadLogs((logs) => {
    const header = 'time_iso,time_local,number\n';
    const rows = logs
      .map((e) => {
        const tIso = e.t_iso || new Date(e.t).toISOString();
        const tLocal = fmtLocal(e.t ?? e.t_iso).replace(/,/g, '');
        return `${tIso},${tLocal},${e.n}`;
      })
      .join('\n');
    const blob = new Blob([header, rows, '\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
      { url, filename: 'spins.csv', saveAs: true },
      () => URL.revokeObjectURL(url)
    );
  });
}
function clearLogs() {
  chrome.storage.local.set({ spinLogs: [] }, () => renderAll([]));
}

// ---- TOGGLE ----
async function loadToggle() {
  const { trackingEnabled = false } = await chrome.storage.local.get({
    trackingEnabled: false,
  });
  tgl.checked = !!trackingEnabled;
}
function setToggle(val) {
  chrome.storage.local.set({ trackingEnabled: !!val });
}

// ---- INIT & EVENTS ----
document.addEventListener('DOMContentLoaded', async () => {
  // bootstrap default domain in visible list on first run
  await ensureDomainStored('https://play.livetables.io/*');

  loadToggle();
  loadStatus();
  loadDomains();
  loadLogs(renderAll);

  btnAddPattern.addEventListener('click', () =>
    addPattern(inpPattern.value)
  );
  btnAddCurrent.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) return;
    try {
      const u = new URL(tab.url);
      const pattern = `${u.origin}/*`;
      addPattern(pattern);
    } catch {}
  });

  btnExport.addEventListener('click', exportCSV);
  btnClear.addEventListener('click', clearLogs);
  tgl.addEventListener('change', () => setToggle(tgl.checked));
});

// Live updates
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.trackingEnabled) tgl.checked = !!ch.trackingEnabled.newValue;
  if (ch.trackerStatus) renderStatus(ch.trackerStatus.newValue);
  if (ch.spinLogs) {
    const { oldValue = [], newValue = [] } = ch.spinLogs;
    if (newValue.length > oldValue.length)
      appendNew(newValue.slice(oldValue.length));
    else renderAll(newValue);
  }
});
