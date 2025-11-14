// src/popup/init.js
import {
  btnExport,
  btnClear,
  btnBetExport,
  btnBetClear,
  btnAddPattern,
  btnAddCurrent,
  dozensStreakInp,
  rowsStreakInp,
  sixStreakInp,
  threesStreakInp,
  // NEW:
  lowhighStreakInp,
  evenoddStreakInp,
  colorsStreakInp,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,
  // NEW:
  lowhighZeroCk,
  evenoddZeroCk,
  colorsZeroCk,
  btnSaveAll,
  dznStepsBox,
  rowStepsBox,
  sixStepsBox,
  threesStepsBox,
  // NEW:
  lowhighStepsBox,
  evenoddStepsBox,
  colorsStepsBox,
  inpPattern,
} from './dom.js';
import { exportCSV, clearLogs } from './spin-logs.js';
import { exportBetCSV, clearBetLogs } from './bet-logs.js';
import { addPattern } from './domains.js';
import { updateDotsFromState } from './streaks.js';
import { setToggle } from './toggle.js';
import {
  saveMarketCfgFromUI,
  DEFAULT_MKT,
  wireMarketTogglesReset,
} from './markets.js';
import { renderSteps, addStep } from './steps-ui.js';
import { saveGlobalChipsFromUI } from './chips.js';
import {
  setGlobalMaxEntries,
  getGlobalMaxEntries,
  resetAllCounters,
  getAllCounters,
} from '../shared/entry-limit.js';

function debounce(fn, ms = 200) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// автосохранение по изм. контролов рынка
function wireAutoSaveForMarket(
  market,
  { streakInp, autoCk, zeroCk, stepsBox }
) {
  const debouncedSave = debounce(
    () => saveMarketCfgFromUI(market),
    200
  );

  if (streakInp) {
    streakInp.addEventListener('input', () => {
      updateDotsFromState();
      debouncedSave();
    });
  }
  if (autoCk) {
    autoCk.addEventListener('change', () => debouncedSave());
  }
  if (zeroCk) {
    zeroCk.addEventListener('change', () => {
      updateDotsFromState();
      debouncedSave();
    });
  }
  if (stepsBox) {
    stepsBox.addEventListener('steps:changed', () => debouncedSave());
    stepsBox.addEventListener('input', () => debouncedSave());
    stepsBox.addEventListener('click', (e) => {
      const btn = e.target?.closest(
        '.btn-del-item,.btn-del-step,.btn-add-item'
      );
      if (btn) debouncedSave();
    });
  }
}

// Добавление пустого шага (не стирает существующие)
function addBlankStep(box) {
  addStep(box);
}

