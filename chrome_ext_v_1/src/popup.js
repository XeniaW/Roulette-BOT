/* popup.js */
const TIME_FMT = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};
const LOCALE = navigator.language || 'en-US';

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

// Auto-betting
const autoBetToggle = document.getElementById('autoBetToggle');
const betStatus = document.getElementById('betStatus');

// ---- BET LOGS DOM ----
const betTbody = document.getElementById('betTbody');
const betCountEl = document.getElementById('betCount');
const btnBetExport = document.getElementById('btnBetExport');
const btnBetClear = document.getElementById('btnBetClear');

// ----------------
function fmtTime(msOrIso) {
  const tms =
    typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso);
  return new Date(tms).toLocaleString(LOCALE, TIME_FMT);
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
  const {
    trackerStatus = { state: 'off', message: 'Трекинг выключен' },
  } = await chrome.storage.local.get({
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
      try {
        await chrome.runtime.sendMessage({ type: 'REREGISTER_CS' });
      } catch {}
      loadDomains();
    });
    li.append(span, rm);
    domList.appendChild(li);
  });
}
function normalizeOriginPattern(s) {
  if (!s) return '';
  let pattern = s.trim();
  if (!pattern) return '';
  try {
    const u = new URL(pattern);
    pattern = `${u.origin}/*`;
  } catch {
    if (!pattern.endsWith('/*'))
      pattern += pattern.endsWith('/') ? '*' : '/*';
  }
  return pattern;
}
async function addPattern(input) {
  const pattern = normalizeOriginPattern(input);
  if (!pattern) return;
  const granted = await chrome.permissions.request({
    origins: [pattern],
  });
  if (!granted) {
    alert('Permission denied: ' + pattern);
    return;
  }
  const { domains = [] } = await chrome.storage.local.get({
    domains: [],
  });
  if (!domains.includes(pattern)) {
    domains.push(pattern);
    await chrome.storage.local.set({ domains });
  }
  try {
    await chrome.runtime.sendMessage({ type: 'REREGISTER_CS' });
  } catch {}
  loadDomains();
}

// ---- SPIN LOGS ----
function renderRow(e) {
  const tr = document.createElement('tr');
  const tdT = document.createElement('td');
  const tdN = document.createElement('td');
  tdT.textContent = fmtTime(e.t ?? e.t_iso);
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
    const header = 'time_iso,time_local,number,href\n';
    const rows = logs
      .map((e) => {
        const tIso = e.t_iso || new Date(e.t).toISOString();
        const tLocal = fmtTime(e.t ?? e.t_iso).replace(/,/g, '');
        return `${tIso},${tLocal},${e.n},${e.href || ''}`;
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

// ---- BET LOGS ----
function renderBetRow(e) {
  const tr = document.createElement('tr');

  const tdT = document.createElement('td');
  tdT.textContent = fmtTime(e.t);

  const tdA = document.createElement('td');
  tdA.textContent =
    e.amount != null ? Number(e.amount).toFixed(2) : '';

  const tdE = document.createElement('td');
  const phase = e.phase ? String(e.phase).toUpperCase() : '';
  const msg =
    e.message ||
    (e.type === 'placed'
      ? e.step
        ? `Шаг ${e.step} поставлен`
        : 'Ставка поставлена'
      : '');
  tdE.textContent = phase ? `[${phase}] ${msg || ''}` : msg || '';

  tdA.className = 'num';
  tr.append(tdT, tdA, tdE);
  return tr;
}
function renderBetAll(logs) {
  if (!betTbody) return;
  betTbody.innerHTML = '';
  logs.forEach((e) => betTbody.appendChild(renderBetRow(e)));
  if (betCountEl) betCountEl.textContent = String(logs.length);
  const list = document.getElementById('betList');
  if (list) list.scrollTop = list.scrollHeight;
}
function appendBetNew(added) {
  if (!betTbody) return;
  added.forEach((e) => betTbody.appendChild(renderBetRow(e)));
  if (betCountEl)
    betCountEl.textContent = String(
      Number(betCountEl.textContent || '0') + added.length
    );
  const list = document.getElementById('betList');
  if (list) list.scrollTop = list.scrollHeight;
}
function loadBetLogs(cb) {
  chrome.storage.local.get({ betLogs: [] }, (data) =>
    cb(Array.isArray(data.betLogs) ? data.betLogs : [])
  );
}
function exportBetCSV() {
  loadBetLogs((logs) => {
    const header =
      'time_iso,time_local,amount,event,phase,type,step\n';
    const rows = logs
      .map((e) => {
        const tIso = new Date(e.t).toISOString();
        const tLocal = fmtTime(e.t).replace(/,/g, '');
        const amt =
          e.amount != null ? Number(e.amount).toFixed(2) : '';
        const phase = e.phase || '';
        const type = e.type || '';
        const step = e.step != null ? e.step : '';
        const eventText = e.message
          ? e.message
          : type === 'placed'
          ? step
            ? `Шаг ${step} поставлен`
            : 'Ставка поставлена'
          : '';
        return `${tIso},${tLocal},${amt},${eventText.replace(
          /,/g,
          ' '
        )},${phase},${type},${step}`;
      })
      .join('\n');
    const blob = new Blob([header, rows, '\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
      { url, filename: 'bet_logs.csv', saveAs: true },
      () => URL.revokeObjectURL(url)
    );
  });
}
function clearBetLogs() {
  chrome.storage.local.set({ betLogs: [] }, () => renderBetAll([]));
}

// ---- Toggles ----
async function loadToggle() {
  const { trackingEnabled = false } = await chrome.storage.local.get({
    trackingEnabled: false,
  });
  tgl.checked = !!trackingEnabled;
}
function setToggle(val) {
  chrome.storage.local.set({ trackingEnabled: !!val });
}

async function loadAutoBet() {
  const {
    autoBettingEnabled = false,
    bettingStatus = { state: 'off', message: '' },
  } = await chrome.storage.local.get({
    autoBettingEnabled: false,
    bettingStatus: { state: 'off', message: '' },
  });
  autoBetToggle.checked = !!autoBettingEnabled;
  betStatus.textContent = `[${(
    bettingStatus.state || 'off'
  ).toUpperCase()}] ${bettingStatus.message || ''}`;
}
function setAutoBet(val) {
  chrome.storage.local.set({ autoBettingEnabled: !!val });
}

// ---- INIT & EVENTS ----
document.addEventListener('DOMContentLoaded', () => {
  loadToggle();
  loadStatus();
  loadDomains();
  loadLogs(renderAll);
  loadBetLogs(renderBetAll);
  loadAutoBet();

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
      addPattern(`${u.origin}/*`);
    } catch {}
  });

  btnExport.addEventListener('click', exportCSV);
  btnClear.addEventListener('click', clearLogs);

  if (btnBetExport)
    btnBetExport.addEventListener('click', exportBetCSV);
  if (btnBetClear)
    btnBetClear.addEventListener('click', clearBetLogs);

  tgl.addEventListener('change', () => setToggle(tgl.checked));
  autoBetToggle.addEventListener('change', () =>
    setAutoBet(autoBetToggle.checked)
  );
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
  if (ch.betLogs) {
    const { oldValue = [], newValue = [] } = ch.betLogs;
    if (Array.isArray(newValue) && newValue.length > oldValue.length)
      appendBetNew(newValue.slice(oldValue.length));
    else renderBetAll(Array.isArray(newValue) ? newValue : []);
  }
  if (ch.domains) loadDomains();
  if (ch.autoBettingEnabled || ch.bettingStatus) loadAutoBet();
});
