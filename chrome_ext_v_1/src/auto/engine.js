(() => {
  const RETRY_MS = 250;
  const RETRY_TIME_LIMIT_MS = 7000;

  // ---- GLOBAL CHIPS CONFIG ----
  const GLOBAL_CHIPS_KEY = 'abGlobalChips';
  const DEFAULT_CHIPS = Object.freeze({
    chipSelectorTemplate: '[data-e2e="chip-{{value}}"]',
    chipValues: [0.1, 0.5, 1, 5],
  });

  // ---- TRACKED TABLES CONFIG ----
  const TRACKED_TABLES_KEY = 'trackedTables';

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

  // один mutex на все рынки/ставки в текущем документе
  const GLOBAL_BET_MUTEX = (window.__GLOBAL_BET_MUTEX__ ||=
    new Mutex());

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

  async function sendBg(msg) {
    try {
      if (!chrome?.runtime?.id || !chrome?.runtime?.sendMessage) {
        return null;
      }
      return await chrome.runtime.sendMessage(msg);
    } catch {
      return null;
    }
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

    if (!chipValues.length) {
      chipValues = [...DEFAULT_CHIPS.chipValues];
    }

    return {
      chipSelectorTemplate: tpl,
      chipValues,
    };
  }

  async function loadGlobalOnlyChips() {
    const { [GLOBAL_CHIPS_KEY]: cfg = DEFAULT_CHIPS } = await sget({
      [GLOBAL_CHIPS_KEY]: DEFAULT_CHIPS,
    });
    return sanitizeChips(cfg);
  }

  async function getTrackedTableForThisTab() {
    const res = await sendBg({ type: 'GET_TRACKED_TABLE_FOR_TAB' });
    if (!res?.matched || !res?.tableId) return null;
    return {
      tableId: String(res.tableId || '').trim(),
      role: String(res.role || ''),
      title: String(res.title || '').trim(),
    };
  }

  async function loadTrackedTableCustomChips() {
    const tabCtx = await getTrackedTableForThisTab();
    if (!tabCtx?.tableId) return null;

    const { [TRACKED_TABLES_KEY]: rawTables = [] } = await sget({
      [TRACKED_TABLES_KEY]: [],
    });

    const tables = Array.isArray(rawTables) ? rawTables : [];
    const table = tables.find(
      (item) => String(item?.id || '').trim() === tabCtx.tableId,
    );

    if (!table) return null;
    if (table.chipMode !== 'custom') return null;

    const tpl = String(table.customChipTpl || '').trim();
    const vals = Array.isArray(table.customChips)
      ? table.customChips
      : [];

    const clean = sanitizeChips({
      chipSelectorTemplate: tpl || DEFAULT_CHIPS.chipSelectorTemplate,
      chipValues: vals,
    });

    if (!clean.chipValues.length) return null;
    return clean;
  }

  async function loadGlobalChips() {
    // для обратной совместимости имя оставлено тем же,
    // но теперь это "effective chips" для текущего tab/table
    const trackedCustom = await loadTrackedTableCustomChips();
    if (trackedCustom) return trackedCustom;
    return loadGlobalOnlyChips();
  }

  async function saveGlobalChips(cfg) {
    const clean = sanitizeChips(cfg);
    await sset({ [GLOBAL_CHIPS_KEY]: clean });
    return clean;
  }

  function isEnabled(el) {
    if (!el) return false;
    const ds = el.getAttribute?.('data-disabled');
    if (ds === 'true') return false;
    const st = window.getComputedStyle(el);
    return (
      st &&
      st.pointerEvents !== 'none' &&
      st.visibility !== 'hidden' &&
      st.display !== 'none'
    );
  }

  function eventPointFor(el) {
    try {
      const rect = el.getBoundingClientRect?.();
      if (
        rect &&
        Number.isFinite(rect.left) &&
        Number.isFinite(rect.top) &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
    } catch {}

    return { x: 0, y: 0 };
  }

  function dispatchMouseLike(el, type, point) {
    const isDown = type === 'mousedown' || type === 'pointerdown';
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: point.x,
      clientY: point.y,
      screenX: point.x,
      screenY: point.y,
      button: 0,
      buttons: isDown ? 1 : 0,
    };

    try {
      if (type.startsWith('pointer') && typeof PointerEvent === 'function') {
        el.dispatchEvent(
          new PointerEvent(type, {
            ...init,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
          }),
        );
        return;
      }
    } catch {}

    try {
      el.dispatchEvent(new MouseEvent(type, init));
    } catch {}
  }

  async function clickElement(el, opts = {}) {
    if (!el) return;
    const nativeClick = opts.nativeClick !== false;
    const point = eventPointFor(el);
    if (opts.strictTargetClick) {
      const rect = el.getBoundingClientRect?.();
      const hit = document.elementFromPoint(point.x, point.y);
      if (!el.isConnected || !rect || rect.width <= 0 || rect.height <= 0 ||
          !hit || (hit !== el && !el.contains(hit))) return false;
    }

    dispatchMouseLike(el, 'pointerover', point);
    dispatchMouseLike(el, 'pointermove', point);
    dispatchMouseLike(el, 'mouseover', point);
    dispatchMouseLike(el, 'mousemove', point);
    dispatchMouseLike(el, 'pointerdown', point);
    dispatchMouseLike(el, 'mousedown', point);
    dispatchMouseLike(el, 'pointerup', point);
    dispatchMouseLike(el, 'mouseup', point);
    dispatchMouseLike(el, 'click', point);

    if (nativeClick) {
      try {
        el.click?.();
      } catch {}
    }

    await new Promise((r) => setTimeout(r, 30));
    return true;
  }

  async function waitAndClickButton(testId, deadline, tick) {
    const selector = `[data-testid="${testId}"]`;

    while (Date.now() < deadline) {
      const node = document.querySelector(selector);
      if (isEnabled(node)) {
        // Toolbar buttons double-fire if we dispatch a click and also call el.click().
        await clickElement(node, { nativeClick: false });
        await new Promise((r) => setTimeout(r, 120));
        return true;
      }

      await new Promise((r) => setTimeout(r, tick));
    }

    return false;
  }

  async function ensureChipSelected(chipEl) {
    if (!chipEl) return false;

    const isSel = () =>
      chipEl.getAttribute('data-selected') === 'true' ||
      chipEl.getAttribute('aria-pressed') === 'true' ||
      chipEl.classList?.contains('selected') ||
      chipEl.classList?.contains('active');

    if (isSel()) return true;

    await clickElement(chipEl);
    await new Promise((r) => setTimeout(r, 60));
    if (isSel()) return true;

    await clickElement(chipEl);
    await new Promise((r) => setTimeout(r, 120));

    // некоторые столы никак не маркируют выбранную фишку
    return isSel() || true;
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

        // иногда атрибуты бывают без ведущего нуля / с лишними нулями
        const s1 = v.toFixed(1).replace(/\.0+$/, '');
        const s2 = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
        const s3 = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
        variants.add(s1);
        variants.add(s2);
        variants.add(s3);
      } else {
        variants.add(String(Math.trunc(v)));
      }

      let el = null;
      let selUsed = null;

      for (const vv of variants) {
        const sel = template.replace('{{value}}', vv);
        const node = document.querySelector(sel);
        if (node) {
          el = node;
          selUsed = sel;
          break;
        }
      }

      out.push({ node: el, sel: selUsed, value: v });
    }

    return out;
  }

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
      (sum, c) =>
        sum + Number(chipValues[c.i] ?? 0) * Number(c.times ?? 0),
      0,
    );
  }

  async function appendBetLog(entry) {
    try {
      const context = await getTrackedTableForThisTab();
      if (context?.tableId) {
        // Route by the sender's table, never by the popup's selected table.
        await sendBg({ type: 'TRACKED_TABLE_APPEND_BET_LOG', tableId: context.tableId, entry });
        return;
      }
      const { betLogs = [] } = await sget({ betLogs: [] });
      const arr = Array.isArray(betLogs) ? betLogs : [];
      arr.push(entry);
      if (arr.length > 2000) arr.splice(0, arr.length - 2000);
      await sset({ betLogs: arr });
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
    steps,
    getTargetNode,
    mutex,
    maxWaitMs,
    retryMs,
    strictTargetClick = false,
  }) {
    const chips = await loadGlobalChips();

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

    const placeOnce = async () => {
      while (Date.now() < deadline) {
        const chipRefs = selectorsFromTemplate(
          chips.chipValues,
          chips.chipSelectorTemplate,
        );
        const chipNodes = chipRefs.map((x) => x.node);

        const okChips = plan.every((c) => isEnabled(chipNodes[c.i]));
        const tNodes = targets.map((t) => getTargetNode(t));
        const okTargets = tNodes.every(isEnabled);

        if (okChips && okTargets) {
          for (let t = 0; t < targets.length; t++) {
            for (const c of plan) {
              const chipEl = chipNodes[c.i];
              await ensureChipSelected(chipEl);

              for (let k = 0; k < c.times; k++) {
                const targetNode = strictTargetClick ? getTargetNode(targets[t]) : tNodes[t];
                if (strictTargetClick && !isEnabled(targetNode)) return false;
                const clicked = await clickElement(targetNode, strictTargetClick
                  ? { nativeClick: false, strictTargetClick: true } : {});
                if (strictTargetClick && !clicked) return false;
                await new Promise((r) => setTimeout(r, 40));
              }
            }
          }
          return true;
        }

        await new Promise((r) => setTimeout(r, tick));
      }

      return false;
    };

    return GLOBAL_BET_MUTEX.run(() => {
      if (mutex && typeof mutex.run === 'function') {
        return mutex.run(placeOnce);
      }
      return placeOnce();
    });
  }

  async function tryRebetDouble({
    mutex,
    maxWaitMs,
    retryMs,
    doubleTimes,
  } = {}) {
    const timeLimit =
      Number.isFinite(maxWaitMs) && maxWaitMs > 0
        ? Math.floor(maxWaitMs)
        : RETRY_TIME_LIMIT_MS;

    const tick =
      Number.isFinite(retryMs) && retryMs > 0
        ? Math.floor(retryMs)
        : RETRY_MS;

    const doubles = Math.max(1, Math.floor(Number(doubleTimes || 1)));

    const run = async () => {
      const deadline = Date.now() + timeLimit;
      const rebetOk = await waitAndClickButton(
        'bet-toolbar-rebet-button',
        deadline,
        tick,
      );
      if (!rebetOk) return false;

      for (let i = 0; i < doubles; i++) {
        const doubleOk = await waitAndClickButton(
          'bet-toolbar-double-button',
          deadline,
          tick,
        );
        if (!doubleOk) return false;
      }

      return true;
    };

    return GLOBAL_BET_MUTEX.run(() => {
      if (mutex && typeof mutex.run === 'function') {
        return mutex.run(run);
      }
      return run();
    });
  }

  window.BET = {
    sget,
    sset,
    Mutex,
    setBetStatus,
    tryPlace,
    tryRebetDouble,
    perTargetAmountForStep,

    // effective chips for current table/tab
    loadGlobalChips,

    // explicit global-only access if needed later
    loadGlobalOnlyChips,
    loadTrackedTableCustomChips,
    getTrackedTableForThisTab,

    saveGlobalChips,
    sanitizeChips,
    DEFAULT_CHIPS,
    GLOBAL_CHIPS_KEY,
  };
})();
