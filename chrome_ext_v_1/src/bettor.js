/* bettor.js — Auto-betting (Dozens) — 4 steps only, русские статусы, дюжины 1–3 */

(() => {
  const $ = (sel) => document.querySelector(sel);
  const dozenButtons = [
    $('#index-800'),
    $('#index-801'),
    $('#index-802'),
  ];

  const CHIP_SELECTORS = [
    '[data-e2e="chip-0.2"]',
    '[data-e2e="chip-1"]',
    '[data-e2e="chip-5"]',
    '[data-e2e="chip-20"]',
  ];
  const PLACE_BUTTON_SEL = null;

  // NEW: номиналы фишек в том же порядке, что и CHIP_SELECTORS
  const CHIP_VALUES = [0.2, 1, 5, 20];

  const RETRY_MS = 250;
  const RETRY_TIME_LIMIT_MS = 7000;
  let destroyed = false;

  // NEW: append-only лог ставок/событий
  async function appendBetLog(entry) {
    try {
      const { betLogs = [] } = await chrome.storage.local.get({
        betLogs: [],
      });
      betLogs.push(entry);
      if (betLogs.length > 2000)
        betLogs.splice(0, betLogs.length - 2000);
      await chrome.storage.local.set({ betLogs });
    } catch {}
  }

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
    // NEW: логируем текст статуса, который виден снизу
    try {
      appendBetLog({
        t: Date.now(),
        type: 'event',
        phase: state, // e.g. 'waiting', 'armed', 'idle', 'error', 'off'
        message, // e.g. "ПРОИГРЫШ → ожидание, следующий шаг 2"
      });
    } catch {}
  }

  const ctxValid = () =>
    !!(typeof chrome !== 'undefined' && chrome?.runtime?.id) &&
    !destroyed;

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
  function dozenLabel(idx) {
    return idx + 1; // convert 0→1, 1→2, 2→3
  }

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
      await chrome.storage.local.get({
        autoBettingEnabled: false,
      });
    const exec = await getExec();
    exec.enabled = !!autoBettingEnabled;
    if (!exec.enabled) {
      exec.phase = 'idle';
      exec.target = null;
      exec.step = 1;
      exec.armedAt = 0;
      await setExec(exec, 'Авто-ставки ВЫКЛ');
    } else {
      await setExec(exec, 'Авто-ставки ВКЛ');
    }
  }

  // ----- 4-step chain -----
  function chipsForStep(step) {
    switch (step) {
      case 1:
        return [{ i: 0, times: 1 }];
      case 2:
        return [{ i: 0, times: 3 }];
      case 3:
        return [{ i: 1, times: 2 }];
      case 4:
        return [
          { i: 2, times: 1 },
          { i: 1, times: 1 },
        ];
      default:
        return [{ i: 0, times: 1 }];
    }
  }

  // NEW: сумма за одну дюжину на конкретном шаге
  function perDozenForStep(step) {
    const plan = chipsForStep(step);
    return plan.reduce(
      (sum, c) => sum + CHIP_VALUES[c.i] * c.times,
      0
    );
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
  function getDozenNode(idx) {
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
          `ВХОД → целевые дюжины ${t
            .map(dozenLabel)
            .join(',')} | шаг 1`
        );
        const ok = await tryPlace(1, t);

        // логируем успешную постановку: время + сумма
        if (ok) {
          const amount = perDozenForStep(1) * t.length;
          await appendBetLog({
            t: Date.now(),
            type: 'placed',
            phase: 'armed',
            message: 'Шаг 1 поставлен',
            amount,
            step: 1,
          });
        }

        setBetStatus(
          ok ? 'armed' : 'error',
          ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
        );
      }
      return;
    }

    if (exec.phase === 'armed') {
      const win = d !== -1 && exec.target.includes(d);
      if (win) {
        const next = {
          ...exec,
          phase: 'idle',
          target: null,
          step: 1,
          armedAt: 0,
        };
        await setExec(
          next,
          `ВЫИГРЫШ на дюжине ${dozenLabel(d)} → сброс`
        );
        return;
      }
      // loss: reset if step 4, otherwise wait for next
      if (exec.step >= 4) {
        const reset = {
          ...exec,
          phase: 'idle',
          target: null,
          step: 1,
          armedAt: 0,
        };
        await setExec(reset, 'ПРОИГРЫШ на шаге 4 → сброс');
        return;
      }
      const next = { ...exec, phase: 'waiting', step: exec.step + 1 };
      await setExec(
        next,
        `ПРОИГРЫШ → ожидание, следующий шаг ${next.step}`
      );
      return;
    }

    if (exec.phase === 'waiting') {
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
          `ГОТОВ шаг ${step} на дюжины ${t.map(dozenLabel).join(',')}`
        );
        const ok = await tryPlace(step, t);

        if (ok) {
          const amount = perDozenForStep(step) * t.length;
          await appendBetLog({
            t: Date.now(),
            type: 'placed',
            phase: 'armed',
            message: `Шаг ${step} поставлен`,
            amount,
            step,
          });
        }

        setBetStatus(
          ok ? 'armed' : 'error',
          ok
            ? `Шаг ${step} поставлен`
            : `Не удалось поставить шаг ${step}`
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
    setBetStatus('idle', 'Авто-ставки готовы');
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
