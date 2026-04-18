// src/shared/entry-limit.js
const KEY_COUNTERS = 'entryCounters';
const KEY_GLOBAL_MAX = 'abMaxEntriesPerMarket';
const KEY_BETLOGS = 'betLogs'; // legacy/global fallback
const TRACKED_TABLE_BET_LOGS_KEY = 'trackedTableBetLogsByTable';
const BETLOGS_MAX = 2000;

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

async function readCounters() {
  const { [KEY_COUNTERS]: obj = {} } = await sget({
    [KEY_COUNTERS]: {},
  });
  return obj && typeof obj === 'object' && !Array.isArray(obj)
    ? obj
    : {};
}

async function writeCounters(obj) {
  await sset({ [KEY_COUNTERS]: obj || {} });
}

async function getTrackedTableIdForThisTab() {
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'GET_TRACKED_TABLE_FOR_TAB',
    });
    const id = String(res?.tableId || '').trim();
    return res?.matched && id ? id : '';
  } catch {
    return '';
  }
}

function mkStatusOffMessage(max) {
  return `Отключено: достигнут лимит входов (${max})`;
}

function mkExecReset(prevExec) {
  const keep =
    prevExec &&
    typeof prevExec === 'object' &&
    !Array.isArray(prevExec)
      ? prevExec
      : {};

  return {
    ...keep,
    enabled: false,
    phase: 'idle',
    target: null,
    step: 1,
    armedAt: 0,
  };
}

function sanitizeBetLogsMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const out = {};
  for (const [tableId, logs] of Object.entries(raw)) {
    out[String(tableId)] = Array.isArray(logs) ? logs.slice() : [];
  }
  return out;
}

async function pushLegacyBetLog(entry) {
  try {
    const bag = await sget({ [KEY_BETLOGS]: [] });
    const betLogs = Array.isArray(bag[KEY_BETLOGS])
      ? bag[KEY_BETLOGS].slice()
      : [];

    betLogs.push(entry);
    if (betLogs.length > BETLOGS_MAX) {
      betLogs.splice(0, betLogs.length - BETLOGS_MAX);
    }

    await sset({ [KEY_BETLOGS]: betLogs });
  } catch {}
}

async function pushTrackedTableBetLog(tableId, entry) {
  if (!tableId) return;

  try {
    const bag = await sget({
      [TRACKED_TABLE_BET_LOGS_KEY]: {},
    });

    const map = sanitizeBetLogsMap(bag[TRACKED_TABLE_BET_LOGS_KEY]);
    const logs = Array.isArray(map[tableId])
      ? map[tableId].slice()
      : [];

    logs.push(entry);
    if (logs.length > BETLOGS_MAX) {
      logs.splice(0, logs.length - BETLOGS_MAX);
    }

    map[tableId] = logs;
    await sset({ [TRACKED_TABLE_BET_LOGS_KEY]: map });
  } catch {}
}

async function pushBetLog(entry, opts = {}) {
  const tableId =
    String(opts.tableId || '').trim() ||
    (await getTrackedTableIdForThisTab());

  await Promise.allSettled([
    pushLegacyBetLog(entry),
    pushTrackedTableBetLog(tableId, entry),
  ]);
}

function isExecMapByTable(execKey, prevValue, opts = {}) {
  if (typeof opts.execByTable === 'boolean') {
    return opts.execByTable;
  }

  if (String(execKey || '').endsWith('ByTable')) {
    return true;
  }

  if (
    prevValue &&
    typeof prevValue === 'object' &&
    !Array.isArray(prevValue)
  ) {
    const values = Object.values(prevValue);
    if (
      values.length > 0 &&
      values.every(
        (v) =>
          v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          ('phase' in v || 'enabled' in v || 'step' in v),
      )
    ) {
      return true;
    }
  }

  return false;
}

async function resetExecState(execKey, opts = {}) {
  if (!execKey) return;

  try {
    const bag = await sget({ [execKey]: null });
    const prevValue = bag[execKey];
    const byTable = isExecMapByTable(execKey, prevValue, opts);

    if (byTable) {
      const tableId =
        String(opts.tableId || '').trim() ||
        (await getTrackedTableIdForThisTab());

      if (!tableId) return;

      const map =
        prevValue &&
        typeof prevValue === 'object' &&
        !Array.isArray(prevValue)
          ? { ...prevValue }
          : {};

      map[tableId] = mkExecReset(map[tableId]);
      await sset({ [execKey]: map });
      return;
    }

    await sset({ [execKey]: mkExecReset(prevValue) });
  } catch {}
}

export async function setGlobalMaxEntries(n) {
  const max = Math.max(0, Number(n) | 0);
  await sset({ [KEY_GLOBAL_MAX]: max });
  return max;
}

export async function getGlobalMaxEntries() {
  const { [KEY_GLOBAL_MAX]: max = 0 } = await sget({
    [KEY_GLOBAL_MAX]: 0,
  });
  return Math.max(0, Number(max) | 0);
}

/**
 * Гейт ВХОДА (на шаг 1).
 * При достижении лимита:
 *  - выключает рынок (enabledKey=false),
 *  - сбрасывает exec (если передан execKey),
 *  - пишет statusKey в storage,
 *  - пишет запись в betLogs,
 *  - возвращает false.
 *
 * opts:
 *  - overrideMax: number
 *  - execKey: string
 *  - execByTable: boolean   // optional; auto-detected if omitted
 *  - tableId: string        // optional; auto-detected if omitted
 */
export async function entryGateFor(
  marketKey,
  enabledKey,
  statusKey,
  opts = {},
) {
  const counters = await readCounters();
  const curr = Math.max(0, Number(counters[marketKey] || 0) | 0);

  const globalMax = await getGlobalMaxEntries();
  const max = Math.max(0, Number(opts.overrideMax ?? globalMax) | 0);

  if (max > 0 && curr >= max) {
    try {
      await sset({ [enabledKey]: false });
    } catch {}

    if (opts.execKey) {
      await resetExecState(opts.execKey, opts);
    }

    try {
      await sset({
        [statusKey]: {
          state: 'off',
          message: mkStatusOffMessage(max),
        },
      });
    } catch {}

    await pushBetLog(
      {
        t: Date.now(),
        type: 'limit',
        market: marketKey,
        message: `Отключено лимитом входов (${max})`,
      },
      opts,
    );

    return false;
  }

  counters[marketKey] = curr + 1;
  await writeCounters(counters);
  return true;
}

// === UI helpers ===
export async function getAllCounters() {
  return await readCounters();
}

export async function setAllCounters(obj) {
  const next = obj && typeof obj === 'object' ? obj : {};
  await writeCounters(next);
}

export async function resetCounter(marketKey) {
  const counters = await readCounters();
  if (marketKey in counters) {
    delete counters[marketKey];
    await writeCounters(counters);
  }
}

export async function resetAllCounters() {
  await writeCounters({});
}
