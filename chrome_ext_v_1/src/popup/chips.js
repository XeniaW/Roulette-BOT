// src/popup/chips.js
import { sget, sset } from './utils.js';
import {
  cfgChipTpl,
  chipsBox,
  cfgChipsMsg,
  btnAddChip,
} from './dom.js';

export const GLOBAL_CHIPS_KEY = 'abGlobalChips';
export const DEFAULT_CHIPS = {
  chipSelectorTemplate: '[data-e2e="chip-{{value}}"]',
  chipValues: [0.1, 0.5, 1, 5],
};

function debounce(fn, ms = 200) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function sanitizeChips(raw) {
  const src = raw || {};
  const tpl =
    typeof src.chipSelectorTemplate === 'string' &&
    src.chipSelectorTemplate.includes('{{value}}')
      ? src.chipSelectorTemplate
      : DEFAULT_CHIPS.chipSelectorTemplate;
  let chipValues = Array.isArray(src.chipValues)
    ? src.chipValues
        .map(Number)
        .filter((v) => Number.isFinite(v) && v > 0)
    : [];
  if (!chipValues.length) chipValues = [...DEFAULT_CHIPS.chipValues];
  return { chipSelectorTemplate: tpl, chipValues };
}

export function makeChipRow(value = '') {
  const div = document.createElement('div');
  div.className = 'row chip-row';
  div.innerHTML = `
    <span class="small">Value</span>
    <input type="number" step="0.0001" class="chip-val" value="${
      value !== '' ? value : ''
    }">
    <button class="btn btn-danger btn-del-chip">x</button>
  `;
  return div;
}

export function renderChips(box, vals) {
  box.innerHTML = '';
  (vals && vals.length ? vals : ['']).forEach((v) =>
    box.appendChild(makeChipRow(v))
  );
}

export function getChipsFromUI(box) {
  const vals = [];
  box.querySelectorAll('.chip-val').forEach((inp) => {
    const v = Number(inp.value);
    if (Number.isFinite(v) && v > 0) vals.push(v);
  });
  return vals;
}

export async function loadGlobalChipsUI() {
  const { [GLOBAL_CHIPS_KEY]: g = null, abDozensConfig = null } =
    await sget({ [GLOBAL_CHIPS_KEY]: null, abDozensConfig: null });
  let use = g;
  if (!use && abDozensConfig && abDozensConfig.chipSelectorTemplate) {
    use = sanitizeChips({
      chipSelectorTemplate: abDozensConfig.chipSelectorTemplate,
      chipValues: abDozensConfig.chipValues,
    });
    await sset({
      [GLOBAL_CHIPS_KEY]: use,
      abDozensConfig: {
        triggerStreak:
          Math.max(2, abDozensConfig.triggerStreak | 0) || 2,
        steps: Array.isArray(abDozensConfig.steps)
          ? abDozensConfig.steps
          : [],
        autoContinue: !!abDozensConfig.autoContinue,
        includeZero: !!abDozensConfig.includeZero,
      },
    });
  }
  if (!use) use = DEFAULT_CHIPS;
  const clean = sanitizeChips(use);
  cfgChipTpl.value = clean.chipSelectorTemplate;
  renderChips(chipsBox, clean.chipValues);
  cfgChipsMsg.textContent = 'Loaded global chips';

  // AUTOSAVE wiring
  wireChipsAutosave();
}

export async function saveGlobalChipsFromUI() {
  const tpl = (cfgChipTpl.value || '').trim();
  if (!tpl.includes('{{value}}')) {
    cfgChipsMsg.textContent = 'Template must include {{value}}';
    return;
  }
  const chipValues = getChipsFromUI(chipsBox);
  if (!chipValues.length) {
    cfgChipsMsg.textContent = 'Add at least one chip value';
    return;
  }
  const clean = sanitizeChips({
    chipSelectorTemplate: tpl,
    chipValues,
  });
  await sset({ [GLOBAL_CHIPS_KEY]: clean });
  try {
    const { betLogs = [] } = await sget({ betLogs: [] });
    betLogs.push({
      t: Date.now(),
      type: 'config',
      market: 'global',
      message: 'Global chips saved',
      chipsCount: clean.chipValues.length,
    });
    if (betLogs.length > 2000)
      betLogs.splice(0, betLogs.length - 2000);
    await sset({ betLogs });
  } catch {}
  cfgChipsMsg.textContent = 'Saved global chips';
}

/* ===== AUTOSAVE (template + values) ===== */
const debouncedSaveChips = debounce(
  () => saveGlobalChipsFromUI(),
  200
);

function wireChipsAutosave() {
  // template field
  cfgChipTpl?.addEventListener('input', () => debouncedSaveChips());

  // delegate for value inputs and delete buttons
  chipsBox?.addEventListener('input', (e) => {
    if (e.target && e.target.classList.contains('chip-val'))
      debouncedSaveChips();
  });
  chipsBox?.addEventListener('click', (e) => {
    const btn = e.target?.closest('.btn-del-chip');
    if (!btn) return;
    const row = btn.closest('.chip-row');
    row?.remove();
    debouncedSaveChips();
  });

  // add chip button
  btnAddChip?.addEventListener('click', () => {
    chipsBox.appendChild(makeChipRow());
    debouncedSaveChips();
  });
}
