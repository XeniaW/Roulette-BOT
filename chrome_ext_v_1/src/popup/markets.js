// src/popup/markets.js
import { sget, sset } from './utils.js';
import {
  dozensStreakInp,
  rowsStreakInp,
  sixStreakInp,
  threesStreakInp,
  dozensAutoCk,
  rowsAutoCk,
  sixAutoCk,
  threesAutoCk,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,
  autoBetToggleDozens,
  autoBetToggleRows,
  autoBetToggleSix,
  autoBetToggleThrees,
  dznStepsBox,
  rowStepsBox,
  sixStepsBox,
  threesStepsBox,
  cfgDznMsg,
  cfgRowMsg,
  cfgSixMsg,
  cfgThreesMsg,
  betStatusDozens,
  betStatusRows,
  betStatusSix,
  betStatusThrees,
} from './dom.js';
import { renderSteps, getStepsFromUI } from './steps-ui.js';
import { DEFAULT_CHIPS, GLOBAL_CHIPS_KEY } from './chips.js';

export const CFG_DZN_KEY = 'abDozensConfig';
export const CFG_ROW_KEY = 'abRowsConfig';
export const CFG_SIX_KEY = 'abSixConfig';
export const CFG_THREES_KEY = 'abThreesConfig';

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
  } else return;

  const st = await sget({
    [enKey]: false,
    [statusKey]: { state: 'off', message: '' },
  });
  toggle.checked = !!st[enKey];
  const stat = st[statusKey] || { state: 'off', message: '' };
  statusElDest.textContent = `[${(
    stat.state || 'off'
  ).toUpperCase()}] ${stat.message || ''}`;

  const cfg = sanitizeMkt(
    (await sget({ [cfgKey]: DEFAULT_MKT }))[cfgKey]
  );
  streakInp.value = String(cfg.triggerStreak);
  autoCk.checked = !!cfg.autoContinue;
  if (zeroCk) zeroCk.checked = !!cfg.includeZero;
  renderSteps(stepsBox, cfg.steps);
  msgEl.textContent = 'Loaded';
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
  } else return;

  const streak = Math.max(
    2,
    Math.floor(Number(streakInpEl.value || 2))
  );
  const autoContinue = !!autoCkEl.checked;
  const includeZero = zeroCkEl == null ? true : !!zeroCkEl.checked;

  const { [GLOBAL_CHIPS_KEY]: chips = DEFAULT_CHIPS } = await sget({
    [GLOBAL_CHIPS_KEY]: DEFAULT_CHIPS,
  });
  const chipCount = Array.isArray(chips?.chipValues)
    ? chips.chipValues.length
    : DEFAULT_CHIPS.chipValues.length;

  const steps = getStepsFromUI(stepsBox);
  if (!steps.length) {
    msgEl.textContent = 'Add at least one step';
    return;
  }
  for (const stp of steps)
    for (const it of stp)
      if (it.chip < 1 || it.chip > chipCount) {
        msgEl.textContent = 'Step uses invalid Chip #';
        return;
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
  msgEl.textContent = 'Saved.';
}

/* toggles reset */
export function wireMarketTogglesReset() {
  const DEFAULT_STREAK = {
    dozens: { count: 0, idx: null },
    rows: { count: 0, idx: null },
  };

  autoBetToggleDozens.addEventListener('change', async () => {
    const enabled = !!autoBetToggleDozens.checked;
    await sset({ autoBettingDozensEnabled: enabled });
    if (!enabled) {
      const { streakState = DEFAULT_STREAK } = await sget({
        streakState: DEFAULT_STREAK,
      });
      const st = {
        ...DEFAULT_STREAK,
        ...streakState,
        dozens: { count: 0, idx: null },
      };
      await sset({ streakState: st });
    }
  });

  autoBetToggleRows.addEventListener('change', async () => {
    const enabled = !!autoBetToggleRows.checked;
    await sset({ autoBettingRowsEnabled: enabled });
    if (!enabled) {
      const { streakState = DEFAULT_STREAK } = await sget({
        streakState: DEFAULT_STREAK,
      });
      const st = {
        ...DEFAULT_STREAK,
        ...streakState,
        rows: { count: 0, idx: null },
      };
      await sset({ streakState: st });
    }
  });

  autoBetToggleSix.addEventListener('change', async () => {
    const enabled = !!autoBetToggleSix.checked;
    await sset({ autoBettingSixEnabled: enabled });
  });

  autoBetToggleThrees.addEventListener('change', async () => {
    const enabled = !!autoBetToggleThrees.checked;
    await sset({ autoBettingThreesEnabled: enabled });
  });
}
