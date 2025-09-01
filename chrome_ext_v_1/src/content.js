/* Content Script (bundled/obfuscatable)
   - Reconciler: always reads the entire [data-name="previous-spins-stack"] list
   - Adds ONLY the true new head items; fills missed spins; dedupes
   - CSV export uses local times; NO href saved
   - Auto-clicks "Reconnect" button when it appears idle
*/

(() => {
  const CONTAINER_SEL = '[data-name="previous-spins-stack"]';
  const CELL_SEL = '[data-name^="cell-"]';
  const MAX_LOGS = 5000;

  // Auto-click "Reconnect"
  const RECONNECT_BTN_SEL =
    'button.style_disconnectionClassName__3evqb1, button .css-12c392l-StyledButton-textStyles-afterStyles-afterStyles-sparseClassName-transparentClassName';

  let observer = null;
  let destroyed = false;
  let snapshot = []; // latest DOM numbers (left→right or order in DOM)
  let tracking = false;

  function setStatus(state, message) {
    try {
      chrome.storage.local.set({
        trackerStatus: {
          state,
          message,
          origin: location.origin,
          at: Date.now(),
        },
      });
    } catch {}
  }

  function parseCells(container) {
    // returns array of numbers in DOM order
    const out = [];
    container.querySelectorAll(CELL_SEL).forEach((el) => {
      const dn = el.getAttribute('data-name') || '';
      const nv = Number(dn.replace('cell-', ''));
      if (Number.isFinite(nv)) out.push(nv);
      else {
        const txt = Number((el.textContent || '').trim());
        if (Number.isFinite(txt)) out.push(txt);
      }
    });
    return out;
  }

  async function getLogs() {
    try {
      const { spinLogs = [] } = await chrome.storage.local.get({
        spinLogs: [],
      });
      return Array.isArray(spinLogs) ? spinLogs : [];
    } catch {
      return [];
    }
  }

  async function setLogs(next) {
    try {
      await chrome.storage.local.set({
        spinLogs: next.slice(-MAX_LOGS),
      });
    } catch {}
  }

  // Reconcile: compute new head elements and append to logs
  async function reconcile(domList) {
    // If DOM list is empty, nothing to do
    if (!domList.length) return;

    // On first run: adopt full list as snapshot, but DO NOT backfill history
    if (!snapshot.length) {
      snapshot = domList.slice();
      return;
    }

    // If the head differs, find how many new items were prepended
    // We search for the first position in domList where the tail aligns with snapshot[0]
    let added = [];
    if (domList[0] !== snapshot[0]) {
      // find k so that domList[k] == snapshot[0]
      let k = -1;
      for (
        let i = 0;
        i < Math.min(domList.length, snapshot.length);
        i++
      ) {
        if (domList[i] === snapshot[0]) {
          k = i;
          break;
        }
      }
      if (k === -1) {
        // no overlap: treat entire domList as new head (conservative; provider might truncate list)
        added = domList.slice(0, 1); // add only the first (latest) to avoid burst
      } else if (k > 0) {
        // domList[0..k-1] are truly new (latest first). We want chronological append.
        added = domList.slice(0, k).reverse();
      }
    }

    if (added.length) {
      const now = Date.now();
      const iso = new Date(now).toISOString();
      const logs = await getLogs();
      for (const n of added) {
        // prevent accidental immediate duplicates (same n at same ms)
        const last = logs[logs.length - 1];
        if (!(last && last.n === n && now - last.t < 400)) {
          logs.push({ n, t: now, t_iso: iso });
        }
      }
      await setLogs(logs);
    }

    // Update snapshot to current domList
    snapshot = domList.slice();
  }

  // Debounced evaluator when mutations arrive
  let tickTimer = null;
  const TICK_MS = 60;
  function scheduleTick(container) {
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = setTimeout(async () => {
      tryAutoReconnect();
      const list = parseCells(container);
      await reconcile(list);
    }, TICK_MS);
  }

  function tryAutoReconnect() {
    try {
      const btn =
        document.querySelector(RECONNECT_BTN_SEL) ||
        [...document.querySelectorAll('button')].find((b) =>
          /Reconnect/i.test(b.textContent || '')
        );
      if (btn && !btn.disabled) btn.click();
    } catch {}
  }

  function start() {
    if (observer) return;
    const container = document.querySelector(CONTAINER_SEL);
    if (!container) {
      setStatus('waiting', 'Ожидаем контейнер…');
      // Poll for the container
      const poll = setInterval(() => {
        if (destroyed) return clearInterval(poll);
        const c = document.querySelector(CONTAINER_SEL);
        if (c) {
          clearInterval(poll);
          snapshot = [];
          attach(c);
        }
      }, 400);
      // Safety error after 10s
      setTimeout(() => {
        const c = document.querySelector(CONTAINER_SEL);
        if (!c)
          setStatus('error', 'Не найден контейнер/классы спинов');
      }, 10000);
      return;
    }
    snapshot = [];
    attach(container);
  }

  function attach(container) {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      scheduleTick(container);
    });
    observer.observe(container, { childList: true, subtree: true });
    // initial read
    scheduleTick(container);
    setStatus('ok', 'Трекинг активен');
  }

  function stop() {
    if (observer) observer.disconnect();
    observer = null;
    setStatus('off', 'Трекинг выключен');
  }

  async function refreshToggleAndMaybeRun() {
    try {
      const { trackingEnabled = false } =
        await chrome.storage.local.get({ trackingEnabled: false });
      tracking = !!trackingEnabled;
      if (tracking) start();
      else stop();
    } catch {}
  }

  // Boot
  if (document.readyState === 'loading') {
    addEventListener('DOMContentLoaded', refreshToggleAndMaybeRun, {
      once: true,
    });
  } else {
    refreshToggleAndMaybeRun();
  }

  // React to changes (toggle)
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if ('trackingEnabled' in ch) {
      tracking = !!ch.trackingEnabled.newValue;
      if (tracking) start();
      else stop();
    }
  });

  // Cleanup on unload to avoid "context invalidated" noise
  addEventListener('beforeunload', () => {
    destroyed = true;
    if (observer) observer.disconnect();
  });
})();
