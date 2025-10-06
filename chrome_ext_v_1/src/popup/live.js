// src/popup/live.js
import { renderStatus } from './status.js';
import { appendNew, renderAll } from './spin-logs.js';
import { appendBetNew, renderBetAll } from './bet-logs.js';
import { loadDomains } from './domains.js';
import { sanitizeMkt } from './markets.js';
import {
  betStatusDozens,
  betStatusRows,
  betStatusCombo,
  betStatusSix,
  betStatusThrees,
  dznStepsBox,
  rowStepsBox,
  comboStepsBox,
  sixStepsBox,
  threesStepsBox,
  dozensStreakInp,
  rowsStreakInp,
  comboStreakInp,
  sixStreakInp,
  threesStreakInp,
  dozensAutoCk,
  rowsAutoCk,
  comboAutoCk,
  sixAutoCk,
  threesAutoCk,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,
} from './dom.js';
import { renderSteps } from './steps-ui.js';
import {
  updateDotsFromState,
  setLatestSpins,
  setCurrStreakState,
} from './streaks.js';

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;

  if (ch.trackingEnabled)
    document.getElementById('toggleTrack').checked =
      !!ch.trackingEnabled.newValue;
  if (ch.trackerStatus) renderStatus(ch.trackerStatus.newValue);

  if (ch.spinLogs) {
    const { oldValue = [], newValue = [] } = ch.spinLogs;
    const arr = Array.isArray(newValue) ? newValue : [];
    setLatestSpins(arr);
    if (Array.isArray(newValue) && newValue.length > oldValue.length)
      appendNew(newValue.slice(oldValue.length));
    else renderAll(arr);
    updateDotsFromState();
  }

  if (ch.betLogs) {
    const { oldValue = [], newValue = [] } = ch.betLogs;
    if (Array.isArray(newValue) && newValue.length > oldValue.length)
      appendBetNew(newValue.slice(oldValue.length));
    else renderBetAll(Array.isArray(newValue) ? newValue : []);
  }

  if (ch.domains) loadDomains();

  function updStatus(el, st) {
    const s = st || { state: 'off', message: '' };
    el.textContent = `[${(s.state || 'off').toUpperCase()}] ${
      s.message || ''
    }`;
  }
  if (ch.bettingStatusDozens)
    updStatus(betStatusDozens, ch.bettingStatusDozens.newValue);
  if (ch.bettingStatusRows)
    updStatus(betStatusRows, ch.bettingStatusRows.newValue);
  if (ch.bettingStatusCombo)
    updStatus(betStatusCombo, ch.bettingStatusCombo.newValue);
  if (ch.bettingStatusSix)
    updStatus(betStatusSix, ch.bettingStatusSix.newValue);
  if (ch.bettingStatusThrees)
    updStatus(betStatusThrees, ch.bettingStatusThrees.newValue);

  if (ch.abDozensConfig) {
    const cfg = sanitizeMkt(ch.abDozensConfig.newValue);
    dozensStreakInp.value = cfg.triggerStreak;
    dozensAutoCk.checked = !!cfg.autoContinue;
    if (dozensZeroCk) dozensZeroCk.checked = !!cfg.includeZero;
    renderSteps(dznStepsBox, cfg.steps);
    updateDotsFromState();
  }
  if (ch.abRowsConfig) {
    const cfg = sanitizeMkt(ch.abRowsConfig.newValue);
    rowsStreakInp.value = cfg.triggerStreak;
    rowsAutoCk.checked = !!cfg.autoContinue;
    if (rowsZeroCk) rowsZeroCk.checked = !!cfg.includeZero;
    renderSteps(rowStepsBox, cfg.steps);
    updateDotsFromState();
  }
  if (ch.abComboConfig) {
    const cfg = sanitizeMkt(ch.abComboConfig.newValue);
    comboStreakInp.value = cfg.triggerStreak;
    comboAutoCk.checked = !!cfg.autoContinue;
    renderSteps(comboStepsBox, cfg.steps);
    updateDotsFromState();
  }
  if (ch.abSixConfig) {
    const cfg = sanitizeMkt(ch.abSixConfig.newValue);
    sixStreakInp.value = cfg.triggerStreak;
    sixAutoCk.checked = !!cfg.autoContinue;
    if (sixZeroCk) sixZeroCk.checked = !!cfg.includeZero;
    renderSteps(sixStepsBox, cfg.steps);
    updateDotsFromState();
  }
  if (ch.abThreesConfig) {
    const cfg = sanitizeMkt(ch.abThreesConfig.newValue);
    threesStreakInp.value = cfg.triggerStreak;
    threesAutoCk.checked = !!cfg.autoContinue;
    if (threesZeroCk) threesZeroCk.checked = !!cfg.includeZero;
    renderSteps(threesStepsBox, cfg.steps);
    updateDotsFromState();
  }

  if (ch.streakState) {
    setCurrStreakState(ch.streakState.newValue);
    updateDotsFromState();
  }
});
