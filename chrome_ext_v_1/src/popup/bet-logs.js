import { fmtTime, sget, sset } from './utils.js';
import { betTbody, betCountEl } from './dom.js';
import {
  TRACKED_TABLE_STATES_KEY,
  SELECTED_TRACKED_TABLE_KEY,
  sanitizeTrackedTableStates,
} from '../shared/tracked-tables.js';

const MAX_BET_LOGS = 2000;

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

async function getFocusedBetLogsSnapshot() {
  const {
    [TRACKED_TABLE_STATES_KEY]: rawStates = {},
    [SELECTED_TRACKED_TABLE_KEY]: rawSelectedId = '',
    betLogs = [],
  } = await sget({
    [TRACKED_TABLE_STATES_KEY]: {},
    [SELECTED_TRACKED_TABLE_KEY]: '',
    betLogs: [],
  });

  const states = sanitizeTrackedTableStates(rawStates);
  const selectedId = String(rawSelectedId || '').trim();
  const selectedState =
    selectedId && states[selectedId] ? states[selectedId] : null;

  const logs = Array.isArray(selectedState?.betLogs)
    ? selectedState.betLogs
    : Array.isArray(betLogs)
      ? betLogs
      : [];

  return {
    selectedId,
    states,
    logs,
  };
}

export function renderBetAll(logs) {
  if (!betTbody) return;
  betTbody.innerHTML = '';
  (Array.isArray(logs) ? logs : []).forEach((e) =>
    betTbody.appendChild(renderBetRow(e)),
  );
  if (betCountEl) {
    betCountEl.textContent = String(
      Array.isArray(logs) ? logs.length : 0,
    );
  }
  const list = document.getElementById('betList');
  if (list) list.scrollTop = list.scrollHeight;
}

export function appendBetNew(added) {
  if (!betTbody) return;
  (Array.isArray(added) ? added : []).forEach((e) =>
    betTbody.appendChild(renderBetRow(e)),
  );
  if (betCountEl) {
    betCountEl.textContent = String(
      Number(betCountEl.textContent || '0') +
        (Array.isArray(added) ? added.length : 0),
    );
  }
  const list = document.getElementById('betList');
  if (list) list.scrollTop = list.scrollHeight;
}

export function loadBetLogs(cb) {
  getFocusedBetLogsSnapshot().then(({ logs }) =>
    cb(Array.isArray(logs) ? logs : []),
  );
}

export async function exportBetCSV() {
  const { selectedId, logs } = await getFocusedBetLogsSnapshot();

  const header =
    'time_iso,time_local,market,amount,balance,event,phase,type,step\n';
  const rows = (Array.isArray(logs) ? logs : [])
    .map((e) => {
      const tIso = new Date(e.t).toISOString();
      const tLocal = fmtTime(e.t).replace(/,/g, '');
      const amt = e.amount != null ? Number(e.amount).toFixed(2) : '';
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
      return `${tIso},${tLocal},${e.market || ''},${amt},${bal},${eventText},${phase},${type},${step}`;
    })
    .join('\n');

  const blob = new Blob([header, rows, '\n']);
  const url = URL.createObjectURL(blob);
  chrome.downloads.download(
    {
      url,
      filename: selectedId
        ? `${selectedId}-bet-logs.csv`
        : 'bet_logs.csv',
      saveAs: true,
    },
    () => URL.revokeObjectURL(url),
  );
}

export async function clearBetLogs() {
  const { selectedId, states } = await getFocusedBetLogsSnapshot();

  if (!selectedId || !states[selectedId]) {
    chrome.storage.local.set({ betLogs: [] }, () => renderBetAll([]));
    return;
  }

  const nextStates = { ...states };
  nextStates[selectedId] = {
    ...nextStates[selectedId],
    betLogs: [],
  };

  await sset({
    [TRACKED_TABLE_STATES_KEY]: nextStates,
    betLogs: [],
  });

  renderBetAll([]);
}
