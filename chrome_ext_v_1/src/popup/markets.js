// src/popup/markets.js
import { sget, sset } from './utils.js';
import {
  // streak inputs
  dozensStreakInp,
  rowsStreakInp,
  sixStreakInp,
  threesStreakInp,
  lowhighStreakInp,
  evenoddStreakInp,
  colorsStreakInp,

  // checkboxes (auto-continue)
  dozensAutoCk,
  rowsAutoCk,
  sixAutoCk,
  threesAutoCk,
  lowhighAutoCk,
  evenoddAutoCk,
  colorsAutoCk,

  // checkboxes (include zero)
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,
  lowhighZeroCk,
  evenoddZeroCk,
  colorsZeroCk,

  // toggles
  autoBetToggleDozens,
  autoBetToggleRows,
  autoBetToggleSix,
  autoBetToggleThrees,
  autoBetToggleLowHigh,
  autoBetToggleEvenOdd,
  autoBetToggleColors,

  // steps boxes
  dznStepsBox,
  rowStepsBox,
  sixStepsBox,
  threesStepsBox,
  lowhighStepsBox,
  evenoddStepsBox,
  colorsStepsBox,

  // cfg messages
  cfgDznMsg,
  cfgRowMsg,
  cfgSixMsg,
  cfgThreesMsg,
  cfgLowHighMsg,
  cfgEvenOddMsg,
  cfgColorsMsg,

  // bet status output spans (for initial render only)
  betStatusDozens,
  betStatusRows,
  betStatusSix,
  betStatusThrees,
  betStatusLowHigh,
  betStatusEvenOdd,
  betStatusColors,
} from './dom.js';

import { renderSteps, getStepsFromUI, addStep } from './steps-ui.js';
import { DEFAULT_CHIPS, GLOBAL_CHIPS_KEY } from './chips.js';
import { resetStreakDots, updateDotsFromState } from './streaks.js';

// === CFG keys (storage) ===
export const CFG_DZN_KEY = 'abDozensConfig';
export const CFG_ROW_KEY = 'abRowsConfig';
export const CFG_SIX_KEY = 'abSixConfig';
export const CFG_THREES_KEY = 'abThreesConfig';
// NEW:
export const CFG_LOWHIGH_KEY = 'abLowHighConfig';
export const CFG_EVENODD_KEY = 'abEvenOddConfig';
export const CFG_COLORS_KEY = 'abColorsConfig';

// === Default market config ===
export const DEFAULT_MKT = Object.freeze({
  triggerStreak: 2,
  autoContinue: false,
  includeZero: true,
  steps: [
    [{ chip: 1, times: 1 }],
    [{ chip: 1, times: 3 }],
    [{ chip: 2, times: 2 }],
    [
      { chip: 3, times: 1 },
      { chip: 2, times: 1 },
    ],
  ],
});

export function sanitizeMkt(raw) {
  const src = raw || {};
  const triggerStreak = Math.max(
    2,
    Math.floor(Number(src.triggerStreak ?? DEFAULT_MKT.triggerStreak))
  );
  const autoContinue = !!(
    src.autoContinue ?? DEFAULT_MKT.autoContinue
  );
  const includeZero = !!(src.includeZero ?? DEFAULT_MKT.includeZero);
  let steps = Array.isArray(src.steps)
    ? src.steps
    : DEFAULT_MKT.steps;

  steps = steps
    .map((st) => (Array.isArray(st) ? st : []))
    .map((st) =>
      st.map((it) => ({
        chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
        times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
      }))
    )
    .map((st) =>
      st.filter(
        (it) => Number.isFinite(it.chip) && Number.isFinite(it.times)
      )
    )
    .filter((st) => st.length);

  if (!steps.length)
    steps = JSON.parse(JSON.stringify(DEFAULT_MKT.steps));
  return { triggerStreak, steps, autoContinue, includeZero };
}

function findAddStepBtn(stepsBox, market) {
  return (
    stepsBox?.parentElement?.querySelector('.btn-add-step') ||
    stepsBox
      ?.closest('.market-card')
      ?.querySelector('.btn-add-step') ||
    document.querySelector(
      `[data-market="${market}"] .btn-add-step`
    ) ||
    document.querySelector(`#market-${market} .btn-add-step`)
  );
}

