// src/popup/bet-logs.js
import { fmtTime, sget } from './utils.js';
import { betTbody, betCountEl } from './dom.js';

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

export function renderBetAll(logs) {
  if (!betTbody) return;
  betTbody.innerHTML = '';
  logs.forEach((e) => betTbody.appendChild(renderBetRow(e)));
  if (betCountEl) betCountEl.textContent = String(logs.length);
  const list = document.getElementById('betList');
  if (list) list.scrollTop = list.scrollHeight;
}

export function appendBetNew(added) {
  if (!betTbody) return;
  added.forEach((e) => betTbody.appendChild(renderBetRow(e)));
  if (betCountEl)
    betCountEl.textContent = String(
      Number(betCountEl.textContent || '0') + added.length
    );
  const list = document.getElementById('betList');
  if (list) list.scrollTop = list.scrollHeight;
}

export function loadBetLogs(cb) {
  chrome.storage.local.get({ betLogs: [] }, (data) =>
    cb(Array.isArray(data.betLogs) ? data.betLogs : [])
  );
}

export function exportBetCSV() {
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

export function clearBetLogs() {
  chrome.storage.local.set({ betLogs: [] }, () => renderBetAll([]));
}
