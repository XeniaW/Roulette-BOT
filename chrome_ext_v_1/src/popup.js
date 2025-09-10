/* Popup main — трекинг/домены/логи без изменений; добавлены:
   - Global Chips (один раз)
   - Steps + Streak по рынкам (Dozens/Rows/Combo)
   - Save All: сохраняет global chips + все steps/streak
*/

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

// ===== базовые DOM из твоего попапа =====
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

// ===== Тумблеры рынков + статусы + стрики =====
const autoBetToggleDozens = document.getElementById(
  'autoBetToggleDozens'
);
const autoBetToggleRows = document.getElementById(
  'autoBetToggleRows'
);
const autoBetToggleCombo = document.getElementById(
  'autoBetToggleCombo'
);

const betStatusDozens = document.getElementById('betStatusDozens');
const betStatusRows = document.getElementById('betStatusRows');
const betStatusCombo = document.getElementById('betStatusCombo');

const dozensStreakInp = document.getElementById('dozensStreak');
const rowsStreakInp = document.getElementById('rowsStreak');
const comboStreakInp = document.getElementById('comboStreak');

const btnSaveAll = document.getElementById('btnSaveAll');

// ===== Helpers (status/domains/logs) =====
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

// ===== GLOBAL CHIPS UI =====
const GLOBAL_CHIPS_KEY = 'abGlobalChips';
const DEFAULT_CHIPS = {
  chipSelectorTemplate: '[data-e2e="chip-{{value}}"]',
  chipValues: [0.2, 1, 5, 20],
};

const cfgChipTpl = document.getElementById('cfgChipTpl');
const chipsBox = document.getElementById('chipsBox');
const cfgChipsMsg = document.getElementById('cfgChipsMsg');
document
  .getElementById('btnAddChip')
  .addEventListener('click', () =>
    chipsBox.appendChild(makeChipRow())
  );

function sanitizeChips(raw) {
  const src = raw || {};
  const tpl =
    typeof src.chipSelectorTemplate === 'string' &&
    src.chipSelectorTemplate.includes('{{value}}')
      ? src.chipSelectorTemplate
      : DEFAULT_CHIPS.chipSelectorTemplate;
  let chipValues = Array.isArray(src.chipValues)
    ? src.chipValues
        .map(Number)
        .filter((v) => Number.isFinite(v) && v > 0)
    : [];
  if (!chipValues.length) chipValues = [...DEFAULT_CHIPS.chipValues];
  return { chipSelectorTemplate: tpl, chipValues };
}
async function loadGlobalChipsUI() {
  // миграция из старого десяткового конфига
  const { [GLOBAL_CHIPS_KEY]: g = null, abDozensConfig = null } =
    await sget({ [GLOBAL_CHIPS_KEY]: null, abDozensConfig: null });
  let use = g;
  if (!use && abDozensConfig && abDozensConfig.chipSelectorTemplate) {
    use = sanitizeChips({
      chipSelectorTemplate: abDozensConfig.chipSelectorTemplate,
      chipValues: abDozensConfig.chipValues,
    });
    await sset({
      [GLOBAL_CHIPS_KEY]: use,
      abDozensConfig: {
        triggerStreak:
          Math.max(2, abDozensConfig.triggerStreak | 0) || 2,
        steps: Array.isArray(abDozensConfig.steps)
          ? abDozensConfig.steps
          : [],
      },
    });
  }
  if (!use) use = DEFAULT_CHIPS;

  const clean = sanitizeChips(use);
  cfgChipTpl.value = clean.chipSelectorTemplate;
  renderChips(chipsBox, clean.chipValues);
  cfgChipsMsg.textContent = 'Loaded global chips';
}
async function saveGlobalChipsFromUI() {
  const tpl = (cfgChipTpl.value || '').trim();
  if (!tpl.includes('{{value}}')) {
    cfgChipsMsg.textContent = 'Template must include {{value}}';
    return;
  }
  const chipValues = getChipsFromUI(chipsBox);
  if (!chipValues.length) {
    cfgChipsMsg.textContent = 'Add at least one chip value';
    return;
  }

  const clean = sanitizeChips({
    chipSelectorTemplate: tpl,
    chipValues,
  });
  await sset({ [GLOBAL_CHIPS_KEY]: clean });

  // лог
  try {
    const { betLogs = [] } = await sget({ betLogs: [] });
    betLogs.push({
      t: Date.now(),
      type: 'config',
      market: 'global',
      message: 'Global chips saved',
      chipsCount: clean.chipValues.length,
    });
    if (betLogs.length > 2000)
      betLogs.splice(0, betLogs.length - 2000);
    await sset({ betLogs });
  } catch {}
  cfgChipsMsg.textContent = 'Saved global chips';
}

