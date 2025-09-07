// src/bet-config.js — shared config (ESM)
const KEY = 'betConfig';

export const defaults = Object.freeze({
  chipSelectors: [
    '[data-e2e="chip-0.2"]',
    '[data-e2e="chip-1"]',
    '[data-e2e="chip-5"]',
    '[data-e2e="chip-20"]',
  ],
  chipValues: [0.2, 1, 5, 20],
  placeButtonSel: null,
  steps: [
    [{ i: 0, times: 1 }],
    [{ i: 0, times: 3 }],
    [{ i: 1, times: 2 }],
    [
      { i: 2, times: 1 },
      { i: 1, times: 1 },
    ],
  ],
});

function sanitize(raw) {
  const cfg = { ...(raw || {}) };

  // chipSelectors
  let chipSelectors = Array.isArray(cfg.chipSelectors)
    ? cfg.chipSelectors
    : [];
  chipSelectors = chipSelectors
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  if (!chipSelectors.length)
    chipSelectors = [...defaults.chipSelectors];

  // chipValues 1:1 with selectors
  let chipValues = Array.isArray(cfg.chipValues)
    ? cfg.chipValues.map(Number)
    : [];
  if (chipValues.length !== chipSelectors.length) {
    chipValues = [...defaults.chipValues].slice(
      0,
      chipSelectors.length
    );
    while (chipValues.length < chipSelectors.length)
      chipValues.push(0);
  }

  // place button (optional)
  const placeButtonSel =
    typeof cfg.placeButtonSel === 'string' ||
    cfg.placeButtonSel === null
      ? cfg.placeButtonSel
      : null;

  // steps
  let steps = Array.isArray(cfg.steps) ? cfg.steps : [];
  steps = steps
    .map((st) => (Array.isArray(st) ? st : []))
    .map((st) =>
      st
        .map((it) => ({
          i: Math.max(
            0,
            Math.min(
              chipSelectors.length - 1,
              Math.floor(Number(it?.i ?? 0))
            )
          ),
          times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
        }))
        .filter(
          (it) => Number.isFinite(it.i) && Number.isFinite(it.times)
        )
    )
    .filter((st) => st.length);
  if (!steps.length)
    steps = JSON.parse(JSON.stringify(defaults.steps));

  return { chipSelectors, chipValues, placeButtonSel, steps };
}

async function sget(defs) {
  try {
    return await chrome.storage.local.get(defs || {});
  } catch {
    return defs || {};
  }
}
async function sset(obj) {
  try {
    await chrome.storage.local.set(obj);
  } catch {}
}

export async function load() {
  const obj = await sget({ [KEY]: defaults });
  return sanitize(obj[KEY]);
}

export async function save(cfg) {
  const clean = sanitize(cfg);
  await sset({ [KEY]: clean });
  return clean;
}
