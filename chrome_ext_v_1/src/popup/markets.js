import { sget, sset } from './utils.js';
import {
  dozensStreakInp,
  rowsStreakInp,
  sixStreakInp,
  threesStreakInp,
  lowhighStreakInp,
  evenoddStreakInp,
  colorsStreakInp,
  sectorsStreakInp,
  antidozensStreakInp,
  antirowsStreakInp,
  dozensAutoCk,
  rowsAutoCk,
  sixAutoCk,
  threesAutoCk,
  lowhighAutoCk,
  evenoddAutoCk,
  colorsAutoCk,
  sectorsAutoCk,
  antidozensAutoCk,
  antirowsAutoCk,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,
  lowhighZeroCk,
  evenoddZeroCk,
  colorsZeroCk,
  sectorsZeroCk,
  antidozensZeroCk,
  antirowsZeroCk,
  autoBetToggleDozens,
  autoBetToggleRows,
  autoBetToggleSix,
  autoBetToggleThrees,
  autoBetToggleLowHigh,
  autoBetToggleEvenOdd,
  autoBetToggleColors,
  autoBetToggleSectors,
  autoBetToggleAntiDozens,
  autoBetToggleAntiRows,
  dznStepsBox,
  rowStepsBox,
  sixStepsBox,
  threesStepsBox,
  lowhighStepsBox,
  evenoddStepsBox,
  colorsStepsBox,
  sectorsStepsBox,
  antiDznStepsBox,
  antiRowsStepsBox,
  cfgDznMsg,
  cfgRowMsg,
  cfgSixMsg,
  cfgThreesMsg,
  cfgLowHighMsg,
  cfgEvenOddMsg,
  cfgColorsMsg,
  cfgSectorsMsg,
  cfgAntiDznMsg,
  cfgAntiRowsMsg,
  betStatusDozens,
  betStatusRows,
  betStatusSix,
  betStatusThrees,
  betStatusLowHigh,
  betStatusEvenOdd,
  betStatusColors,
  betStatusSectors,
  betStatusAntiDozens,
  betStatusAntiRows,
  autoBetToggleNeighbors,
  betStatusNeighbors,
  neighborsStepsBox,
  cfgNeighborsMsg,
  numbersGapInp,
  numbersMaxTargetsInp,
  numbersAutoCk,
  autoBetToggleNumbers,
  betStatusNumbers,
  numbersStepsBox,
  cfgNumbersMsg,
  autoBetToggleMissing19,
  betStatusMissing19,
  missing19TriggerCountInp,
  missing19MaxDoublesInp,
  missing19RebetDoubleCk,
  missing19InsuranceEnabledCk,
  missing19InsuranceChipValueInp,
  missing19StepsBox,
  cfgMissing19Msg,
  autoBetToggleRepeats,
  betStatusRepeats,
  repeatsRangesBox,
  repeatsInsuranceEnabledCk,
  repeatsInsuranceRangesBox,
  cfgRepeatsMsg,
} from './dom.js';

import { renderSteps, getStepsFromUI } from './steps-ui.js';
import { renderRanges, getRangesFromUI } from './range-steps-ui.js';
import { DEFAULT_CHIPS, GLOBAL_CHIPS_KEY } from './chips.js';
import { resetStreakDots, updateDotsFromState } from './streaks.js';

export const CFG_DZN_KEY = 'abDozensConfig';
export const CFG_ANTI_DZN_KEY = 'abAntiDozensConfig';
export const CFG_ROW_KEY = 'abRowsConfig';
export const CFG_SIX_KEY = 'abSixConfig';
export const CFG_THREES_KEY = 'abThreesConfig';
export const CFG_LOWHIGH_KEY = 'abLowHighConfig';
export const CFG_EVENODD_KEY = 'abEvenOddConfig';
export const CFG_COLORS_KEY = 'abColorsConfig';
export const CFG_SECTORS_KEY = 'abSectorsConfig';
export const CFG_NEIGHBORS_KEY = 'abNeighborsConfig';
export const CFG_ANTI_ROWS_KEY = 'abAntiRowsConfig';
export const CFG_NUMBERS_KEY = 'abNumbersConfig';
export const CFG_MISSING19_KEY = 'abMissing19Config';
export const CFG_REPEATS_KEY = 'abRepeatsConfig';

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

