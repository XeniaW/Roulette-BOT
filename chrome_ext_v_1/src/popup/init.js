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
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,
  btnSaveAll,
  dznStepsBox,
  rowStepsBox,
  sixStepsBox,
  threesStepsBox,
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
import { renderSteps } from './steps-ui.js';
import { saveGlobalChipsFromUI } from './chips.js';

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
    autoCk.addEventListener('change', () => {
      debouncedSave();
    });
  }
  if (zeroCk) {
    zeroCk.addEventListener('change', () => {
      updateDotsFromState();
      debouncedSave();
    });
  }
  if (stepsBox) {
    // любое изменение в steps (добавление/удаление/правки) — событие из steps-ui
    stepsBox.addEventListener('steps:changed', () => debouncedSave());
    // на всякий случай ловим прямые input-ы (если кто-то вручную вставит поля)
    stepsBox.addEventListener('input', () => debouncedSave());
    stepsBox.addEventListener('click', (e) => {
      // кнопки add/remove уже триггерят steps:changed, но продублируем
      const btn = e.target?.closest(
        '.btn-del-item,.btn-del-step,.btn-add-item'
      );
      if (btn) debouncedSave();
    });
  }
}

function addBlankStep(box) {
  renderSteps(box, [[{ chip: 1, times: 1 }]]);
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

  // Save buttons (оставляем, но есть автосейв)
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

  // SAVE ALL (массовая кнопка)
  btnSaveAll.addEventListener('click', async () => {
    await saveGlobalChipsFromUI();
    await saveMarketCfgFromUI('dozens');
    await saveMarketCfgFromUI('rows');
    await saveMarketCfgFromUI('six');
    await saveMarketCfgFromUI('threes');
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

  // Авто-бет тумблеры — сохраняются в wireMarketTogglesReset()
  wireMarketTogglesReset();
}
