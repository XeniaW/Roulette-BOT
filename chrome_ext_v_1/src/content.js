/* Content script (MV3)
   1) Трекинг спинов (как было).
   2) Чтение баланса напрямую из DOM (data-true-value -> [data-e2e="balance-value"]), без кликов.
   3) Автопрошивка balance в новые записи betLogs.
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
  let lastReconnectClick = 0;

  let lastSnapshot = [];
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
  // Кнопка нам больше не нужна, но селектор оставим (на будущее/совместимость)
  const BALANCE_BTN_SEL =
    'button.balance__refresh.balance-refresh, button[aria-label="Update balance"], button[data-e2e="balance-refresh"]';

  // Значение баланса: поддерживаем новую и старую разметку
  const BALANCE_VAL_SEL =
    '[data-e2e="balance"] [data-e2e="balance-value"], .style_balanceWrapper__1dya9zx0 [data-e2e="balance-value"], span.account-select-toggle__value';

  function findOneDeep(selector) {
    const direct = document.querySelector(selector);
    if (direct) return direct;
    const all = queryAllDeep(document, selector);
    return all.length ? all[0] : null;
  }

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

  function parseBalanceText(txt) {
    if (!txt) return null;
    // нормализуем: убираем пробелы/неразрывные, заменяем запятую на точку
    const clean = txt.replace(/[^\d,.\-]/g, '').replace(',', '.');
    const val = Number(clean);
    return Number.isFinite(val) ? val : null;
  }

  function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  // === МИНИ-ПРАВКА #1: читаем баланс напрямую из DOM
  async function readBalanceValue() {
    // 1) ищем контейнер с балансом
    const wrap =
      findOneDeep('[data-e2e="balance"]') ||
      findOneDeep('.style_balanceWrapper__1dya9zx0');

    // сначала пробуем data-true-value
    if (wrap) {
      const raw = wrap.getAttribute?.('data-true-value');
      if (raw != null) {
        const v = parseBalanceText(String(raw));
        if (v != null) return v;
      }
    }

    // затем fallback: текст из [data-e2e="balance-value"] (или старого селектора)
    const span =
      (wrap && wrap.querySelector?.('[data-e2e="balance-value"]')) ||
      findOneDeep(BALANCE_VAL_SEL);

    if (span) {
      const txt = (span.textContent || '').trim();
      const v2 = parseBalanceText(txt);
      if (v2 != null) return v2;
    }

    return null;
  }

  // === МИНИ-ПРАВКА #2: больше не кликаем по кнопке — просто читаем текущее значение
  async function refreshBalanceAndRead(
    opts = { refresh: false, waitMs: 400 }
  ) {
    const waitMs = Math.max(0, Number(opts?.waitMs ?? 400));

    // читаем прямо из DOM; если ещё не смонтировалось — подождём чуть-чуть
    const started = Date.now();
    let val = await readBalanceValue();
    while (val == null && Date.now() - started < waitMs) {
      await delay(100);
      val = await readBalanceValue();
    }

    if (val != null)
      await safeSet({
        currentBalance: { value: val, t: Date.now() },
      });
    return val;
  }

  // Ответы на сообщения из попапа/бэкграунда (совместимость сохранена)
  chrome.runtime.onMessage.addListener(
    (msg, _sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      if (
        msg.type === 'READ_BALANCE' ||
        msg.type === 'REFRESH_BALANCE'
      ) {
        refreshBalanceAndRead({
          // refresh игнорируется внутри функции
          refresh: msg.type === 'REFRESH_BALANCE',
        })
          .then((v) => sendResponse({ ok: true, balance: v }))
          .catch((e) =>
            sendResponse({ ok: false, error: String(e) })
          );
        return true; // async reply
      }
    }
  );

  // Автопрошивка баланса в новые записи betLogs
  let _isPatchingBetLogs = false;
  chrome.storage.onChanged.addListener(async (ch, area) => {
    if (area !== 'local') return;
    if (!ch.betLogs || _isPatchingBetLogs) return;

    const oldArr = Array.isArray(ch.betLogs.oldValue)
      ? ch.betLogs.oldValue
      : [];
    const newArr = Array.isArray(ch.betLogs.newValue)
      ? ch.betLogs.newValue
      : [];
    if (newArr.length <= oldArr.length) return;

    // проверяем, есть ли у добавленных элементов поле balance
    const added = newArr.slice(oldArr.length);
    const needPatch = added.some((e) => e && e.balance == null);

    if (!needPatch) return;

    // читаем актуальный баланс (без кликов)
    const bal = await refreshBalanceAndRead({
      refresh: false,
      waitMs: 400,
    });

    // пришиваем баланс только к новым без balance
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

  /* ====================== СПИНЫ (как было) ====================== */
  function readCurrentListFrom(containerEl) {
    const cells = containerEl.querySelectorAll(CELL_SEL);
    const arr = [];
    for (const el of cells) {
      const n = extractNumberFromCell(el);
      if (Number.isFinite(n)) arr.push(n);
    }
    return arr; // newest-first
  }

  function extractNumberFromCell(el) {
    const dn = el.getAttribute?.('data-name');
    if (dn && dn.startsWith(CELL_PREFIX)) {
      const num = Number(dn.slice(CELL_PREFIX.length));
      if (Number.isFinite(num)) return num;
    }
    const t = Number((el.textContent || '').trim());
    return Number.isFinite(t) ? t : null;
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
    if (logs.length > MAX_LOGS)
      logs.splice(0, logs.length - MAX_LOGS);
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
    if (!prev.length) shouldLog = false;
    else if (head !== prev[0]) shouldLog = true;
    else {
      const prevSecond = prev[1];
      const currSecond = curr[1];
      if (currSecond === head && prevSecond !== head)
        shouldLog = true;
    }

    if (shouldLog) appendLogs([head]);
    lastSnapshot = curr;
  }

  function startObserving(containerEl) {
    stopObserving();
    containerNode = containerEl;
    lastSnapshot = readCurrentListFrom(containerNode);
    observer = new MutationObserver((muts) => {
      for (const m of muts)
        if (m.type === 'childList') {
          handleMutations();
          break;
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
        'Не найден контейнер/классы спинов на странице'
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
        if (btn && isElementVisible(btn) && !btn.disabled)
          found.push(btn);
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
      RECONNECT_SCAN_TICK_MS
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
  }

  async function init() {
    startReconnectLoop();

    // начальное снятие баланса в фоне (без клика)
    try {
      await refreshBalanceAndRead({ refresh: false, waitMs: 600 });
    } catch {}

    if (
      document.readyState === 'complete' ||
      document.readyState === 'interactive'
    )
      tryStart();
    else
      window.addEventListener('DOMContentLoaded', tryStart, {
        once: true,
      });

    chrome.storage.onChanged.addListener(onSettingsChanged);
    window.addEventListener('pagehide', onUnload, { once: true });
    window.addEventListener('beforeunload', onUnload, { once: true });
  }

  init();
})();
