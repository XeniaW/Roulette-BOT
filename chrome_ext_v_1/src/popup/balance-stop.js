// src/popup/balance-stop.js
import { sget, sset } from './utils.js';

const CFG_KEY = 'abBalanceStopConfig';
const STATE_KEY = 'abBalanceStopState';

const DEFAULT_CFG = Object.freeze({
  stopOnMin: false,
  minBalance: 40,
  stopOnMax: false,
  maxBalance: 100,
});

function sanitizeCfg(raw) {
  const cfg = raw || {};

  let minBalance = Number(cfg.minBalance);
  let maxBalance = Number(cfg.maxBalance);

  if (!Number.isFinite(minBalance) || minBalance < 0) {
    minBalance = DEFAULT_CFG.minBalance;
  }
  if (!Number.isFinite(maxBalance) || maxBalance < 0) {
    maxBalance = DEFAULT_CFG.maxBalance;
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

function renderLiveState({
  currentBalance,
  stopState,
  liveEl,
  currentEl,
}) {
  if (currentEl) {
    currentEl.textContent =
      currentBalance != null ? fmtMoney(currentBalance) : '—';
  }

  if (!liveEl) return;

  if (stopState?.triggered) {
    liveEl.textContent =
      stopState.message || 'Stopped by balance guard';
    liveEl.className = 'small error-text';
    return;
  }

  if (currentBalance != null) {
    liveEl.textContent = `Current balance: ${fmtMoney(currentBalance)}`;
    liveEl.className = 'small muted';
    return;
  }

  liveEl.textContent = 'Current balance: —';
  liveEl.className = 'small muted';
}

export async function loadBalanceStopUI() {
  const minEnabledEl = document.getElementById('balanceStopOnMin');
  const minEl = document.getElementById('balanceStopMin');
  const maxEnabledEl = document.getElementById('balanceStopOnMax');
  const maxEl = document.getElementById('balanceStopMax');
  const saveBtn = document.getElementById('btnSaveBalanceStop');
  const msgEl = document.getElementById('balanceStopMsg');
  const liveEl = document.getElementById('balanceStopLive');
  const currentEl = document.getElementById('balanceStopCurrent');

  if (
    !minEnabledEl ||
    !minEl ||
    !maxEnabledEl ||
    !maxEl ||
    !saveBtn
  ) {
    return;
  }

  const {
    [CFG_KEY]: rawCfg = DEFAULT_CFG,
    [STATE_KEY]: stopState = null,
    currentBalance = null,
  } = await sget({
    [CFG_KEY]: DEFAULT_CFG,
    [STATE_KEY]: null,
    currentBalance: null,
  });

  const cfg = sanitizeCfg(rawCfg);
  const currentVal =
    currentBalance && Number.isFinite(Number(currentBalance.value))
      ? Number(currentBalance.value)
      : null;

  minEnabledEl.checked = cfg.stopOnMin;
  minEl.value = String(cfg.minBalance);
  maxEnabledEl.checked = cfg.stopOnMax;
  maxEl.value = String(cfg.maxBalance);

  renderLiveState({
    currentBalance: currentVal,
    stopState,
    liveEl,
    currentEl,
  });

  saveBtn.addEventListener('click', async () => {
    const next = sanitizeCfg({
      stopOnMin: minEnabledEl.checked,
      minBalance: Number(minEl.value),
      stopOnMax: maxEnabledEl.checked,
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

    await sset({
      [CFG_KEY]: next,
      [STATE_KEY]: null,
    });

    if (msgEl) {
      msgEl.textContent =
        `Saved: min ${next.stopOnMin ? fmtMoney(next.minBalance) : 'off'}, ` +
        `max ${next.stopOnMax ? fmtMoney(next.maxBalance) : 'off'}`;
      msgEl.className = 'small muted';
    }
  });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;

    let nextBalance = currentVal;
    let nextStopState = stopState;

    if (ch.currentBalance) {
      const v = ch.currentBalance.newValue;
      nextBalance =
        v && Number.isFinite(Number(v.value))
          ? Number(v.value)
          : null;
    }

    if (ch[STATE_KEY]) {
      nextStopState = ch[STATE_KEY].newValue || null;
    }

    if (ch.currentBalance || ch[STATE_KEY]) {
      renderLiveState({
        currentBalance: nextBalance,
        stopState: nextStopState,
        liveEl,
        currentEl,
      });
    }
  });
}
