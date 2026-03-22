import { sget } from './utils.js';
import {
  TRACKED_TABLES_KEY,
  TRACKED_TABLE_STATES_KEY,
  SELECTED_TRACKED_TABLE_KEY,
  sanitizeTrackedTables,
  sanitizeTrackedTableStates,
  getTrackedTableStatus,
} from '../shared/tracked-tables.js';

const statusEl = document.getElementById('status');
const statusMsg = document.getElementById('statusMsg');

function normalizePillState(state) {
  if (state === 'standby') return 'waiting';
  if (state === 'ok') return 'ok';
  if (state === 'waiting') return 'waiting';
  if (state === 'error') return 'error';
  return 'off';
}

function normalizeLabel(state) {
  if (state === 'standby') return 'STANDBY';
  if (state === 'ok') return 'OK';
  if (state === 'waiting') return 'WAITING';
  if (state === 'error') return 'ERROR';
  return 'OFF';
}

export function renderStatus(s) {
  const rawState = s?.state || 'off';
  const pillState = normalizePillState(rawState);
  const label = normalizeLabel(rawState);

  const msg =
    s?.message ||
    (rawState === 'off'
      ? 'Трекинг выключен'
      : rawState === 'waiting'
        ? 'Ожидаем таблицу...'
        : rawState === 'standby'
          ? 'Таблица в standby'
          : rawState === 'ok'
            ? 'Трекинг активен'
            : rawState === 'error'
              ? 'Ошибка трекинга'
              : '');

  if (statusEl) {
    statusEl.className = `status-pill ${pillState}`;
    statusEl.textContent = label;
  }
  if (statusMsg) {
    statusMsg.textContent = msg;
  }
}

function buildSummaryMessage({
  enabledCount,
  okCount,
  standbyCount,
  waitingCount,
  errorCount,
  focusTitle,
  focusStatus,
}) {
  const stats = `Tables ${enabledCount} · live ${okCount} · standby ${standbyCount} · wait ${waitingCount} · err ${errorCount}`;
  if (!focusTitle) return stats;

  const focusMsg = focusStatus?.message
    ? `${focusTitle}: ${focusStatus.message}`
    : focusTitle;

  return `${stats} · Focus: ${focusMsg}`;
}

export async function loadStatus() {
  const {
    trackingEnabled = false,
    [TRACKED_TABLES_KEY]: rawTables = [],
    [TRACKED_TABLE_STATES_KEY]: rawStates = {},
    [SELECTED_TRACKED_TABLE_KEY]: rawSelectedId = '',
    trackerStatus = { state: 'off', message: '' },
  } = await sget({
    trackingEnabled: false,
    [TRACKED_TABLES_KEY]: [],
    [TRACKED_TABLE_STATES_KEY]: {},
    [SELECTED_TRACKED_TABLE_KEY]: '',
    trackerStatus: { state: 'off', message: '' },
  });

  const tables = sanitizeTrackedTables(rawTables);
  const states = sanitizeTrackedTableStates(rawStates);
  const enabledTables = tables.filter((t) => t.enabled);

  if (!enabledTables.length) {
    renderStatus(
      trackingEnabled
        ? {
            state: 'waiting',
            message: 'Нет ни одной включённой tracked table',
          }
        : {
            state: 'off',
            message: 'Трекинг выключен',
          },
    );
    return;
  }

  let okCount = 0;
  let standbyCount = 0;
  let waitingCount = 0;
  let errorCount = 0;

  for (const table of enabledTables) {
    const st = getTrackedTableStatus(states[table.id]);
    const state = st?.state || 'off';

    if (state === 'ok') okCount++;
    else if (state === 'standby') standbyCount++;
    else if (state === 'waiting') waitingCount++;
    else if (state === 'error') errorCount++;
  }

  const selectedId = String(rawSelectedId || '').trim();
  const focusTable =
    enabledTables.find((t) => t.id === selectedId) ||
    enabledTables[0];
  const focusStatus = focusTable
    ? getTrackedTableStatus(states[focusTable.id])
    : null;

  if (!trackingEnabled) {
    renderStatus({
      state: 'off',
      message: buildSummaryMessage({
        enabledCount: enabledTables.length,
        okCount,
        standbyCount,
        waitingCount,
        errorCount,
        focusTitle: focusTable?.title || '',
        focusStatus,
      }),
    });
    return;
  }

  let overallState = 'off';
  if (okCount > 0) overallState = 'ok';
  else if (standbyCount > 0 || waitingCount > 0)
    overallState = 'waiting';
  else if (errorCount > 0) overallState = 'error';
  else if (trackerStatus?.state) overallState = trackerStatus.state;

  renderStatus({
    state: overallState,
    message: buildSummaryMessage({
      enabledCount: enabledTables.length,
      okCount,
      standbyCount,
      waitingCount,
      errorCount,
      focusTitle: focusTable?.title || '',
      focusStatus,
    }),
  });
}