export const DEFAULT_NEIGHBORS = Object.freeze({
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

export const DEFAULT_NUMBERS = Object.freeze({
  triggerGap: 120,
  maxTargets: 1,
  autoContinue: false,
  steps: JSON.parse(JSON.stringify(DEFAULT_MKT.steps)),
});

export const DEFAULT_MISSING19 = Object.freeze({
  triggerCount: 19,
  useRebetDouble: true,
  maxDoubles: 3,
  insuranceEnabled: false,
  insuranceChipValue: 1,
  steps: JSON.parse(JSON.stringify(DEFAULT_MKT.steps)),
});

export const DEFAULT_REPEATS = Object.freeze({
  ranges: [
    { from: 1, to: 9, items: [{ chip: 1, times: 1 }] },
    { from: 10, to: 12, items: [{ chip: 1, times: 2 }] },
  ],
  insuranceEnabled: false,
  insuranceRanges: [
    { from: 1, to: 9, items: [{ chip: 2, times: 1 }] },
    { from: 10, to: 12, items: [{ chip: 2, times: 2 }] },
  ],
});

function normalizeInsuranceChipValue(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? n
    : DEFAULT_MISSING19.insuranceChipValue;
}

export function sanitizeNeighbors(raw) {
  const src = raw || {};
  let steps = Array.isArray(src.steps)
    ? src.steps
    : DEFAULT_NEIGHBORS.steps;

  steps = steps
    .map((st) => (Array.isArray(st) ? st : []))
    .map((st) =>
      st.map((it) => ({
        chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
        times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
      })),
    )
    .map((st) =>
      st.filter(
        (it) => Number.isFinite(it.chip) && Number.isFinite(it.times),
      ),
    )
    .filter((st) => st.length);

  if (!steps.length) {
    steps = JSON.parse(JSON.stringify(DEFAULT_NEIGHBORS.steps));
  }
  return { steps };
}

export function sanitizeMkt(raw) {
  const src = raw || {};
  const triggerStreak = Math.max(
    2,
    Math.floor(
      Number(src.triggerStreak ?? DEFAULT_MKT.triggerStreak),
    ),
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
      })),
    )
    .map((st) =>
      st.filter(
        (it) => Number.isFinite(it.chip) && Number.isFinite(it.times),
      ),
    )
    .filter((st) => st.length);

  if (!steps.length) {
    steps = JSON.parse(JSON.stringify(DEFAULT_MKT.steps));
  }

  return { triggerStreak, steps, autoContinue, includeZero };
}

export function sanitizeNumbers(raw) {
  const src = raw || {};
  const triggerGap = Math.max(
    1,
    Math.floor(Number(src.triggerGap ?? DEFAULT_NUMBERS.triggerGap)),
  );
  const maxTargets = Math.max(
    1,
    Math.floor(Number(src.maxTargets ?? DEFAULT_NUMBERS.maxTargets)),
  );
  const autoContinue = !!(
    src.autoContinue ?? DEFAULT_NUMBERS.autoContinue
  );

  let steps = Array.isArray(src.steps)
    ? src.steps
    : DEFAULT_NUMBERS.steps;

  steps = steps
    .map((st) => (Array.isArray(st) ? st : []))
    .map((st) =>
      st.map((it) => ({
        chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
        times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
      })),
    )
    .map((st) =>
      st.filter(
        (it) => Number.isFinite(it.chip) && Number.isFinite(it.times),
      ),
    )
    .filter((st) => st.length);

  if (!steps.length) {
    steps = JSON.parse(JSON.stringify(DEFAULT_NUMBERS.steps));
  }

  return { triggerGap, maxTargets, steps, autoContinue };
}

