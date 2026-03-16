import { loadStatus } from './popup/status.js';
import { loadDomains } from './popup/domains.js';
import { loadLogs, renderAll } from './popup/spin-logs.js';
import { loadBetLogs, renderBetAll } from './popup/bet-logs.js';
import { loadMarketUI } from './popup/markets.js';
import { loadToggle } from './popup/toggle.js';
import { loadGlobalChipsUI } from './popup/chips.js';
import { wireInitHandlers } from './popup/init.js';
import './popup/live.js';

// streaks
import {
  setLatestSpins,
  setCurrStreakState,
  updateDotsFromState,
  handleStorageChangeForStreaks,
} from './popup/streaks.js';

const BALANCE_STOP_CFG_KEY = 'abBalanceStopConfig';
const BALANCE_STOP_STATE_KEY = 'abBalanceStopState';

const BALANCE_STOP_DEFAULTS = Object.freeze({
  stopOnMin: false,
  minBalance: 40,
  stopOnMax: false,
  maxBalance: 100,
});

let _utilsPromise = null;
function getUtils() {
  if (!_utilsPromise) {
    _utilsPromise = import('./popup/utils.js');
  }
  return _utilsPromise;
}

function sanitizeBalanceStopCfg(raw) {
  const cfg = raw || {};

  let minBalance = Number(cfg.minBalance);
  let maxBalance = Number(cfg.maxBalance);

  if (!Number.isFinite(minBalance) || minBalance < 0) {
    minBalance = BALANCE_STOP_DEFAULTS.minBalance;
  }
  if (!Number.isFinite(maxBalance) || maxBalance < 0) {
    maxBalance = BALANCE_STOP_DEFAULTS.maxBalance;
  }

  return {
    stopOnMin: !!cfg.stopOnMin,
    minBalance: Math.round(minBalance * 100) / 100,
    stopOnMax: !!cfg.stopOnMax,
    maxBalance: Math.round(maxBalance * 100) / 100,
  };
}

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function renderBalanceStopLive({
  currentValue,
  stopState,
  currentEl,
  liveEl,
}) {
  if (currentEl) {
    currentEl.textContent =
      currentValue != null ? fmtMoney(currentValue) : '—';
  }

  if (!liveEl) return;

  if (stopState?.triggered) {
    liveEl.textContent =
      stopState.message || 'Stopped by balance limit';
    liveEl.className = 'small error-text';
    return;
  }

  if (currentValue != null) {
    liveEl.textContent = `Current balance: ${fmtMoney(currentValue)}`;
    liveEl.className = 'small muted';
    return;
  }

  liveEl.textContent = 'Current balance: —';
  liveEl.className = 'small muted';
}