/** Отрисовка/подписка UI для заданного рынка */
export async function loadMarketUI(market) {
  let cfgKey,
    enKey,
    statusKey,
    streakInp,
    autoCk,
    zeroCk,
    toggle,
    stepsBox,
    msgEl,
    statusElDest;

  if (market === 'dozens') {
    cfgKey = CFG_DZN_KEY;
    enKey = 'autoBettingDozensEnabled';
    statusKey = 'bettingStatusDozens';
    streakInp = dozensStreakInp;
    autoCk = dozensAutoCk;
    zeroCk = dozensZeroCk;
    toggle = autoBetToggleDozens;
    stepsBox = dznStepsBox;
    msgEl = cfgDznMsg;
    statusElDest = betStatusDozens;
  } else if (market === 'rows') {
    cfgKey = CFG_ROW_KEY;
    enKey = 'autoBettingRowsEnabled';
    statusKey = 'bettingStatusRows';
    streakInp = rowsStreakInp;
    autoCk = rowsAutoCk;
    zeroCk = rowsZeroCk;
    toggle = autoBetToggleRows;
    stepsBox = rowStepsBox;
    msgEl = cfgRowMsg;
    statusElDest = betStatusRows;
  } else if (market === 'six') {
    cfgKey = CFG_SIX_KEY;
    enKey = 'autoBettingSixEnabled';
    statusKey = 'bettingStatusSix';
    streakInp = sixStreakInp;
    autoCk = sixAutoCk;
    zeroCk = sixZeroCk;
    toggle = autoBetToggleSix;
    stepsBox = sixStepsBox;
    msgEl = cfgSixMsg;
    statusElDest = betStatusSix;
  } else if (market === 'threes') {
    cfgKey = CFG_THREES_KEY;
    enKey = 'autoBettingThreesEnabled';
    statusKey = 'bettingStatusThrees';
    streakInp = threesStreakInp;
    autoCk = threesAutoCk;
    zeroCk = threesZeroCk;
    toggle = autoBetToggleThrees;
    stepsBox = threesStepsBox;
    msgEl = cfgThreesMsg;
    statusElDest = betStatusThrees;
  } else if (market === 'lowhigh') {
    cfgKey = CFG_LOWHIGH_KEY;
    enKey = 'autoBettingLowHighEnabled';
    statusKey = 'bettingStatusLowHigh';
    streakInp = lowhighStreakInp;
    autoCk = lowhighAutoCk;
    zeroCk = lowhighZeroCk;
    toggle = autoBetToggleLowHigh;
    stepsBox = lowhighStepsBox;
    msgEl = cfgLowHighMsg;
    statusElDest = betStatusLowHigh;
  } else if (market === 'evenodd') {
    cfgKey = CFG_EVENODD_KEY;
    enKey = 'autoBettingEvenOddEnabled';
    statusKey = 'bettingStatusEvenOdd';
    streakInp = evenoddStreakInp;
    autoCk = evenoddAutoCk;
    zeroCk = evenoddZeroCk;
    toggle = autoBetToggleEvenOdd;
    stepsBox = evenoddStepsBox;
    msgEl = cfgEvenOddMsg;
    statusElDest = betStatusEvenOdd;
  } else if (market === 'colors') {
    cfgKey = CFG_COLORS_KEY;
    enKey = 'autoBettingColorsEnabled';
    statusKey = 'bettingStatusColors';
    streakInp = colorsStreakInp;
    autoCk = colorsAutoCk;
    zeroCk = colorsZeroCk;
    toggle = autoBetToggleColors;
    stepsBox = colorsStepsBox;
    msgEl = cfgColorsMsg;
    statusElDest = betStatusColors;
  } else {
    return;
  }

  // начальные значения enabled + статус
  const st = await sget({
    [enKey]: false,
    [statusKey]: { state: 'off', message: '' },
  });
  if (toggle) toggle.checked = !!st[enKey];
  const stat = st[statusKey] || { state: 'off', message: '' };
  if (statusElDest)
    statusElDest.textContent = `[${(
      stat.state || 'off'
    ).toUpperCase()}] ${stat.message || ''}`;

  // конфиг
  const cfg = sanitizeMkt(
    (await sget({ [cfgKey]: DEFAULT_MKT }))[cfgKey]
  );
  if (streakInp) streakInp.value = String(cfg.triggerStreak);
  if (autoCk) autoCk.checked = !!cfg.autoContinue;
  if (zeroCk) zeroCk.checked = !!cfg.includeZero;

  renderSteps(stepsBox, cfg.steps, { silent: true });
  if (msgEl) msgEl.textContent = 'Loaded';

  // кнопка добавления шага рядом с текущим stepsBox
  const btnAddStep =
    stepsBox?.parentElement?.querySelector('.btn-add-step') ||
    stepsBox?.closest('.market-card')?.querySelector('.btn-add-step');
  if (btnAddStep) {
    btnAddStep.addEventListener('click', () => {
      addStep(stepsBox);
      // steps:changed эмитится внутри addStep -> автосейв дернётся снаружи
    });
  }
}

