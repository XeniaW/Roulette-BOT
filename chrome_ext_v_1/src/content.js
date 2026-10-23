(() => {
  if (
    typeof chrome === 'undefined' ||
    !chrome.runtime?.id ||
    !chrome.runtime?.sendMessage ||
    !chrome.storage?.local
  ) {
    return;
  }

  const IS_TOP = (() => {
    try {
      return window.top === window;
    } catch {
      return true;
    }
  })();

  const TITLE_SELECTORS = [
    '[data-test-el="casino-control-bar__title"]',
    '.casino-games-stand-game-frame-header__title',
  ];
  const FRAME_TITLE_REQUEST = 'spins-logger-frame-title-request';
  const FRAME_TITLE_REPLY = 'spins-logger-frame-title-reply';
  let parentTitle = '';
  let titleRequestAt = 0;
  const CONTAINER_ATTR = 'previous-spins-stack';
  const CONTAINER_SEL = `[data-name="${CONTAINER_ATTR}"]`;
  const CELL_PREFIX = 'cell-';
  const CELL_SEL = `[data-name^="${CELL_PREFIX}"]`;

  const BALANCE_VAL_SEL =
    '[data-e2e="balance"] [data-e2e="balance-value"], .style_balanceWrapper__1dya9zx0 [data-e2e="balance-value"], span.account-select-toggle__value, .balance-layout .balance-amount';

  const BALANCE_STOP_CFG_KEY = 'abBalanceStopConfig';
  const BALANCE_STOP_STATE_KEY = 'abBalanceStopState';
  const TRACKED_TABLE_STATES_KEY = 'trackedTableStates';

  const FIND_TICK_MS = 700;
  const RECONCILE_TICK_MS = 1200;
  const HEARTBEAT_MS = 1200;
  const BALANCE_MS = 1800;
  const RECONNECT_MS = 2000;
  const REENTER_MS = 3000;
  const CLICK_THROTTLE_MS = 8000;

  const BALANCE_STOP_DEFAULTS = Object.freeze({
    stopOnMin: false,
    minBalance: 40,
    stopOnMax: false,
    maxBalance: 100,
  });

  const MARKET_STOP_KEYS = [
    {
      enabledKey: 'autoBettingDozensEnabled',
      execKey: 'betExecDozensByTable',
      statusKey: 'bettingStatusDozens',
    },
    {
      enabledKey: 'autoBettingRowsEnabled',
      execKey: 'betExecRowsByTable',
      statusKey: 'bettingStatusRows',
    },
    {
      enabledKey: 'autoBettingSixEnabled',
      execKey: 'betExecSixByTable',
      statusKey: 'bettingStatusSix',
    },
    {
      enabledKey: 'autoBettingThreesEnabled',
      execKey: 'betExecThreesByTable',
      statusKey: 'bettingStatusThrees',
    },
    {
      enabledKey: 'autoBettingLowHighEnabled',
      execKey: 'betExecLowHighByTable',
      statusKey: 'bettingStatusLowHigh',
    },
    {
      enabledKey: 'autoBettingEvenOddEnabled',
      execKey: 'betExecEvenOddByTable',
      statusKey: 'bettingStatusEvenOdd',
    },
    {
      enabledKey: 'autoBettingColorsEnabled',
      execKey: 'betExecColorsByTable',
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
      execKey: 'betExecAntiDozensByTable',
      statusKey: 'bettingStatusAntiDozens',
    },
    {
      enabledKey: 'autoBettingAntiRowsEnabled',
      execKey: 'betExecAntiRowsByTable',
      statusKey: 'bettingStatusAntiRows',
    },
    {
      enabledKey: 'autoBettingNumbersEnabled',
      execKey: 'betExecNumbers',
      statusKey: 'bettingStatusNumbers',
    },
    {
      enabledKey: 'autoBettingMissing19Enabled',
      execKey: 'betExecMissing19ByTable',
      statusKey: 'bettingStatusMissing19',
    },
    {
      enabledKey: 'autoBettingRepeatsEnabled',
      execKey: 'betExecRepeatsByTable',
      statusKey: 'bettingStatusRepeats',
    },
    {
      enabledKey: 'autoBettingCatchXMatchEnabled',
      execKey: 'betExecCatchXMatchByTable',
      statusKey: 'bettingStatusCatchXMatch',
    },
  ];

  let destroyed = false;
  let running = false;
  let observer = null;
  let containerNode = null;
  let waitTimer = null;
  let reconcileTimer = null;
  let heartbeatTimer = null;
  let balanceTimer = null;
  let reconnectTimer = null;
  let reenterTimer = null;
  let lastSnapshot = [];
  let lastStatusSig = '';
  let balanceReadPromise = null;
  let cyclePromise = null;
  let lastGenericClick = 0;
  let lastReenterClick = 0;
  let hadTrackingHere = false;
  let pendingBalanceStop = null;

  let tracked = {
    matched: false,
    tableId: '',
    title: '',
    role: 'off',
    ownsLease: false,
  };

  function ctxValid() {
    return !!chrome?.runtime?.id && !destroyed;
  }

  async function safeGet(defaults) {
    if (!ctxValid()) return defaults || {};
    try {
      return await chrome.storage.local.get(defaults || {});
    } catch {
      return defaults || {};
    }
  }

  async function safeSet(obj) {
    if (!ctxValid()) return;
    try {
      await chrome.storage.local.set(obj);
    } catch {}
  }

  async function sendBg(msg) {
    if (!ctxValid()) return null;
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch {
      return null;
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  let shadowRoots = [];
  let shadowRootsReadAt = -Infinity;
  function getShadowRoots() {
    if (Date.now() - shadowRootsReadAt >= FIND_TICK_MS) {
      shadowRoots = Array.from(document.querySelectorAll('*'))
        .filter(node => node.shadowRoot).map(node => node.shadowRoot);
      shadowRootsReadAt = Date.now();
    }
    return shadowRoots;
  }

  function findOneDeep(selector) {
    const direct = document.querySelector(selector);
    if (direct) return direct;

    for (const root of getShadowRoots()) {
      try {
        const found = root.querySelector(selector);
        if (found) return found;
      } catch {}
    }
    return null;
  }

  function queryAllDeep(selector) {
    const out = [];
    try {
      document
        .querySelectorAll(selector)
        ?.forEach((n) => out.push(n));
    } catch {}

    for (const root of getShadowRoots()) {
      try {
        root
          .querySelectorAll(selector)
          ?.forEach((n) => out.push(n));
      } catch {}
    }
    return out;
  }

  function isVisible(el) {
    const rect = el?.getBoundingClientRect?.();
    if (!rect) return false;
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      getComputedStyle(el).visibility !== 'hidden'
    );
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

  function getCurrentTableTitle() {
    if (!IS_TOP && parentTitle) return parentTitle;
    const titles = new Set();
    for (const sel of TITLE_SELECTORS) {
      for (const root of queryAllDeep(sel)) {
        const cleaned = normalizeText((root.textContent || '').replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' '));
        if (cleaned) titles.add(cleaned);
      }
    }
    return titles.size === 1 ? [...titles][0] : '';
  }

  function titleForChildFrame(source) {
    const iframe = queryAllDeep('iframe').find(node => node.contentWindow === source);
    if (!iframe) return '';
    for (let root = iframe.parentElement; root; root = root.parentElement || root.host) {
      const titles = new Set();
      for (const selector of TITLE_SELECTORS) {
        root.querySelectorAll?.(selector).forEach(node => {
          const title = normalizeText((node.textContent || '').replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' '));
          if (title) titles.add(title);
        });
      }
      if (titles.size === 1) return [...titles][0];
      if (titles.size > 1) return '';
    }
    return getCurrentTableTitle();
  }

  window.addEventListener('message', event => {
    if (event.data?.type === FRAME_TITLE_REQUEST && event.source !== window) {
      const title = titleForChildFrame(event.source);
      if (title) event.source.postMessage({ type: FRAME_TITLE_REPLY, title }, '*');
    } else if (!IS_TOP && event.data?.type === FRAME_TITLE_REPLY && event.source === window.parent) {
      parentTitle = normalizeText(event.data.title);
    }
  });

  function requestParentTitle() {
    if (IS_TOP || !window.parent?.postMessage || parentTitle || Date.now() - titleRequestAt < 1000) return;
    titleRequestAt = Date.now();
    window.parent.postMessage({ type: FRAME_TITLE_REQUEST }, '*');
  }

  function parseBalanceText(txt) {
    if (!txt) return null;
    const clean = String(txt)
      .replace(/\s+/g, '')
      .replace(/[^\d,.\-]/g, '');

    const lastComma = clean.lastIndexOf(',');
    const lastDot = clean.lastIndexOf('.');
    const decimalSep =
      lastComma > -1 && lastDot > -1
        ? lastComma > lastDot
          ? ','
          : '.'
        : lastComma > -1
          ? ','
          : '.';
    const normalized =
      decimalSep === ','
        ? clean.replace(/\./g, '').replace(',', '.')
        : clean.replace(/,/g, '');

    if (!/[0-9]/.test(normalized)) return null;
    const val = Number(normalized);
    return Number.isFinite(val) ? val : null;
  }

  async function readBalanceValue() {
    const wrap =
      findOneDeep('[data-e2e="balance"]') ||
      findOneDeep('.style_balanceWrapper__1dya9zx0') ||
      findOneDeep('.balance-layout');

    const span =
      (wrap && wrap.querySelector?.('[data-e2e="balance-value"]')) ||
      findOneDeep(BALANCE_VAL_SEL);

    if (span) {
      const txt = normalizeText(span.textContent || '');
      const v = parseBalanceText(txt);
      if (v != null) return v;
    }

    if (wrap) {
      const raw = wrap.getAttribute?.('data-true-value');
      if (raw != null) {
        const v = parseBalanceText(String(raw));
        if (v != null) return v;
      }
    }

    return null;
  }

  function mkExecReset(prevExec) {
    const keep =
      prevExec &&
      typeof prevExec === 'object' &&
      !Array.isArray(prevExec)
        ? prevExec
        : {};

    return {
      ...keep,
      enabled: false,
      phase: 'idle',
      target: null,
      step: 1,
      armedAt: 0,
    };
  }

  function isExecMapByTable(execKey, prevValue) {
    if (String(execKey || '').endsWith('ByTable')) return true;
    if (
      !prevValue ||
      typeof prevValue !== 'object' ||
      Array.isArray(prevValue)
    ) {
      return false;
    }

    const values = Object.values(prevValue);
    return (
      values.length > 0 &&
      values.every(
        (v) =>
          v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          ('phase' in v || 'enabled' in v || 'step' in v),
      )
    );
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

  async function appendGlobalBetLog(entry) {
    const { betLogs = [] } = await safeGet({ betLogs: [] });
    const logs = Array.isArray(betLogs) ? betLogs : [];
    logs.push(entry);
    if (logs.length > 2000) logs.splice(0, logs.length - 2000);
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

    const execDefaults = {};
    for (const market of MARKET_STOP_KEYS) {
      execDefaults[market.execKey] = null;
    }
    const execBag = await safeGet(execDefaults);

    for (const market of MARKET_STOP_KEYS) {
      patch[market.enabledKey] = false;

      const prevExec = execBag[market.execKey];
      if (
        tracked.tableId &&
        isExecMapByTable(market.execKey, prevExec)
      ) {
        const nextMap =
          prevExec &&
          typeof prevExec === 'object' &&
          !Array.isArray(prevExec)
            ? { ...prevExec }
            : {};
        nextMap[tracked.tableId] = mkExecReset(
          nextMap[tracked.tableId],
        );
        patch[market.execKey] = nextMap;
      } else {
        patch[market.execKey] = mkExecReset(prevExec);
      }

      patch[market.statusKey] = {
        state: 'off',
        message,
        origin: location.origin,
        at: now,
      };
    }

    await safeSet(patch);

    await appendGlobalBetLog({
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
    if (cfg.stopOnMin && balance <= cfg.minBalance) reason = 'min';
    else if (cfg.stopOnMax && balance >= cfg.maxBalance)
      reason = 'max';

    if (reason === 'min' && cfg.minBalance > 0 && balance <= 0) {
      pendingBalanceStop = null;
      return;
    }

    if (!reason) {
      pendingBalanceStop = null;
      return;
    }
    if (stopState?.triggered && stopState.reason === reason) return;

    if (pendingBalanceStop?.reason !== reason) {
      pendingBalanceStop = {
        reason,
        balance,
        at: Date.now(),
      };
      return;
    }

    pendingBalanceStop = null;

    await stopAllMarketsByBalance(reason, balance, cfg);
  }

  async function pushTrackedStatus(state, message = '') {
    if (!tracked.tableId) return;

    const sig = `${tracked.tableId}::${state}::${message}`;
    if (sig === lastStatusSig) return;
    lastStatusSig = sig;

    await sendBg({
      type: 'TRACKED_TABLE_SET_STATUS',
      tableId: tracked.tableId,
      matchedTitle: tracked.title,
      href: location.href,
      state,
      message,
    });
  }

  function refreshBalanceAndRead(opts = { waitMs: 400 }) {
    if (!balanceReadPromise) {
      balanceReadPromise = readAndReportBalance(opts).finally(() => { balanceReadPromise = null; });
    }
    return balanceReadPromise;
  }

  async function readAndReportBalance(opts) {
    const sourceTableId = tracked.tableId;
    const waitMs = Math.max(0, Number(opts?.waitMs ?? 400));
    const started = Date.now();
    let val = await readBalanceValue();

    while (val == null && Date.now() - started < waitMs) {
      await delay(100);
      val = await readBalanceValue();
    }

    if (Number.isFinite(val) && sourceTableId && sourceTableId === tracked.tableId) {
      await sendBg({
        type: 'TRACKED_TABLE_SET_BALANCE',
        tableId: tracked.tableId,
        matchedTitle: tracked.title,
        href: location.href,
        value: val,
      });

      await evaluateBalanceStop(val);
    }

    return val;
  }

  function extractNumberFromCell(el) {
    const dn = el.getAttribute?.('data-name');
    if (dn && dn.startsWith(CELL_PREFIX)) {
      const num = Number(dn.slice(CELL_PREFIX.length));
      if (Number.isFinite(num)) return num;
    }

    const t = Number(normalizeText(el.textContent || ''));
    return Number.isFinite(t) ? t : null;
  }

  function readCurrentListFrom(containerEl) {
    const cells = containerEl.querySelectorAll(CELL_SEL);
    const arr = [];
    for (const el of cells) {
      const n = extractNumberFromCell(el);
      if (Number.isFinite(n)) arr.push(n);
    }
    return arr;
  }

  async function appendTrackedSpins(numbersArrayOldestFirst) {
    if (!tracked.tableId || !numbersArrayOldestFirst?.length) return;

    const now = Date.now();
    const spins = numbersArrayOldestFirst.map((n) => ({
      n,
      t: now,
      t_iso: new Date(now).toISOString(),
    }));

    await sendBg({
      type: 'TRACKED_TABLE_APPEND_SPINS',
      tableId: tracked.tableId,
      matchedTitle: tracked.title,
      href: location.href,
      spins,
    });
  }

  function handleMutations() {
    if (!containerNode || !tracked.tableId) return;

    const curr = readCurrentListFrom(containerNode);
    if (!curr.length) {
      lastSnapshot = curr;
      return;
    }

    const head = curr[0];
    const prev = lastSnapshot;
    let shouldLog = false;

    if (!prev.length) shouldLog = false;
    else if (head !== prev[0]) shouldLog = true;
    else {
      const prevSecond = prev[1];
      const currSecond = curr[1];
      if (currSecond === head && prevSecond !== head) {
        shouldLog = true;
      }
    }

    if (shouldLog) {
      appendTrackedSpins([head]).catch(() => {});
    }

    lastSnapshot = curr;
  }

  async function startObserving(containerEl) {
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
    hadTrackingHere = true;
    await pushTrackedStatus('ok', 'Tracking active');
    await refreshBalanceAndRead({ waitMs: 500 });
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

    if (waitTimer) {
      clearTimeout(waitTimer);
      waitTimer = null;
    }

    containerNode = null;
    running = false;
  }

  function waitForContainerLoop() {
    if (!tracked.tableId) return;

    let box = document.querySelector(CONTAINER_SEL);
    if (!box) {
      const all = queryAllDeep(CONTAINER_SEL);
      if (all.length) box = all[0];
    }

    if (box) {
      startObserving(box).catch(() => {});
      return;
    }

    waitTimer = setTimeout(waitForContainerLoop, FIND_TICK_MS);
  }

  async function maybeStartTrackingInThisFrame() {
    const { trackingEnabled = false } = await safeGet({
      trackingEnabled: false,
    });

    if (!trackingEnabled || !tracked.tableId || tracked.role !== 'leader') {
      stopObserving();
      return;
    }

    if (running && containerNode?.isConnected) return;
    if (waitTimer) return;

    waitForContainerLoop();
  }

  function setTrackedContext(next) {
    if (tracked.tableId !== next.tableId) {
      stopObserving();
      lastSnapshot = [];
    }
    tracked = next;
  }

  async function syncTrackedContext() {
    requestParentTitle();
    const localTitle = getCurrentTableTitle();

    if (localTitle && (IS_TOP || findOneDeep(CONTAINER_SEL))) {
      const res = await sendBg({
        type:
          tracked.matched && tracked.ownsLease
            ? 'TRACKED_TABLE_HEARTBEAT'
            : 'TRACKED_TABLE_HELLO',
        title: localTitle,
        href: location.href,
      });

      if (res?.matched) {
        setTrackedContext({
          matched: true,
          tableId: String(res.tableId || '').trim(),
          title: String(res.debug?.matchedTitle || localTitle),
          role: String(res.role || 'leader'),
          ownsLease: res.role === 'leader',
        });
        return;
      }
      if (res?.ok) {
        setTrackedContext({ matched: false, tableId: '', title: localTitle, role: 'off', ownsLease: false });
        return;
      }
      // A transient message failure is not an explicit table mismatch.
    }

    const byTab = await sendBg({ type: 'GET_TRACKED_TABLE_FOR_TAB' });
    if (byTab?.matched) {
      setTrackedContext({
        matched: true,
        tableId: String(byTab.tableId || '').trim(),
        title: localTitle || String(byTab.title || ''),
        role: 'leader',
        ownsLease: false,
      });
      return;
    }

    setTrackedContext({
      matched: false,
      tableId: '',
      title: localTitle || '',
      role: 'off',
      ownsLease: false,
    });
  }

  function findReconnectButtons() {
    const candidates = [];
    const btns = Array.from(
      document.querySelectorAll('button, [role="button"]'),
    );
    const roots = getShadowRoots();

    for (const root of roots) {
      try {
        root
          .querySelectorAll('button, [role="button"]')
          .forEach((b) => btns.push(b));
      } catch {}
    }

    for (const b of btns) {
      const text = normalizeText(
        b.textContent || b.getAttribute?.('aria-label') || '',
      );
      if (!text) continue;

      if (
        /reconnect|подключиться|continue|продолжить|i am here|i'm here|i am still here|still here|я здесь|я всё ещё здесь/i.test(
          text,
        )
      ) {
        if (isVisible(b) && !b.disabled) {
          candidates.push(b);
        }
      }
    }

    return candidates;
  }

  function scanAndReconnect() {
    const now = Date.now();
    if (now - lastGenericClick < CLICK_THROTTLE_MS) return;

    const candidates = findReconnectButtons();
    if (candidates.length) {
      lastGenericClick = now;
      clickElement(candidates[0]);
    }
  }

  function findLobbyEntryByTitle(title) {
    if (!title) return null;
    const normTitle = normalizeText(title).toLowerCase();
    if (!normTitle) return null;

    const selectors = [
      '.lobby-table-in',
      '.lobby-table-inner',
      '.lobby-table-info',
      '.lobby-table-name',
      '.lobby-table-title',
      '[class*="lobby-table"]',
      '[class*="table-card"]',
      '[class*="game-card"]',
      '[class*="casino-card"]',
      'a',
      'button',
      '[role="button"]',
    ];

    const seen = new Set();

    for (const selector of selectors) {
      const nodes = queryAllDeep(selector);
      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);

        const text = normalizeText(
          node.textContent || '',
        ).toLowerCase();
        if (!text || !text.includes(normTitle)) continue;
        if (!isVisible(node)) continue;

        const clickable =
          node.closest?.(
            'a,button,[role="button"],.lobby-table-in,.lobby-table-inner',
          ) || node;

        if (clickable && isVisible(clickable)) return clickable;
      }
    }

    return null;
  }

  function tryLobbyReenter() {
    if (!IS_TOP) return;
    if (!tracked.title) return;
    if (getCurrentTableTitle()) return;

    const now = Date.now();
    if (now - lastReenterClick < CLICK_THROTTLE_MS) return;

    const entry = findLobbyEntryByTitle(tracked.title);
    if (entry) {
      lastReenterClick = now;
      clickElement(entry);
    }
  }
  function cycle() {
    if (!cyclePromise) {
      cyclePromise = cycleOnce().finally(() => { cyclePromise = null; });
    }
    return cyclePromise;
  }

  async function cycleOnce() {
    await syncTrackedContext();

    const { trackingEnabled = false } = await safeGet({
      trackingEnabled: false,
    });

    if (!trackingEnabled) {
      stopObserving();
      return;
    }

    if (!tracked.tableId) {
      stopObserving();
      return;
    }

    let box = document.querySelector(CONTAINER_SEL);
    if (!box) {
      const all = queryAllDeep(CONTAINER_SEL);
      if (all.length) box = all[0];
    }

    if (box) {
      await maybeStartTrackingInThisFrame();
      await refreshBalanceAndRead({ waitMs: 250 });
      return;
    }

    if (hadTrackingHere) {
      hadTrackingHere = false;
      stopObserving();
      await pushTrackedStatus(
        'waiting',
        'Waiting for roulette frame',
      );
    }
  }

  function onUnload() {
    destroyed = true;

    if (IS_TOP && tracked.ownsLease && tracked.tableId) {
      sendBg({
        type: 'TRACKED_TABLE_RELEASE',
        tableId: tracked.tableId,
      }).catch(() => {});
    }

    stopObserving();

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (balanceTimer) clearInterval(balanceTimer);
    if (reconnectTimer) clearInterval(reconnectTimer);
    if (reenterTimer) clearInterval(reenterTimer);

    heartbeatTimer = null;
    balanceTimer = null;
    reconnectTimer = null;
    reenterTimer = null;
  }

  function getBetLogsFromStateMap(map, tableId) {
    if (!map || typeof map !== 'object') return [];
    const state =
      map[tableId] && typeof map[tableId] === 'object'
        ? map[tableId]
        : null;
    const logs = Array.isArray(state?.betLogs) ? state.betLogs : [];
    return logs;
  }

  if (chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener(
      (msg, _sender, sendResponse) => {
        if (!msg || typeof msg !== 'object') return;

        if (
          msg.type === 'READ_BALANCE' ||
          msg.type === 'REFRESH_BALANCE'
        ) {
          refreshBalanceAndRead({ waitMs: 400 })
            .then((v) => sendResponse({ ok: true, balance: v }))
            .catch((e) =>
              sendResponse({ ok: false, error: String(e) }),
            );
          return true;
        }
      },
    );
  }

  if (chrome.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener(async (ch, area) => {
      if (area !== 'local' || !tracked.tableId || tracked.role !== 'leader') return;
      if (!running && !IS_TOP) return;
      if (ch[BALANCE_STOP_CFG_KEY]) {
        await refreshBalanceAndRead({ waitMs: 200 });
      }
      const change = ch[TRACKED_TABLE_STATES_KEY];
      if (!change) return;
      const oldLogs = getBetLogsFromStateMap(change.oldValue, tracked.tableId);
      const newLogs = getBetLogsFromStateMap(change.newValue, tracked.tableId);
      const last = newLogs[newLogs.length - 1];
      if (!last || last.balance != null) return;
      if (JSON.stringify(last) === JSON.stringify(oldLogs[oldLogs.length - 1])) return;
      // Only report the balance. Background merges it into the latest logs;
      // content frames must never write stale copies of all tables back.
      await refreshBalanceAndRead({ waitMs: 400 });
    });
  }

  async function init() {
    await cycle();

    heartbeatTimer = setInterval(() => {
      cycle().catch(() => {});
    }, HEARTBEAT_MS);

    balanceTimer = setInterval(() => {
      if (tracked.tableId && tracked.role === 'leader' && (running || IS_TOP)) {
        refreshBalanceAndRead({ waitMs: 250 }).catch(() => {});
      }
    }, BALANCE_MS);

    reconnectTimer = setInterval(() => {
      scanAndReconnect();
    }, RECONNECT_MS);

    reenterTimer = setInterval(() => {
      tryLobbyReenter();
    }, REENTER_MS);

    window.addEventListener('pagehide', onUnload, { once: true });
    window.addEventListener('beforeunload', onUnload, { once: true });
  }

  init().catch(() => {});
})();
