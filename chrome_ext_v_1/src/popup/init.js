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
  lowhighStreakInp,
  evenoddStreakInp,
  colorsStreakInp,
  // ✅ NEW:
  sectorsStreakInp,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,
  lowhighZeroCk,
  evenoddZeroCk,
  colorsZeroCk,
  // ✅ NEW:
  sectorsZeroCk,
  btnSaveAll,
  dznStepsBox,
  rowStepsBox,
  sixStepsBox,
  threesStepsBox,
  lowhighStepsBox,
  evenoddStepsBox,
  colorsStepsBox,
  // ✅ NEW:
  sectorsStepsBox,
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
  if (autoCk)
    autoCk.addEventListener('change', () => debouncedSave());

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

function addBlankStep(box) {
  addStep(box);
}

export function wireInitHandlers() {
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
  document
    .getElementById('btnAddLowHighStep')
    ?.addEventListener('click', () => addBlankStep(lowhighStepsBox));
  document
    .getElementById('btnAddEvenOddStep')
    ?.addEventListener('click', () => addBlankStep(evenoddStepsBox));
  document
    .getElementById('btnAddColorsStep')
    ?.addEventListener('click', () => addBlankStep(colorsStepsBox));

  // ✅ NEW
  document
    .getElementById('btnAddSectorsStep')
    ?.addEventListener('click', () => addBlankStep(sectorsStepsBox));

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

  // ✅ NEW
  document
    .getElementById('btnCfgSectorsDefaults')
    ?.addEventListener('click', () =>
      renderSteps(sectorsStepsBox, DEFAULT_MKT.steps)
    );

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
  document
    .getElementById('btnCfgLowHighSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('lowhigh'));
  document
    .getElementById('btnCfgEvenOddSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('evenodd'));
  document
    .getElementById('btnCfgColorsSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('colors'));

  // ✅ NEW
  document
    .getElementById('btnCfgSectorsSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('sectors'));

  btnExport.addEventListener('click', exportCSV);
  btnClear.addEventListener('click', clearLogs);
  if (btnBetExport)
    btnBetExport.addEventListener('click', exportBetCSV);
  if (btnBetClear)
    btnBetClear.addEventListener('click', clearBetLogs);

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

  document
    .getElementById('toggleTrack')
    .addEventListener('change', (e) => setToggle(e.target.checked));

  dozensStreakInp.addEventListener('input', updateDotsFromState);
  rowsStreakInp.addEventListener('input', updateDotsFromState);
  sixStreakInp.addEventListener('input', updateDotsFromState);
  threesStreakInp.addEventListener('input', updateDotsFromState);

  dozensZeroCk?.addEventListener('change', updateDotsFromState);
  rowsZeroCk?.addEventListener('change', updateDotsFromState);
  sixZeroCk?.addEventListener('change', updateDotsFromState);
  threesZeroCk?.addEventListener('change', updateDotsFromState);

  lowhighStreakInp?.addEventListener('input', updateDotsFromState);
  evenoddStreakInp?.addEventListener('input', updateDotsFromState);
  colorsStreakInp?.addEventListener('input', updateDotsFromState);
  lowhighZeroCk?.addEventListener('change', updateDotsFromState);
  evenoddZeroCk?.addEventListener('change', updateDotsFromState);
  colorsZeroCk?.addEventListener('change', updateDotsFromState);

  // ✅ NEW
  sectorsStreakInp?.addEventListener('input', updateDotsFromState);
  sectorsZeroCk?.addEventListener('change', updateDotsFromState);

  btnSaveAll.addEventListener('click', async () => {
    await saveGlobalChipsFromUI();
    await saveMarketCfgFromUI('dozens');
    await saveMarketCfgFromUI('rows');
    await saveMarketCfgFromUI('six');
    await saveMarketCfgFromUI('threes');
    await saveMarketCfgFromUI('lowhigh');
    await saveMarketCfgFromUI('evenodd');
    await saveMarketCfgFromUI('colors');
    // ✅ NEW
    await saveMarketCfgFromUI('sectors');
  });

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

  // ✅ NEW
  wireAutoSaveForMarket('sectors', {
    streakInp: sectorsStreakInp,
    autoCk: document.getElementById('sectorsAutoContinue'),
    zeroCk: document.getElementById('sectorsIncludeZero'),
    stepsBox: sectorsStepsBox,
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
        // ✅ NEW
        sectors: {
          en: 'autoBettingSectorsEnabled',
          ex: 'betExecSectors',
          st: 'bettingStatusSectors',
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

  chrome.storage.onChanged.addEventListener?.(() => {});
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.entryCounters) renderCounters();
    if (ch.abMaxEntriesPerMarket) {
      const v = Number(ch.abMaxEntriesPerMarket.newValue || 0) | 0;
      if (maxEntriesInp) maxEntriesInp.value = String(v);
    }
  });

  refreshEntryLimitUI();
  wireMarketTogglesReset();
}