export function wireInitHandlers() {
  // Steps add
  document
    .getElementById('btnAddDznStep')
    ?.addEventListener('click', () => addBlankStep(dznStepsBox));
  document
    .getElementById('btnAddRowStep')
    ?.addEventListener('click', () => addBlankStep(rowStepsBox));
  document
    .getElementById('btnAddSixStep')
    ?.addEventListener('click', () => addBlankStep(sixStepsBox));
  document
    .getElementById('btnAddThreesStep')
    ?.addEventListener('click', () => addBlankStep(threesStepsBox));
  // NEW:
  document
    .getElementById('btnAddLowHighStep')
    ?.addEventListener('click', () => addBlankStep(lowhighStepsBox));
  document
    .getElementById('btnAddEvenOddStep')
    ?.addEventListener('click', () => addBlankStep(evenoddStepsBox));
  document
    .getElementById('btnAddColorsStep')
    ?.addEventListener('click', () => addBlankStep(colorsStepsBox));

  // Defaults
  document
    .getElementById('btnCfgDznDefaults')
    ?.addEventListener('click', () =>
      renderSteps(dznStepsBox, DEFAULT_MKT.steps)
    );
  document
    .getElementById('btnCfgRowDefaults')
    ?.addEventListener('click', () =>
      renderSteps(rowStepsBox, DEFAULT_MKT.steps)
    );
  document
    .getElementById('btnCfgSixDefaults')
    ?.addEventListener('click', () =>
      renderSteps(sixStepsBox, DEFAULT_MKT.steps)
    );
  document
    .getElementById('btnCfgThreesDefaults')
    ?.addEventListener('click', () =>
      renderSteps(threesStepsBox, DEFAULT_MKT.steps)
    );
  // NEW:
  document
    .getElementById('btnCfgLowHighDefaults')
    ?.addEventListener('click', () =>
      renderSteps(lowhighStepsBox, DEFAULT_MKT.steps)
    );
  document
    .getElementById('btnCfgEvenOddDefaults')
    ?.addEventListener('click', () =>
      renderSteps(evenoddStepsBox, DEFAULT_MKT.steps)
    );
  document
    .getElementById('btnCfgColorsDefaults')
    ?.addEventListener('click', () =>
      renderSteps(colorsStepsBox, DEFAULT_MKT.steps)
    );

  // Save buttons
  document
    .getElementById('btnCfgDznSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('dozens'));
  document
    .getElementById('btnCfgRowSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('rows'));
  document
    .getElementById('btnCfgSixSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('six'));
  document
    .getElementById('btnCfgThreesSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('threes'));
  // NEW:
  document
    .getElementById('btnCfgLowHighSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('lowhigh'));
  document
    .getElementById('btnCfgEvenOddSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('evenodd'));
  document
    .getElementById('btnCfgColorsSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('colors'));

  // Export/Clear
  btnExport.addEventListener('click', exportCSV);
  btnClear.addEventListener('click', clearLogs);
  if (btnBetExport)
    btnBetExport.addEventListener('click', exportBetCSV);
  if (btnBetClear)
    btnBetClear.addEventListener('click', clearBetLogs);

  // Domains
  btnAddPattern.addEventListener('click', () =>
    addPattern(inpPattern.value)
  );
  btnAddCurrent.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) return;
    try {
      const u = new URL(tab.url);
      addPattern(`${u.origin}/*`);
    } catch {}
  });

  // Tracking toggle
  document
    .getElementById('toggleTrack')
    .addEventListener('change', (e) => setToggle(e.target.checked));

  // Dots (мгновенный пересчёт при ручных изменениях)
  dozensStreakInp.addEventListener('input', updateDotsFromState);
  rowsStreakInp.addEventListener('input', updateDotsFromState);
  sixStreakInp.addEventListener('input', updateDotsFromState);
  threesStreakInp.addEventListener('input', updateDotsFromState);
  dozensZeroCk?.addEventListener('change', updateDotsFromState);
  rowsZeroCk?.addEventListener('change', updateDotsFromState);
  sixZeroCk?.addEventListener('change', updateDotsFromState);
  threesZeroCk?.addEventListener('change', updateDotsFromState);
  // NEW:
  lowhighStreakInp?.addEventListener('input', updateDotsFromState);
  evenoddStreakInp?.addEventListener('input', updateDotsFromState);
  colorsStreakInp?.addEventListener('input', updateDotsFromState);
  lowhighZeroCk?.addEventListener('change', updateDotsFromState);
  evenoddZeroCk?.addEventListener('change', updateDotsFromState);
  colorsZeroCk?.addEventListener('change', updateDotsFromState);

  // SAVE ALL
  btnSaveAll.addEventListener('click', async () => {
    await saveGlobalChipsFromUI();
    await saveMarketCfgFromUI('dozens');
    await saveMarketCfgFromUI('rows');
    await saveMarketCfgFromUI('six');
    await saveMarketCfgFromUI('threes');
    // NEW:
    await saveMarketCfgFromUI('lowhigh');
    await saveMarketCfgFromUI('evenodd');
    await saveMarketCfgFromUI('colors');
  });

  // Автосохранение рынков (streak + includeZero + autoContinue + steps)
  wireAutoSaveForMarket('dozens', {
    streakInp: dozensStreakInp,
    autoCk: document.getElementById('dozensAutoContinue'),
    zeroCk: document.getElementById('dozensIncludeZero'),
    stepsBox: dznStepsBox,
  });
  wireAutoSaveForMarket('rows', {
    streakInp: rowsStreakInp,
    autoCk: document.getElementById('rowsAutoContinue'),
    zeroCk: document.getElementById('rowsIncludeZero'),
    stepsBox: rowStepsBox,
  });
  wireAutoSaveForMarket('six', {
    streakInp: sixStreakInp,
    autoCk: document.getElementById('sixAutoContinue'),
    zeroCk: document.getElementById('sixIncludeZero'),
    stepsBox: sixStepsBox,
  });
  wireAutoSaveForMarket('threes', {
    streakInp: threesStreakInp,
    autoCk: document.getElementById('threesAutoContinue'),
    zeroCk: document.getElementById('threesIncludeZero'),
    stepsBox: threesStepsBox,
  });
  // NEW:
  wireAutoSaveForMarket('lowhigh', {
    streakInp: lowhighStreakInp,
    autoCk: document.getElementById('lowhighAutoContinue'),
    zeroCk: document.getElementById('lowhighIncludeZero'),
    stepsBox: lowhighStepsBox,
  });
  wireAutoSaveForMarket('evenodd', {
    streakInp: evenoddStreakInp,
    autoCk: document.getElementById('evenoddAutoContinue'),
    zeroCk: document.getElementById('evenoddIncludeZero'),
    stepsBox: evenoddStepsBox,
  });
  wireAutoSaveForMarket('colors', {
    streakInp: colorsStreakInp,
    autoCk: document.getElementById('colorsAutoContinue'),
    zeroCk: document.getElementById('colorsIncludeZero'),
    stepsBox: colorsStepsBox,
  });

  // ==== ENTRY LIMIT UI ====
  const maxEntriesInp = document.getElementById('maxEntries');
  const btnSaveMaxEntries = document.getElementById(
    'btnSaveMaxEntries'
  );
  const btnResetEntryCounters = document.getElementById(
    'btnResetEntryCounters'
  );
  const entryLimitMsg = document.getElementById('entryLimitMsg');
  const entryCountersList = document.getElementById(
    'entryCountersList'
  );

  async function renderCounters() {
    if (!entryCountersList) return;
    const counters = (await getAllCounters()) || {};
    const markets = Object.keys(counters).sort();
    if (markets.length === 0) {
      entryCountersList.innerHTML = '<li>—</li>';
      return;
    }
    entryCountersList.innerHTML = markets
      .map((m) => `<li>${m}: ${Number(counters[m] || 0)}</li>`)
      .join('');
  }

  async function refreshEntryLimitUI() {
    try {
      const max = await getGlobalMaxEntries();
      if (maxEntriesInp) maxEntriesInp.value = String(max);
    } catch {}
    await renderCounters();
  }

  btnSaveMaxEntries?.addEventListener('click', async () => {
    const v = Number(maxEntriesInp?.value ?? 0) | 0;
    const max = Math.max(0, v);
    await setGlobalMaxEntries(max);

    // НЕМЕДЛЕННОЕ ПРИМЕНЕНИЕ
    if (max > 0) {
      const counters = (await getAllCounters()) || {};
      const MAP = {
        dozens: {
          en: 'autoBettingDozensEnabled',
          ex: 'betExecDozens',
          st: 'bettingStatusDozens',
        },
        rows: {
          en: 'autoBettingRowsEnabled',
          ex: 'betExecRows',
          st: 'bettingStatusRows',
        },
        six: {
          en: 'autoBettingSixEnabled',
          ex: 'betExecSix',
          st: 'bettingStatusSix',
        },
        threes: {
          en: 'autoBettingThreesEnabled',
          ex: 'betExecThrees',
          st: 'bettingStatusThrees',
        },
        // NEW:
        lowhigh: {
          en: 'autoBettingLowHighEnabled',
          ex: 'betExecLowHigh',
          st: 'bettingStatusLowHigh',
        },
        evenodd: {
          en: 'autoBettingEvenOddEnabled',
          ex: 'betExecEvenOdd',
          st: 'bettingStatusEvenOdd',
        },
        colors: {
          en: 'autoBettingColorsEnabled',
          ex: 'betExecColors',
          st: 'bettingStatusColors',
        },
      };
      const toDisable = Object.keys(counters).filter(
        (m) => (counters[m] | 0) >= max
      );
      for (const m of toDisable) {
        const meta = MAP[m];
        if (!meta) continue;
        try {
          await chrome.storage.local.set({
            [meta.en]: false,
            [meta.ex]: {
              enabled: false,
              phase: 'idle',
              target: null,
              step: 1,
              armedAt: 0,
            },
          });
        } catch {}
      }
    }

    if (entryLimitMsg) {
      entryLimitMsg.textContent = `Лимит сохранён: ${max}.`;
      setTimeout(() => (entryLimitMsg.textContent = ''), 2000);
    }
  });

  btnResetEntryCounters?.addEventListener('click', async () => {
    await resetAllCounters();
    await renderCounters();
    if (entryLimitMsg) {
      entryLimitMsg.textContent = 'Счётчики входов сброшены.';
      setTimeout(() => (entryLimitMsg.textContent = ''), 2000);
    }
  });

  // лайв-обновления от storage
  chrome.storage.onChanged.addEventListener?.(() => {}); // no-op for MV3 safety
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.entryCounters) renderCounters();
    if (ch.abMaxEntriesPerMarket) {
      const v = Number(ch.abMaxEntriesPerMarket.newValue || 0) | 0;
      if (maxEntriesInp) maxEntriesInp.value = String(v);
    }
  });

  // первичная подгрузка для Entry limit
  refreshEntryLimitUI();

  // Авто-бет тумблеры
  wireMarketTogglesReset();
}
