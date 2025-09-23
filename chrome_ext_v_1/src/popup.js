/* Popup main: глобальные фишки, шаги/стрики/autoContinue по рынкам, + streak-dots с корректной подсветкой первого кружка, + баланс в bet-логах */

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

/* ===== базовые DOM ===== */
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

/* ===== переключатели рынков / статусы / стрики / auto-continue ===== */
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

const dozensAutoCk = document.getElementById('dozensAutoContinue');
const rowsAutoCk = document.getElementById('rowsAutoContinue');
const comboAutoCk = document.getElementById('comboAutoContinue');

const btnSaveAll = document.getElementById('btnSaveAll');

/* ===== streak dots containers ===== */
const dotsDozens = document.getElementById('dozensStreakDots');
const dotsRows = document.getElementById('rowsStreakDots');
const dotsCombo = document.getElementById('comboStreakDots');

/* ===== утилиты ===== */
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

/* домены */
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

/* логи */
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

/* ====== BET LOGS (с колонкой "balance") ====== */
function renderBetRow(e) {
  const tr = document.createElement('tr');

  const tdT = document.createElement('td');
  tdT.textContent = fmtTime(e.t);

  const tdA = document.createElement('td');
  tdA.textContent =
    e.amount != null ? Number(e.amount).toFixed(2) : '';
  tdA.className = 'num';

  const tdB = document.createElement('td'); // NEW: balance
  tdB.textContent =
    e.balance != null && Number.isFinite(Number(e.balance))
      ? Number(e.balance).toFixed(2)
      : '';
  tdB.className = 'num';

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

  tr.append(tdT, tdA, tdB, tdE);
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
      'time_iso,time_local,market,amount,balance,event,phase,type,step\n'; // NEW: balance
    const rows = logs
      .map((e) => {
        const tIso = new Date(e.t).toISOString();
        const tLocal = fmtTime(e.t).replace(/,/g, '');
        const amt =
          e.amount != null ? Number(e.amount).toFixed(2) : '';
        const bal =
          e.balance != null && Number.isFinite(Number(e.balance))
            ? Number(e.balance).toFixed(2)
            : '';
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
        },${amt},${bal},${eventText},${phase},${type},${step}`;
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

/* ===== глобальные фишки ===== */
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
        autoContinue: !!abDozensConfig.autoContinue,
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

/* ===== конфиг рынков ===== */
const CFG_DZN_KEY = 'abDozensConfig';
const CFG_ROW_KEY = 'abRowsConfig';
const CFG_COMBO_KEY = 'abComboConfig';

const DEFAULT_MKT = Object.freeze({
  triggerStreak: 2,
  autoContinue: false,
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
  const autoContinue = !!(
    src.autoContinue ?? DEFAULT_MKT.autoContinue
  );
  let steps = Array.isArray(src.steps)
    ? src.steps
    : DEFAULT_MKT.steps;
  steps = steps
    .map((st) => (Array.isArray(st) ? st : []))
    .map((st) =>
      st.map((it) => ({
        chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
        times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
      }))
    )
    .map((st) =>
      st.filter(
        (it) => Number.isFinite(it.chip) && Number.isFinite(it.times)
      )
    )
    .filter((st) => st.length);
  if (!steps.length)
    steps = JSON.parse(JSON.stringify(DEFAULT_MKT.steps));
  return { triggerStreak, steps, autoContinue };
}

/* steps UI refs */
const dznStepsBox = document.getElementById('dznStepsBox');
const rowStepsBox = document.getElementById('rowStepsBox');
const comboStepsBox = document.getElementById('comboStepsBox');
const cfgDznMsg = document.getElementById('cfgDznMsg');
const cfgRowMsg = document.getElementById('cfgRowMsg');
const cfgComboMsg = document.getElementById('cfgComboMsg');

/* helpers UI (chips/steps) */
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

/* загрузка/сохранение рынков */
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
  const autoCk =
    market === 'dozens'
      ? dozensAutoCk
      : market === 'rows'
      ? rowsAutoCk
      : comboAutoCk;
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
  autoCk.checked = !!cfg.autoContinue;
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
  const autoCk =
    market === 'dozens'
      ? dozensAutoCk
      : market === 'rows'
      ? rowsAutoCk
      : comboAutoCk;
  const autoContinue = !!autoCk.checked;

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
  for (const stp of steps)
    for (const it of stp)
      if (it.chip < 1 || it.chip > chipCount) {
        msgEl.textContent = 'Step uses invalid Chip #';
        return;
      }

  const clean = sanitizeMkt({
    triggerStreak: streak,
    steps,
    autoContinue,
  });
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
      autoContinue: clean.autoContinue,
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

/* ===== Dots: логика ===== */
function dozenIndex(n) {
  if (n === 0) return -1;
  if (n <= 12) return 0;
  if (n <= 24) return 1;
  if (n <= 36) return 2;
  return -1;
}
function rowIndex(n) {
  if (n === 0) return -1;
  const r = n % 3;
  if (r === 1) return 0;
  if (r === 2) return 1;
  if (r === 0) return 2;
  return -1;
}

/* актуальный последний спин — чтобы 1-й кружок был зелёным при не-нулевом числе */
let lastNumber = null;

const DEFAULT_STREAK = {
  dozens: { count: 0, idx: null },
  rows: { count: 0, idx: null },
  combo: { count: 0, d: null, r: null },
};
let currStreakState = DEFAULT_STREAK;

function renderDots(hostEl, filledCount, max) {
  const fill = Math.max(0, Math.floor(Number(filledCount || 0)));
  const total = Math.max(1, Math.floor(Number(max || 1)));
  let html = '';
  for (let i = 0; i < total; i++)
    html += `<span class="dot${i < fill ? ' filled' : ''}"></span>`;
  hostEl.innerHTML = html;
}

function effectiveCount(kind) {
  let c = Math.max(0, Number(kind.count || 0));
  if (c === 0 && lastNumber != null && lastNumber !== 0) {
    c = 1;
  }
  return c;
}

function updateDotsFromState() {
  const maxD = Math.max(1, Number(dozensStreakInp.value) || 2);
  const maxR = Math.max(1, Number(rowsStreakInp.value) || 2);
  const maxC = Math.max(1, Number(comboStreakInp.value) || 2);

  renderDots(
    dotsDozens,
    effectiveCount(currStreakState?.dozens || { count: 0 }),
    maxD
  );
  renderDots(
    dotsRows,
    effectiveCount(currStreakState?.rows || { count: 0 }),
    maxR
  );
  renderDots(
    dotsCombo,
    effectiveCount(currStreakState?.combo || { count: 0 }),
    maxC
  );
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', async () => {
  await loadGlobalChipsUI();

  loadStatus();
  loadDomains();
  loadLogs(renderAll);
  loadBetLogs(renderBetAll);
  await loadMarketUI('dozens');
  await loadMarketUI('rows');
  await loadMarketUI('combo');
  await loadToggle();

  // начальный streakState + последний номер
  const { streakState = DEFAULT_STREAK, spinLogs = [] } = await sget({
    streakState: DEFAULT_STREAK,
    spinLogs: [],
  });
  currStreakState = streakState || DEFAULT_STREAK;
  if (Array.isArray(spinLogs) && spinLogs.length) {
    lastNumber = Number(spinLogs[spinLogs.length - 1].n);
    if (!Number.isFinite(lastNumber)) lastNumber = null;
  }
  updateDotsFromState();

  /* кнопки */
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

  autoBetToggleDozens.addEventListener('change', async () => {
    const enabled = !!autoBetToggleDozens.checked;
    await sset({ autoBettingDozensEnabled: enabled });
    if (!enabled) {
      const { streakState = DEFAULT_STREAK } = await sget({
        streakState: DEFAULT_STREAK,
      });
      const st = {
        ...DEFAULT_STREAK,
        ...streakState,
        dozens: { count: 0, idx: null },
      };
      await sset({ streakState: st });
    }
  });

  autoBetToggleRows.addEventListener('change', async () => {
    const enabled = !!autoBetToggleRows.checked;
    await sset({ autoBettingRowsEnabled: enabled });
    if (!enabled) {
      const { streakState = DEFAULT_STREAK } = await sget({
        streakState: DEFAULT_STREAK,
      });
      const st = {
        ...DEFAULT_STREAK,
        ...streakState,
        rows: { count: 0, idx: null },
      };
      await sset({ streakState: st });
    }
  });

  autoBetToggleCombo.addEventListener('change', async () => {
    const enabled = !!autoBetToggleCombo.checked;
    await sset({ autoBettingComboEnabled: enabled });
    if (!enabled) {
      const { streakState = DEFAULT_STREAK } = await sget({
        streakState: DEFAULT_STREAK,
      });
      const st = {
        ...DEFAULT_STREAK,
        ...streakState,
        combo: { count: 0, d: null, r: null },
      };
      await sset({ streakState: st });
    }
  });

  // --- Add Step buttons ---
  function addBlankStep(box) {
    makeStepCard(box, [{ chip: 1, times: 1 }]);
  }

  document
    .getElementById('btnAddDznStep')
    ?.addEventListener('click', () => addBlankStep(dznStepsBox));
  document
    .getElementById('btnAddRowStep')
    ?.addEventListener('click', () => addBlankStep(rowStepsBox));
  document
    .getElementById('btnAddComboStep')
    ?.addEventListener('click', () => addBlankStep(comboStepsBox));

  // Defaults
  document
    .getElementById('btnCfgDznDefaults')
    ?.addEventListener('click', () =>
      renderSteps(dznStepsBox, DEFAULT_MKT.steps)
    );
  document
    .getElementById('btnCfgRowDefaults')
    ?.addEventListener('click', () =>
      renderSteps(rowStepsBox, DEFAULT_MKT.steps)
    );
  document
    .getElementById('btnCfgComboDefaults')
    ?.addEventListener('click', () =>
      renderSteps(comboStepsBox, DEFAULT_MKT.steps)
    );

  // Save (per market)
  document
    .getElementById('btnCfgDznSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('dozens'));
  document
    .getElementById('btnCfgRowSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('rows'));
  document
    .getElementById('btnCfgComboSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('combo'));

  // изменение "максимума" — перерисовать точки
  dozensStreakInp.addEventListener('input', updateDotsFromState);
  rowsStreakInp.addEventListener('input', updateDotsFromState);
  comboStreakInp.addEventListener('input', updateDotsFromState);

  // SAVE ALL
  btnSaveAll.addEventListener('click', async () => {
    await saveGlobalChipsFromUI();
    await saveMarketCfgFromUI('dozens');
    await saveMarketCfgFromUI('rows');
    await saveMarketCfgFromUI('combo');
  });
});

/* live updates */
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;

  if (ch.trackingEnabled) tgl.checked = !!ch.trackingEnabled.newValue;
  if (ch.trackerStatus) renderStatus(ch.trackerStatus.newValue);

  if (ch.spinLogs) {
    const { oldValue = [], newValue = [] } = ch.spinLogs;
    if (Array.isArray(newValue) && newValue.length) {
      const last = newValue[newValue.length - 1];
      if (last && Number.isFinite(Number(last.n))) {
        lastNumber = Number(last.n);
      }
    }
    if (newValue.length > oldValue.length)
      appendNew(newValue.slice(oldValue.length));
    else renderAll(Array.isArray(newValue) ? newValue : []);
    updateDotsFromState();
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

  if (ch.abDozensConfig) {
    const cfg = sanitizeMkt(ch.abDozensConfig.newValue);
    dozensStreakInp.value = cfg.triggerStreak;
    dozensAutoCk.checked = !!cfg.autoContinue;
    renderSteps(dznStepsBox, cfg.steps);
    updateDotsFromState();
  }
  if (ch.abRowsConfig) {
    const cfg = sanitizeMkt(ch.abRowsConfig.newValue);
    rowsStreakInp.value = cfg.triggerStreak;
    rowsAutoCk.checked = !!cfg.autoContinue;
    renderSteps(rowStepsBox, cfg.steps);
    updateDotsFromState();
  }
  if (ch.abComboConfig) {
    const cfg = sanitizeMkt(ch.abComboConfig.newValue);
    comboStreakInp.value = cfg.triggerStreak;
    comboAutoCk.checked = !!cfg.autoContinue;
    renderSteps(comboStepsBox, cfg.steps);
    updateDotsFromState();
  }

  if (ch.streakState) {
    currStreakState = ch.streakState.newValue || DEFAULT_STREAK;
    updateDotsFromState();
  }
});
