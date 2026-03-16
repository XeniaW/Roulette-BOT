/* Content script (MV3)
   Tracks roulette spins displayed under [data-name="previous-spins-stack"].
   - Logs ONLY the current head number exactly once per spin (including repeats like 17→17)
   - Shadow-DOM aware for reconnect button scanning
   - Status is exposed via chrome.storage.local.trackerStatus
   - Logs are stored in chrome.storage.local.spinLogs (capped)
   - Robust against "Extension context invalidated" and frame navigations
*/

(() => {
  /* ====================== ОБЩЕЕ ====================== */
  const CONTAINER_ATTR = 'previous-spins-stack';
  const CELL_PREFIX = 'cell-';
  const CONTAINER_SEL = `[data-name="${CONTAINER_ATTR}"]`;
  const CELL_SEL = `[data-name^="${CELL_PREFIX}"]`;
  const MAX_LOGS = 5000;

  const FIND_TICK_MS = 600;
  const FIND_ERROR_AFTER_MS = 10000;
  const RECONCILE_TICK_MS = 1200;

  const RECONNECT_SCAN_TICK_MS = 2000;
  const RECONNECT_CLICK_THROTTLE = 10000;

  let destroyed = false;
  let running = false;
  let observer = null;
  let containerNode = null;
  let waitPollTimer = null;
  let errorTimer = null;
  let reconcileTimer = null;
  let reconnectTimer = null;
  let balanceGuardTimer = null;
  let lastReconnectClick = 0;

  let lastSnapshot = [];
  let _isPatchingBetLogs = false;

  try {
    window.__SPINS_LOGGER__ = 'alive';
  } catch {}

  const ctxValid = () =>
    !!(typeof chrome !== 'undefined' && chrome?.runtime?.id) &&
    !destroyed;

  async function safeGet(defs) {
    if (!ctxValid()) return defs || {};
    try {
      return await chrome.storage.local.get(defs || {});
    } catch {
      return defs || {};
    }
  }

  async function safeSet(obj) {
    if (!ctxValid()) return;
    try {
      await chrome.storage.local.set(obj);
    } catch {}
  }

  function setStatus(state, message = '', origin = location.origin) {
    safeSet({
      trackerStatus: { state, message, origin, at: Date.now() },
    });
  }

  function isElementVisible(el) {
    const rect = el.getBoundingClientRect?.();
    if (!rect) return false;
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      getComputedStyle(el).visibility !== 'hidden'
    );
  }

  function queryAllDeep(root, selector) {
    const out = [];
    try {
      root.querySelectorAll(selector)?.forEach((n) => out.push(n));
    } catch {}

    const nodes = root.querySelectorAll
      ? root.querySelectorAll('*')
      : [];
    for (const n of nodes) {
      if (n.shadowRoot) {
        try {
          n.shadowRoot
            .querySelectorAll(selector)
            ?.forEach((m) => out.push(m));
        } catch {}
      }
    }
    return out;
  }

  /* ====================== БАЛАНС ====================== */
  const BALANCE_BTN_SEL =
    'button.balance__refresh.balance-refresh, button[aria-label="Update balance"], button[data-e2e="balance-refresh"]';

  const BALANCE_VAL_SEL =
    '[data-e2e="balance"] [data-e2e="balance-value"], .style_balanceWrapper__1dya9zx0 [data-e2e="balance-value"], span.account-select-toggle__value';

  const BALANCE_STOP_CFG_KEY = 'abBalanceStopConfig';
  const BALANCE_STOP_STATE_KEY = 'abBalanceStopState';
  const BALANCE_RECHECK_MS = 1500;

  const BALANCE_STOP_DEFAULTS = Object.freeze({
    stopOnMin: false,
    minBalance: 40,
    stopOnMax: false,
    maxBalance: 100,
  });

  const MARKET_STOP_KEYS = [
    {
      enabledKey: 'autoBettingDozensEnabled',
      execKey: 'betExecDozens',
      statusKey: 'bettingStatusDozens',
    },
    {
      enabledKey: 'autoBettingRowsEnabled',
      execKey: 'betExecRows',
      statusKey: 'bettingStatusRows',
    },
    {
      enabledKey: 'autoBettingSixEnabled',
      execKey: 'betExecSix',
      statusKey: 'bettingStatusSix',
    },
    {
      enabledKey: 'autoBettingThreesEnabled',
      execKey: 'betExecThrees',
      statusKey: 'bettingStatusThrees',
    },
    {
      enabledKey: 'autoBettingLowHighEnabled',
      execKey: 'betExecLowHigh',
      statusKey: 'bettingStatusLowHigh',
    },
    {
      enabledKey: 'autoBettingEvenOddEnabled',
      execKey: 'betExecEvenOdd',
      statusKey: 'bettingStatusEvenOdd',
    },
    {
      enabledKey: 'autoBettingColorsEnabled',
      execKey: 'betExecColors',
      statusKey: 'bettingStatusColors',
    },
    {
      enabledKey: 'autoBettingSectorsEnabled',
      execKey: 'betExecSectors',
      statusKey: 'bettingStatusSectors',
    },
    {
      enabledKey: 'autoBettingNeighborsEnabled',
      execKey: 'betExecNeighbors',
      statusKey: 'bettingStatusNeighbors',
    },
    {
      enabledKey: 'autoBettingAntiDozensEnabled',
      execKey: 'betExecAntiDozens',
      statusKey: 'bettingStatusAntiDozens',
    },
    {
      enabledKey: 'autoBettingAntiRowsEnabled',
      execKey: 'betExecAntiRows',
      statusKey: 'bettingStatusAntiRows',
    },
    {
      enabledKey: 'autoBettingNumbersEnabled',
      execKey: 'betExecNumbers',
      statusKey: 'bettingStatusNumbers',
    },
  ];

  function findOneDeep(selector) {
    const direct = document.querySelector(selector);
    if (direct) return direct;
    const all = queryAllDeep(document, selector);
    return all.length ? all[0] : null;
  }

  function clickElement(el) {
    try {
      el.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true }),
      );
      el.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } catch {
      try {
        el.click();
      } catch {}
    }
  }

  function parseBalanceText(txt) {
    if (!txt) return null;
    const clean = String(txt)
      .replace(/[^\d,.\-]/g, '')
      .replace(',', '.');
    const val = Number(clean);
    return Number.isFinite(val) ? val : null;
  }

  function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  async function readBalanceValue() {
    const wrap =
      findOneDeep('[data-e2e="balance"]') ||
      findOneDeep('.style_balanceWrapper__1dya9zx0');

    if (wrap) {
      const raw = wrap.getAttribute?.('data-true-value');
      if (raw != null) {
        const v = parseBalanceText(String(raw));
        if (v != null) return v;
      }
    }

    const span =
      (wrap && wrap.querySelector?.('[data-e2e="balance-value"]')) ||
      findOneDeep(BALANCE_VAL_SEL);

    if (span) {
      const txt = (span.textContent || '').trim();
      const v = parseBalanceText(txt);
      if (v != null) return v;
    }

    return null;
  }

  function sanitizeBalanceStopCfg(raw) {
    const cfg = raw || {};

    let minBalance = Number(cfg.minBalance);
    let maxBalance = Number(cfg.maxBalance);

    if (!Number.isFinite(minBalance) || minBalance < 0) {
      minBalance = BALANCE_STOP_DEFAULTS.minBalance;
    }
    if (!Number.isFinite(maxBalance) || maxBalance < 0) {
      maxBalance = BALANCE_STOP_DEFAULTS.maxBalance;
    }

    return {
      stopOnMin: !!cfg.stopOnMin,
      minBalance: Math.round(minBalance * 100) / 100,
      stopOnMax: !!cfg.stopOnMax,
      maxBalance: Math.round(maxBalance * 100) / 100,
    };
  }

  async function appendBetLog(entry) {
    const { betLogs = [] } = await safeGet({ betLogs: [] });
    const logs = Array.isArray(betLogs) ? betLogs : [];
    logs.push(entry);
    if (logs.length > 2000) {
      logs.splice(0, logs.length - 2000);
    }
    await safeSet({ betLogs: logs });
  }

  async function stopAllMarketsByBalance(reason, balance, cfg) {
    const now = Date.now();
    const message =
      reason === 'min'
        ? `STOP ALL: balance ${balance.toFixed(2)} <= min ${cfg.minBalance.toFixed(2)}`
        : `STOP ALL: balance ${balance.toFixed(2)} >= max ${cfg.maxBalance.toFixed(2)}`;

    const patch = {
      [BALANCE_STOP_STATE_KEY]: {
        triggered: true,
        reason,
        balance,
        at: now,
        message,
      },
    };

    for (const market of MARKET_STOP_KEYS) {
      patch[market.enabledKey] = false;
      patch[market.execKey] = {
        enabled: false,
        phase: 'idle',
        target: null,
        step: 1,
        armedAt: 0,
      };
      patch[market.statusKey] = {
        state: 'off',
        message,
        origin: location.origin,
        at: now,
      };
    }

    await safeSet(patch);

    await appendBetLog({
      t: now,
      type: 'guard-stop',
      market: 'global',
      phase: 'off',
      amount: 0,
      balance,
      message,
    });
  }

  async function evaluateBalanceStop(balance) {
    if (!Number.isFinite(balance)) return;

    const {
      [BALANCE_STOP_CFG_KEY]: rawCfg = BALANCE_STOP_DEFAULTS,
      [BALANCE_STOP_STATE_KEY]: stopState = null,
    } = await safeGet({
      [BALANCE_STOP_CFG_KEY]: BALANCE_STOP_DEFAULTS,
      [BALANCE_STOP_STATE_KEY]: null,
    });

    const cfg = sanitizeBalanceStopCfg(rawCfg);

    let reason = null;
    if (cfg.stopOnMin && balance <= cfg.minBalance) {
      reason = 'min';
    } else if (cfg.stopOnMax && balance >= cfg.maxBalance) {
      reason = 'max';
    }

    if (!reason) return;

    if (stopState?.triggered && stopState.reason === reason) {
      return;
    }

    await stopAllMarketsByBalance(reason, balance, cfg);
  }

  async function refreshBalanceAndRead(
    opts = { refresh: false, waitMs: 400 },
  ) {
    const waitMs = Math.max(0, Number(opts?.waitMs ?? 400));

    const started = Date.now();
    let val = await readBalanceValue();
    while (val == null && Date.now() - started < waitMs) {
      await delay(100);
      val = await readBalanceValue();
    }

    if (val != null) {
      await safeSet({
        currentBalance: { value: val, t: Date.now() },
      });
      await evaluateBalanceStop(val);
    }

    return val;
  }

  chrome.runtime.onMessage.addListener(
    (msg, _sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;

      if (
        msg.type === 'READ_BALANCE' ||
        msg.type === 'REFRESH_BALANCE'
      ) {
        refreshBalanceAndRead({
          refresh: msg.type === 'REFRESH_BALANCE',
        })
          .then((v) => sendResponse({ ok: true, balance: v }))
          .catch((e) =>
            sendResponse({ ok: false, error: String(e) }),
          );
        return true;
      }
    },
  );

  chrome.storage.onChanged.addListener(async (ch, area) => {
    if (area !== 'local') return;

    if (ch[BALANCE_STOP_CFG_KEY]) {
      try {
        await refreshBalanceAndRead({
          refresh: false,
          waitMs: 200,
        });
      } catch {}
    }

    if (!ch.betLogs || _isPatchingBetLogs) return;

    const oldArr = Array.isArray(ch.betLogs.oldValue)
      ? ch.betLogs.oldValue
      : [];
    const newArr = Array.isArray(ch.betLogs.newValue)
      ? ch.betLogs.newValue
      : [];

    if (newArr.length <= oldArr.length) return;

    const added = newArr.slice(oldArr.length);
    const needPatch = added.some((e) => e && e.balance == null);
    if (!needPatch) return;

    const bal = await refreshBalanceAndRead({
      refresh: false,
      waitMs: 400,
    });

    const patched = newArr.map((e, idx) => {
      if (idx < oldArr.length) return e;
      if (e && e.balance == null) return { ...e, balance: bal };
      return e;
    });

    try {
      _isPatchingBetLogs = true;
      await safeSet({ betLogs: patched });
    } finally {
      _isPatchingBetLogs = false;
    }
  });

  /* ====================== СПИНЫ ====================== */
  function extractNumberFromCell(el) {
    const dn = el.getAttribute?.('data-name');
    if (dn && dn.startsWith(CELL_PREFIX)) {
      const num = Number(dn.slice(CELL_PREFIX.length));
      if (Number.isFinite(num)) return num;
    }

    const t = Number((el.textContent || '').trim());
    return Number.isFinite(t) ? t : null;
  }

  function readCurrentListFrom(containerEl) {
    const cells = containerEl.querySelectorAll(CELL_SEL);
    const arr = [];
    for (const el of cells) {
      const n = extractNumberFromCell(el);
      if (Number.isFinite(n)) arr.push(n);
    }
    return arr; // newest-first
  }

  async function appendLogs(numbersArrayOldestFirst) {
    if (!numbersArrayOldestFirst?.length) return;

    const { spinLogs = [] } = await safeGet({ spinLogs: [] });
    const logs = Array.isArray(spinLogs) ? spinLogs : [];

    for (const n of numbersArrayOldestFirst) {
      logs.push({
        n,
        t: Date.now(),
        t_iso: new Date().toISOString(),
      });
    }

    if (logs.length > MAX_LOGS) {
      logs.splice(0, logs.length - MAX_LOGS);
    }

    await safeSet({ spinLogs: logs });
  }

  function handleMutations() {
    if (!containerNode) return;

    const curr = readCurrentListFrom(containerNode);
    if (!curr.length) {
      lastSnapshot = curr;
      return;
    }

    const head = curr[0];
    const prev = lastSnapshot;

    let shouldLog = false;

    if (!prev.length) {
      shouldLog = false;
    } else if (head !== prev[0]) {
      shouldLog = true;
    } else {
      const prevSecond = prev[1];
      const currSecond = curr[1];
      if (currSecond === head && prevSecond !== head) {
        shouldLog = true;
      }
    }

    if (shouldLog) {
      appendLogs([head]);
    }

    lastSnapshot = curr;
  }

  function startObserving(containerEl) {
    stopObserving();
    containerNode = containerEl;
    lastSnapshot = readCurrentListFrom(containerNode);

    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') {
          handleMutations();
          break;
        }
      }
    });

    observer.observe(containerNode, {
      childList: true,
      subtree: true,
    });

    reconcileTimer = setInterval(() => {
      if (containerNode) handleMutations();
    }, RECONCILE_TICK_MS);

    running = true;
    setStatus('ok', 'Трекинг активен');
  }

  function stopObserving() {
    if (observer) {
      try {
        observer.disconnect();
      } catch {}
      observer = null;
    }

    if (reconcileTimer) {
      clearInterval(reconcileTimer);
      reconcileTimer = null;
    }

    containerNode = null;
    running = false;
  }

  function clearWaiters() {
    if (waitPollTimer) {
      clearTimeout(waitPollTimer);
      waitPollTimer = null;
    }
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
  }

  function waitForContainerLoop() {
    let box = document.querySelector(CONTAINER_SEL);
    if (!box) {
      const deepMatches = queryAllDeep(document, CONTAINER_SEL);
      if (deepMatches.length) box = deepMatches[0];
    }

    if (box) {
      clearWaiters();
      startObserving(box);
      return;
    }

    waitPollTimer = setTimeout(waitForContainerLoop, FIND_TICK_MS);
  }

  async function tryStart() {
    const { trackingEnabled = false } = await safeGet({
      trackingEnabled: false,
    });

    if (!trackingEnabled) {
      setStatus('off', 'Трекинг выключен');
      stopObserving();
      return;
    }

    if (running && containerNode?.isConnected) return;

    setStatus('waiting', 'Ожидаем контейнер со спинами…');
    clearWaiters();

    errorTimer = setTimeout(() => {
      setStatus(
        'error',
        'Не найден контейнер/классы спинов на странице',
      );
    }, FIND_ERROR_AFTER_MS);

    waitForContainerLoop();
  }

  function findReconnectCandidates(root = document) {
    const found = [];

    const spans = root.querySelectorAll('[data-e2e^="btn-label-"]');
    for (const span of spans) {
      const text = (span.textContent || '').trim();
      if (/reconnect/i.test(text) || /подключиться/i.test(text)) {
        const btn = span.closest('button');
        if (btn && isElementVisible(btn) && !btn.disabled) {
          found.push(btn);
        }
      }
    }

    const btns = root.querySelectorAll('button');
    for (const b of btns) {
      const text = (b.textContent || '').trim();
      if (
        (/reconnect/i.test(text) || /подключиться/i.test(text)) &&
        isElementVisible(b) &&
        !b.disabled
      ) {
        found.push(b);
      }
    }

    return found;
  }

  function scanAndReconnect() {
    const now = Date.now();
    if (now - lastReconnectClick < RECONNECT_CLICK_THROTTLE) return;

    let candidates = findReconnectCandidates(document);
    const hosts = document.querySelectorAll('*');

    for (const h of hosts) {
      if (!h.shadowRoot) continue;
      try {
        const inner = findReconnectCandidates(h.shadowRoot);
        if (inner.length) candidates = candidates.concat(inner);
      } catch {}
    }

    if (candidates.length) {
      lastReconnectClick = now;
      clickElement(candidates[0]);
    }
  }

  function startReconnectLoop() {
    if (reconnectTimer) clearInterval(reconnectTimer);
    reconnectTimer = setInterval(
      scanAndReconnect,
      RECONNECT_SCAN_TICK_MS,
    );
  }

  function stopReconnectLoop() {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function onSettingsChanged(changes, area) {
    if (area !== 'local') return;

    if ('trackingEnabled' in changes) {
      const enabled = !!changes.trackingEnabled.newValue;

      if (!enabled) {
        stopObserving();
        clearWaiters();
        setStatus('off', 'Трекинг выключен');
      } else {
        tryStart();
      }
    }
  }

  function onUnload() {
    destroyed = true;
    stopObserving();
    stopReconnectLoop();
    clearWaiters();

    if (balanceGuardTimer) {
      clearInterval(balanceGuardTimer);
      balanceGuardTimer = null;
    }
  }

  async function init() {
    startReconnectLoop();

    try {
      await refreshBalanceAndRead({ refresh: false, waitMs: 600 });
    } catch {}

    if (balanceGuardTimer) clearInterval(balanceGuardTimer);
    balanceGuardTimer = setInterval(() => {
      refreshBalanceAndRead({ refresh: false, waitMs: 300 }).catch(
        () => {},
      );
    }, BALANCE_RECHECK_MS);

    if (
      document.readyState === 'complete' ||
      document.readyState === 'interactive'
    ) {
      tryStart();
    } else {
      window.addEventListener('DOMContentLoaded', tryStart, {
        once: true,
      });
    }

    chrome.storage.onChanged.addListener(onSettingsChanged);
    window.addEventListener('pagehide', onUnload, { once: true });
    window.addEventListener('beforeunload', onUnload, {
      once: true,
    });
  }

  init();
})();
