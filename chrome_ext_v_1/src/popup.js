/* Popup UI + логика: трекинг/домены/логи + ДЮЖИНЫ/РЯДЫ */
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

// ====== утилиты хранилища ======
async function sget(defs) {
  try {
    return await chrome.storage.local.get(defs || {});
  } catch {
    return defs || {};
  }
}
async function sset(obj) {
  try {
    await chrome.storage.local.set(obj);
  } catch {}
}

// ====== базовые DOM (трекинг/домены/логи) ======
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

const betTbody = document.getElementById('betTbody');
const betCountEl = document.getElementById('betCount');
const btnBetExport = document.getElementById('btnBetExport');
const btnBetClear = document.getElementById('btnBetClear');

function fmtTime(x) {
  const t = typeof x === 'number' ? x : Date.parse(x);
  return new Date(t).toLocaleString(LOCALE, TIME_FMT);
}
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
  } = await sget({ trackerStatus: { state: 'off', message: '' } });
  renderStatus(trackerStatus);
}

async function loadDomains() {
  const { domains = [] } = await sget({ domains: [] });
  domList.innerHTML = '';
  domains.forEach((p) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = p;
    const rm = document.createElement('button');
    rm.textContent = 'Remove';
    rm.addEventListener('click', async () => {
      const { domains: cur = [] } = await sget({ domains: [] });
      const next = cur.filter((x) => x !== p);
      await sset({ domains: next });
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
  const { domains = [] } = await sget({ domains: [] });
  if (!domains.includes(pattern)) {
    domains.push(pattern);
    await sset({ domains });
  }
  try {
    await chrome.runtime.sendMessage({ type: 'REREGISTER_CS' });
  } catch {}
  loadDomains();
}

function renderRow(e) {
  const tr = document.createElement('tr');
  const tdT = document.createElement('td');
  tdT.textContent = fmtTime(e.t ?? e.t_iso);
  const tdN = document.createElement('td');
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
      : e.type === 'config'
      ? 'Конфиг сохранён'
      : '');
  tdE.textContent =
    (e.market ? `[${e.market}] ` : '') +
    (phase ? `[${phase}] ` : '') +
    msg;
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
      'time_iso,time_local,market,amount,event,phase,type,step\n';
    const rows = logs
      .map((e) => {
        const tIso = new Date(e.t).toISOString();
        const tLocal = fmtTime(e.t).replace(/,/g, '');
        const amt =
          e.amount != null ? Number(e.amount).toFixed(2) : '';
        const phase = e.phase || '';
        const type = e.type || '';
        const step = e.step != null ? e.step : '';
        const eventText = (
          e.message
            ? e.message
            : type === 'placed'
            ? step
              ? `Шаг ${step} поставлен`
              : 'Ставка поставлена'
            : type === 'config'
            ? 'Конфиг сохранён'
            : ''
        ).replace(/,/g, ' ');
        return `${tIso},${tLocal},${
          e.market || ''
        },${amt},${eventText},${phase},${type},${step}`;
      })
      .join('\n');
    const blob = new Blob([header, rows, '\n']);
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

async function loadToggle() {
  const { trackingEnabled = false } = await sget({
    trackingEnabled: false,
  });
  tgl.checked = !!trackingEnabled;
}
function setToggle(val) {
  chrome.storage.local.set({ trackingEnabled: !!val });
}

// ====== РЫНКИ (дюжины/ряды) ======
const CFG_DZN_KEY = 'abDozensConfig';
const CFG_ROW_KEY = 'abRowsConfig';

const DEFAULT_MKT_CFG = Object.freeze({
  chipSelectorTemplate: '[data-e2e="chip-{{value}}"]',
  chipValues: [0.2, 1, 5, 20],
  placeButtonSel: null,
  triggerStreak: 2,
  steps: [
    [{ chip: 1, times: 1 }],
    [{ chip: 1, times: 3 }],
    [{ chip: 2, times: 2 }],
    [
      { chip: 3, times: 1 },
      { chip: 2, times: 1 },
    ],
  ],
});

function sanitizeMktCfg(raw) {
  const d = DEFAULT_MKT_CFG;
  const src = raw || {};
  const tpl =
    typeof src.chipSelectorTemplate === 'string' &&
    src.chipSelectorTemplate.includes('{{value}}')
      ? src.chipSelectorTemplate
      : d.chipSelectorTemplate;
  let chipValues = Array.isArray(src.chipValues)
    ? src.chipValues
        .map(Number)
        .filter((v) => Number.isFinite(v) && v > 0)
    : [];
  if (!chipValues.length) chipValues = [...d.chipValues];
  const placeButtonSel =
    typeof src.placeButtonSel === 'string' &&
    src.placeButtonSel.trim()
      ? src.placeButtonSel.trim()
      : null;
  const triggerStreak = Math.max(
    2,
    Math.floor(Number(src.triggerStreak ?? d.triggerStreak))
  );
  let steps = Array.isArray(src.steps) ? src.steps : d.steps;
  steps = steps
    .map((st) => (Array.isArray(st) ? st : []))
    .map((st) =>
      st
        .map((it) => ({
          chip: Math.max(
            1,
            Math.min(
              chipValues.length,
              Math.floor(Number(it?.chip ?? 1))
            )
          ),
          times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
        }))
        .filter(
          (it) =>
            Number.isFinite(it.chip) && Number.isFinite(it.times)
        )
    )
    .filter((st) => st.length);
  if (!steps.length) steps = JSON.parse(JSON.stringify(d.steps));
  return {
    chipSelectorTemplate: tpl,
    chipValues,
    placeButtonSel,
    steps,
    triggerStreak,
  };
}
async function loadMktCfg(key) {
  const { [key]: cfg = DEFAULT_MKT_CFG } = await sget({
    [key]: DEFAULT_MKT_CFG,
  });
  return sanitizeMktCfg(cfg);
}
async function saveMktCfg(key, cfg) {
  const clean = sanitizeMktCfg(cfg);
  await sset({ [key]: clean });
  try {
    const { betLogs = [] } = await sget({ betLogs: [] });
    betLogs.push({
      t: Date.now(),
      type: 'config',
      market: key.includes('Rows') ? 'rows' : 'dozens',
      message: 'Конфиг сохранён',
      chipsCount: clean.chipValues.length,
      stepsCount: clean.steps.length,
      triggerStreak: clean.triggerStreak,
    });
    if (betLogs.length > 2000)
      betLogs.splice(0, betLogs.length - 2000);
    await sset({ betLogs });
  } catch {}
  try {
    await chrome.runtime.sendMessage({ type: 'AB_CONFIG_SAVED' });
  } catch {}
  return clean;
}

// DOM для рынков
const autoBetToggleDozens = document.getElementById(
  'autoBetToggleDozens'
);
const autoBetToggleRows = document.getElementById(
  'autoBetToggleRows'
);
const betStatusDozens = document.getElementById('betStatusDozens');
const betStatusRows = document.getElementById('betStatusRows');
const dozensStreakInp = document.getElementById('dozensStreak');
const rowsStreakInp = document.getElementById('rowsStreak');

// Dozens config widgets
const cfgDznMsg = document.getElementById('cfgDznMsg');
const cfgDznChipTpl = document.getElementById('cfgDznChipTpl');
const cfgDznPlaceBtn = document.getElementById('cfgDznPlaceBtn');
const dznChipsBox = document.getElementById('dznChipsBox');
const dznStepsBox = document.getElementById('dznStepsBox');
document
  .getElementById('btnAddDznChip')
  .addEventListener('click', () =>
    dznChipsBox.appendChild(makeChipRow())
  );
document
  .getElementById('btnAddDznStep')
  .addEventListener('click', () => {
    makeStepCard(dznStepsBox, [{ chip: 1, times: 1 }]);
  });
document
  .getElementById('btnCfgDznDefaults')
  .addEventListener('click', async () => {
    const d = DEFAULT_MKT_CFG;
    cfgDznChipTpl.value = d.chipSelectorTemplate;
    cfgDznPlaceBtn.value = d.placeButtonSel ?? '';
    dozensStreakInp.value = String(d.triggerStreak);
    renderChips(dznChipsBox, d.chipValues);
    renderSteps(dznStepsBox, d.steps);
    cfgDznMsg.textContent = 'Defaults loaded (not saved).';
  });
document
  .getElementById('btnCfgDznSave')
  .addEventListener('click', () => saveMarketCfgFromUI('dozens'));

// Rows config widgets
const cfgRowMsg = document.getElementById('cfgRowMsg');
const cfgRowChipTpl = document.getElementById('cfgRowChipTpl');
const cfgRowPlaceBtn = document.getElementById('cfgRowPlaceBtn');
const rowChipsBox = document.getElementById('rowChipsBox');
const rowStepsBox = document.getElementById('rowStepsBox');
document
  .getElementById('btnAddRowChip')
  .addEventListener('click', () =>
    rowChipsBox.appendChild(makeChipRow())
  );
document
  .getElementById('btnAddRowStep')
  .addEventListener('click', () => {
    makeStepCard(rowStepsBox, [{ chip: 1, times: 1 }]);
  });
document
  .getElementById('btnCfgRowDefaults')
  .addEventListener('click', async () => {
    const d = DEFAULT_MKT_CFG;
    cfgRowChipTpl.value = d.chipSelectorTemplate;
    cfgRowPlaceBtn.value = d.placeButtonSel ?? '';
    rowsStreakInp.value = String(d.triggerStreak);
    renderChips(rowChipsBox, d.chipValues);
    renderSteps(rowStepsBox, d.steps);
    cfgRowMsg.textContent = 'Defaults loaded (not saved).';
  });
document
  .getElementById('btnCfgRowSave')
  .addEventListener('click', () => saveMarketCfgFromUI('rows'));

// helpers для конфиг-UI
function makeChipRow(value = '') {
  const div = document.createElement('div');
  div.className = 'row chip-row';
  div.innerHTML = `<span class="small">Value</span><input type="number" step="0.0001" class="chip-val" value="${
    value !== '' ? value : ''
  }"><button class="btn btn-danger btn-del-chip">x</button>`;
  div
    .querySelector('.btn-del-chip')
    .addEventListener('click', () => div.remove());
  return div;
}
function renderChips(box, vals) {
  box.innerHTML = '';
  (vals && vals.length ? vals : ['']).forEach((v) =>
    box.appendChild(makeChipRow(v))
  );
}
function getChipsFromUI(box) {
  const vals = [];
  box.querySelectorAll('.chip-val').forEach((inp) => {
    const v = Number(inp.value);
    if (Number.isFinite(v) && v > 0) vals.push(v);
  });
  return vals;
}
function makeStepItemRow(chipIndex1 = 1, times = 1) {
  const row = document.createElement('div');
  row.className = 'row step-item';
  row.innerHTML = `<span class="small">Chip #</span><input type="number" min="1" step="1" class="step-chip-i" value="${chipIndex1}"><span class="small">X</span><input type="number" min="1" step="1" class="step-times" value="${times}"><button class="btn btn-danger btn-del-item">x</button>`;
  row
    .querySelector('.btn-del-item')
    .addEventListener('click', () => row.remove());
  return row;
}
function makeStepCard(container, items) {
  const card = document.createElement('div');
  card.className = 'step-card';
  card.innerHTML = `<div class="row step-head"><strong>Step</strong><div class="row gap-tight"><button class="btn btn-plain btn-add-item">+ Add item</button><button class="btn btn-danger btn-del-step">Remove step</button></div></div><div class="step-items"></div>`;
  const box = card.querySelector('.step-items');
  (items && items.length ? items : [{ chip: 1, times: 1 }]).forEach(
    (it) =>
      box.appendChild(makeStepItemRow(it.chip ?? 1, it.times ?? 1))
  );
  card
    .querySelector('.btn-add-item')
    .addEventListener('click', () =>
      box.appendChild(makeStepItemRow())
    );
  card
    .querySelector('.btn-del-step')
    .addEventListener('click', () => {
      card.remove();
    });
  container.appendChild(card);
}
function renderSteps(box, steps) {
  box.innerHTML = '';
  (Array.isArray(steps) && steps.length
    ? steps
    : [[{ chip: 1, times: 1 }]]
  ).forEach((st) => makeStepCard(box, st));
}
function getStepsFromUI(box) {
  const out = [];
  box.querySelectorAll('.step-card').forEach((card) => {
    const items = [];
    card.querySelectorAll('.step-item').forEach((it) => {
      const iVal = Number(it.querySelector('.step-chip-i').value);
      const tVal = Number(it.querySelector('.step-times').value);
      if (
        Number.isFinite(iVal) &&
        iVal >= 1 &&
        Number.isFinite(tVal) &&
        tVal >= 1
      )
        items.push({
          chip: Math.floor(iVal),
          times: Math.floor(tVal),
        });
    });
    if (items.length) out.push(items);
  });
  return out;
}

async function loadMarketUI(market) {
  const isDozens = market === 'dozens';
  const cfgKey = isDozens ? CFG_DZN_KEY : CFG_ROW_KEY;
  const enKey = isDozens
    ? 'autoBettingDozensEnabled'
    : 'autoBettingRowsEnabled';
  const statusKey = isDozens
    ? 'bettingStatusDozens'
    : 'bettingStatusRows';
  const streakInp = isDozens ? dozensStreakInp : rowsStreakInp;
  const toggle = isDozens ? autoBetToggleDozens : autoBetToggleRows;

  const obj = await sget({
    [enKey]: false,
    [statusKey]: { state: 'off', message: '' },
  });
  toggle.checked = !!obj[enKey];
  const st = obj[statusKey] || { state: 'off', message: '' };
  (isDozens ? betStatusDozens : betStatusRows).textContent = `[${(
    st.state || 'off'
  ).toUpperCase()}] ${st.message || ''}`;

  const cfg = await loadMktCfg(cfgKey);
  streakInp.value = String(cfg.triggerStreak);

  if (isDozens) {
    cfgDznChipTpl.value = cfg.chipSelectorTemplate;
    cfgDznPlaceBtn.value = cfg.placeButtonSel ?? '';
    renderChips(dznChipsBox, cfg.chipValues);
    renderSteps(dznStepsBox, cfg.steps);
    cfgDznMsg.textContent = 'Loaded';
  } else {
    cfgRowChipTpl.value = cfg.chipSelectorTemplate;
    cfgRowPlaceBtn.value = cfg.placeButtonSel ?? '';
    renderChips(rowChipsBox, cfg.chipValues);
    renderSteps(rowStepsBox, cfg.steps);
    cfgRowMsg.textContent = 'Loaded';
  }
}

async function saveMarketCfgFromUI(market) {
  const isDozens = market === 'dozens';
  const cfgKey = isDozens ? CFG_DZN_KEY : CFG_ROW_KEY;

  const tpl = (
    isDozens ? cfgDznChipTpl.value : cfgRowChipTpl.value
  ).trim();
  if (!tpl.includes('{{value}}'))
    return ((isDozens ? cfgDznMsg : cfgRowMsg).textContent =
      'Template must include {{value}}');

  const chipValues = getChipsFromUI(
    isDozens ? dznChipsBox : rowChipsBox
  );
  if (!chipValues.length)
    return ((isDozens ? cfgDznMsg : cfgRowMsg).textContent =
      'Add at least one chip value');

  const steps = getStepsFromUI(isDozens ? dznStepsBox : rowStepsBox);
  if (!steps.length)
    return ((isDozens ? cfgDznMsg : cfgRowMsg).textContent =
      'Add at least one step');

  for (const st of steps)
    for (const it of st)
      if (it.chip < 1 || it.chip > chipValues.length)
        return ((isDozens ? cfgDznMsg : cfgRowMsg).textContent =
          'Step uses invalid Chip #');

  const placeButtonSel =
    (
      (isDozens ? cfgDznPlaceBtn.value : cfgRowPlaceBtn.value) || ''
    ).trim() || null;
  const triggerStreak = Math.max(
    2,
    Math.floor(
      Number(
        (isDozens ? dozensStreakInp.value : rowsStreakInp.value) || 2
      )
    )
  );

  await saveMktCfg(cfgKey, {
    chipSelectorTemplate: tpl,
    chipValues,
    placeButtonSel,
    steps,
    triggerStreak,
  });
  (isDozens ? cfgDznMsg : cfgRowMsg).textContent = 'Saved.';
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  // миграция старого единственного конфига (если был)
  const mig = await sget({ abConfig: null });
  if (mig.abConfig) {
    const cleaned = sanitizeMktCfg(mig.abConfig);
    await sset({ [CFG_DZN_KEY]: cleaned });
    await sset({ abConfig: null });
  }

  loadStatus();
  loadDomains();
  loadLogs(renderAll);
  loadBetLogs(renderBetAll);
  await loadMarketUI('dozens');
  await loadMarketUI('rows');
  await loadToggle();

  btnExport.addEventListener('click', exportCSV);
  btnClear.addEventListener('click', clearLogs);
  if (btnBetExport)
    btnBetExport.addEventListener('click', exportBetCSV);
  if (btnBetClear)
    btnBetClear.addEventListener('click', clearBetLogs);

  document
    .getElementById('btnAddPattern')
    .addEventListener('click', () => addPattern(inpPattern.value));
  document
    .getElementById('btnAddCurrent')
    .addEventListener('click', async () => {
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

  tgl.addEventListener('change', () => setToggle(tgl.checked));
  autoBetToggleDozens.addEventListener('change', () =>
    sset({ autoBettingDozensEnabled: !!autoBetToggleDozens.checked })
  );
  autoBetToggleRows.addEventListener('change', () =>
    sset({ autoBettingRowsEnabled: !!autoBetToggleRows.checked })
  );
});

// live updates
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

  if (ch.bettingStatusDozens) {
    const st = ch.bettingStatusDozens.newValue || {
      state: 'off',
      message: '',
    };
    betStatusDozens.textContent = `[${(
      st.state || 'off'
    ).toUpperCase()}] ${st.message || ''}`;
  }
  if (ch.bettingStatusRows) {
    const st = ch.bettingStatusRows.newValue || {
      state: 'off',
      message: '',
    };
    betStatusRows.textContent = `[${(
      st.state || 'off'
    ).toUpperCase()}] ${st.message || ''}`;
  }
  if (ch.abDozensConfig) {
    const cfg = ch.abDozensConfig.newValue;
    dozensStreakInp.value = String(cfg?.triggerStreak ?? 2);
  }
  if (ch.abRowsConfig) {
    const cfg = ch.abRowsConfig.newValue;
    rowsStreakInp.value = String(cfg?.triggerStreak ?? 2);
  }
});
