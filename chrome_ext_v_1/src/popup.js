// src/popup.js
/* Popup main: глобальные фишки, шаги/стрики/auto-continue по рынкам, + streak-dots, + баланс в bet-логах
   ДОБАВЛЕНО: per-market "учитывать 0" (includeZero) — как флажок, аналогичный "Ставки подряд".
   Если включён — 0 учитывается в стрике/индикаторах и будет сохранён в конфиг рынка (ab*Config.includeZero).
   Если выключен — 0 НЕ учитывается (обрывает окно прогресса и не идёт в счётчик).
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
const autoBetToggleSix = document.getElementById('autoBetToggleSix');

const betStatusDozens = document.getElementById('betStatusDozens');
const betStatusRows = document.getElementById('betStatusRows');
const betStatusCombo = document.getElementById('betStatusCombo');
const betStatusSix = document.getElementById('betStatusSix');

const dozensStreakInp = document.getElementById('dozensStreak');
const rowsStreakInp = document.getElementById('rowsStreak');
const comboStreakInp = document.getElementById('comboStreak');
const sixStreakInp = document.getElementById('sixStreak');

const dozensAutoCk = document.getElementById('dozensAutoContinue');
const rowsAutoCk = document.getElementById('rowsAutoContinue');
const comboAutoCk = document.getElementById('comboAutoContinue');
const sixAutoCk = document.getElementById('sixAutoContinue');

/* === НОВОЕ: флажки "учитывать 0" по рынкам ===
   ОБЯЗАТЕЛЬНО добавьте в popup.html чекбоксы с этими id рядом с auto-continue:
   - <input type="checkbox" id="dozensIncludeZero" /> Учитывать 0
   - <input type="checkbox" id="rowsIncludeZero" /> Учитывать 0
   - <input type="checkbox" id="sixIncludeZero" /> Учитывать 0
   (для combo по ТЗ не требуется)
*/
const dozensZeroCk = document.getElementById('dozensIncludeZero');
const rowsZeroCk = document.getElementById('rowsIncludeZero');
const sixZeroCk = document.getElementById('sixIncludeZero');

const btnSaveAll = document.getElementById('btnSaveAll');

/* ===== streak dots containers ===== */
const dotsDozens = document.getElementById('dozensStreakDots');
const dotsRows = document.getElementById('rowsStreakDots');
const dotsCombo = document.getElementById('comboStreakDots');
const dotsSix = document.getElementById('sixStreakDots');

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

/* логи чисел */
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

