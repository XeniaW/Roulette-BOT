(() => {
  const RETRY_MS = 250;
  const RETRY_TIME_LIMIT_MS = 7000;

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
      } else variants.add(String(Math.trunc(v)));
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

  function chipsForStep(step, cfg) {
    const steps = cfg.steps;
    const idx = Math.max(0, Math.min(steps.length - 1, step - 1));
    const plan = steps[idx] || [{ chip: 1, times: 1 }];
    return plan.map((it) => ({
      i: Math.max(0, it.chip - 1),
      times: it.times,
    }));
  }
  function perTargetAmountForStep(step, cfg) {
    return chipsForStep(step, cfg).reduce(
      (s, c) =>
        s + Number(cfg.chipValues[c.i] ?? 0) * Number(c.times ?? 0),
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

  async function tryPlace({
    step,
    targets,
    cfg,
    getTargetNode,
    mutex,
  }) {
    const deadline = Date.now() + RETRY_TIME_LIMIT_MS;
    const plan = chipsForStep(step, cfg);
    return mutex.run(async () => {
      while (Date.now() < deadline) {
        const chipNodes = selectorsFromTemplate(
          cfg.chipValues,
          cfg.chipSelectorTemplate
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
          if (cfg.placeButtonSel) {
            const btn = document.querySelector(cfg.placeButtonSel);
            if (isEnabled(btn)) await clickElement(btn);
          }
          return true;
        }
        await new Promise((r) => setTimeout(r, RETRY_MS));
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
  };
})();