export function sanitizeMissing19(raw) {
  const src = raw || {};
  const triggerCount = Math.max(
    19,
    Math.floor(
      Number(src.triggerCount ?? DEFAULT_MISSING19.triggerCount),
    ),
  );
  const maxDoubles = Math.max(
    0,
    Math.floor(Number(src.maxDoubles ?? DEFAULT_MISSING19.maxDoubles)),
  );
  const useRebetDouble = !!(
    src.useRebetDouble ?? DEFAULT_MISSING19.useRebetDouble
  );
  const insuranceEnabled = !!(
    src.insuranceEnabled ?? DEFAULT_MISSING19.insuranceEnabled
  );
  const insuranceChipValue = normalizeInsuranceChipValue(
    src.insuranceChipValue,
  );

  let steps = Array.isArray(src.steps)
    ? src.steps
    : DEFAULT_MISSING19.steps;

  steps = steps
    .map((st) => (Array.isArray(st) ? st : []))
    .map((st) =>
      st.map((it) => ({
        chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
        times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
      })),
    )
    .map((st) =>
      st.filter(
        (it) => Number.isFinite(it.chip) && Number.isFinite(it.times),
      ),
    )
    .filter((st) => st.length);

  if (!steps.length) {
    steps = JSON.parse(JSON.stringify(DEFAULT_MISSING19.steps));
  }

  return {
    triggerCount,
    useRebetDouble,
    maxDoubles,
    insuranceEnabled,
    insuranceChipValue,
    steps,
  };
}

function sanitizeRangeItems(rawItems) {
  const src = Array.isArray(rawItems) ? rawItems : [];
  const items = src
    .map((it) => ({
      chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
      times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
    }))
    .filter(
      (it) => Number.isFinite(it.chip) && Number.isFinite(it.times),
    );

  return items.length ? items : [{ chip: 1, times: 1 }];
}

function sanitizeRangeList(rawRanges, fallbackRanges) {
  const raw = Array.isArray(rawRanges) ? rawRanges : fallbackRanges;
  const ranges = raw
    .map((range) => {
      const from = Math.max(1, Math.floor(Number(range?.from ?? 1)));
      const to = Math.max(
        from,
        Math.floor(Number(range?.to ?? from)),
      );
      return {
        from,
        to: Math.min(37, to),
        items: sanitizeRangeItems(range?.items),
      };
    })
    .filter((range) => range.from <= 37)
    .sort((a, b) => a.from - b.from || a.to - b.to);

  return ranges.length
    ? ranges
    : JSON.parse(JSON.stringify(fallbackRanges));
}

