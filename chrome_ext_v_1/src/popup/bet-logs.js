import { fmtTime, sget, sset } from './utils.js';
import { betTbody, betCountEl } from './dom.js';
import {
  TRACKED_TABLE_STATES_KEY,
  SELECTED_TRACKED_TABLE_KEY,
  sanitizeTrackedTableStates,
} from '../shared/tracked-tables.js';

const TRACKED_TABLE_BET_LOGS_KEY = 'trackedTableBetLogsByTable';

let _betLogsBooted = false;

function renderBetRow(e) {
  const tr = document.createElement('tr');

  const tdT = document.createElement('td');
  tdT.textContent = fmtTime(e.t);

  const tdA = document.createElement('td');
  tdA.textContent =
    e.amount != null && Number.isFinite(Number(e.amount))
      ? Number(e.amount).toFixed(2)
      : '';
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
        : e.type === 'limit'
          ? 'Лимит входов'
          : '');

  tdE.textContent =
    (e.market ? `[${e.market}] ` : '') +
    (phase ? `[${phase}] ` : '') +
    msg;

  tr.append(tdT, tdA, tdB, tdE);
  return tr;
}

function sanitizeTableBetLogsMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    out[String(key)] = Array.isArray(val) ? val.slice() : [];
  }
  return out;
}

function pickFocusedLogs({
  selectedId,
  tableBetLogsMap,
  states,
  globalBetLogs,
}) {
  const tableLogs =
    selectedId &&
    tableBetLogsMap &&
    typeof tableBetLogsMap === 'object' &&
    Array.isArray(tableBetLogsMap[selectedId])
      ? tableBetLogsMap[selectedId]
      : null;

  if (Array.isArray(tableLogs) && tableLogs.length > 0) {
    return tableLogs;
  }

  const selectedState =
    selectedId && states[selectedId] ? states[selectedId] : null;

  if (
    Array.isArray(selectedState?.betLogs) &&
    selectedState.betLogs.length > 0
  ) {
    return selectedState.betLogs;
  }

  if (Array.isArray(globalBetLogs) && globalBetLogs.length > 0) {
    return globalBetLogs;
  }

  if (Array.isArray(tableLogs)) {
    return tableLogs;
  }

  if (Array.isArray(selectedState?.betLogs)) {
    return selectedState.betLogs;
  }

  return [];
}

async function getFocusedBetLogsSnapshot() {
  const {
    [TRACKED_TABLE_STATES_KEY]: rawStates = {},
    [TRACKED_TABLE_BET_LOGS_KEY]: rawTableBetLogsMap = {},
    [SELECTED_TRACKED_TABLE_KEY]: rawSelectedId = '',
    betLogs = [],
  } = await sget({
    [TRACKED_TABLE_STATES_KEY]: {},
    [TRACKED_TABLE_BET_LOGS_KEY]: {},
    [SELECTED_TRACKED_TABLE_KEY]: '',
    betLogs: [],
  });

  const states = sanitizeTrackedTableStates(rawStates);
  const selectedId = String(rawSelectedId || '').trim();
  const tableBetLogsMap = sanitizeTableBetLogsMap(rawTableBetLogsMap);

  const logs = pickFocusedLogs({
    selectedId,
    tableBetLogsMap,
    states,
    globalBetLogs: Array.isArray(betLogs) ? betLogs : [],
  });

  return {
    selectedId,
    states,
    tableBetLogsMap,
    logs: Array.isArray(logs) ? logs : [],
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

function bindBetLogsLive(cb) {
  if (_betLogsBooted) return;
  _betLogsBooted = true;

  chrome.storage.onChanged.addListener(async (ch, area) => {
    if (area !== 'local') return;

    if (
      ch[TRACKED_TABLE_BET_LOGS_KEY] ||
      ch[TRACKED_TABLE_STATES_KEY] ||
      ch[SELECTED_TRACKED_TABLE_KEY] ||
      ch.betLogs
    ) {
      const { logs } = await getFocusedBetLogsSnapshot();
      cb(Array.isArray(logs) ? logs : []);
    }
  });
}

export function loadBetLogs(cb) {
  getFocusedBetLogsSnapshot().then(({ logs }) =>
    cb(Array.isArray(logs) ? logs : []),
  );

  bindBetLogsLive(cb);
}

export async function exportBetCSV() {
  const { selectedId, logs } = await getFocusedBetLogsSnapshot();

  const header =
    'time_iso,time_local,market,amount,balance,event,phase,type,step\n';

  const rows = (Array.isArray(logs) ? logs : [])
    .map((e) => {
      const tIso = new Date(e.t).toISOString();
      const tLocal = fmtTime(e.t).replace(/,/g, '');
      const amt =
        e.amount != null && Number.isFinite(Number(e.amount))
          ? Number(e.amount).toFixed(2)
          : '';
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
              : e.type === 'limit'
                ? 'Лимит входов'
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
  const { selectedId, states, tableBetLogsMap } =
    await getFocusedBetLogsSnapshot();

  if (!selectedId) {
    await sset({ betLogs: [] });
    renderBetAll([]);
    return;
  }

  const nextStates = { ...states };
  const nextTableBetLogsMap =
    tableBetLogsMap && typeof tableBetLogsMap === 'object'
      ? { ...tableBetLogsMap }
      : {};

  if (
    nextStates[selectedId] &&
    typeof nextStates[selectedId] === 'object'
  ) {
    nextStates[selectedId] = {
      ...nextStates[selectedId],
      betLogs: [],
    };
  }

  nextTableBetLogsMap[selectedId] = [];

  await sset({
    [TRACKED_TABLE_STATES_KEY]: nextStates,
    [TRACKED_TABLE_BET_LOGS_KEY]: nextTableBetLogsMap,
  });

  renderBetAll([]);
}
