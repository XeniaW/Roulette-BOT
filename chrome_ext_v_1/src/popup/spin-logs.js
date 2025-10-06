// src/popup/spin-logs.js
import { fmtTime } from './utils.js';
import { tbody, countEl } from './dom.js';

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

export function renderAll(logs) {
  tbody.innerHTML = '';
  logs.forEach((e) => tbody.appendChild(renderRow(e)));
  countEl.textContent = String(logs.length);
  const list = document.getElementById('list');
  list.scrollTop = list.scrollHeight;
}

export function appendNew(added) {
  added.forEach((e) => tbody.appendChild(renderRow(e)));
  countEl.textContent = String(
    Number(countEl.textContent) + added.length
  );
  const list = document.getElementById('list');
  list.scrollTop = list.scrollHeight;
}

export function loadLogs(cb) {
  chrome.storage.local.get({ spinLogs: [] }, (data) =>
    cb(Array.isArray(data.spinLogs) ? data.spinLogs : [])
  );
}

export function exportCSV() {
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

export function clearLogs() {
  chrome.storage.local.set({ spinLogs: [] }, () => renderAll([]));
}
