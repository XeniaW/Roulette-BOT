// src/popup.js
import { loadStatus } from './popup/status.js';
import { loadDomains } from './popup/domains.js';
import { loadLogs, renderAll } from './popup/spin-logs.js';
import { loadBetLogs, renderBetAll } from './popup/bet-logs.js';
import { loadMarketUI } from './popup/markets.js';
import {
  updateDotsFromState,
  setLatestSpins,
  setCurrStreakState,
} from './popup/streaks.js';
import { loadToggle } from './popup/toggle.js';
import { loadGlobalChipsUI } from './popup/chips.js';
import { wireInitHandlers } from './popup/init.js';
import './popup/live.js';

document.addEventListener('DOMContentLoaded', async () => {
  await loadGlobalChipsUI();
  loadStatus();
  loadDomains();
  loadLogs((logs) => {
    setLatestSpins(logs);
    renderAll(logs);
  });
  loadBetLogs(renderBetAll);

  await loadMarketUI('dozens');
  await loadMarketUI('rows');
  await loadMarketUI('combo');
  await loadMarketUI('six');
  await loadMarketUI('threes');

  await loadToggle();

  const { sget } = await import('./popup/utils.js');
  const DEFAULT_STREAK = {
    dozens: { count: 0, idx: null },
    rows: { count: 0, idx: null },
    combo: { count: 0, d: null, r: null },
  };
  const { streakState = DEFAULT_STREAK, spinLogs = [] } = await sget({
    streakState: DEFAULT_STREAK,
    spinLogs: [],
  });
  setCurrStreakState(streakState || DEFAULT_STREAK);
  setLatestSpins(Array.isArray(spinLogs) ? spinLogs : []);
  updateDotsFromState();

  wireInitHandlers();
});