// ===== Market steps/streak (Dozens/Rows/Combo) =====
const CFG_DZN_KEY = 'abDozensConfig';
const CFG_ROW_KEY = 'abRowsConfig';
const CFG_COMBO_KEY = 'abComboConfig';

const DEFAULT_MKT = Object.freeze({
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

function sanitizeMkt(raw) {
  const src = raw || {};
  const triggerStreak = Math.max(
    2,
    Math.floor(Number(src.triggerStreak ?? DEFAULT_MKT.triggerStreak))
  );
  let steps = Array.isArray(src.steps)
    ? src.steps
    : DEFAULT_MKT.steps;
  steps = steps
    .map((st) => (Array.isArray(st) ? st : []))
    .map((st) =>
      st
        .map((it) => ({
          chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
          times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
        }))
        .filter(
          (it) =>
            Number.isFinite(it.chip) && Number.isFinite(it.times)
        )
    )
    .filter((st) => st.length);
  if (!steps.length)
    steps = JSON.parse(JSON.stringify(DEFAULT_MKT.steps));
  return { triggerStreak, steps };
}

const dznStepsBox = document.getElementById('dznStepsBox');
const rowStepsBox = document.getElementById('rowStepsBox');
const comboStepsBox = document.getElementById('comboStepsBox');

const cfgDznMsg = document.getElementById('cfgDznMsg');
const cfgRowMsg = document.getElementById('cfgRowMsg');
const cfgComboMsg = document.getElementById('cfgComboMsg');

document
  .getElementById('btnAddDznStep')
  .addEventListener('click', () =>
    makeStepCard(dznStepsBox, [{ chip: 1, times: 1 }])
  );
document
  .getElementById('btnAddRowStep')
  .addEventListener('click', () =>
    makeStepCard(rowStepsBox, [{ chip: 1, times: 1 }])
  );
document
  .getElementById('btnAddComboStep')
  .addEventListener('click', () =>
    makeStepCard(comboStepsBox, [{ chip: 1, times: 1 }])
  );

document
  .getElementById('btnCfgDznDefaults')
  .addEventListener('click', () => {
    renderSteps(dznStepsBox, DEFAULT_MKT.steps);
    cfgDznMsg.textContent = 'Defaults loaded (not saved).';
  });
document
  .getElementById('btnCfgRowDefaults')
  .addEventListener('click', () => {
    renderSteps(rowStepsBox, DEFAULT_MKT.steps);
    cfgRowMsg.textContent = 'Defaults loaded (not saved).';
  });
document
  .getElementById('btnCfgComboDefaults')
  .addEventListener('click', () => {
    renderSteps(comboStepsBox, DEFAULT_MKT.steps);
    cfgComboMsg.textContent = 'Defaults loaded (not saved).';
  });

document
  .getElementById('btnCfgDznSave')
  .addEventListener('click', () => saveMarketCfgFromUI('dozens'));
document
  .getElementById('btnCfgRowSave')
  .addEventListener('click', () => saveMarketCfgFromUI('rows'));
document
  .getElementById('btnCfgComboSave')
  .addEventListener('click', () => saveMarketCfgFromUI('combo'));

// helpers UI (chips and steps)
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

// load/save per market UI
async function loadMarketUI(market) {
  const cfgKey =
    market === 'dozens'
      ? CFG_DZN_KEY
      : market === 'rows'
      ? CFG_ROW_KEY
      : CFG_COMBO_KEY;
  const enKey =
    market === 'dozens'
      ? 'autoBettingDozensEnabled'
      : market === 'rows'
      ? 'autoBettingRowsEnabled'
      : 'autoBettingComboEnabled';
  const statusKey =
    market === 'dozens'
      ? 'bettingStatusDozens'
      : market === 'rows'
      ? 'bettingStatusRows'
      : 'bettingStatusCombo';
  const streakInp =
    market === 'dozens'
      ? dozensStreakInp
      : market === 'rows'
      ? rowsStreakInp
      : comboStreakInp;
  const toggle =
    market === 'dozens'
      ? autoBetToggleDozens
      : market === 'rows'
      ? autoBetToggleRows
      : autoBetToggleCombo;
  const stepsBox =
    market === 'dozens'
      ? dznStepsBox
      : market === 'rows'
      ? rowStepsBox
      : comboStepsBox;
  const msgEl =
    market === 'dozens'
      ? cfgDznMsg
      : market === 'rows'
      ? cfgRowMsg
      : cfgComboMsg;

  const st = await sget({
    [enKey]: false,
    [statusKey]: { state: 'off', message: '' },
  });
  toggle.checked = !!st[enKey];
  const stat = st[statusKey] || { state: 'off', message: '' };
  (market === 'dozens'
    ? betStatusDozens
    : market === 'rows'
    ? betStatusRows
    : betStatusCombo
  ).textContent = `[${(stat.state || 'off').toUpperCase()}] ${
    stat.message || ''
  }`;

  const cfg = sanitizeMkt(
    (await sget({ [cfgKey]: DEFAULT_MKT }))[cfgKey]
  );
  streakInp.value = String(cfg.triggerStreak);
  renderSteps(stepsBox, cfg.steps);
  msgEl.textContent = 'Loaded';
}
async function saveMarketCfgFromUI(market) {
  const cfgKey =
    market === 'dozens'
      ? CFG_DZN_KEY
      : market === 'rows'
      ? CFG_ROW_KEY
      : CFG_COMBO_KEY;
  const stepsBox =
    market === 'dozens'
      ? dznStepsBox
      : market === 'rows'
      ? rowStepsBox
      : comboStepsBox;
  const msgEl =
    market === 'dozens'
      ? cfgDznMsg
      : market === 'rows'
      ? cfgRowMsg
      : cfgComboMsg;
  const streak = Math.max(
    2,
    Math.floor(
      Number(
        (market === 'dozens'
          ? dozensStreakInp.value
          : market === 'rows'
          ? rowsStreakInp.value
          : comboStreakInp.value) || 2
      )
    )
  );

  // валидация chip# против глобальных фишек
  const { [GLOBAL_CHIPS_KEY]: chips = DEFAULT_CHIPS } = await sget({
    [GLOBAL_CHIPS_KEY]: DEFAULT_CHIPS,
  });
  const chipCount = Array.isArray(chips?.chipValues)
    ? chips.chipValues.length
    : DEFAULT_CHIPS.chipValues.length;

  const steps = getStepsFromUI(stepsBox);
  if (!steps.length) {
    msgEl.textContent = 'Add at least one step';
    return;
  }
  for (const st of steps)
    for (const it of st)
      if (it.chip < 1 || it.chip > chipCount) {
        msgEl.textContent = 'Step uses invalid Chip #';
        return;
      }

  const clean = sanitizeMkt({ triggerStreak: streak, steps });
  await sset({ [cfgKey]: clean });

  try {
    const { betLogs = [] } = await sget({ betLogs: [] });
    betLogs.push({
      t: Date.now(),
      type: 'config',
      market,
      message: 'Конфиг сохранён',
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
  msgEl.textContent = 'Saved.';
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  // migrate old chips from abDozensConfig if needed
  await loadGlobalChipsUI();

  loadStatus();
  loadDomains();
  loadLogs(renderAll);
  loadBetLogs(renderBetAll);
  await loadMarketUI('dozens');
  await loadMarketUI('rows');
  await loadMarketUI('combo');
  await loadToggle();

  btnExport.addEventListener('click', exportCSV);
  btnClear.addEventListener('click', clearLogs);
  if (btnBetExport)
    btnBetExport.addEventListener('click', exportBetCSV);
  if (btnBetClear)
    btnBetClear.addEventListener('click', clearBetLogs);

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

  tgl.addEventListener('change', () => setToggle(tgl.checked));
  autoBetToggleDozens.addEventListener('change', () =>
    sset({ autoBettingDozensEnabled: !!autoBetToggleDozens.checked })
  );
  autoBetToggleRows.addEventListener('change', () =>
    sset({ autoBettingRowsEnabled: !!autoBetToggleRows.checked })
  );
  autoBetToggleCombo.addEventListener('change', () =>
    sset({ autoBettingComboEnabled: !!autoBetToggleCombo.checked })
  );

  // SAVE ALL
  btnSaveAll.addEventListener('click', async () => {
    await saveGlobalChipsFromUI();
    await saveMarketCfgFromUI('dozens');
    await saveMarketCfgFromUI('rows');
    await saveMarketCfgFromUI('combo');
  });
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
  if (ch.bettingStatusCombo) {
    const st = ch.bettingStatusCombo.newValue || {
      state: 'off',
      message: '',
    };
    betStatusCombo.textContent = `[${(
      st.state || 'off'
    ).toUpperCase()}] ${st.message || ''}`;
  }

  if (ch[GLOBAL_CHIPS_KEY]) loadGlobalChipsUI();
  if (ch.abDozensConfig) {
    const cfg = sanitizeMkt(ch.abDozensConfig.newValue);
    dozensStreakInp.value = cfg.triggerStreak;
    renderSteps(dznStepsBox, cfg.steps);
  }
  if (ch.abRowsConfig) {
    const cfg = sanitizeMkt(ch.abRowsConfig.newValue);
    rowsStreakInp.value = cfg.triggerStreak;
    renderSteps(rowStepsBox, cfg.steps);
  }
  if (ch.abComboConfig) {
    const cfg = sanitizeMkt(ch.abComboConfig.newValue);
    comboStreakInp.value = cfg.triggerStreak;
    renderSteps(comboStepsBox, cfg.steps);
  }
});
