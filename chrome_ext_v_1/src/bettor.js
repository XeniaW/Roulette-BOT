/* bettor.js — Auto-betting (Dozens) — MINIMAL PATCH:
 */

(() => {
  // ---------- DOZENS per your first code ----------
  const $ = (sel) => document.querySelector(sel);
  const dozenButtons = [
    $('#index-800'),
    $('#index-801'),
    $('#index-802'),
  ];

  // ---------- chips selectors (как было ранее) ----------
  const CHIP_SELECTORS = [
    '[data-e2e="chip-0.2"]', // chip 1
    '[data-e2e="chip-1"]', // chip 2
    '[data-e2e="chip-5"]', // chip 3
    '[data-e2e="chip-20"]', // chip 4
  ];
  // если нужен "подтвердить ставку", укажи селектор:
  const PLACE_BUTTON_SEL = null;

  const RETRY_MS = 250;
  const RETRY_TIME_LIMIT_MS = 7000;

  let destroyed = false;

  function setBetStatus(state, message) {
    try {
      chrome.storage.local.set({
        bettingStatus: {
          state,
          message,
          at: Date.now(),
          origin: location.origin,
        },
      });
    } catch {}
  }
  const ctxValid = () =>
    !!(typeof chrome !== 'undefined' && chrome?.runtime?.id) &&
    !destroyed;

  // dozen index helper
  function dozenIndex(n) {
    if (n === 0) return -1;
    if (n >= 1 && n <= 12) return 0;
    if (n >= 13 && n <= 24) return 1;
    if (n >= 25 && n <= 36) return 2;
    return -1;
  }
  function otherTwoDozens(skip) {
    return [0, 1, 2].filter((d) => d !== skip);
  }

  // exec state
  async function getExec() {
    const { betExec = null } = await chrome.storage.local.get({
      betExec: null,
    });
    return (
      betExec || {
        enabled: false,
        phase: 'idle',
        target: null,
        step: 1,
        armedAt: 0,
      }
    );
  }
  async function setExec(next, statusMsg = null) {
    await chrome.storage.local.set({ betExec: next });
    if (statusMsg)
      setBetStatus(next.enabled ? next.phase : 'off', statusMsg);
  }

  async function loadEnabled() {
    const { autoBettingEnabled = false } =
      await chrome.storage.local.get({ autoBettingEnabled: false });
    const exec = await getExec();
    exec.enabled = !!autoBettingEnabled;
    if (!exec.enabled) {
      exec.phase = 'idle';
      exec.target = null;
      exec.step = 1;
      exec.armedAt = 0;
      await setExec(exec, 'Auto-betting OFF');
    } else {
      await setExec(exec, 'Auto-betting ON');
    }
  }

  // 5-step chain (per dozen; кликаем на обе целевые дюжины):
  function chipsForStep(step) {
    switch (step) {
      case 1:
        return [{ i: 0, times: 1 }]; // 1× chip-0.2
      case 2:
        return [{ i: 0, times: 3 }]; // 3× chip-0.2
      case 3:
        return [{ i: 1, times: 2 }]; // 2× chip-1
      case 4:
        return [
          { i: 2, times: 1 },
          { i: 1, times: 1 },
        ]; // 1× chip-5 + 1× chip-1
      case 5:
        return [{ i: 3, times: 1 }]; // 1× chip-20
      default:
        return [{ i: 0, times: 1 }];
    }
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
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
      })
    );
    await new Promise((r) => setTimeout(r, 30));
  }

  // MINIMAL CHANGE: используем именно dozenButtons при клике
  function getDozenNode(idx) {
    // берем из массива; если страница перерисовала узлы — пробуем найти снова по id
    const fallbackSel =
      idx === 0
        ? '#index-800'
        : idx === 1
        ? '#index-801'
        : '#index-802';
    return dozenButtons[idx] || $(fallbackSel);
  }

  async function tryPlace(step, target) {
    const deadline = Date.now() + RETRY_TIME_LIMIT_MS;
    const chipPlan = chipsForStep(step);

    while (Date.now() < deadline) {
      const chipNodes = CHIP_SELECTORS.map((sel) =>
        document.querySelector(sel)
      );
      const okChips = chipPlan.every((c) =>
        isEnabled(chipNodes[c.i])
      );
      const dozenNodes = target.map((d) => getDozenNode(d));
      const okDozens = dozenNodes.every(isEnabled);

      if (okChips && okDozens) {
        for (let dz = 0; dz < target.length; dz++) {
          for (const c of chipPlan) {
            const chip = chipNodes[c.i];
            await clickElement(chip);
            for (let k = 0; k < c.times; k++) {
              await clickElement(dozenNodes[dz]);
              await new Promise((r) => setTimeout(r, 40));
            }
          }
        }
        if (PLACE_BUTTON_SEL) {
          const btn = document.querySelector(PLACE_BUTTON_SEL);
          if (isEnabled(btn)) await clickElement(btn);
        }
        return true;
      }
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
    return false;
  }

  async function onSpin(n) {
    const exec = await getExec();
    if (!exec.enabled) return;

    const { spinLogs = [] } = await chrome.storage.local.get({
      spinLogs: [],
    });
    const d = dozenIndex(n);

    if (exec.phase === 'idle') {
      // ждём две подряд одинаковые НЕ-нулевые дюжины
      let last = [];
      for (
        let i = spinLogs.length - 1;
        i >= 0 && last.length < 2;
        i--
      ) {
        const di = dozenIndex(spinLogs[i].n);
        if (di !== -1) last.push(di);
      }
      const doubled =
        last.length >= 2 && last[0] === last[1] ? last[0] : null;
      if (doubled !== null) {
        const t = otherTwoDozens(doubled);
        const next = {
          ...exec,
          phase: 'armed',
          target: t,
          step: 1,
          armedAt: Date.now(),
        };
        await setExec(
          next,
          `ENTRY → target dozens ${t.join(',')} | step 1`
        );
        const ok = await tryPlace(1, t);
        setBetStatus(
          ok ? 'armed' : 'error',
          ok ? 'Step 1 placed' : 'Cannot place Step 1'
        );
      }
      return;
    }

    if (exec.phase === 'armed') {
      // текущая ставка решается по только что выпавшему числу
      const win = d !== -1 && exec.target.includes(d);
      if (win) {
        const next = {
          ...exec,
          phase: 'idle',
          target: null,
          step: 1,
          armedAt: 0,
        };
        await setExec(next, `WIN on dozen ${d} → reset`);
        return;
      }
      // проигрыш (включая 0 и «плохую» дюжину) → ждём выхода из «плохой» зоны
      const next = {
        ...exec,
        phase: 'waiting',
        step: Math.min(exec.step + 1, 5),
      };
      await setExec(next, `LOSE → waiting, next step ${next.step}`);
      return;
    }

    if (exec.phase === 'waiting') {
      // Ждём появления числа из ЛЮБОЙ из целевых двух дюжин (0 считается «плохой» — игнорим)
      if (d !== -1 && exec.target?.includes(d)) {
        const step = exec.step;
        const t = exec.target;
        const next = {
          ...exec,
          phase: 'armed',
          target: t,
          step,
          armedAt: Date.now(),
        };
        await setExec(
          next,
          `ARM step ${step} on dozens ${t.join(',')}`
        );
        const ok = await tryPlace(step, t);
        setBetStatus(
          ok ? 'armed' : 'error',
          ok ? `Step ${step} placed` : `Cannot place Step ${step}`
        );
      }
      return;
    }
  }

  function attachStorageListener() {
    chrome.storage.onChanged.addListener(async (ch, area) => {
      if (area !== 'local') return;
      if (ch.autoBettingEnabled) loadEnabled();
      if (ch.spinLogs) {
        const { oldValue = [], newValue = [] } = ch.spinLogs;
        if (
          Array.isArray(newValue) &&
          newValue.length > oldValue.length
        ) {
          const added = newValue.slice(oldValue.length);
          for (const e of added) await onSpin(e.n);
        }
      }
    });
  }

  async function init() {
    if (!ctxValid()) return;
    await loadEnabled();
    attachStorageListener();
    setBetStatus('idle', 'bettor loaded');
  }

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    init();
  else
    window.addEventListener('DOMContentLoaded', init, { once: true });

  window.addEventListener('beforeunload', () => {
    destroyed = true;
  });
})();
