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

  // NEW: anti-dozens
  antidozensStreakInp,
  lowhighStreakInp,
  evenoddStreakInp,
  colorsStreakInp,
  sectorsStreakInp,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,

  // NEW: anti-dozens
  antidozensZeroCk,
  lowhighZeroCk,
  evenoddZeroCk,
  colorsZeroCk,
  sectorsZeroCk,
  btnSaveAll,
  dznStepsBox,
  rowStepsBox,
  sixStepsBox,
  threesStepsBox,

  // NEW: anti-dozens
  antiDznStepsBox,
  lowhighStepsBox,
  evenoddStepsBox,
  colorsStepsBox,
  sectorsStepsBox,
  inpPattern,

  // neighbors
  neighborsStepsBox,
  autoBetToggleNeighbors,
  betStatusNeighbors,
} from './dom.js';

import { exportCSV, clearLogs } from './spin-logs.js';
import { exportBetCSV, clearBetLogs } from './bet-logs.js';
import { addPattern } from './domains.js';
import { updateDotsFromState } from './streaks.js';
import { setToggle } from './toggle.js';

import {
  saveMarketCfgFromUI,
  DEFAULT_MKT,
  DEFAULT_NEIGHBORS,
  CFG_NEIGHBORS_KEY,
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
    // steps-ui.js should dispatch steps:changed; keep both for safety
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

export function wireInitHandlers() {
  // ===== Add step buttons (ONLY HERE, nowhere else) =====
  document
    .getElementById('btnAddDznStep')
    ?.addEventListener('click', () => addStep(dznStepsBox));

  // NEW: anti-dozens
  document
    .getElementById('btnAddAntiDznStep')
    ?.addEventListener('click', () => addStep(antiDznStepsBox));

  document
    .getElementById('btnAddRowStep')
    ?.addEventListener('click', () => addStep(rowStepsBox));
  document
    .getElementById('btnAddSixStep')
    ?.addEventListener('click', () => addStep(sixStepsBox));
  document
    .getElementById('btnAddThreesStep')
    ?.addEventListener('click', () => addStep(threesStepsBox));
  document
    .getElementById('btnAddLowHighStep')
    ?.addEventListener('click', () => addStep(lowhighStepsBox));
  document
    .getElementById('btnAddEvenOddStep')
    ?.addEventListener('click', () => addStep(evenoddStepsBox));
  document
    .getElementById('btnAddColorsStep')
    ?.addEventListener('click', () => addStep(colorsStepsBox));
  document
    .getElementById('btnAddSectorsStep')
    ?.addEventListener('click', () => addStep(sectorsStepsBox));
  document
    .getElementById('btnAddNeighborsStep')
    ?.addEventListener('click', () => addStep(neighborsStepsBox));

  // ===== Defaults buttons =====
  document
    .getElementById('btnCfgDznDefaults')
    ?.addEventListener('click', () =>
      renderSteps(dznStepsBox, DEFAULT_MKT.steps)
    );

  // NEW: anti-dozens
  document
    .getElementById('btnCfgAntiDznDefaults')
    ?.addEventListener('click', () =>
      renderSteps(antiDznStepsBox, DEFAULT_MKT.steps)
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
  document
    .getElementById('btnCfgSectorsDefaults')
    ?.addEventListener('click', () =>
      renderSteps(sectorsStepsBox, DEFAULT_MKT.steps)
    );

  document
    .getElementById('btnCfgNeighborsDefaults')
    ?.addEventListener('click', async () => {
      try {
        await chrome.storage.local.set({
          [CFG_NEIGHBORS_KEY]: DEFAULT_NEIGHBORS,
        });
      } catch {}
      renderSteps(neighborsStepsBox, DEFAULT_NEIGHBORS.steps);
      const msg = document.getElementById('cfgNeighborsMsg');
      if (msg) msg.textContent = 'Defaults loaded';
    });

  // ===== Save buttons =====
  document
    .getElementById('btnCfgDznSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('dozens'));

  // NEW: anti-dozens
  document
    .getElementById('btnCfgAntiDznSave')
    ?.addEventListener('click', () =>
      saveMarketCfgFromUI('antidozens')
    );

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
  document
    .getElementById('btnCfgSectorsSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('sectors'));
  document
    .getElementById('btnCfgNeighborsSave')
    ?.addEventListener('click', () =>
      saveMarketCfgFromUI('neighbors')
    );

  // ===== Export / clear logs =====
  btnExport?.addEventListener('click', exportCSV);
  btnClear?.addEventListener('click', clearLogs);
  btnBetExport?.addEventListener('click', exportBetCSV);
  btnBetClear?.addEventListener('click', clearBetLogs);

  // ===== Domains =====
  btnAddPattern?.addEventListener('click', () =>
    addPattern(inpPattern.value)
  );
  btnAddCurrent?.addEventListener('click', async () => {
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

  // ===== Master tracking toggle =====
  document
    .getElementById('toggleTrack')
    ?.addEventListener('change', (e) => setToggle(e.target.checked));

  // ===== Dots updates =====
  dozensStreakInp?.addEventListener('input', updateDotsFromState);
  rowsStreakInp?.addEventListener('input', updateDotsFromState);
  sixStreakInp?.addEventListener('input', updateDotsFromState);
  threesStreakInp?.addEventListener('input', updateDotsFromState);

  // NEW: anti-dozens
  antidozensStreakInp?.addEventListener('input', updateDotsFromState);

  lowhighStreakInp?.addEventListener('input', updateDotsFromState);
  evenoddStreakInp?.addEventListener('input', updateDotsFromState);
  colorsStreakInp?.addEventListener('input', updateDotsFromState);
  sectorsStreakInp?.addEventListener('input', updateDotsFromState);

  dozensZeroCk?.addEventListener('change', updateDotsFromState);
  rowsZeroCk?.addEventListener('change', updateDotsFromState);
  sixZeroCk?.addEventListener('change', updateDotsFromState);
  threesZeroCk?.addEventListener('change', updateDotsFromState);

  // NEW: anti-dozens
  antidozensZeroCk?.addEventListener('change', updateDotsFromState);

  lowhighZeroCk?.addEventListener('change', updateDotsFromState);
  evenoddZeroCk?.addEventListener('change', updateDotsFromState);
  colorsZeroCk?.addEventListener('change', updateDotsFromState);
  sectorsZeroCk?.addEventListener('change', updateDotsFromState);

  // ===== Save all =====
  btnSaveAll?.addEventListener('click', async () => {
    await saveGlobalChipsFromUI();
    await saveMarketCfgFromUI('dozens');
    await saveMarketCfgFromUI('antidozens'); // NEW
    await saveMarketCfgFromUI('rows');
    await saveMarketCfgFromUI('six');
    await saveMarketCfgFromUI('threes');
    await saveMarketCfgFromUI('lowhigh');
    await saveMarketCfgFromUI('evenodd');
    await saveMarketCfgFromUI('colors');
    await saveMarketCfgFromUI('sectors');
    await saveMarketCfgFromUI('neighbors');
  });

  // ===== Auto-save wiring =====
  wireAutoSaveForMarket('dozens', {
    streakInp: dozensStreakInp,
    autoCk: document.getElementById('dozensAutoContinue'),
    zeroCk: document.getElementById('dozensIncludeZero'),
    stepsBox: dznStepsBox,
  });

  // NEW: anti-dozens
  wireAutoSaveForMarket('antidozens', {
    streakInp: antidozensStreakInp,
    autoCk: document.getElementById('antidozensAutoContinue'),
    zeroCk: document.getElementById('antidozensIncludeZero'),
    stepsBox: antiDznStepsBox,
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

  wireAutoSaveForMarket('sectors', {
    streakInp: sectorsStreakInp,
    autoCk: document.getElementById('sectorsAutoContinue'),
    zeroCk: document.getElementById('sectorsIncludeZero'),
    stepsBox: sectorsStepsBox,
  });

  // neighbors: steps only
  wireAutoSaveForMarket('neighbors', { stepsBox: neighborsStepsBox });

  // neighbors: instant ON/OFF UI (so it doesn't lie until a bet happens)
  autoBetToggleNeighbors?.addEventListener('change', async () => {
    const checked = !!autoBetToggleNeighbors.checked;
    try {
      await chrome.storage.local.set({
        autoBettingNeighborsEnabled: checked,
        bettingStatusNeighbors: checked
          ? { state: 'idle', message: 'ON (жду спин)' }
          : { state: 'off', message: '' },
      });
    } catch {}

    if (betStatusNeighbors) {
      betStatusNeighbors.textContent = checked
        ? '[IDLE] ON (жду спин)'
        : '[OFF]';
    }
  });

  // ===== ENTRY LIMIT UI =====
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
    if (!markets.length) {
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