export function sanitizeRepeats(raw) {
  const src = raw || {};
  return {
    ranges: sanitizeRangeList(src.ranges, DEFAULT_REPEATS.ranges),
    insuranceEnabled: !!(
      src.insuranceEnabled ?? DEFAULT_REPEATS.insuranceEnabled
    ),
    insuranceRanges: sanitizeRangeList(
      src.insuranceRanges,
      DEFAULT_REPEATS.insuranceRanges,
    ),
  };
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
  } else if (market === 'antidozens') {
    cfgKey = CFG_ANTI_DZN_KEY;
    enKey = 'autoBettingAntiDozensEnabled';
    statusKey = 'bettingStatusAntiDozens';
    streakInp = antidozensStreakInp;
    autoCk = antidozensAutoCk;
    zeroCk = antidozensZeroCk;
    toggle = autoBetToggleAntiDozens;
    stepsBox = antiDznStepsBox;
    msgEl = cfgAntiDznMsg;
    statusElDest = betStatusAntiDozens;
  } else if (market === 'antirows') {
    cfgKey = CFG_ANTI_ROWS_KEY;
    enKey = 'autoBettingAntiRowsEnabled';
    statusKey = 'bettingStatusAntiRows';
    streakInp = antirowsStreakInp;
    autoCk = antirowsAutoCk;
    zeroCk = antirowsZeroCk;
    toggle = autoBetToggleAntiRows;
    stepsBox = antiRowsStepsBox;
    msgEl = cfgAntiRowsMsg;
    statusElDest = betStatusAntiRows;
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
  } else if (market === 'sectors') {
    cfgKey = CFG_SECTORS_KEY;
    enKey = 'autoBettingSectorsEnabled';
    statusKey = 'bettingStatusSectors';
    streakInp = sectorsStreakInp;
    autoCk = sectorsAutoCk;
    zeroCk = sectorsZeroCk;
    toggle = autoBetToggleSectors;
    stepsBox = sectorsStepsBox;
    msgEl = cfgSectorsMsg;
    statusElDest = betStatusSectors;
  } else if (market === 'neighbors') {
    cfgKey = CFG_NEIGHBORS_KEY;
    enKey = 'autoBettingNeighborsEnabled';
    statusKey = 'bettingStatusNeighbors';
    toggle = autoBetToggleNeighbors;
    stepsBox = neighborsStepsBox;
    msgEl = cfgNeighborsMsg;
    statusElDest = betStatusNeighbors;
  } else if (market === 'numbers') {
    cfgKey = CFG_NUMBERS_KEY;
    enKey = 'autoBettingNumbersEnabled';
    statusKey = 'bettingStatusNumbers';
    streakInp = numbersGapInp;
    autoCk = numbersAutoCk;
    zeroCk = null;
    toggle = autoBetToggleNumbers;
    stepsBox = numbersStepsBox;
    msgEl = cfgNumbersMsg;
    statusElDest = betStatusNumbers;
  } else if (market === 'missing19') {
    cfgKey = CFG_MISSING19_KEY;
    enKey = 'autoBettingMissing19Enabled';
    statusKey = 'bettingStatusMissing19';
    streakInp = null;
    autoCk = null;
    zeroCk = null;
    toggle = autoBetToggleMissing19;
    stepsBox = missing19StepsBox;
    msgEl = cfgMissing19Msg;
    statusElDest = betStatusMissing19;
  } else if (market === 'repeats') {
    cfgKey = CFG_REPEATS_KEY;
    enKey = 'autoBettingRepeatsEnabled';
    statusKey = 'bettingStatusRepeats';
    streakInp = null;
    autoCk = null;
    zeroCk = null;
    toggle = autoBetToggleRepeats;
    stepsBox = repeatsRangesBox;
    msgEl = cfgRepeatsMsg;
    statusElDest = betStatusRepeats;
  } else return;

  const st = await sget({
    [enKey]: false,
    [statusKey]: { state: 'off', message: '' },
  });

  if (toggle) toggle.checked = !!st[enKey];

  const stat = st[statusKey] || { state: 'off', message: '' };
  if (statusElDest) {
    statusElDest.textContent = `[${String(
      stat.state || 'off',
    ).toUpperCase()}] ${stat.message || ''}`;
  }

  let cfg;
  if (market === 'neighbors') {
    cfg = sanitizeNeighbors(
      (await sget({ [cfgKey]: DEFAULT_NEIGHBORS }))[cfgKey],
    );
  } else if (market === 'numbers') {
    cfg = sanitizeNumbers(
      (await sget({ [cfgKey]: DEFAULT_NUMBERS }))[cfgKey],
    );
    if (numbersGapInp) numbersGapInp.value = String(cfg.triggerGap);
    if (numbersMaxTargetsInp) {
      numbersMaxTargetsInp.value = String(cfg.maxTargets);
    }
    if (numbersAutoCk) numbersAutoCk.checked = !!cfg.autoContinue;
  } else if (market === 'missing19') {
    cfg = sanitizeMissing19(
      (await sget({ [cfgKey]: DEFAULT_MISSING19 }))[cfgKey],
    );
    if (missing19TriggerCountInp) {
      missing19TriggerCountInp.value = String(cfg.triggerCount);
    }
    if (missing19MaxDoublesInp) {
      missing19MaxDoublesInp.value = String(cfg.maxDoubles);
    }
    if (missing19RebetDoubleCk) {
      missing19RebetDoubleCk.checked = !!cfg.useRebetDouble;
    }
    if (missing19InsuranceEnabledCk) {
      missing19InsuranceEnabledCk.checked = !!cfg.insuranceEnabled;
    }
    if (missing19InsuranceChipValueInp) {
      missing19InsuranceChipValueInp.value = String(
        cfg.insuranceChipValue,
      );
    }
  } else if (market === 'repeats') {
    cfg = sanitizeRepeats(
      (await sget({ [cfgKey]: DEFAULT_REPEATS }))[cfgKey],
    );
  } else {
    cfg = sanitizeMkt(
      (await sget({ [cfgKey]: DEFAULT_MKT }))[cfgKey],
    );
    if (streakInp) streakInp.value = String(cfg.triggerStreak);
    if (autoCk) autoCk.checked = !!cfg.autoContinue;
    if (zeroCk) zeroCk.checked = !!cfg.includeZero;
  }

  if (market === 'repeats') {
    if (repeatsInsuranceEnabledCk) {
      repeatsInsuranceEnabledCk.checked = !!cfg.insuranceEnabled;
    }
    renderRanges(stepsBox, cfg.ranges, { silent: true });
    renderRanges(repeatsInsuranceRangesBox, cfg.insuranceRanges, {
      silent: true,
    });
  } else {
    renderSteps(stepsBox, cfg.steps, { silent: true });
  }
  if (msgEl) msgEl.textContent = 'Loaded';
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
  } else if (market === 'antidozens') {
    cfgKey = CFG_ANTI_DZN_KEY;
    stepsBox = antiDznStepsBox;
    msgEl = cfgAntiDznMsg;
    streakInpEl = antidozensStreakInp;
    autoCkEl = antidozensAutoCk;
    zeroCkEl = antidozensZeroCk;
  } else if (market === 'antirows') {
    cfgKey = CFG_ANTI_ROWS_KEY;
    stepsBox = antiRowsStepsBox;
    msgEl = cfgAntiRowsMsg;
    streakInpEl = antirowsStreakInp;
    autoCkEl = antirowsAutoCk;
    zeroCkEl = antirowsZeroCk;
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
  } else if (market === 'sectors') {
    cfgKey = CFG_SECTORS_KEY;
    stepsBox = sectorsStepsBox;
    msgEl = cfgSectorsMsg;
    streakInpEl = sectorsStreakInp;
    autoCkEl = sectorsAutoCk;
    zeroCkEl = sectorsZeroCk;
  } else if (market === 'neighbors') {
    cfgKey = CFG_NEIGHBORS_KEY;
    stepsBox = neighborsStepsBox;
    msgEl = cfgNeighborsMsg;
  } else if (market === 'numbers') {
    cfgKey = CFG_NUMBERS_KEY;
    stepsBox = numbersStepsBox;
    msgEl = cfgNumbersMsg;
    streakInpEl = numbersGapInp;
    autoCkEl = numbersAutoCk;
    zeroCkEl = null;
  } else if (market === 'missing19') {
    cfgKey = CFG_MISSING19_KEY;
    stepsBox = missing19StepsBox;
    msgEl = cfgMissing19Msg;
    streakInpEl = null;
    autoCkEl = null;
    zeroCkEl = null;
  } else if (market === 'repeats') {
    cfgKey = CFG_REPEATS_KEY;
    stepsBox = repeatsRangesBox;
    msgEl = cfgRepeatsMsg;
    streakInpEl = null;
    autoCkEl = null;
    zeroCkEl = null;
  } else return;

  const { [GLOBAL_CHIPS_KEY]: chips = DEFAULT_CHIPS } = await sget({
    [GLOBAL_CHIPS_KEY]: DEFAULT_CHIPS,
  });

  const chipCount = Array.isArray(chips?.chipValues)
    ? chips.chipValues.length
    : DEFAULT_CHIPS.chipValues.length;

  if (market === 'repeats') {
    const ranges = getRangesFromUI(stepsBox);
    const insuranceRanges = getRangesFromUI(repeatsInsuranceRangesBox);
    const insuranceEnabled = !!repeatsInsuranceEnabledCk?.checked;
    if (!ranges.length) {
      if (msgEl) msgEl.textContent = 'Add at least one range';
      return;
    }
    if (insuranceEnabled && !insuranceRanges.length) {
      if (msgEl) msgEl.textContent = 'Add at least one insurance range';
      return;
    }

    const allRanges = ranges.concat(insuranceRanges);
    for (const range of allRanges) {
      for (const it of range.items || []) {
        if (it.chip < 1 || it.chip > chipCount) {
          if (msgEl) msgEl.textContent = 'Range uses invalid Chip #';
          return;
        }
      }
    }

    const clean = sanitizeRepeats({
      ranges,
      insuranceEnabled,
      insuranceRanges,
    });
    await sset({ [cfgKey]: clean });
    if (msgEl) msgEl.textContent = 'Saved.';
    return;
  }

  let steps = getStepsFromUI(stepsBox);
  if (market === 'missing19' && missing19RebetDoubleCk?.checked) {
    steps = JSON.parse(JSON.stringify(DEFAULT_MISSING19.steps));
  }
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

  if (market === 'neighbors') {
    const clean = sanitizeNeighbors({ steps });
    await sset({ [cfgKey]: clean });
    if (msgEl) msgEl.textContent = 'Saved.';
    return;
  }

  if (market === 'numbers') {
    const gap = Math.max(
      1,
      Math.floor(Number(streakInpEl?.value || 1)),
    );
    const maxTargets = Math.max(
      1,
      Math.floor(Number(numbersMaxTargetsInp?.value || 1)),
    );
    const autoContinue = !!autoCkEl?.checked;

    const clean = sanitizeNumbers({
      triggerGap: gap,
      maxTargets,
      steps,
      autoContinue,
    });

    await sset({ [cfgKey]: clean });
    if (msgEl) msgEl.textContent = 'Saved.';
    return;
  }

  if (market === 'missing19') {
    const triggerCount = Math.max(
      19,
      Math.floor(Number(missing19TriggerCountInp?.value || 19)),
    );
    const maxDoubles = Math.max(
      0,
      Math.floor(Number(missing19MaxDoublesInp?.value || 0)),
    );
    const useRebetDouble = !!missing19RebetDoubleCk?.checked;
    const insuranceEnabled = !!missing19InsuranceEnabledCk?.checked;
    const insuranceChipValue = normalizeInsuranceChipValue(
      missing19InsuranceChipValueInp?.value,
    );
    const clean = sanitizeMissing19({
      triggerCount,
      useRebetDouble,
      maxDoubles,
      insuranceEnabled,
      insuranceChipValue,
      steps,
    });

    await sset({ [cfgKey]: clean });
    if (msgEl) msgEl.textContent = 'Saved.';
    return;
  }

  const streak = Math.max(
    2,
    Math.floor(Number(streakInpEl?.value || 2)),
  );
  const autoContinue = !!autoCkEl?.checked;
  const includeZero = zeroCkEl == null ? true : !!zeroCkEl.checked;

  const clean = sanitizeMkt({
    triggerStreak: streak,
    steps,
    autoContinue,
    includeZero,
  });
  await sset({ [cfgKey]: clean });

  if (msgEl) msgEl.textContent = 'Saved.';
}

