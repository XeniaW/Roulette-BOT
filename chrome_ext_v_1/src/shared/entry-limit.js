// src/shared/entry-limit.js
const KEY_COUNTERS = 'entryCounters';
const KEY_GLOBAL_MAX = 'abMaxEntriesPerMarket';
const KEY_BETLOGS = 'betLogs';
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
  return obj && typeof obj === 'object' ? obj : {};
}

async function writeCounters(obj) {
  await sset({ [KEY_COUNTERS]: obj || {} });
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

function mkStatusOffMessage(max) {
  return `Отключено: достигнут лимит входов (${max})`;
}

function mkExecReset(prevExec) {
  // Сброс "по уму": базовые поля приводим к дефолту,
  // а неизвестные поля сохраняем (например activationIdx у Numbers).
  const keep =
    prevExec && typeof prevExec === 'object' ? prevExec : {};
  return {
    ...keep,
    enabled: false,
    phase: 'idle',
    target: null,
    step: 1,
    armedAt: 0,
  };
}

async function pushBetLog(entry) {
  try {
    const bag = await sget({ [KEY_BETLOGS]: [] });
    const betLogs = Array.isArray(bag[KEY_BETLOGS])
      ? bag[KEY_BETLOGS]
      : [];
    betLogs.push(entry);
    if (betLogs.length > BETLOGS_MAX)
      betLogs.splice(0, betLogs.length - BETLOGS_MAX);
    await sset({ [KEY_BETLOGS]: betLogs });
  } catch {}
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
 * @param {string} marketKey
 * @param {string} enabledKey
 * @param {string} statusKey
 * @param {object} [opts]
 * @param {number} [opts.overrideMax]  // локальный лимит рынка (если надо)
 * @param {string} [opts.execKey]      // например: 'betExecDozens'
 */
export async function entryGateFor(
  marketKey,
  enabledKey,
  statusKey,
  opts = {}
) {
  const counters = await readCounters();
  const curr = Math.max(0, Number(counters[marketKey] || 0) | 0);

  const globalMax = await getGlobalMaxEntries();
  const max = Math.max(0, Number(opts.overrideMax ?? globalMax) | 0);

  // лимит включен и достигнут
  if (max > 0 && curr >= max) {
    // 1) выключаем рынок
    try {
      await sset({ [enabledKey]: false });
    } catch {}

    // 2) сброс exec (если известен ключ)
    if (opts.execKey) {
      try {
        const bag = await sget({ [opts.execKey]: null });
        const prevExec = bag[opts.execKey];
        await sset({ [opts.execKey]: mkExecReset(prevExec) });
      } catch {}
    }

    // 3) статус в storage (чтобы popup/live увидели это без BET.setBetStatus)
    try {
      await sset({
        [statusKey]: {
          state: 'off',
          message: mkStatusOffMessage(max),
        },
      });
    } catch {}

    // 4) betLogs (одно событие, когда лимит сработал)
    await pushBetLog({
      t: Date.now(),
      type: 'limit',
      market: marketKey,
      message: `Отключено лимитом входов (${max})`,
    });

    return false;
  }

  // Разрешаем вход и инкрементируем счётчик
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
