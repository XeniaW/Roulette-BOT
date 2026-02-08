// src/popup/live.js
import { renderStatus } from './status.js';
import { appendNew, renderAll } from './spin-logs.js';
import { appendBetNew, renderBetAll } from './bet-logs.js';
import { loadDomains } from './domains.js';
import { sanitizeMkt, sanitizeNeighbors } from './markets.js';
import {
  betStatusDozens,
  betStatusRows,
  betStatusSix,
  betStatusThrees,

  // NEW: anti-dozens
  betStatusAntiDozens,

  // NEW (halves)
  betStatusLowHigh,
  betStatusEvenOdd,
  betStatusColors,

  // NEW (sectors)
  betStatusSectors,

  // neighbors
  betStatusNeighbors,
  dznStepsBox,
  rowStepsBox,
  sixStepsBox,
  threesStepsBox,

  // NEW: anti-dozens
  antiDznStepsBox,

  // NEW
  lowhighStepsBox,
  evenoddStepsBox,
  colorsStepsBox,
  sectorsStepsBox,
  dozensStreakInp,
  rowsStreakInp,
  sixStreakInp,
  threesStreakInp,

  // NEW: anti-dozens
  antidozensStreakInp,

  // NEW
  lowhighStreakInp,
  evenoddStreakInp,
  colorsStreakInp,
  sectorsStreakInp,
  dozensAutoCk,
  rowsAutoCk,
  sixAutoCk,
  threesAutoCk,

  // NEW: anti-dozens
  antidozensAutoCk,

  // NEW
  lowhighAutoCk,
  evenoddAutoCk,
  colorsAutoCk,
  sectorsAutoCk,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,

  // NEW: anti-dozens
  antidozensZeroCk,

  // NEW
  lowhighZeroCk,
  evenoddZeroCk,
  colorsZeroCk,
  sectorsZeroCk,
} from './dom.js';

import { renderSteps } from './steps-ui.js';
import {
  updateDotsFromState,
  setLatestSpins,
  setCurrStreakState,
  handleStorageChangeForStreaks,
} from './streaks.js';

function setStatusText(el, stObj) {
  const s = stObj || { state: 'off', message: '' };
  if (!el) return;
  el.textContent = `[${(s.state || 'off').toUpperCase()}] ${
    s.message || ''
  }`;
}