export function wireMarketTogglesReset() {
  autoBetToggleDozens?.addEventListener('change', async () => {
    const checked = !!autoBetToggleDozens.checked;
    await sset({ autoBettingDozensEnabled: checked });
    if (!checked) {
      resetStreakDots('dozens');
      updateDotsFromState();
    }
  });

  autoBetToggleAntiDozens?.addEventListener('change', async () => {
    const checked = !!autoBetToggleAntiDozens.checked;
    await sset({ autoBettingAntiDozensEnabled: checked });
    if (!checked) {
      resetStreakDots('antidozens');
      updateDotsFromState();
    }
  });

  autoBetToggleAntiRows?.addEventListener('change', async () => {
    const checked = !!autoBetToggleAntiRows.checked;
    await sset({ autoBettingAntiRowsEnabled: checked });
    if (!checked) {
      resetStreakDots('antirows');
      updateDotsFromState();
    }
  });

  autoBetToggleRows?.addEventListener('change', async () => {
    const checked = !!autoBetToggleRows.checked;
    await sset({ autoBettingRowsEnabled: checked });
    if (!checked) {
      resetStreakDots('rows');
      updateDotsFromState();
    }
  });

  autoBetToggleSix?.addEventListener('change', async () => {
    const checked = !!autoBetToggleSix.checked;
    await sset({ autoBettingSixEnabled: checked });
    if (!checked) {
      resetStreakDots('six');
      updateDotsFromState();
    }
  });

  autoBetToggleThrees?.addEventListener('change', async () => {
    const checked = !!autoBetToggleThrees.checked;
    await sset({ autoBettingThreesEnabled: checked });
    if (!checked) {
      resetStreakDots('threes');
      updateDotsFromState();
    }
  });

  autoBetToggleLowHigh?.addEventListener('change', async () => {
    const checked = !!autoBetToggleLowHigh.checked;
    await sset({ autoBettingLowHighEnabled: checked });
    if (!checked) {
      resetStreakDots('lowhigh');
      updateDotsFromState();
    }
  });

  autoBetToggleEvenOdd?.addEventListener('change', async () => {
    const checked = !!autoBetToggleEvenOdd.checked;
    await sset({ autoBettingEvenOddEnabled: checked });
    if (!checked) {
      resetStreakDots('evenodd');
      updateDotsFromState();
    }
  });

  autoBetToggleColors?.addEventListener('change', async () => {
    const checked = !!autoBetToggleColors.checked;
    await sset({ autoBettingColorsEnabled: checked });
    if (!checked) {
      resetStreakDots('colors');
      updateDotsFromState();
    }
  });

  autoBetToggleSectors?.addEventListener('change', async () => {
    const checked = !!autoBetToggleSectors.checked;
    await sset({ autoBettingSectorsEnabled: checked });
    if (!checked) {
      resetStreakDots('sectors');
      updateDotsFromState();
    }
  });

  autoBetToggleNeighbors?.addEventListener('change', async () => {
    const checked = !!autoBetToggleNeighbors.checked;
    await sset({
      autoBettingNeighborsEnabled: checked,
      bettingStatusNeighbors: checked
        ? { state: 'idle', message: 'ON (жду спин)' }
        : { state: 'off', message: '' },
    });
    if (betStatusNeighbors) {
      betStatusNeighbors.textContent = checked
        ? '[IDLE] ON (жду спин)'
        : '[OFF]';
    }
  });

  autoBetToggleNumbers?.addEventListener('change', async () => {
    const checked = !!autoBetToggleNumbers.checked;
    await sset({
      autoBettingNumbersEnabled: checked,
      bettingStatusNumbers: checked
        ? {
            state: 'idle',
            message: 'NUMBERS: spin 0 | candidates 37',
          }
        : { state: 'off', message: '' },
    });
    if (betStatusNumbers) {
      betStatusNumbers.textContent = checked
        ? '[IDLE] NUMBERS: spin 0 | candidates 37'
        : '[OFF]';
    }
  });

  autoBetToggleMissing19?.addEventListener('change', async () => {
    const checked = !!autoBetToggleMissing19.checked;
    await sset({
      autoBettingMissing19Enabled: checked,
      bettingStatusMissing19: checked
        ? {
            state: 'idle',
            message: 'MISSING19: collecting 0/19 | repeats 0',
          }
        : { state: 'off', message: '' },
    });
    if (betStatusMissing19) {
      betStatusMissing19.textContent = checked
        ? '[IDLE] MISSING19: collecting 0/19 | repeats 0'
        : '[OFF]';
    }
  });

  autoBetToggleRepeats?.addEventListener('change', async () => {
    const checked = !!autoBetToggleRepeats.checked;
    await sset({
      autoBettingRepeatsEnabled: checked,
      bettingStatusRepeats: checked
        ? {
            state: 'idle',
            message: 'REPEATS: wait first spin',
          }
        : { state: 'off', message: '' },
    });
    if (betStatusRepeats) {
      betStatusRepeats.textContent = checked
        ? '[IDLE] REPEATS: wait first spin'
        : '[OFF]';
    }
  });
}
