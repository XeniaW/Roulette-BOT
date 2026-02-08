// src/popup.js
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

  // NEW: дополнительные рынки половин
  await loadMarketUI('lowhigh');
  await loadMarketUI('evenodd');
  await loadMarketUI('colors');

  // ✅ NEW: sectors (racetrack)
  await loadMarketUI('sectors');

  await loadMarketUI('neighbors');

  // главный тумблер
  await loadToggle();

  // первичная подгрузка streakState + спины из стораджа
  const { sget } = await import('./popup/utils.js');
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

  // ==== Живые обновления для лампочек (постепенно) ====
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
