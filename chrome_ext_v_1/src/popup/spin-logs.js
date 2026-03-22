import { sget, sset } from './utils.js';
import { tbody, count, uniqueLeft } from './dom.js';
import {
  TRACKED_TABLE_STATES_KEY,
  SELECTED_TRACKED_TABLE_KEY,
  sanitizeTrackedTableStates,
} from '../shared/tracked-tables.js';

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatTime(ts) {
  const d = new Date(ts || Date.now());
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(
    d.getSeconds(),
  )}`;
}

function toNum(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function defaultStreak() {
  return {
    dozens: { count: 0, idx: null },
    rows: { count: 0, idx: null },
    combo: { count: 0, d: null, r: null },
    lowhigh: { count: 0, idx: null },
    evenodd: { count: 0, idx: null },
    colors: { count: 0, idx: null },
    antidozens: { count: 0, idx: null },
  };
}

function calcUniqueLeft(logs) {
  const seen = new Set();
  for (const it of logs || []) {
    const n = toNum(it?.n);
    if (n == null) continue;
    if (n < 0 || n > 36) continue;
    seen.add(n);
  }
  return Math.max(0, 37 - seen.size);
}

function renderCounters(logs) {
  if (count) count.textContent = String((logs || []).length);
  if (uniqueLeft) {
    uniqueLeft.textContent = String(calcUniqueLeft(logs || []));
  }
}

function rowHtml(item) {
  const t = formatTime(item?.t);
  const n = item?.n ?? '';
  return `<tr><td class="mono">${t}</td><td class="mono">${n}</td></tr>`;
}

async function getFocusedSpinLogsSnapshot() {
  const {
    [TRACKED_TABLE_STATES_KEY]: rawStates = {},
    [SELECTED_TRACKED_TABLE_KEY]: rawSelectedId = '',
    spinLogs = [],
  } = await sget({
    [TRACKED_TABLE_STATES_KEY]: {},
    [SELECTED_TRACKED_TABLE_KEY]: '',
    spinLogs: [],
  });

  const states = sanitizeTrackedTableStates(rawStates);
  const selectedId = String(rawSelectedId || '').trim();
  const selectedState =
    selectedId && states[selectedId] ? states[selectedId] : null;

  const logs = Array.isArray(selectedState?.spinLogs)
    ? selectedState.spinLogs
    : Array.isArray(spinLogs)
      ? spinLogs
      : [];

  return {
    selectedId,
    states,
    logs,
  };
}

// ===== API =====

export function loadLogs(onLoaded) {
  getFocusedSpinLogsSnapshot().then(({ logs }) => {
    if (typeof onLoaded === 'function') onLoaded(logs);
  });
}

export function renderAll(logs) {
  const arr = Array.isArray(logs) ? logs : [];
  if (!tbody) return;

  tbody.innerHTML = arr.map(rowHtml).join('');
  renderCounters(arr);
}

export function appendNew(delta, fullLogsForCounters) {
  if (!tbody) return;

  const arr = Array.isArray(delta) ? delta : [];
  if (arr.length) {
    const html = arr.map(rowHtml).join('');
    tbody.insertAdjacentHTML('beforeend', html);
  }

  const base = Array.isArray(fullLogsForCounters)
    ? fullLogsForCounters
    : null;

  if (base) renderCounters(base);
  else if (count) {
    count.textContent = String(
      (Number(count.textContent || '0') || 0) + arr.length,
    );
  }
}

export async function clearLogs() {
  const { selectedId, states } = await getFocusedSpinLogsSnapshot();

  if (!selectedId || !states[selectedId]) {
    await sset({ spinLogs: [] });
    renderAll([]);
    return;
  }

  const nextStates = { ...states };
  nextStates[selectedId] = {
    ...nextStates[selectedId],
    spinLogs: [],
    streakState: defaultStreak(),
  };

  await sset({
    [TRACKED_TABLE_STATES_KEY]: nextStates,
    spinLogs: [],
    streakState: defaultStreak(),
  });

  renderAll([]);
}

export async function exportCSV() {
  const { selectedId, logs } = await getFocusedSpinLogsSnapshot();
  const arr = Array.isArray(logs) ? logs : [];

  const lines = ['time,number'];
  for (const it of arr) {
    const d = new Date(it?.t || Date.now()).toISOString();
    const n = it?.n ?? '';
    lines.push(`${d},${n}`);
  }
  const csv = lines.join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = selectedId
    ? `${selectedId}-spin-logs.csv`
    : 'spin-logs.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function calcGapsAll(logs) {
  const lastIdx = new Array(37).fill(-1);
  const arr = Array.isArray(logs) ? logs : [];

  for (let i = 0; i < arr.length; i++) {
    const n = toNum(arr[i]?.n);
    if (n == null || n < 0 || n > 36) continue;
    lastIdx[n] = i;
  }

  const len = arr.length;
  const gaps = [];
  for (let n = 0; n <= 36; n++) {
    const li = lastIdx[n];
    const gap = li === -1 ? len : len - 1 - li;
    gaps.push({ n, gap });
  }
  return gaps;
}

export function formatTopNearTrigger(
  logs,
  triggerGap,
  topN = 5,
  pct = 0.8,
) {
  const tg = Math.max(1, Number(triggerGap) | 0);
  const nearFrom = Math.ceil(tg * pct);

  const gaps = calcGapsAll(logs);
  const maxGap = gaps.reduce((m, x) => Math.max(m, x.gap), 0);

  if (maxGap < nearFrom) return '';

  const near = gaps
    .filter((x) => x.gap >= nearFrom)
    .map((x) => ({ ...x, d: tg - x.gap }))
    .sort((a, b) => a.d - b.d || b.gap - a.gap || a.n - b.n)
    .slice(0, Math.max(1, topN | 0));

  if (!near.length) return '';

  const items = near.map((x) => {
    if (x.d <= 0) return `${x.n}: gap ${x.gap} (READY ${-x.d})`;
    return `${x.n}: gap ${x.gap} (+${x.d})`;
  });

  return `Near ${nearFrom}/${tg}: ` + items.join(' | ');
}