export async function saveMarketCfgFromUI(market) {
  let cfgKey, stepsBox, msgEl, streakInpEl, autoCkEl, zeroCkEl;

  if (market === 'dozens') {
    cfgKey = CFG_DZN_KEY;
    stepsBox = dznStepsBox;
    msgEl = cfgDznMsg;
    streakInpEl = dozensStreakInp;
    autoCkEl = dozensAutoCk;
    zeroCkEl = dozensZeroCk;
  } else if (market === 'rows') {
    cfgKey = CFG_ROW_KEY;
    stepsBox = rowStepsBox;
    msgEl = cfgRowMsg;
    streakInpEl = rowsStreakInp;
    autoCkEl = rowsAutoCk;
    zeroCkEl = rowsZeroCk;
  } else if (market === 'six') {
    cfgKey = CFG_SIX_KEY;
    stepsBox = sixStepsBox;
    msgEl = cfgSixMsg;
    streakInpEl = sixStreakInp;
    autoCkEl = sixAutoCk;
    zeroCkEl = sixZeroCk;
  } else if (market === 'threes') {
    cfgKey = CFG_THREES_KEY;
    stepsBox = threesStepsBox;
    msgEl = cfgThreesMsg;
    streakInpEl = threesStreakInp;
    autoCkEl = threesAutoCk;
    zeroCkEl = threesZeroCk;
  } else if (market === 'lowhigh') {
    cfgKey = CFG_LOWHIGH_KEY;
    stepsBox = lowhighStepsBox;
    msgEl = cfgLowHighMsg;
    streakInpEl = lowhighStreakInp;
    autoCkEl = lowhighAutoCk;
    zeroCkEl = lowhighZeroCk;
  } else if (market === 'evenodd') {
    cfgKey = CFG_EVENODD_KEY;
    stepsBox = evenoddStepsBox;
    msgEl = cfgEvenOddMsg;
    streakInpEl = evenoddStreakInp;
    autoCkEl = evenoddAutoCk;
    zeroCkEl = evenoddZeroCk;
  } else if (market === 'colors') {
    cfgKey = CFG_COLORS_KEY;
    stepsBox = colorsStepsBox;
    msgEl = cfgColorsMsg;
    streakInpEl = colorsStreakInp;
    autoCkEl = colorsAutoCk;
    zeroCkEl = colorsZeroCk;
  } else return;

  const streak = Math.max(
    2,
    Math.floor(Number(streakInpEl?.value || 2))
  );
  const autoContinue = !!autoCkEl?.checked;
  const includeZero = zeroCkEl == null ? true : !!zeroCkEl.checked;

  const { [GLOBAL_CHIPS_KEY]: chips = DEFAULT_CHIPS } = await sget({
    [GLOBAL_CHIPS_KEY]: DEFAULT_CHIPS,
  });
  const chipCount = Array.isArray(chips?.chipValues)
    ? chips.chipValues.length
    : DEFAULT_CHIPS.chipValues.length;

  const steps = getStepsFromUI(stepsBox);
  if (!steps.length) {
    if (msgEl) msgEl.textContent = 'Add at least one step';
    return;
  }
  for (const stp of steps) {
    for (const it of stp) {
      if (it.chip < 1 || it.chip > chipCount) {
        if (msgEl) msgEl.textContent = 'Step uses invalid Chip #';
        return;
      }
    }
  }

  const clean = sanitizeMkt({
    triggerStreak: streak,
    steps,
    autoContinue,
    includeZero,
  });
  await sset({ [cfgKey]: clean });

  try {
    const { betLogs = [] } = await sget({ betLogs: [] });
    betLogs.push({
      t: Date.now(),
      type: 'config',
      market,
      message: 'Конфиг сохранён',
      stepsCount: clean.steps.length,
      triggerStreak: clean.triggerStreak,
      autoContinue: clean.autoContinue,
      includeZero: clean.includeZero,
    });
    if (betLogs.length > 2000)
      betLogs.splice(0, betLogs.length - 2000);
    await sset({ betLogs });
  } catch {}
  try {
    await chrome.runtime.sendMessage({ type: 'AB_CONFIG_SAVED' });
  } catch {}
  if (msgEl) msgEl.textContent = 'Saved.';
}

