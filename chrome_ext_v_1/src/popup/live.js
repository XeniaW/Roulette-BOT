import { loadStatus } from './status.js';
import {
  appendNew,
  renderAll,
  formatTopNearTrigger,
} from './spin-logs.js';
import { appendBetNew, renderBetAll } from './bet-logs.js';
import { loadDomains } from './domains.js';
import {
  sanitizeMkt,
  sanitizeNeighbors,
  sanitizeNumbers,
} from './markets.js';
import {
  TRACKED_TABLES_KEY,
  TRACKED_TABLE_STATES_KEY,
  SELECTED_TRACKED_TABLE_KEY,
} from '../shared/tracked-tables.js';

import {
  betStatusDozens,
  betStatusRows,
  betStatusSix,
  betStatusThrees,
  betStatusAntiDozens,
  betStatusAntiRows,
  betStatusLowHigh,
  betStatusEvenOdd,
  betStatusColors,
  betStatusSectors,
  betStatusNeighbors,
  dznStepsBox,
  rowStepsBox,
  sixStepsBox,
  threesStepsBox,
  antiDznStepsBox,
  antiRowsStepsBox,
  lowhighStepsBox,
  evenoddStepsBox,
  colorsStepsBox,
  sectorsStepsBox,
  dozensStreakInp,
  rowsStreakInp,
  sixStreakInp,
  threesStreakInp,
  antidozensStreakInp,
  antirowsStreakInp,
  lowhighStreakInp,
  evenoddStreakInp,
  colorsStreakInp,
  sectorsStreakInp,
  dozensAutoCk,
  rowsAutoCk,
  sixAutoCk,
  threesAutoCk,
  antidozensAutoCk,
  antirowsAutoCk,
  lowhighAutoCk,
  evenoddAutoCk,
  colorsAutoCk,
  sectorsAutoCk,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,
  antidozensZeroCk,
  antirowsZeroCk,
  lowhighZeroCk,
  evenoddZeroCk,
  colorsZeroCk,
  sectorsZeroCk,
  betStatusNumbers,
  numbersStepsBox,
  numbersGapInp,
  numbersAutoCk,
  numbersNear,
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
  el.textContent = `[${(s.state || 'off').toUpperCase()}] ${s.message || ''}`;
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

let lastSpinLogs = [];

function updateNumbersNearUI(spinLogsArr) {
  if (!numbersNear) return;

  const tg = Number(numbersGapInp?.value || 0) | 0;
  if (tg <= 0) {
    numbersNear.textContent = '';
    return;
  }

  const txt = formatTopNearTrigger(spinLogsArr, tg, 5, 0.8);
  numbersNear.textContent = txt || '';
}

chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;

  try {
    if (ch.spinLogs) {
      const { oldValue = [], newValue = [] } = ch.spinLogs;
      const arr = Array.isArray(newValue) ? newValue : [];
      lastSpinLogs = arr;

      setLatestSpins(arr);

      if (
        Array.isArray(newValue) &&
        newValue.length > oldValue.length
      ) {
        appendNew(newValue.slice(oldValue.length), arr);
      } else {
        renderAll(arr);
      }

      updateDotsFromState();
      updateNumbersNearUI(arr);
    }

    if (
      ch.trackingEnabled ||
      ch.trackerStatus ||
      ch[TRACKED_TABLES_KEY] ||
      ch[TRACKED_TABLE_STATES_KEY] ||
      ch[SELECTED_TRACKED_TABLE_KEY]
    ) {
      loadStatus().catch(() => {});
    }

    if (ch.betLogs) {
      const { oldValue = [], newValue = [] } = ch.betLogs;
      if (
        Array.isArray(newValue) &&
        newValue.length > oldValue.length
      ) {
        appendBetNew(newValue.slice(oldValue.length));
      } else {
        renderBetAll(Array.isArray(newValue) ? newValue : []);
      }
    }

    if (ch.domains) loadDomains();

    if (ch.bettingStatusDozens)
      setStatusText(betStatusDozens, ch.bettingStatusDozens.newValue);
    if (ch.bettingStatusAntiDozens)
      setStatusText(
        betStatusAntiDozens,
        ch.bettingStatusAntiDozens.newValue,
      );
    if (ch.bettingStatusAntiRows)
      setStatusText(
        betStatusAntiRows,
        ch.bettingStatusAntiRows.newValue,
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
        ch.bettingStatusLowHigh.newValue,
      );
    if (ch.bettingStatusEvenOdd)
      setStatusText(
        betStatusEvenOdd,
        ch.bettingStatusEvenOdd.newValue,
      );
    if (ch.bettingStatusColors)
      setStatusText(betStatusColors, ch.bettingStatusColors.newValue);

    if (ch.bettingStatusSectors)
      setStatusText(
        betStatusSectors,
        ch.bettingStatusSectors.newValue,
      );
    if (ch.bettingStatusNeighbors)
      setStatusText(
        betStatusNeighbors,
        ch.bettingStatusNeighbors.newValue,
      );

    if (ch.bettingStatusNumbers)
      setStatusText(
        betStatusNumbers,
        ch.bettingStatusNumbers.newValue,
      );

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
    if (ch.autoBettingNumbersEnabled) {
      const en = !!ch.autoBettingNumbersEnabled.newValue;
      const st =
        (ch.bettingStatusNumbers &&
          ch.bettingStatusNumbers.newValue) ||
        null;
      setOnIfEnabled(betStatusNumbers, en, st);
    }

    if (ch.abDozensConfig) {
      const cfg = sanitizeMkt(ch.abDozensConfig.newValue);
      if (dozensStreakInp) dozensStreakInp.value = cfg.triggerStreak;
      if (dozensAutoCk) dozensAutoCk.checked = !!cfg.autoContinue;
      if (dozensZeroCk) dozensZeroCk.checked = !!cfg.includeZero;
      if (dznStepsBox) renderSteps(dznStepsBox, cfg.steps);
      updateDotsFromState();
    }

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

    if (ch.abAntiRowsConfig) {
      const cfg = sanitizeMkt(ch.abAntiRowsConfig.newValue);
      if (antirowsStreakInp)
        antirowsStreakInp.value = cfg.triggerStreak;
      if (antirowsAutoCk) antirowsAutoCk.checked = !!cfg.autoContinue;
      if (antirowsZeroCk) antirowsZeroCk.checked = !!cfg.includeZero;
      if (antiRowsStepsBox) renderSteps(antiRowsStepsBox, cfg.steps);
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

    if (ch.abNumbersConfig) {
      const cfg = sanitizeNumbers(ch.abNumbersConfig.newValue);
      if (numbersGapInp) numbersGapInp.value = cfg.triggerGap;
      if (numbersAutoCk) numbersAutoCk.checked = !!cfg.autoContinue;
      if (numbersStepsBox) renderSteps(numbersStepsBox, cfg.steps);
      updateNumbersNearUI(lastSpinLogs);
    }

    if (ch.abNeighborsConfig) {
      const cfg = sanitizeNeighbors(ch.abNeighborsConfig.newValue);
      void cfg;
    }

    if (ch.streakState) {
      setCurrStreakState(ch.streakState.newValue);
      updateDotsFromState();
    }

    handleStorageChangeForStreaks(ch, area);
  } catch (e) {
    console.warn('[live:onChanged] suppressed error', e);
  }
});
