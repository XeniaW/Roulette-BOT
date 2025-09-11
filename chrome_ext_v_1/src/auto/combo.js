// src/auto/combo.js
(() => {
  const DEFAULT_COMBO = Object.freeze({
    triggerStreak: 2,
    autoContinue: false, // NEW
    steps: [
      [{ chip: 1, times: 1 }],
      [{ chip: 1, times: 3 }],
      [{ chip: 2, times: 2 }],
      [
        { chip: 3, times: 1 },
        { chip: 2, times: 1 },
      ],
    ],
  });

  // --- dozens
  function dozenIndex(n) {
    if (n === 0) return -1;
    if (n <= 12) return 0;
    if (n <= 24) return 1;
    if (n <= 36) return 2;
    return -1;
  }
  function getDozenNode(idx) {
    const sel =
      idx === 0
        ? '#index-800'
        : idx === 1
        ? '#index-801'
        : '#index-802';
    return document.querySelector(sel);
  }

  // --- rows (0→#index-702, 1→#index-701, 2→#index-700)
  function rowIndex(n) {
    if (n === 0) return -1;
    const r = n % 3;
    if (r === 1) return 0;
    if (r === 2) return 1;
    if (r === 0) return 2;
    return -1;
  }
  function getRowNode(idx) {
    if (idx === 0) return document.querySelector('#index-702');
    if (idx === 1) return document.querySelector('#index-701');
    return document.querySelector('#index-700');
  }

  function otherTwo(x) {
    return [0, 1, 2].filter((i) => i !== x);
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

  // config
  function sanitizeCombo(raw) {
    const src = raw || {};
    const triggerStreak = Math.max(
      2,
      Math.floor(
        Number(src.triggerStreak ?? DEFAULT_COMBO.triggerStreak)
      )
    );
    const autoContinue = !!(
      src.autoContinue ?? DEFAULT_COMBO.autoContinue
    );
    let steps = Array.isArray(src.steps)
      ? src.steps
      : DEFAULT_COMBO.steps;
    steps = steps
      .map((st) => (Array.isArray(st) ? st : []))
      .map((st) =>
        st
          .map((it) => ({
            chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
            times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
          }))
          .filter(
            (it) =>
              Number.isFinite(it.chip) && Number.isFinite(it.times)
          )
      )
      .filter((st) => st.length);
    if (!steps.length) steps = DEFAULT_COMBO.steps;
    return { triggerStreak, steps, autoContinue };
  }
  async function loadComboCfg() {
    const { abComboConfig = DEFAULT_COMBO } = await sget({
      abComboConfig: DEFAULT_COMBO,
    });
    return sanitizeCombo(abComboConfig);
  }
  async function saveComboCfg(cfg) {
    const clean = sanitizeCombo(cfg);
    await sset({ abComboConfig: clean });
    return clean;
  }

  // exec
  async function getExec() {
    const { betExecCombo = null } = await sget({
      betExecCombo: null,
    });
    return (
      betExecCombo || {
        enabled: false,
        phase: 'idle',
        step: 1,
        armedAt: 0,
        target: { d: null, r: null, dz: [], rw: [] },
      }
    );
  }
  async function setExec(next, statusMsg = null) {
    await sset({ betExecCombo: next });
    if (statusMsg)
      BET.setBetStatus(
        'bettingStatusCombo',
        next.enabled ? next.phase : 'off',
        statusMsg
      );
  }
  async function loadEnabled() {
    const { autoBettingComboEnabled = false } = await sget({
      autoBettingComboEnabled: false,
    });
    const exec = await getExec();
    exec.enabled = !!autoBettingComboEnabled;
    if (!exec.enabled) {
      exec.phase = 'idle';
      exec.step = 1;
      exec.armedAt = 0;
      exec.target = { d: null, r: null, dz: [], rw: [] };
      await setExec(exec, 'Авто-ставки (комбо) ВЫКЛ');
    } else {
      await setExec(exec, 'Авто-ставки (комбо) ВКЛ');
    }
  }

  const mutex = new BET.Mutex();

  async function tryPlaceCombo(step, targets, steps) {
    const [okDz, okRw] = await (async () => {
      const r1 = await BET.tryPlace({
        step,
        targets: targets.dz,
        steps,
        getTargetNode: getDozenNode,
        mutex,
      });
      const r2 = await BET.tryPlace({
        step,
        targets: targets.rw,
        steps,
        getTargetNode: getRowNode,
        mutex,
      });
      return [r1, r2];
    })();

    try {
      const chips = await BET.loadGlobalChips();
      const amountDz = okDz
        ? BET.perTargetAmountForStep(step, steps, chips.chipValues) *
          targets.dz.length
        : 0;
      const amountRw = okRw
        ? BET.perTargetAmountForStep(step, steps, chips.chipValues) *
          targets.rw.length
        : 0;
      const { betLogs = [] } = await sget({ betLogs: [] });
      betLogs.push({
        t: Date.now(),
        type: 'placed',
        market: 'combo',
        phase: 'armed',
        message: `Шаг ${step} поставлен (комбо): дюжины ${
          okDz ? 'OK' : 'FAIL'
        }, ряды ${okRw ? 'OK' : 'FAIL'}`,
        amount: amountDz + amountRw,
        step,
        detail: { okDz, okRw, dz: targets.dz, rw: targets.rw },
      });
      if (betLogs.length > 2000)
        betLogs.splice(0, betLogs.length - 2000);
      await sset({ betLogs });
    } catch {}

    return { okDz, okRw };
  }

  async function onSpin(n) {
    const exec = await getExec();
    if (!exec.enabled) return;

    const { spinLogs = [] } = await sget({ spinLogs: [] });
    const d = dozenIndex(n),
      r = rowIndex(n);

    if (exec.phase === 'idle') {
      const { triggerStreak, steps } = await loadComboCfg();
      let last = [];
      for (
        let i = spinLogs.length - 1;
        i >= 0 && last.length < triggerStreak;
        i--
      ) {
        const ni = spinLogs[i].n;
        const di = dozenIndex(ni),
          ri = rowIndex(ni);
        if (di !== -1 && ri !== -1) last.push(`${di}:${ri}`);
      }
      const allSame =
        last.length >= triggerStreak &&
        last.every((z) => z === last[0]);
      if (allSame) {
        const [dStr, rStr] = last[0].split(':');
        const d0 = Number(dStr),
          r0 = Number(rStr);
        const t = {
          d: d0,
          r: r0,
          dz: otherTwo(d0),
          rw: otherTwo(r0),
        };

        const next = {
          ...exec,
          phase: 'armed',
          step: 1,
          armedAt: Date.now(),
          target: t,
        };
        await setExec(
          next,
          `ВХОД (комбо) → дюжины ${t.dz
            .map((x) => x + 1)
            .join(',')} и ряды ${t.rw
            .map((x) => x + 1)
            .join(',')} | шаг 1`
        );

        const res = await tryPlaceCombo(1, t, steps);
        const anyOk = res.okDz || res.okRw;
        const msg = anyOk
          ? `Шаг 1 поставлен (комбо): дюжины ${
              res.okDz ? 'OK' : 'FAIL'
            }, ряды ${res.okRw ? 'OK' : 'FAIL'}`
          : 'Не удалось поставить шаг 1 (комбо)';
        BET.setBetStatus(
          'bettingStatusCombo',
          anyOk ? 'armed' : 'error',
          msg
        );
      }
      return;
    }

    if (exec.phase === 'armed') {
      const win =
        (d !== -1 && exec.target.dz.includes(d)) ||
        (r !== -1 && exec.target.rw.includes(r));
      if (win) {
        const reset = {
          ...exec,
          phase: 'idle',
          step: 1,
          armedAt: 0,
          target: { d: null, r: null, dz: [], rw: [] },
        };
        await setExec(reset, `ВЫИГРЫШ (комбо) → сброс`);
        return;
      }
      const { steps, autoContinue } = await loadComboCfg();
      const lastStep = Math.max(1, steps.length);
      if (exec.step >= lastStep) {
        const reset = {
          ...exec,
          phase: 'idle',
          step: 1,
          armedAt: 0,
          target: { d: null, r: null, dz: [], rw: [] },
        };
        await setExec(
          reset,
          `ПРОИГРЫШ (комбо) на шаге ${lastStep} → сброс`
        );
        return;
      }

      if (autoContinue) {
        const step = exec.step + 1;
        const t = exec.target;
        const next = {
          ...exec,
          phase: 'armed',
          step,
          armedAt: Date.now(),
          target: t,
        };
        await setExec(
          next,
          `ПРОИГРЫШ (комбо) → сразу ставим шаг ${step} (дюжины ${t.dz
            .map((x) => x + 1)
            .join(',')}, ряды ${t.rw.map((x) => x + 1).join(',')})`
        );
        const res = await tryPlaceCombo(step, t, steps);
        const anyOk = res.okDz || res.okRw;
        const msg = anyOk
          ? `Шаг ${step} поставлен (комбо): дюжины ${
              res.okDz ? 'OK' : 'FAIL'
            }, ряды ${res.okRw ? 'OK' : 'FAIL'}`
          : `Не удалось поставить шаг ${step} (комбо)`;
        BET.setBetStatus(
          'bettingStatusCombo',
          anyOk ? 'armed' : 'error',
          msg
        );
        return;
      }

      const next = { ...exec, phase: 'waiting', step: exec.step + 1 };
      await setExec(
        next,
        `ПРОИГРЫШ (комбо) → ожидание, следующий шаг ${next.step}`
      );
      return;
    }

    if (exec.phase === 'waiting') {
      const touch =
        (d !== -1 && exec.target.dz.includes(d)) ||
        (r !== -1 && exec.target.rw.includes(r));
      if (touch) {
        const step = exec.step,
          t = exec.target;
        const { steps } = await loadComboCfg();
        const next = {
          ...exec,
          phase: 'armed',
          step,
          armedAt: Date.now(),
          target: t,
        };
        await setExec(
          next,
          `ГОТОВ (комбо) шаг ${step} на дюжины ${t.dz
            .map((x) => x + 1)
            .join(',')} и ряды ${t.rw.map((x) => x + 1).join(',')}`
        );
        const res = await tryPlaceCombo(step, t, steps);
        const anyOk = res.okDz || res.okRw;
        const msg = anyOk
          ? `Шаг ${step} поставлен (комбо): дюжины ${
              res.okDz ? 'OK' : 'FAIL'
            }, ряды ${res.okRw ? 'OK' : 'FAIL'}`
          : `Не удалось поставить шаг ${step} (комбо)`;
        BET.setBetStatus(
          'bettingStatusCombo',
          anyOk ? 'armed' : 'error',
          msg
        );
      }
    }
  }

  function attachStorageListener() {
    chrome.storage.onChanged.addListener(async (ch, area) => {
      if (area !== 'local') return;
      if (ch.autoBettingComboEnabled) loadEnabled();
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
    await loadEnabled();
    attachStorageListener();
    BET.setBetStatus('bettingStatusCombo', 'idle', 'Готово (комбо)');
  }

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    init();
  else
    window.addEventListener('DOMContentLoaded', init, { once: true });
})();
