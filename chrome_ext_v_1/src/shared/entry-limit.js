// src/shared/entry-limit.js
const KEY_COUNTERS = 'entryCounters';
const KEY_GLOBAL_MAX = 'abMaxEntriesPerMarket';

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

/**
 * Гейт ВХОДА (на шаг 1).
 * При достижении лимита:
 *  - выключает рынок (enabled=false),
 *  - СБРАСЫВАЕТ exec (если передан execKey),
 *  - пишет статус,
 *  - пишет запись в betLogs,
 *  - возвращает false.
 *
 * @param {string} marketKey
 * @param {string} enabledKey
 * @param {string} statusKey
 * @param {object} [opts]
 * @param {number} [opts.overrideMax]
 * @param {string} [opts.execKey]   // например: 'betExecDozens'
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

  if (max > 0 && curr >= max) {
    // выключаем рынок
    try {
      await chrome.storage.local.set({ [enabledKey]: false });
    } catch {}

    // сброс exec (если известен ключ)
    if (opts.execKey) {
      try {
        await chrome.storage.local.set({
          [opts.execKey]: {
            enabled: false,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
          },
        });
      } catch {}
    }

    // лог и статус
    try {
      const bag = await sget({ betLogs: [] });
      const betLogs = Array.isArray(bag.betLogs) ? bag.betLogs : [];
      betLogs.push({
        t: Date.now(),
        type: 'limit',
        market: marketKey,
        message: `Отключено лимитом входов (${max})`,
      });
      if (betLogs.length > 2000)
        betLogs.splice(0, betLogs.length - 2000);
      await sset({ betLogs });
    } catch {}

    try {
      // если функция доступна в контексте
      if (typeof BET !== 'undefined' && BET.setBetStatus) {
        BET.setBetStatus(
          statusKey,
          'off',
          `Отключено: достигнут лимит входов (${max})`
        );
      }
    } catch {}

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
