export const TRACKED_TABLES_KEY = 'trackedTables';
export const TRACKED_TABLE_STATES_KEY = 'trackedTableStates';
export const TRACKED_TABLE_BET_LOGS_KEY =
  'trackedTableBetLogsByTable';
export const SELECTED_TRACKED_TABLE_KEY = 'selectedTrackedTableId';
export const UI_TRACKED_TABLES_OPEN_KEY = 'uiTrackedTablesOpen';

export const DEFAULT_TRACKED_TABLE = Object.freeze({
  id: '',
  title: '',
  normTitle: '',
  enabled: true,
  chipMode: 'global', // 'global' | 'custom'
  customChipTpl: '',
  customChips: [],
});

export function normalizeTitle(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function slugifyTitle(value) {
  const base = String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .trim();

  return base || 'table';
}

export function makeTrackedTableId(title, existingIds = []) {
  const used = new Set(
    Array.isArray(existingIds) ? existingIds.filter(Boolean) : [],
  );
  const base = slugifyTitle(title);
  if (!used.has(base)) return base;

  let i = 2;
  while (used.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function normalizeChipValues(values) {
  const arr = Array.isArray(values) ? values : [];
  const out = [];

  for (const raw of arr) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push(Math.round(n * 100) / 100);
  }

  return out;
}

export function sanitizeTrackedTable(raw, opts = {}) {
  const src = raw || {};
  const title = String(src.title ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const normTitle = normalizeTitle(title);

  const existingIds = Array.isArray(opts.existingIds)
    ? opts.existingIds
    : [];
  const fallbackId = opts.fallbackId || '';
  const id =
    String(src.id || '').trim() ||
    fallbackId ||
    makeTrackedTableId(title || 'table', existingIds);

  const chipMode = src.chipMode === 'custom' ? 'custom' : 'global';

  return {
    id,
    title,
    normTitle,
    enabled: src.enabled !== false,
    chipMode,
    customChipTpl: String(src.customChipTpl ?? '').trim(),
    customChips: normalizeChipValues(src.customChips),
  };
}

export function sanitizeTrackedTables(list) {
  const src = Array.isArray(list) ? list : [];
  const out = [];
  const usedIds = new Set();

  for (const item of src) {
    const clean = sanitizeTrackedTable(item, {
      existingIds: Array.from(usedIds),
    });
    if (!clean.title) continue;
    if (usedIds.has(clean.id)) continue;
    usedIds.add(clean.id);
    out.push(clean);
  }

  return out;
}

export function sanitizeTrackedTableStates(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw
    : {};
}

export function sanitizeTrackedTableBetLogsMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const out = {};
  for (const [tableId, logs] of Object.entries(raw)) {
    out[String(tableId)] = Array.isArray(logs) ? logs.slice() : [];
  }
  return out;
}

export function getTrackedTableState(states, tableId) {
  const map = sanitizeTrackedTableStates(states);
  return map[tableId] || null;
}

export function getTrackedTableBalanceValue(state) {
  if (!state || typeof state !== 'object') return null;

  const candidates = [
    state?.balance?.value,
    state?.currentBalance?.value,
    state?.balance,
    state?.currentBalance,
  ];

  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

export function getTrackedTableSpinLogs(state) {
  const arr = state?.spinLogs;
  return Array.isArray(arr) ? arr : [];
}

export function getTrackedTableBetLogs(state) {
  const arr = state?.betLogs;
  return Array.isArray(arr) ? arr : [];
}

export function getTrackedTableBetLogsById(
  tableBetLogsMap,
  tableId,
  fallbackState = null,
) {
  const map = sanitizeTrackedTableBetLogsMap(tableBetLogsMap);

  if (
    tableId &&
    Object.prototype.hasOwnProperty.call(map, tableId) &&
    Array.isArray(map[tableId])
  ) {
    return map[tableId];
  }

  return getTrackedTableBetLogs(fallbackState);
}

export function getTrackedTableStatus(state) {
  if (state?.status && typeof state.status === 'object') {
    return state.status;
  }
  return { state: 'off', message: '' };
}

export function getTrackedTableMatchedTitle(state) {
  return String(
    state?.matchedTitle ??
      state?.currentTitle ??
      state?.domTitle ??
      '',
  ).trim();
}

export function getTrackedTableLeaderText(state) {
  const leader = state?.leader;
  if (!leader || typeof leader !== 'object') return '—';

  const tabId =
    leader.tabId != null ? `tab ${leader.tabId}` : 'tab ?';
  const frameId =
    leader.frameId != null ? `frame ${leader.frameId}` : 'frame ?';

  return `${tabId}, ${frameId}`;
}

export function getLiveBadge(statusState) {
  switch (statusState) {
    case 'ok':
      return { text: 'LIVE', cls: 'live-badge ok' };
    case 'waiting':
      return { text: 'WAIT', cls: 'live-badge waiting' };
    case 'standby':
      return { text: 'STANDBY', cls: 'live-badge standby' };
    case 'error':
      return { text: 'ERROR', cls: 'live-badge error' };
    default:
      return { text: 'OFF', cls: 'live-badge off' };
  }
}

export function fmtMoney(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

export function fmtTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  try {
    return new Date(n).toLocaleString();
  } catch {
    return String(value);
  }
}

export function countUniqueLeft(logs) {
  const arr = Array.isArray(logs) ? logs : [];
  const seen = new Set();

  for (const item of arr) {
    const n = Number(item?.n);
    if (Number.isInteger(n) && n >= 0 && n <= 36) {
      seen.add(n);
    }
  }

  return 37 - seen.size;
}
