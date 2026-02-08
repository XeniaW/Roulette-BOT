(() => {
  const RETRY_MS = 250;
  const RETRY_TIME_LIMIT_MS = 7000;

  // ---- GLOBAL CHIPS CONFIG ----
  const GLOBAL_CHIPS_KEY = 'abGlobalChips';
  const DEFAULT_CHIPS = Object.freeze({
    chipSelectorTemplate: '[data-e2e="chip-{{value}}"]',
    chipValues: [0.1, 0.5, 1, 5],
  });

  class Mutex {
    constructor() {
      this._p = Promise.resolve();
    }
    async run(fn) {
      const p = this._p;
      let release;
      this._p = new Promise((r) => (release = r));
      try {
        await p;
        return await fn();
      } finally {
        release();
      }
    }
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

  function sanitizeChips(raw) {
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
    if (!chipValues.length)
      chipValues = [...DEFAULT_CHIPS.chipValues];
    return { chipSelectorTemplate: tpl, chipValues };
  }

  async function loadGlobalChips() {
    const { [GLOBAL_CHIPS_KEY]: cfg = DEFAULT_CHIPS } = await sget({
      [GLOBAL_CHIPS_KEY]: DEFAULT_CHIPS,
    });
    return sanitizeChips(cfg);
  }
  async function saveGlobalChips(cfg) {
    const clean = sanitizeChips(cfg);
    await sset({ [GLOBAL_CHIPS_KEY]: clean });
    return clean;
  }

  // ---- DOM helpers ----
  function isEnabled(el) {
    if (!el) return false;
    const ds = el.getAttribute?.('data-disabled');
    if (ds === 'true') return false;
    const st = window.getComputedStyle(el);
    return (
      st && st.pointerEvents !== 'none' && st.visibility !== 'hidden'
    );
  }
  async function clickElement(el) {
    try {
      el.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    } catch {
      try {
        el.click?.();
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 30));
  }

  function selectorsFromTemplate(chipValues, template) {
    const out = [];
    for (const v of chipValues) {
      const variants = new Set();
      variants.add(String(v));
      if (!Number.isInteger(v)) {
        variants.add(v.toString());
        variants.add(v.toFixed(1));
        variants.add(v.toFixed(2));
        variants.add(v.toFixed(3));
      } else {
        variants.add(String(Math.trunc(v)));
      }
      let el = null,
        selUsed = null;
      for (const vv of variants) {
        const sel = template.replace('{{value}}', vv);
        const node = document.querySelector(sel);
        if (node) {
          el = node;
          selUsed = sel;
          break;
        }
      }
      out.push({ node: el, sel: selUsed });
    }
    return out;
  }

  // steps: массив шагов; каждый шаг — массив {chip:1-based, times}
  function planForStep(step, steps, chipCount) {
    const idx = Math.max(0, Math.min(steps.length - 1, step - 1));
    const plan = steps[idx] || [{ chip: 1, times: 1 }];
    return plan.map((it) => ({
      i: Math.max(0, Math.min(chipCount - 1, (it.chip | 0) - 1)),
      times: Math.max(1, it.times | 0),
    }));
  }
  function perTargetAmountForStep(step, steps, chipValues) {
    const plan = planForStep(step, steps, chipValues.length);
    return plan.reduce(
      (s, c) =>
        s + Number(chipValues[c.i] ?? 0) * Number(c.times ?? 0),
      0
    );
  }

  async function appendBetLog(entry) {
    try {
      const { betLogs = [] } = await sget({ betLogs: [] });
      betLogs.push(entry);
      if (betLogs.length > 2000)
        betLogs.splice(0, betLogs.length - 2000);
      await sset({ betLogs });
    } catch {}
  }

  function setBetStatus(key, state, message) {
    const obj = {};
    obj[key] = {
      state,
      message,
      at: Date.now(),
      origin: location.origin,
    };
    try {
      chrome.storage.local.set(obj);
    } catch {}
    appendBetLog({
      t: Date.now(),
      type: 'event',
      market: key,
      phase: state,
      message,
    });
  }

  // Универсальная постановка: использует ГЛОБАЛЬНЫЕ фишки + локальные steps
  async function tryPlace({
    step,
    targets,
    steps,
    getTargetNode,
    mutex,

    // ✅ новые опции (не обязательные)
    maxWaitMs,
    retryMs,
  }) {
    const chips = await loadGlobalChips(); // {chipSelectorTemplate, chipValues}

    const timeLimit =
      Number.isFinite(maxWaitMs) && maxWaitMs > 0
        ? Math.floor(maxWaitMs)
        : RETRY_TIME_LIMIT_MS;

    const tick =
      Number.isFinite(retryMs) && retryMs > 0
        ? Math.floor(retryMs)
        : RETRY_MS;

    const deadline = Date.now() + timeLimit;
    const plan = planForStep(step, steps, chips.chipValues.length);

    return mutex.run(async () => {
      while (Date.now() < deadline) {
        const chipNodes = selectorsFromTemplate(
          chips.chipValues,
          chips.chipSelectorTemplate
        ).map((x) => x.node);

        const okChips = plan.every((c) => isEnabled(chipNodes[c.i]));
        const tNodes = targets.map((t) => getTargetNode(t));
        const okTargets = tNodes.every(isEnabled);

        if (okChips && okTargets) {
          for (let t = 0; t < targets.length; t++) {
            for (const c of plan) {
              await clickElement(chipNodes[c.i]);
              for (let k = 0; k < c.times; k++) {
                await clickElement(tNodes[t]);
                await new Promise((r) => setTimeout(r, 40));
              }
            }
          }
          return true;
        }

        await new Promise((r) => setTimeout(r, tick));
      }
      return false;
    });
  }

  window.BET = {
    sget,
    sset,
    Mutex,
    setBetStatus,
    tryPlace,
    perTargetAmountForStep,
    // global chips API (для popup.js)
    loadGlobalChips,
    saveGlobalChips,
    sanitizeChips,
    DEFAULT_CHIPS,
    GLOBAL_CHIPS_KEY,
  };
})();