/** Сброс ламп и streak-состояний при выключении рынков */
export function wireMarketTogglesReset() {
  const DEFAULT_STREAK = {
    dozens: { count: 0, idx: null },
    rows: { count: 0, idx: null },
  };

  // Dozens
  autoBetToggleDozens?.addEventListener('change', async () => {
    const checked = !!autoBetToggleDozens.checked;
    await sset({ autoBettingDozensEnabled: checked });
    if (!checked) {
      resetStreakDots('dozens');
      const { streakState = DEFAULT_STREAK } = await sget({
        streakState: DEFAULT_STREAK,
      });
      const st = {
        ...DEFAULT_STREAK,
        ...streakState,
        dozens: { count: 0, idx: null },
      };
      await sset({ streakState: st });
      updateDotsFromState();
    }
  });

  // Rows
  autoBetToggleRows?.addEventListener('change', async () => {
    const checked = !!autoBetToggleRows.checked;
    await sset({ autoBettingRowsEnabled: checked });
    if (!checked) {
      resetStreakDots('rows');
      const { streakState = DEFAULT_STREAK } = await sget({
        streakState: DEFAULT_STREAK,
      });
      const st = {
        ...DEFAULT_STREAK,
        ...streakState,
        rows: { count: 0, idx: null },
      };
      await sset({ streakState: st });
      updateDotsFromState();
    }
  });

  // Six
  autoBetToggleSix?.addEventListener('change', async () => {
    const checked = !!autoBetToggleSix.checked;
    await sset({ autoBettingSixEnabled: checked });
    if (!checked) {
      resetStreakDots('six');
      updateDotsFromState();
    }
  });

  // Threes
  autoBetToggleThrees?.addEventListener('change', async () => {
    const checked = !!autoBetToggleThrees.checked;
    await sset({ autoBettingThreesEnabled: checked });
    if (!checked) {
      resetStreakDots('threes');
      updateDotsFromState();
    }
  });

  // NEW: Low/High
  autoBetToggleLowHigh?.addEventListener('change', async () => {
    const checked = !!autoBetToggleLowHigh.checked;
    await sset({ autoBettingLowHighEnabled: checked });
    if (!checked) {
      resetStreakDots('lowhigh');
      updateDotsFromState();
    }
  });

  // NEW: Even/Odd
  autoBetToggleEvenOdd?.addEventListener('change', async () => {
    const checked = !!autoBetToggleEvenOdd.checked;
    await sset({ autoBettingEvenOddEnabled: checked });
    if (!checked) {
      resetStreakDots('evenodd');
      updateDotsFromState();
    }
  });

  // NEW: Colors
  autoBetToggleColors?.addEventListener('change', async () => {
    const checked = !!autoBetToggleColors.checked;
    await sset({ autoBettingColorsEnabled: checked });
    if (!checked) {
      resetStreakDots('colors');
      updateDotsFromState();
    }
  });
}