function setOnIfEnabled(el, enabled, stObj) {
  if (!el) return;
  const s = stObj || {};
  const hasMeaningful =
    s &&
    typeof s.state === 'string' &&
    s.state !== 'off' &&
    s.state !== '';
  if (enabled && !hasMeaningful) el.textContent = `[ON]`;
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;

  try {
    // === 1) СНАЧАЛА ОБНОВЛЯЕМ СПИН-ЛОГИ (критично для realtime) ===
    if (ch.spinLogs) {
      const { oldValue = [], newValue = [] } = ch.spinLogs;
      const arr = Array.isArray(newValue) ? newValue : [];
      setLatestSpins(arr);

      if (
        Array.isArray(newValue) &&
        newValue.length > oldValue.length
      ) {
        appendNew(newValue.slice(oldValue.length));
      } else {
        renderAll(arr);
      }
      updateDotsFromState();
    }

    // === 2) Остальные апдейты — максимально безопасно ===
    if (ch.trackingEnabled) {
      const tgl = document.getElementById('toggleTrack');
      if (tgl) tgl.checked = !!ch.trackingEnabled.newValue;
    }

    if (ch.trackerStatus) renderStatus(ch.trackerStatus.newValue);

    if (ch.betLogs) {
      const { oldValue = [], newValue = [] } = ch.betLogs;
      if (
        Array.isArray(newValue) &&
        newValue.length > oldValue.length
      )
        appendBetNew(newValue.slice(oldValue.length));
      else renderBetAll(Array.isArray(newValue) ? newValue : []);
    }

    if (ch.domains) loadDomains();

    // statuses from strategies
    if (ch.bettingStatusDozens)
      setStatusText(betStatusDozens, ch.bettingStatusDozens.newValue);
    if (ch.bettingStatusAntiDozens)
      setStatusText(
        betStatusAntiDozens,
        ch.bettingStatusAntiDozens.newValue
      );
    if (ch.bettingStatusRows)
      setStatusText(betStatusRows, ch.bettingStatusRows.newValue);
    if (ch.bettingStatusSix)
      setStatusText(betStatusSix, ch.bettingStatusSix.newValue);
    if (ch.bettingStatusThrees)
      setStatusText(betStatusThrees, ch.bettingStatusThrees.newValue);

    if (ch.bettingStatusLowHigh)
      setStatusText(
        betStatusLowHigh,
        ch.bettingStatusLowHigh.newValue
      );
    if (ch.bettingStatusEvenOdd)
      setStatusText(
        betStatusEvenOdd,
        ch.bettingStatusEvenOdd.newValue
      );
    if (ch.bettingStatusColors)
      setStatusText(betStatusColors, ch.bettingStatusColors.newValue);

    if (ch.bettingStatusSectors)
      setStatusText(
        betStatusSectors,
        ch.bettingStatusSectors.newValue
      );
    if (ch.bettingStatusNeighbors)
      setStatusText(
        betStatusNeighbors,
        ch.bettingStatusNeighbors.newValue
      );

    // show [ON] right after toggle on (before first status)
    if (ch.autoBettingLowHighEnabled) {
      const en = !!ch.autoBettingLowHighEnabled.newValue;
      const st =
        (ch.bettingStatusLowHigh &&
          ch.bettingStatusLowHigh.newValue) ||
        null;
      setOnIfEnabled(betStatusLowHigh, en, st);
    }
    if (ch.autoBettingEvenOddEnabled) {
      const en = !!ch.autoBettingEvenOddEnabled.newValue;
      const st =
        (ch.bettingStatusEvenOdd &&
          ch.bettingStatusEvenOdd.newValue) ||
        null;
      setOnIfEnabled(betStatusEvenOdd, en, st);
    }
    if (ch.autoBettingColorsEnabled) {
      const en = !!ch.autoBettingColorsEnabled.newValue;
      const st =
        (ch.bettingStatusColors && ch.bettingStatusColors.newValue) ||
        null;
      setOnIfEnabled(betStatusColors, en, st);
    }

    // configs sync
    if (ch.abDozensConfig) {
      const cfg = sanitizeMkt(ch.abDozensConfig.newValue);
      if (dozensStreakInp) dozensStreakInp.value = cfg.triggerStreak;
      if (dozensAutoCk) dozensAutoCk.checked = !!cfg.autoContinue;
      if (dozensZeroCk) dozensZeroCk.checked = !!cfg.includeZero;
      if (dznStepsBox) renderSteps(dznStepsBox, cfg.steps);
      updateDotsFromState();
    }

    // NEW: anti-dozens config
    if (ch.abAntiDozensConfig) {
      const cfg = sanitizeMkt(ch.abAntiDozensConfig.newValue);
      if (antidozensStreakInp)
        antidozensStreakInp.value = cfg.triggerStreak;
      if (antidozensAutoCk)
        antidozensAutoCk.checked = !!cfg.autoContinue;
      if (antidozensZeroCk)
        antidozensZeroCk.checked = !!cfg.includeZero;
      if (antiDznStepsBox) renderSteps(antiDznStepsBox, cfg.steps);
      updateDotsFromState();
    }

    if (ch.abRowsConfig) {
      const cfg = sanitizeMkt(ch.abRowsConfig.newValue);
      if (rowsStreakInp) rowsStreakInp.value = cfg.triggerStreak;
      if (rowsAutoCk) rowsAutoCk.checked = !!cfg.autoContinue;
      if (rowsZeroCk) rowsZeroCk.checked = !!cfg.includeZero;
      if (rowStepsBox) renderSteps(rowStepsBox, cfg.steps);
      updateDotsFromState();
    }

    if (ch.abSixConfig) {
      const cfg = sanitizeMkt(ch.abSixConfig.newValue);
      if (sixStreakInp) sixStreakInp.value = cfg.triggerStreak;
      if (sixAutoCk) sixAutoCk.checked = !!cfg.autoContinue;
      if (sixZeroCk) sixZeroCk.checked = !!cfg.includeZero;
      if (sixStepsBox) renderSteps(sixStepsBox, cfg.steps);
      updateDotsFromState();
    }

    if (ch.abThreesConfig) {
      const cfg = sanitizeMkt(ch.abThreesConfig.newValue);
      if (threesStreakInp) threesStreakInp.value = cfg.triggerStreak;
      if (threesAutoCk) threesAutoCk.checked = !!cfg.autoContinue;
      if (threesZeroCk) threesZeroCk.checked = !!cfg.includeZero;
      if (threesStepsBox) renderSteps(threesStepsBox, cfg.steps);
      updateDotsFromState();
    }

    if (ch.abLowHighConfig) {
      const cfg = sanitizeMkt(ch.abLowHighConfig.newValue);
      if (lowhighStreakInp)
        lowhighStreakInp.value = cfg.triggerStreak;
      if (lowhighAutoCk) lowhighAutoCk.checked = !!cfg.autoContinue;
      if (lowhighZeroCk) lowhighZeroCk.checked = !!cfg.includeZero;
      if (lowhighStepsBox) renderSteps(lowhighStepsBox, cfg.steps);
      updateDotsFromState();
    }

    if (ch.abEvenOddConfig) {
      const cfg = sanitizeMkt(ch.abEvenOddConfig.newValue);
      if (evenoddStreakInp)
        evenoddStreakInp.value = cfg.triggerStreak;
      if (evenoddAutoCk) evenoddAutoCk.checked = !!cfg.autoContinue;
      if (evenoddZeroCk) evenoddZeroCk.checked = !!cfg.includeZero;
      if (evenoddStepsBox) renderSteps(evenoddStepsBox, cfg.steps);
      updateDotsFromState();
    }

    if (ch.abColorsConfig) {
      const cfg = sanitizeMkt(ch.abColorsConfig.newValue);
      if (colorsStreakInp) colorsStreakInp.value = cfg.triggerStreak;
      if (colorsAutoCk) colorsAutoCk.checked = !!cfg.autoContinue;
      if (colorsZeroCk) colorsZeroCk.checked = !!cfg.includeZero;
      if (colorsStepsBox) renderSteps(colorsStepsBox, cfg.steps);
      updateDotsFromState();
    }

    if (ch.abSectorsConfig) {
      const cfg = sanitizeMkt(ch.abSectorsConfig.newValue);
      if (sectorsStreakInp)
        sectorsStreakInp.value = cfg.triggerStreak;
      if (sectorsAutoCk) sectorsAutoCk.checked = !!cfg.autoContinue;
      if (sectorsZeroCk) sectorsZeroCk.checked = !!cfg.includeZero;
      if (sectorsStepsBox) renderSteps(sectorsStepsBox, cfg.steps);
      updateDotsFromState();
    }

    // neighbors config (steps only)
    if (ch.abNeighborsConfig) {
      const cfg = sanitizeNeighbors(ch.abNeighborsConfig.newValue);
      // neighborsStepsBox here is not imported in this file by design; config UI is handled by loadMarketUI/init wiring
      // (если захочешь, могу добавить сюда тоже, но сейчас это не требуется)
      void cfg;
    }

    // streaks
    if (ch.streakState) {
      setCurrStreakState(ch.streakState.newValue);
      updateDotsFromState();
    }

    // системные сигналы от стратегий
    handleStorageChangeForStreaks(ch, area);
  } catch (e) {
    console.warn('[live:onChanged] suppressed error', e);
  }
});