async function loadBalanceStopUI() {
  const minOnEl = document.getElementById('balanceStopOnMin');
  const minEl = document.getElementById('balanceStopMin');
  const maxOnEl = document.getElementById('balanceStopOnMax');
  const maxEl = document.getElementById('balanceStopMax');
  const saveBtn = document.getElementById('btnSaveBalanceStop');
  const msgEl = document.getElementById('balanceStopMsg');
  const liveEl = document.getElementById('balanceStopLive');
  const currentEl = document.getElementById('balanceStopCurrent');

  if (!minOnEl || !minEl || !maxOnEl || !maxEl || !saveBtn) {
    return;
  }

  const { sget, sset } = await getUtils();

  const {
    [BALANCE_STOP_CFG_KEY]: rawCfg = BALANCE_STOP_DEFAULTS,
    [BALANCE_STOP_STATE_KEY]: stopStateRaw = null,
    currentBalance = null,
  } = await sget({
    [BALANCE_STOP_CFG_KEY]: BALANCE_STOP_DEFAULTS,
    [BALANCE_STOP_STATE_KEY]: null,
    currentBalance: null,
  });

  let cfg = sanitizeBalanceStopCfg(rawCfg);
  let stopState = stopStateRaw || null;
  let currentValue =
    currentBalance && Number.isFinite(Number(currentBalance.value))
      ? Number(currentBalance.value)
      : null;

  minOnEl.checked = cfg.stopOnMin;
  minEl.value = String(cfg.minBalance);
  maxOnEl.checked = cfg.stopOnMax;
  maxEl.value = String(cfg.maxBalance);

  renderBalanceStopLive({
    currentValue,
    stopState,
    currentEl,
    liveEl,
  });

  saveBtn.addEventListener('click', async () => {
    const next = sanitizeBalanceStopCfg({
      stopOnMin: minOnEl.checked,
      minBalance: Number(minEl.value),
      stopOnMax: maxOnEl.checked,
      maxBalance: Number(maxEl.value),
    });

    if (
      next.stopOnMin &&
      next.stopOnMax &&
      next.maxBalance <= next.minBalance
    ) {
      if (msgEl) {
        msgEl.textContent =
          'Max balance must be greater than min balance';
        msgEl.className = 'small error-text';
      }
      return;
    }

    cfg = next;
    stopState = null;

    await sset({
      [BALANCE_STOP_CFG_KEY]: next,
      [BALANCE_STOP_STATE_KEY]: null,
    });

    if (msgEl) {
      msgEl.textContent =
        `Saved: min ${next.stopOnMin ? fmtMoney(next.minBalance) : 'off'}, ` +
        `max ${next.stopOnMax ? fmtMoney(next.maxBalance) : 'off'}`;
      msgEl.className = 'small muted';
    }

    renderBalanceStopLive({
      currentValue,
      stopState,
      currentEl,
      liveEl,
    });
  });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;

    let changed = false;

    if (ch.currentBalance) {
      const next = ch.currentBalance.newValue;
      currentValue =
        next && Number.isFinite(Number(next.value))
          ? Number(next.value)
          : null;
      changed = true;
    }

    if (ch[BALANCE_STOP_STATE_KEY]) {
      stopState = ch[BALANCE_STOP_STATE_KEY].newValue || null;
      changed = true;
    }

    if (ch[BALANCE_STOP_CFG_KEY]) {
      cfg = sanitizeBalanceStopCfg(ch[BALANCE_STOP_CFG_KEY].newValue);
      minOnEl.checked = cfg.stopOnMin;
      minEl.value = String(cfg.minBalance);
      maxOnEl.checked = cfg.stopOnMax;
      maxEl.value = String(cfg.maxBalance);
      changed = true;
    }

    if (changed) {
      renderBalanceStopLive({
        currentValue,
        stopState,
        currentEl,
        liveEl,
      });
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadGlobalChipsUI();

  // статус/домены/логи
  loadStatus();
  loadDomains();

  loadLogs((logs) => {
    setLatestSpins(Array.isArray(logs) ? logs : []);
    renderAll(logs);
    updateDotsFromState();
  });

  loadBetLogs(renderBetAll);

  // рынки
  await loadMarketUI('dozens');
  await loadMarketUI('rows');
  await loadMarketUI('six');
  await loadMarketUI('threes');

  // дополнительные рынки половин
  await loadMarketUI('lowhigh');
  await loadMarketUI('evenodd');
  await loadMarketUI('colors');

  // sectors
  await loadMarketUI('sectors');

  await loadMarketUI('neighbors');
  await loadMarketUI('antidozens');
  await loadMarketUI('antirows');
  await loadMarketUI('numbers');

  // главный тумблер
  await loadToggle();

  // balance stop UI
  await loadBalanceStopUI();

  // первичная подгрузка streakState + спины из стораджа
  const { sget } = await getUtils();
  const DEFAULT_STREAK = {
    dozens: { count: 0, idx: null },
    rows: { count: 0, idx: null },
  };
  const { streakState = DEFAULT_STREAK, spinLogs = [] } = await sget({
    streakState: DEFAULT_STREAK,
    spinLogs: [],
  });
  setCurrStreakState(streakState || DEFAULT_STREAK);
  setLatestSpins(Array.isArray(spinLogs) ? spinLogs : []);
  updateDotsFromState();

  // кнопки/хэндлеры
  wireInitHandlers();

  // ==== Живые обновления для лампочек ====
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;

    if (ch.spinLogs) {
      const next = Array.isArray(ch.spinLogs.newValue)
        ? ch.spinLogs.newValue
        : [];
      setLatestSpins(next);
      updateDotsFromState();
    }

    handleStorageChangeForStreaks(ch, area);

    if (ch.streakState) {
      setCurrStreakState(ch.streakState.newValue || DEFAULT_STREAK);
      updateDotsFromState();
    }
  });
});