/* ====== BET LOGS ====== */
function renderBetRow(e) {
  const tr = document.createElement('tr');
  const tdT = document.createElement('td');
  tdT.textContent = fmtTime(e.t);
  const tdA = document.createElement('td');
  tdA.textContent =
    e.amount != null ? Number(e.amount).toFixed(2) : '';
  tdA.className = 'num';
  const tdB = document.createElement('td');
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
      'time_iso,time_local,market,amount,balance,event,phase,type,step\n';
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
            : e.type === 'placed'
            ? e.step
              ? `Шаг ${e.step} поставлен`
              : 'Ставка поставлена'
            : e.type === 'config'
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
        includeZero: !!abDozensConfig.includeZero,
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
const CFG_SIX_KEY = 'abSixConfig';

const DEFAULT_MKT = Object.freeze({
  triggerStreak: 2,
  autoContinue: false,
  includeZero: true, // НОВОЕ: по умолчанию 0 учитывается
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
  const includeZero = !!(src.includeZero ?? DEFAULT_MKT.includeZero);
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
  return { triggerStreak, steps, autoContinue, includeZero };
}

/* steps UI refs */
const dznStepsBox = document.getElementById('dznStepsBox');
const rowStepsBox = document.getElementById('rowStepsBox');
const comboStepsBox = document.getElementById('comboStepsBox');
const sixStepsBox = document.getElementById('sixStepsBox');
const cfgDznMsg = document.getElementById('cfgDznMsg');
const cfgRowMsg = document.getElementById('cfgRowMsg');
const cfgComboMsg = document.getElementById('cfgComboMsg');
const cfgSixMsg = document.getElementById('cfgSixMsg');

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
      : market === 'combo'
      ? CFG_COMBO_KEY
      : CFG_SIX_KEY;

  const enKey =
    market === 'dozens'
      ? 'autoBettingDozensEnabled'
      : market === 'rows'
      ? 'autoBettingRowsEnabled'
      : market === 'combo'
      ? 'autoBettingComboEnabled'
      : 'autoBettingSixEnabled';

  const statusKey =
    market === 'dozens'
      ? 'bettingStatusDozens'
      : market === 'rows'
      ? 'bettingStatusRows'
      : market === 'combo'
      ? 'bettingStatusCombo'
      : 'bettingStatusSix';

  const streakInp =
    market === 'dozens'
      ? dozensStreakInp
      : market === 'rows'
      ? rowsStreakInp
      : market === 'combo'
      ? comboStreakInp
      : sixStreakInp;

  const autoCk =
    market === 'dozens'
      ? dozensAutoCk
      : market === 'rows'
      ? rowsAutoCk
      : market === 'combo'
      ? comboAutoCk
      : sixAutoCk;

  // zero checkbox reference (combo не трогаем)
  const zeroCk =
    market === 'dozens'
      ? dozensZeroCk
      : market === 'rows'
      ? rowsZeroCk
      : market === 'combo'
      ? null
      : sixZeroCk;

  const toggle =
    market === 'dozens'
      ? autoBetToggleDozens
      : market === 'rows'
      ? autoBetToggleRows
      : market === 'combo'
      ? autoBetToggleCombo
      : autoBetToggleSix;

  const stepsBox =
    market === 'dozens'
      ? dznStepsBox
      : market === 'rows'
      ? rowStepsBox
      : market === 'combo'
      ? comboStepsBox
      : sixStepsBox;

  const msgEl =
    market === 'dozens'
      ? cfgDznMsg
      : market === 'rows'
      ? cfgRowMsg
      : market === 'combo'
      ? cfgComboMsg
      : cfgSixMsg;

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
    : market === 'combo'
    ? betStatusCombo
    : betStatusSix
  ).textContent = `[${(stat.state || 'off').toUpperCase()}] ${
    stat.message || ''
  }`;

  const cfg = sanitizeMkt(
    (await sget({ [cfgKey]: DEFAULT_MKT }))[cfgKey]
  );
  streakInp.value = String(cfg.triggerStreak);
  autoCk.checked = !!cfg.autoContinue;
  if (zeroCk) zeroCk.checked = !!cfg.includeZero; // НОВОЕ
  renderSteps(stepsBox, cfg.steps);
  msgEl.textContent = 'Loaded';
}
async function saveMarketCfgFromUI(market) {
  const cfgKey =
    market === 'dozens'
      ? CFG_DZN_KEY
      : market === 'rows'
      ? CFG_ROW_KEY
      : market === 'combo'
      ? CFG_COMBO_KEY
      : CFG_SIX_KEY;

  const stepsBox =
    market === 'dozens'
      ? dznStepsBox
      : market === 'rows'
      ? rowStepsBox
      : market === 'combo'
      ? comboStepsBox
      : sixStepsBox;

  const msgEl =
    market === 'dozens'
      ? cfgDznMsg
      : market === 'rows'
      ? cfgRowMsg
      : market === 'combo'
      ? cfgComboMsg
      : cfgSixMsg;

  const streak = Math.max(
    2,
    Math.floor(
      Number(
        (market === 'dozens'
          ? dozensStreakInp.value
          : market === 'rows'
          ? rowsStreakInp.value
          : market === 'combo'
          ? comboStreakInp.value
          : sixStreakInp.value) || 2
      )
    )
  );
  const autoContinue =
    market === 'dozens'
      ? !!dozensAutoCk.checked
      : market === 'rows'
      ? !!rowsAutoCk.checked
      : market === 'combo'
      ? !!comboAutoCk.checked
      : !!sixAutoCk.checked;

  // includeZero из соответствующего чекбокса (combo не имеет)
  const includeZero =
    market === 'dozens'
      ? !!dozensZeroCk?.checked
      : market === 'rows'
      ? !!rowsZeroCk?.checked
      : market === 'combo'
      ? true /* по ТЗ не требуется, оставим true */
      : !!sixZeroCk?.checked;

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
    includeZero,
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
      includeZero: clean.includeZero,
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

/* ===== Dots: индикаторы прогресса ===== */
// dozen 0..2, 0 -> -1
function dozenIndex(n) {
  if (n === 0) return -1;
  if (n <= 12) return 0;
  if (n <= 24) return 1;
  if (n <= 36) return 2;
  return -1;
}
// row 0..2, 0 -> -1
function rowIndex(n) {
  if (n === 0) return -1;
  const r = n % 3;
  if (r === 1) return 0;
  if (r === 2) return 1;
  if (r === 0) return 2;
  return -1;
}
// sixline 0..5, 0 -> -1
function sixIndex(n) {
  if (n === 0) return -1;
  if (n < 1 || n > 36) return -1;
  return Math.floor((n - 1) / 6);
}

/* актуальные спины + последний спин */
let latestSpins = [];
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

/* === прогресс-метрики с опцией includeZero === */
/** Для дюжин/рядов: считаем длину хвостового окна.
 * Если includeZero=true — 0 допускается и идёт в счёт; иначе 0 обрывает окно.
 * Вне нулей все числа должны принадлежать одной и той же группе (dozen/row).
 */
function calcOneGroupProgress(spins, need, toIndex, includeZero) {
  let cnt = 0;
  let cand = null;
  let seenNonZero = false;

  for (
    let i = Array.isArray(spins) ? spins.length - 1 : -1;
    i >= 0 && cnt < need;
    i--
  ) {
    const n = Number(spins[i]?.n);
    if (!Number.isFinite(n)) break;

    if (n === 0) {
      if (!includeZero) break; // 0 запрещён — рвём окно
      cnt++; // 0 разрешён — считаем как часть окна
      continue;
    }
    const ix = toIndex(n);
    if (ix === -1) break;
    if (cand == null) cand = ix;
    else if (ix !== cand) break;

    seenNonZero = true;
    cnt++;
  }

  if (!seenNonZero) return { len: 0, cand: null };
  return { len: cnt, cand };
}

/** Для шестерок: в окне допускаются ТОЛЬКО (0 если includeZero=true) и значения не более чем из двух шестерок. */
function calcSixProgress(spins, need, includeZero) {
  let cnt = 0;
  const set = new Set();
  for (
    let i = Array.isArray(spins) ? spins.length - 1 : -1;
    i >= 0 && cnt < need;
    i--
  ) {
    const n = Number(spins[i]?.n);
    if (!Number.isFinite(n)) break;

    if (n === 0) {
      if (!includeZero) break; // 0 запрещён — рвём окно
      cnt++;
      continue;
    }
    const si = sixIndex(n);
    if (si === -1) break;
    if (!set.has(si)) {
      if (set.size === 2) break; // третья шестерка — окно ломается
      set.add(si);
    }
    cnt++;
  }
  return { len: cnt, hasTwo: set.size === 2 };
}

function updateDotsFromState() {
  const maxD = Math.max(1, Number(dozensStreakInp.value) || 2);
  const maxR = Math.max(1, Number(rowsStreakInp.value) || 2);
  const maxC = Math.max(1, Number(comboStreakInp.value) || 2);
  const maxS = Math.max(1, Number(sixStreakInp.value) || 2);

  const incZeroD = !!dozensZeroCk?.checked;
  const incZeroR = !!rowsZeroCk?.checked;
  const incZeroS = !!sixZeroCk?.checked;

  // ДЮЖИНЫ
  const progD = calcOneGroupProgress(
    latestSpins,
    maxD,
    dozenIndex,
    incZeroD
  );
  renderDots(dotsDozens, Math.min(progD.len, maxD), maxD);

  // РЯДЫ
  const progR = calcOneGroupProgress(
    latestSpins,
    maxR,
    rowIndex,
    incZeroR
  );
  renderDots(dotsRows, Math.min(progR.len, maxR), maxR);

  // COMBO — оставляем как раньше (streakState.combo)
  renderDots(
    dotsCombo,
    Math.max(0, Number(currStreakState?.combo?.count || 0)),
    maxC
  );

  // ШЕСТЕРКИ
  const progS = calcSixProgress(latestSpins, maxS, incZeroS);
  renderDots(dotsSix, Math.min(progS.len, maxS), maxS);
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', async () => {
  await loadGlobalChipsUI();

  loadStatus();
  loadDomains();
  loadLogs((logs) => {
    latestSpins = Array.isArray(logs) ? logs : [];
    renderAll(latestSpins);
  });
  loadBetLogs(renderBetAll);
  await loadMarketUI('dozens');
  await loadMarketUI('rows');
  await loadMarketUI('combo');
  await loadMarketUI('six');
  await loadToggle();

  const { streakState = DEFAULT_STREAK, spinLogs = [] } = await sget({
    streakState: DEFAULT_STREAK,
    spinLogs: [],
  });
  currStreakState = streakState || DEFAULT_STREAK;
  latestSpins = Array.isArray(spinLogs) ? spinLogs : [];
  if (latestSpins.length) {
    lastNumber = Number(latestSpins[latestSpins.length - 1].n);
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
  autoBetToggleSix.addEventListener('change', async () => {
    const enabled = !!autoBetToggleSix.checked;
    await sset({ autoBettingSixEnabled: enabled });
  });

  // Add Step buttons
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
  document
    .getElementById('btnAddSixStep')
    ?.addEventListener('click', () => addBlankStep(sixStepsBox));

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
  document
    .getElementById('btnCfgSixDefaults')
    ?.addEventListener('click', () =>
      renderSteps(sixStepsBox, DEFAULT_MKT.steps)
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
  document
    .getElementById('btnCfgSixSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('six'));

  // изменение настроек — перерисовать точки
  dozensStreakInp.addEventListener('input', updateDotsFromState);
  rowsStreakInp.addEventListener('input', updateDotsFromState);
  comboStreakInp.addEventListener('input', updateDotsFromState);
  sixStreakInp.addEventListener('input', updateDotsFromState);

  // НОВОЕ: реакция на переключение "учитывать 0"
  dozensZeroCk?.addEventListener('change', updateDotsFromState);
  rowsZeroCk?.addEventListener('change', updateDotsFromState);
  sixZeroCk?.addEventListener('change', updateDotsFromState);

  // SAVE ALL
  btnSaveAll.addEventListener('click', async () => {
    await saveGlobalChipsFromUI();
    await saveMarketCfgFromUI('dozens');
    await saveMarketCfgFromUI('rows');
    await saveMarketCfgFromUI('combo');
    await saveMarketCfgFromUI('six');
  });
});

/* live updates */
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;

  if (ch.trackingEnabled) tgl.checked = !!ch.trackingEnabled.newValue;
  if (ch.trackerStatus) renderStatus(ch.trackerStatus.newValue);

  if (ch.spinLogs) {
    const { oldValue = [], newValue = [] } = ch.spinLogs;
    const arr = Array.isArray(newValue) ? newValue : [];
    latestSpins = arr;
    if (arr.length) {
      const last = arr[arr.length - 1];
      if (last && Number.isFinite(Number(last.n)))
        lastNumber = Number(last.n);
    }
    if (Array.isArray(newValue) && newValue.length > oldValue.length)
      appendNew(newValue.slice(oldValue.length));
    else renderAll(arr);
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
  if (ch.bettingStatusSix) {
    const st = ch.bettingStatusSix.newValue || {
      state: 'off',
      message: '',
    };
    betStatusSix.textContent = `[${(
      st.state || 'off'
    ).toUpperCase()}] ${st.message || ''}`;
  }

  if (ch.abDozensConfig) {
    const cfg = sanitizeMkt(ch.abDozensConfig.newValue);
    dozensStreakInp.value = cfg.triggerStreak;
    dozensAutoCk.checked = !!cfg.autoContinue;
    if (dozensZeroCk) dozensZeroCk.checked = !!cfg.includeZero;
    renderSteps(dznStepsBox, cfg.steps);
    updateDotsFromState();
  }
  if (ch.abRowsConfig) {
    const cfg = sanitizeMkt(ch.abRowsConfig.newValue);
    rowsStreakInp.value = cfg.triggerStreak;
    rowsAutoCk.checked = !!cfg.autoContinue;
    if (rowsZeroCk) rowsZeroCk.checked = !!cfg.includeZero;
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
  if (ch.abSixConfig) {
    const cfg = sanitizeMkt(ch.abSixConfig.newValue);
    sixStreakInp.value = cfg.triggerStreak;
    sixAutoCk.checked = !!cfg.autoContinue;
    if (sixZeroCk) sixZeroCk.checked = !!cfg.includeZero;
    renderSteps(sixStepsBox, cfg.steps);
    updateDotsFromState();
  }

  if (ch.streakState) {
    currStreakState = ch.streakState.newValue || DEFAULT_STREAK;
    updateDotsFromState();
  }
});
