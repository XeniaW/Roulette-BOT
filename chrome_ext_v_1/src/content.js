/* Content script (MV3)
   Tracks roulette spins displayed under [data-name="previous-spins-stack"].
   - Logs ONLY the current head number exactly once per spin (including repeats like 17→17)
   - Shadow-DOM aware for reconnect button scanning
   - Status is exposed via chrome.storage.local.trackerStatus
   - Logs are stored in chrome.storage.local.spinLogs (capped)
   - Robust against "Extension context invalidated" and frame navigations
*/

(() => {
  // ---------- config ----------
  const CONTAINER_ATTR = 'previous-spins-stack';
  const CELL_PREFIX = 'cell-';
  const CONTAINER_SEL = `[data-name="${CONTAINER_ATTR}"]`;
  const CELL_SEL = `[data-name^="${CELL_PREFIX}"]`;
  const MAX_LOGS = 5000;

  const FIND_TICK_MS = 600; // how often we poll for the container while waiting
  const FIND_ERROR_AFTER_MS = 10000; // after this, we surface a "not found" error (but keep polling)
  const RECONCILE_TICK_MS = 1200; // a light poll to reconcile in case mutations are missed

  // Auto-reconnect constants
  const RECONNECT_SCAN_TICK_MS = 2000;
  const RECONNECT_CLICK_THROTTLE = 10000; // min ms between auto-clicks

  // ---------- state ----------
  let destroyed = false; // document is unloading
  let running = false; // we are actively tracking
  let observer = null; // MutationObserver for the container
  let containerNode = null; // the spins container
  let waitPollTimer = null; // waiting-for-container poll
  let errorTimer = null; // delayed "not found" error
  let reconcileTimer = null; // gentle reconcile poll
  let reconnectTimer = null; // timer for reconnect scans
  let lastReconnectClick = 0; // throttle for reconnect button

  // We keep the last snapshot of the on-screen list (array of numbers, newest first)
  let lastSnapshot = [];

  // Quick beacon for debugging
  try {
    window.__SPINS_LOGGER__ = 'alive';
  } catch {}

  // ---------- utils ----------
  const ctxValid = () =>
    !!(typeof chrome !== 'undefined' && chrome?.runtime?.id) &&
    !destroyed;

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

  // Deep (limited) shadow-aware query helpers
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

  // ---------- logging ----------
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
    if (logs.length > MAX_LOGS)
      logs.splice(0, logs.length - MAX_LOGS);

    await safeSet({ spinLogs: logs });
  }

  // ---------- container & reconciliation ----------
  function extractNumberFromCell(el) {
    // Prefer data-name="cell-XX"
    const dn = el.getAttribute?.('data-name');
    if (dn && dn.startsWith(CELL_PREFIX)) {
      const num = Number(dn.slice(CELL_PREFIX.length));
      if (Number.isFinite(num)) return num;
    }
    // Fallback to text content
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
    // The UI typically shows newest first (leftmost / first element)
    return arr; // newest-first array
  }

  // NOTE: kept for reference, but no longer used to avoid spam/backfill edge cases.
  function diffNewItems(_lastSnap, _currSnap) {
    return [];
  }

  // The ONLY place where we decide to log a number.
  // Rule: log the head once per actual spin (including same-number repeats).
  function handleMutations() {
    if (!containerNode) return;

    const curr = readCurrentListFrom(containerNode); // newest-first
    if (!curr.length) {
      lastSnapshot = curr;
      return;
    }

    const head = curr[0];
    const prev = lastSnapshot;

    let shouldLog = false;

    if (!prev.length) {
      // First attach: don't backfill/log
      shouldLog = false;
    } else if (head !== prev[0]) {
      // Head changed => new spin
      shouldLog = true;
    } else {
      // Head stayed the same. New spin only if a duplicate head was inserted at the front.
      // Example:
      //   prev: [17,  3, ...]
      //   curr: [17, 17, ...]  => log
      const prevSecond = prev[1];
      const currSecond = curr[1];
      if (currSecond === head && prevSecond !== head) {
        shouldLog = true;
      }
    }

    if (shouldLog) {
      appendLogs([head]); // oldest-first array with a single item
    }

    // Update snapshot last so repeated mutation/reconcile calls won't re-log
    lastSnapshot = curr;
  }

  function startObserving(containerEl) {
    stopObserving();

    containerNode = containerEl;
    lastSnapshot = readCurrentListFrom(containerNode); // initialize snapshot (no log)

    observer = new MutationObserver((muts) => {
      // Any childList change can indicate re-render or push; reconcile on each batch
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

    // Gentle reconcile poll (backup)
    reconcileTimer = setInterval(() => {
      if (!containerNode) return;
      handleMutations();
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
    // Try normal query first (fast)
    let box = document.querySelector(CONTAINER_SEL);

    // Shadow-root pass (limited)
    if (!box) {
      const deepMatches = queryAllDeep(document, CONTAINER_SEL);
      if (deepMatches.length) box = deepMatches[0];
    }

    if (box) {
      clearWaiters();
      startObserving(box);
      return;
    }

    // Keep polling
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

    // Begin waiting for the container to appear (if not present yet)
    setStatus('waiting', 'Ожидаем контейнер со спинами…');

    // After a grace period, surface an error (but keep polling)
    clearWaiters();
    errorTimer = setTimeout(() => {
      setStatus(
        'error',
        'Не найден контейнер/классы спинов на странице'
      );
    }, FIND_ERROR_AFTER_MS);

    waitForContainerLoop();
  }

  // ---------- reconnect button ----------
  function clickElement(el) {
    try {
      el.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true })
      );
      el.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true })
      );
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } catch {
      try {
        el.click();
      } catch {}
    }
  }

  function findReconnectCandidates(root = document) {
    const found = [];

    // Preferred: label span with data-e2e starting with "btn-label-..."
    const spans = root.querySelectorAll('[data-e2e^="btn-label-"]');
    for (const span of spans) {
      const text = (span.textContent || '').trim();
      if (/reconnect/i.test(text) || /подключиться/i.test(text)) {
        const btn = span.closest('button');
        if (btn && isElementVisible(btn) && !btn.disabled)
          found.push(btn);
      }
    }

    // Fallback: any visible <button> whose text suggests reconnect
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

    // Shallow shadow roots
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
      // console.debug('[SpinsLogger] Auto Reconnect clicked');
    }
  }

  function startReconnectLoop() {
    if (reconnectTimer) clearInterval(reconnectTimer);
    reconnectTimer = setInterval(
      scanAndReconnect,
      RECONNECT_SCAN_TICK_MS
    );
  }

  function stopReconnectLoop() {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // ---------- lifecycle ----------
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
  }

  async function init() {
    // Begin auto-reconnect loop (safe even if never needed)
    startReconnectLoop();

    // Start tracking (if enabled)
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
    window.addEventListener('beforeunload', onUnload, { once: true });
  }

  init();
})();
