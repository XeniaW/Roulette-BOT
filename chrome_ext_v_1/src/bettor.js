/* bettor.js — Auto-betting (Dozens) — русские статусы, дюжины 1–3, конфиг в chrome.storage.local.abConfig */
(() => {
  const CFG_KEY = 'abConfig';
  const DEFAULT_CFG = Object.freeze({
    chipSelectorTemplate: '[data-e2e="chip-{{value}}"]',
    chipValues: [0.2, 1, 5, 20],
    placeButtonSel: null,
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

  function sanitizeCfg(raw) {
    const src = raw || {};
    const tpl =
      typeof src.chipSelectorTemplate === 'string' &&
      src.chipSelectorTemplate.includes('{{value}}')
        ? src.chipSelectorTemplate
        : DEFAULT_CFG.chipSelectorTemplate;
    let chipValues = Array.isArray(src.chipValues)
      ? src.chipValues
          .map(Number)
          .filter((v) => Number.isFinite(v) && v > 0)
      : [];
    if (!chipValues.length) chipValues = [...DEFAULT_CFG.chipValues];
    const placeButtonSel =
      typeof src.placeButtonSel === 'string' &&
      src.placeButtonSel.trim()
        ? src.placeButtonSel.trim()
        : null;

    let steps = Array.isArray(src.steps) ? src.steps : [];
    steps = steps
      .map((st) => (Array.isArray(st) ? st : []))
      .map((st) =>
        st
          .map((it) => ({
            chip: Math.max(
              1,
              Math.min(
                chipValues.length,
                Math.floor(Number(it?.chip ?? 1))
              )
            ),
            times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
          }))
          .filter(
            (it) =>
              Number.isFinite(it.chip) && Number.isFinite(it.times)
          )
      )
      .filter((st) => st.length);
    if (!steps.length)
      steps = JSON.parse(JSON.stringify(DEFAULT_CFG.steps));
    return {
      chipSelectorTemplate: tpl,
      chipValues,
      placeButtonSel,
      steps,
    };
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

  async function loadCfg() {
    const { [CFG_KEY]: cfg = DEFAULT_CFG } = await sget({
      [CFG_KEY]: DEFAULT_CFG,
    });
    return sanitizeCfg(cfg);
  }

  const $ = (sel) => document.querySelector(sel);
  const dozenButtons = [
    $('#index-800'),
    $('#index-801'),
    $('#index-802'),
  ];

  const RETRY_MS = 250,
    RETRY_TIME_LIMIT_MS = 7000;
  let destroyed = false;

  async function appendBetLog(entry) {
    try {
      const { betLogs = [] } = await sget({ betLogs: [] });
      betLogs.push(entry);
      if (betLogs.length > 2000)
        betLogs.splice(0, betLogs.length - 2000);
      await sset({ betLogs });
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
    try {
      appendBetLog({
        t: Date.now(),
        type: 'event',
        phase: state,
        message,
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
    return idx + 1;
  }

  async function getExec() {
    const { betExec = null } = await sget({ betExec: null });
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
    await sset({ betExec: next });
    if (statusMsg)
      setBetStatus(next.enabled ? next.phase : 'off', statusMsg);
  }
  async function loadEnabled() {
    const { autoBettingEnabled = false } = await sget({
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

  // селекторы фишек строим из шаблона и номиналов; делаем резервные форматы числа
  function selectorsFrom(cfg) {
    const out = [];
    for (const v of cfg.chipValues) {
      const variants = new Set();
      const base = String(v);
      variants.add(base);
      // 0.2 -> 0.2 / 0.20 / 0.200
      if (!Number.isInteger(v)) {
        const s1 = v.toString();
        variants.add(s1);
        variants.add(v.toFixed(1));
        variants.add(v.toFixed(2));
        variants.add(v.toFixed(3));
      } else {
        variants.add(String(Math.trunc(v)));
      }
      let el = null,
        selUsed = null;
      for (const vv of variants) {
        const sel = cfg.chipSelectorTemplate.replace('{{value}}', vv);
        const node = document.querySelector(sel);
        if (node) {
          el = node;
          selUsed = sel;
          break;
        }
      }
      out.push({ node: el, sel: selUsed });
    }
    return out;
  }

  function chipsForStep(step, cfg) {
    const steps = cfg.steps;
    const idx = Math.max(0, Math.min(steps.length - 1, step - 1));
    const plan = steps[idx];
    // конвертируем 1-based chip -> 0-based index
    return (plan || [{ chip: 1, times: 1 }]).map((it) => ({
      i: Math.max(0, it.chip - 1),
      times: it.times,
    }));
  }
  function perDozenForStep(step, cfg) {
    return chipsForStep(step, cfg).reduce(
      (s, c) =>
        s + Number(cfg.chipValues[c.i] ?? 0) * Number(c.times ?? 0),
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
    try {
      el.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    } catch {}
    await new Promise((r) => setTimeout(r, 30));
  }
  function getDozenNode(idx) {
    const fallbackSel =
      idx === 0
        ? '#index-800'
        : idx === 1
        ? '#index-801'
        : '#index-802';
    return dozenButtons[idx] || document.querySelector(fallbackSel);
  }

  // ——— СТАВКА: всегда перечитываем конфиг и строим селекторы на лету
  async function tryPlace(step, target) {
    const cfg = await loadCfg(); // СВЕЖИЙ конфиг
    const deadline = Date.now() + RETRY_TIME_LIMIT_MS;
    const plan = chipsForStep(step, cfg);

    while (Date.now() < deadline) {
      const chipNodes = selectorsFrom(cfg).map((x) => x.node);
      const okChips = plan.every((c) => isEnabled(chipNodes[c.i]));
      const dozenNodes = target.map((d) => getDozenNode(d));
      const okDozens = dozenNodes.every(isEnabled);

      if (okChips && okDozens) {
        for (let dz = 0; dz < target.length; dz++) {
          for (const c of plan) {
            const chip = chipNodes[c.i];
            await clickElement(chip);
            for (let k = 0; k < c.times; k++) {
              await clickElement(dozenNodes[dz]);
              await new Promise((r) => setTimeout(r, 40));
            }
          }
        }
        if (cfg.placeButtonSel) {
          const btn = document.querySelector(cfg.placeButtonSel);
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

    const { spinLogs = [] } = await sget({ spinLogs: [] });
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
        if (ok) {
          const cfg = await loadCfg();
          const amount = perDozenForStep(1, cfg) * t.length;
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
      const cfg = await loadCfg();
      const lastStep = Math.max(1, cfg.steps.length);
      if (exec.step >= lastStep) {
        const reset = {
          ...exec,
          phase: 'idle',
          target: null,
          step: 1,
          armedAt: 0,
        };
        await setExec(reset, `ПРОИГРЫШ на шаге ${lastStep} → сброс`);
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
          const cfg = await loadCfg();
          const amount = perDozenForStep(step, cfg) * t.length;
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
    // мгновенная подгрузка по сигналу из popup
    try {
      chrome.runtime.onMessage.addListener((m) => {
        if (m?.type === 'AB_CONFIG_SAVED') {
          /* ничего не делаем — tryPlace всегда читает свежий конфиг */
        }
      });
    } catch {}
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
