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
  let patchingBetLogs = false;
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

  function findOneDeep(selector) {
    const direct = document.querySelector(selector);
    if (direct) return direct;

    const all = document.querySelectorAll('*');
    for (const node of all) {
      if (!node.shadowRoot) continue;
      try {
        const found = node.shadowRoot.querySelector(selector);
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

    const all = document.querySelectorAll('*');
    for (const node of all) {
      if (!node.shadowRoot) continue;
      try {
        node.shadowRoot
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
    for (const sel of TITLE_SELECTORS) {
      const root = findOneDeep(sel);
      if (!root) continue;

      const rawText = normalizeText(root.textContent || '');
      if (!rawText) continue;

      const cleaned = normalizeText(
        rawText.replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' '),
      );

      if (cleaned) return cleaned;
    }

    return '';
  }

  function parseBalanceText(txt) {
    if (!txt) return null;
    const clean = String(txt)
      .replace(/[^\d,.\-]/g, '')
      .replace(',', '.');
    const val = Number(clean);
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

  async function refreshBalanceAndRead(opts = { waitMs: 400 }) {
    const waitMs = Math.max(0, Number(opts?.waitMs ?? 400));
    const started = Date.now();
    let val = await readBalanceValue();

    while (val == null && Date.now() - started < waitMs) {
      await delay(100);
      val = await readBalanceValue();
    }

    if (Number.isFinite(val) && tracked.tableId) {
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

    if (!trackingEnabled || !tracked.tableId) {
      stopObserving();
      return;
    }

    if (running && containerNode?.isConnected) return;
    if (waitTimer) return;

    waitForContainerLoop();
  }

  async function syncTrackedContext() {
    const localTitle = getCurrentTableTitle();

    if (IS_TOP && localTitle) {
      const res = await sendBg({
        type:
          tracked.matched && tracked.ownsLease
            ? 'TRACKED_TABLE_HEARTBEAT'
            : 'TRACKED_TABLE_HELLO',
        title: localTitle,
        href: location.href,
      });

      if (res?.matched) {
        tracked = {
          matched: true,
          tableId: String(res.tableId || '').trim(),
          title: localTitle,
          role: String(res.role || 'leader'),
          ownsLease: true,
        };
        return;
      }
    }

    const byTab = await sendBg({ type: 'GET_TRACKED_TABLE_FOR_TAB' });
    if (byTab?.matched) {
      tracked = {
        matched: true,
        tableId: String(byTab.tableId || '').trim(),
        title: localTitle || String(byTab.title || ''),
        role: 'leader',
        ownsLease: IS_TOP,
      };
      return;
    }

    tracked = {
      matched: false,
      tableId: '',
      title: localTitle || '',
      role: 'off',
      ownsLease: false,
    };
  }

  function findReconnectButtons() {
    const candidates = [];
    const btns = Array.from(
      document.querySelectorAll('button, [role="button"]'),
    );
    const roots = Array.from(document.querySelectorAll('*'))
      .filter((n) => n.shadowRoot)
      .map((n) => n.shadowRoot);

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
  async function cycle() {
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
      if (area !== 'local') return;

      if (ch[BALANCE_STOP_CFG_KEY]) {
        try {
          await refreshBalanceAndRead({ waitMs: 200 });
        } catch {}
      }

      if (
        ch[TRACKED_TABLE_STATES_KEY] &&
        !patchingBetLogs &&
        tracked.tableId
      ) {
        const oldStates =
          ch[TRACKED_TABLE_STATES_KEY].oldValue &&
          typeof ch[TRACKED_TABLE_STATES_KEY].oldValue === 'object'
            ? ch[TRACKED_TABLE_STATES_KEY].oldValue
            : {};
        const newStates =
          ch[TRACKED_TABLE_STATES_KEY].newValue &&
          typeof ch[TRACKED_TABLE_STATES_KEY].newValue === 'object'
            ? ch[TRACKED_TABLE_STATES_KEY].newValue
            : {};

        const oldArr = getBetLogsFromStateMap(
          oldStates,
          tracked.tableId,
        );
        const newArr = getBetLogsFromStateMap(
          newStates,
          tracked.tableId,
        );

        if (newArr.length > oldArr.length) {
          const added = newArr.slice(oldArr.length);
          const needPatch = added.some((e) => e && e.balance == null);

          if (needPatch) {
            const bal = await refreshBalanceAndRead({ waitMs: 400 });

            if (Number.isFinite(bal)) {
              const currentState =
                newStates[tracked.tableId] &&
                typeof newStates[tracked.tableId] === 'object'
                  ? { ...newStates[tracked.tableId] }
                  : {};

              const patchedBetLogs = newArr.map((e, idx) => {
                if (idx < oldArr.length) return e;
                if (e && e.balance == null) {
                  return { ...e, balance: bal };
                }
                return e;
              });

              const patchedStates = {
                ...newStates,
                [tracked.tableId]: {
                  ...currentState,
                  betLogs: patchedBetLogs,
                },
              };

              try {
                patchingBetLogs = true;
                await safeSet({
                  [TRACKED_TABLE_STATES_KEY]: patchedStates,
                });
              } finally {
                patchingBetLogs = false;
              }
            }
          }
        }
      }

      if (!ch.betLogs || patchingBetLogs) return;

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

      const bal = await refreshBalanceAndRead({ waitMs: 400 });

      const patched = newArr.map((e, idx) => {
        if (idx < oldArr.length) return e;
        if (e && e.balance == null && Number.isFinite(bal)) {
          return { ...e, balance: bal };
        }
        return e;
      });

      try {
        patchingBetLogs = true;
        await safeSet({ betLogs: patched });
      } finally {
        patchingBetLogs = false;
      }
    });
  }

  async function init() {
    await cycle();

    heartbeatTimer = setInterval(() => {
      cycle().catch(() => {});
    }, HEARTBEAT_MS);

    balanceTimer = setInterval(() => {
      if (tracked.tableId) {
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
