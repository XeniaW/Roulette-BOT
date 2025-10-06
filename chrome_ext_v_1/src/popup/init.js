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
  comboStreakInp,
  sixStreakInp,
  threesStreakInp,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,
  btnSaveAll,
} from './dom.js';
import { exportCSV, clearLogs } from './spin-logs.js';
import { exportBetCSV, clearBetLogs } from './bet-logs.js';
import { addPattern } from './domains.js';
import { updateDotsFromState } from './streaks.js';
import { setToggle } from './toggle.js';
import { saveMarketCfgFromUI } from './markets.js';
import { saveGlobalChipsFromUI } from './chips.js';
import {
  dznStepsBox,
  rowStepsBox,
  comboStepsBox,
  sixStepsBox,
  threesStepsBox,
} from './dom.js';
import { renderSteps } from './steps-ui.js';
import { DEFAULT_MKT, wireMarketTogglesReset } from './markets.js';

function addBlankStep(box) {
  renderSteps(box, [[{ chip: 1, times: 1 }]]);
}

export function wireInitHandlers() {
  document
    .getElementById('btnAddDznStep')
    ?.addEventListener('click', () => addBlankStep(dznStepsBox));
  document
    .getElementById('btnAddRowStep')
    ?.addEventListener('click', () => addBlankStep(rowStepsBox));
  document
    .getElementById('btnAddComboStep')
    ?.addEventListener('click', () => addBlankStep(comboStepsBox));
  document
    .getElementById('btnAddSixStep')
    ?.addEventListener('click', () => addBlankStep(sixStepsBox));
  document
    .getElementById('btnAddThreesStep')
    ?.addEventListener('click', () => addBlankStep(threesStepsBox));

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
    .getElementById('btnCfgComboDefaults')
    ?.addEventListener('click', () =>
      renderSteps(comboStepsBox, DEFAULT_MKT.steps)
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
    .getElementById('btnCfgDznSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('dozens'));
  document
    .getElementById('btnCfgRowSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('rows'));
  document
    .getElementById('btnCfgComboSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('combo'));
  document
    .getElementById('btnCfgSixSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('six'));
  document
    .getElementById('btnCfgThreesSave')
    ?.addEventListener('click', () => saveMarketCfgFromUI('threes'));

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
  comboStreakInp.addEventListener('input', updateDotsFromState);
  sixStreakInp.addEventListener('input', updateDotsFromState);
  threesStreakInp.addEventListener('input', updateDotsFromState);

  dozensZeroCk?.addEventListener('change', updateDotsFromState);
  rowsZeroCk?.addEventListener('change', updateDotsFromState);
  sixZeroCk?.addEventListener('change', updateDotsFromState);
  threesZeroCk?.addEventListener('change', updateDotsFromState);

  btnSaveAll.addEventListener('click', async () => {
    await saveGlobalChipsFromUI();
    await saveMarketCfgFromUI('dozens');
    await saveMarketCfgFromUI('rows');
    await saveMarketCfgFromUI('combo');
    await saveMarketCfgFromUI('six');
    await saveMarketCfgFromUI('threes');
  });

  wireMarketTogglesReset();
}
