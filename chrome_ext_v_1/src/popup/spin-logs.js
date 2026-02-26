// src/popup/spin-logs.js
import { sget, sset } from './utils.js';
import { tbody, count, uniqueLeft } from './dom.js';

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
  if (uniqueLeft)
    uniqueLeft.textContent = String(calcUniqueLeft(logs || []));
}

function rowHtml(item) {
  const t = formatTime(item?.t);
  const n = item?.n ?? '';
  return `<tr><td class="mono">${t}</td><td class="mono">${n}</td></tr>`;
}

// ===== API =====

export function loadLogs(onLoaded) {
  sget({ spinLogs: [] }).then(({ spinLogs }) => {
    const logs = Array.isArray(spinLogs) ? spinLogs : [];
    if (typeof onLoaded === 'function') onLoaded(logs);
  });
}

export function renderAll(logs) {
  const arr = Array.isArray(logs) ? logs : [];
  if (!tbody) return;

  // последними вниз
  tbody.innerHTML = arr.map(rowHtml).join('');
  renderCounters(arr);
}

/**
 * appendNew: добавляет только новые строки (для live.js),
 * не перерисовывая всю таблицу
 */
export function appendNew(delta, fullLogsForCounters) {
  if (!tbody) return;

  const arr = Array.isArray(delta) ? delta : [];
  if (arr.length) {
    const html = arr.map(rowHtml).join('');
    tbody.insertAdjacentHTML('beforeend', html);
  }

  // counters считаем по полному массиву, если он передан
  const base = Array.isArray(fullLogsForCounters)
    ? fullLogsForCounters
    : null;

  if (base) renderCounters(base);
  else {
    // fallback: считаем по таблице как по длине, уникальные не вытащим
    // поэтому лучше всегда передавать полный logs массив
    if (count)
      count.textContent = String(
        (count.textContent | 0) + arr.length,
      );
  }
}

export async function clearLogs() {
  await sset({ spinLogs: [] });
  renderAll([]);
}

export async function exportCSV() {
  const { spinLogs = [] } = await sget({ spinLogs: [] });
  const arr = Array.isArray(spinLogs) ? spinLogs : [];

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
  a.download = 'spin-logs.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function calcGapsAll(logs) {
  // 0..36 всегда
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

  // ещё слишком рано: ничего не показываем
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
