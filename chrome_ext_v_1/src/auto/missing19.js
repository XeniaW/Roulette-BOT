// src/auto/missing19.js
import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
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

  const CFG_KEY = 'abMissing19Config';
  const ENABLED_KEY = 'autoBettingMissing19Enabled';
  const STATUS_KEY = 'bettingStatusMissing19';
  const EXECS_KEY = 'betExecMissing19ByTable';
  const TRACKED_TABLE_STATES_KEY = 'trackedTableStates';
  const MAX_BET_LOGS = 2000;
  const PLACE_MAX_WAIT_MS = 20000;
  const ENTRY_UNIQUE_COUNT = 19;
  const STRATEGY_VERSION = 2;

  function numId(n) {
    return `index-${100 + Number(n)}`;
  }

  function getMainTableRoot() {
    return document.querySelector('[data-name="center-section"]');
  }

  function getTargetNode(n) {
    const id = numId(n);
    const roots = [
      getMainTableRoot(),
      document.querySelector('#bet-grid-desktop'),
      document.querySelector('[data-e2e="bet-grid-desktop"]'),
      document.querySelector('[data-testid="bet-grid-desktop"]'),
      document.querySelector('#bet-grid'),
    ].filter(Boolean);

    for (const root of roots) {
      const node =
        root.querySelector(`#${id}`) ||
        root.querySelector(`[id="${id}"]`);
      if (node) return node;
    }

    return document.getElementById(id) || document.querySelector(`#${id}`);
  }

  function isNodeEnabled(el) {
    if (!el) return false;
    const ds = el.getAttribute?.('data-disabled');
    if (ds === 'true') return false;
    const st = window.getComputedStyle(el);
    return (
      st &&
      st.pointerEvents !== 'none' &&
      st.visibility !== 'hidden' &&
      st.display !== 'none'
    );
  }

  function inspectTargets(targets) {
    const missing = [];
    const disabled = [];

    for (const target of targets) {
      const node = getTargetNode(target);
      if (!node) missing.push(target);
      else if (!isNodeEnabled(node)) disabled.push(target);
    }

    return { missing, disabled };
  }

  function formatPlaceError(res) {
    const parts = [];
    if (Array.isArray(res?.missingTargets) && res.missingTargets.length) {
      parts.push(`missing nodes ${res.missingTargets.join(', ')}`);
    }
    if (
      Array.isArray(res?.disabledTargets) &&
      res.disabledTargets.length
    ) {
      parts.push(`disabled nodes ${res.disabledTargets.join(', ')}`);
    }
    return parts.join(' | ') || 'target/chip timeout';
  }

  function getIndex(n) {
    const x = Number(n);
    if (!Number.isInteger(x) || x < 0 || x > 36) return -1;
    return x;
  }

  function allNumbers() {
    const out = [];
    for (let i = 0; i <= 36; i++) out.push(i);
    return out;
  }

  function normalizeSeen(value) {
    const arr = Array.isArray(value) ? value : [];
    const seen = [];
    const used = new Set();

    for (const raw of arr) {
      const n = getIndex(raw);
      if (n === -1 || used.has(n)) continue;
      used.add(n);
      seen.push(n);
    }

    return seen;
  }

  function addSpinToCycle(exec, spin) {
    const seen = normalizeSeen(exec?.seen);
    const used = new Set(seen);
    let repeatCount = Math.max(
      0,
      Math.floor(Number(exec?.repeatCount || 0)),
    );

    if (spin === -1) return { seen, repeatCount, addedUnique: false };

    if (used.has(spin)) {
      repeatCount += 1;
      return { seen, repeatCount, addedUnique: false };
    }

    seen.push(spin);
    return { seen, repeatCount, addedUnique: true };
  }

  function targetsFromSeen(seen) {
    const used = new Set(normalizeSeen(seen));
    return allNumbers().filter((n) => !used.has(n));
  }

  function sanitizeSteps(rawSteps) {
    let steps = Array.isArray(rawSteps) ? rawSteps : DEFAULT_CFG.steps;

    steps = steps
      .map((st) => (Array.isArray(st) ? st : []))
      .map((st) =>
        st.map((it) => ({
          chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
          times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
        })),
      )
      .map((st) =>
        st.filter(
          (it) =>
            Number.isFinite(it.chip) && Number.isFinite(it.times),
        ),
      )
      .filter((st) => st.length);

    if (!steps.length) {
      steps = JSON.parse(JSON.stringify(DEFAULT_CFG.steps));
    }

    return steps;
  }

  function sanitizeCfg(raw) {
    const src = raw || {};
    return { steps: sanitizeSteps(src.steps) };
  }

  function emptyExec(enabled = false) {
    return {
      strategyVersion: STRATEGY_VERSION,
      enabled: !!enabled,
      phase: 'idle',
      target: null,
      step: 1,
      armedAt: 0,
      seen: [],
      repeatCount: 0,
    };
  }

  async function getTrackedTableIdForThisTab() {
    try {
      const ctx =
        typeof BET.getTrackedTableForThisTab === 'function'
          ? await BET.getTrackedTableForThisTab()
          : null;
      const id = String(ctx?.tableId || '').trim();
      if (id) return id;
    } catch {}

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'GET_TRACKED_TABLE_FOR_TAB',
      });
      const id = String(res?.tableId || '').trim();
      return res?.matched && id ? id : '';
    } catch {
      return '';
    }
  }

  async function appendTrackedBetLog(tableId, entry) {
    if (!tableId) return;

    const { [TRACKED_TABLE_STATES_KEY]: states = {} } =
      await BET.sget({
        [TRACKED_TABLE_STATES_KEY]: {},
      });

    const nextStates =
      states && typeof states === 'object' ? { ...states } : {};
    const prevState =
      nextStates[tableId] && typeof nextStates[tableId] === 'object'
        ? { ...nextStates[tableId] }
        : {};

    const betLogs = Array.isArray(prevState.betLogs)
      ? prevState.betLogs.slice()
      : [];

    betLogs.push(entry);
    if (betLogs.length > MAX_BET_LOGS) {
      betLogs.splice(0, betLogs.length - MAX_BET_LOGS);
    }

    prevState.betLogs = betLogs;
    nextStates[tableId] = prevState;

    await BET.sset({ [TRACKED_TABLE_STATES_KEY]: nextStates });
  }

  async function placeStep(step, targets, steps, mutex) {
    const inspected = inspectTargets(targets);
    if (inspected.missing.length) {
      return {
        ok: false,
        amount: 0,
        missingTargets: inspected.missing,
        disabledTargets: [],
      };
    }

    const ok = await BET.tryPlace({
      step,
      targets,
      steps,
      getTargetNode,
      mutex,
      maxWaitMs: PLACE_MAX_WAIT_MS,
    });
    if (!ok) {
      const retryInspect = inspectTargets(targets);
      return {
        ok: false,
        amount: 0,
        missingTargets: retryInspect.missing,
        disabledTargets: retryInspect.disabled,
      };
    }

    const chips = await BET.loadGlobalChips();
    const amount =
      BET.perTargetAmountForStep(step, steps, chips.chipValues) *
      targets.length;

    return { ok: true, amount };
  }

  class Missing19Market extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'missing19',
        cfgKey: CFG_KEY,
        enabledKey: ENABLED_KEY,
        statusKey: STATUS_KEY,
        execKey: EXECS_KEY,
        getIndex,
        getOthers: () => [],
        getTargetNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    sanitizeCfg(raw) {
      return sanitizeCfg(raw);
    }

    async getExec() {
      const tableId = await getTrackedTableIdForThisTab();
      const {
        [ENABLED_KEY]: enabled = false,
        [EXECS_KEY]: rawMap = {},
      } = await this.sget({
        [ENABLED_KEY]: false,
        [EXECS_KEY]: {},
      });

      const map =
        rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)
          ? rawMap
          : {};

      const saved =
        tableId && map[tableId] && typeof map[tableId] === 'object'
          ? map[tableId]
          : {};

      if (
        Object.keys(saved).length > 0 &&
        saved.strategyVersion !== STRATEGY_VERSION
      ) {
        return emptyExec(enabled);
      }

      return {
        ...emptyExec(enabled),
        ...saved,
        enabled: !!enabled,
        seen: normalizeSeen(saved.seen),
        repeatCount: Math.max(
          0,
          Math.floor(Number(saved.repeatCount || 0)),
        ),
      };
    }

    async setExec(next, statusMsg = null) {
      const tableId = await getTrackedTableIdForThisTab();
      if (!tableId) return;

      const { [EXECS_KEY]: rawMap = {} } = await this.sget({
        [EXECS_KEY]: {},
      });
      const map =
        rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)
          ? { ...rawMap }
          : {};

      map[tableId] = {
        ...next,
        strategyVersion: STRATEGY_VERSION,
        seen: normalizeSeen(next?.seen),
        repeatCount: Math.max(
          0,
          Math.floor(Number(next?.repeatCount || 0)),
        ),
      };
      await this.sset({ [EXECS_KEY]: map });

      if (statusMsg) {
        BET.setBetStatus(
          STATUS_KEY,
          next.enabled ? next.phase : 'off',
          statusMsg,
        );
      }
    }

    async loadEnabled() {
      const exec = await this.getExec();
      exec.enabled = !!exec.enabled;

      if (!exec.enabled) {
        exec.phase = 'idle';
        exec.target = null;
        exec.step = 1;
        exec.armedAt = 0;
        exec.seen = [];
        exec.repeatCount = 0;
        await this.setExec(exec, '');
        BET.setBetStatus(STATUS_KEY, 'off', '');
        return;
      }

      await this.setExec(exec);
      BET.setBetStatus(
        STATUS_KEY,
        exec.phase || 'idle',
        `MISSING19: collecting ${exec.seen.length}/19 | repeats ${exec.repeatCount}`,
      );
    }

    setStatus(state, message) {
      BET.setBetStatus(STATUS_KEY, state, message || '');
    }

    async logPlaced(step, targets, amount, message, exec) {
      const tableId = await getTrackedTableIdForThisTab();
      await appendTrackedBetLog(tableId, {
        t: Date.now(),
        type: 'placed',
        market: 'missing19',
        phase: 'armed',
        message,
        amount,
        step,
        targets: Array.isArray(targets) ? targets.slice() : [],
        unique: Array.isArray(exec?.seen) ? exec.seen.length : null,
        repeats: Number(exec?.repeatCount || 0),
      });
    }

    async reset(message) {
      const reset = {
        ...emptyExec(true),
      };
      await this.setExec(reset, message);
      this.setStatus('idle', message);
    }

    async placeAndReport(exec, targets, step, steps, prefix) {
      const next = {
        ...exec,
        enabled: true,
        phase: 'armed',
        target: targets.slice(),
        step,
        armedAt: Date.now(),
      };

      await this.setExec(
        next,
        `${prefix}: step ${step} | targets ${targets.join(', ')}`,
      );

      const res = await placeStep(step, targets, steps, this.mutex);
      if (res.ok) {
        await this.logPlaced(
          step,
          targets,
          res.amount,
          `${prefix}: step ${step} placed | targets ${targets.join(', ')}`,
          next,
        );
      } else {
        await this.setExec({
          ...next,
          phase: 'idle',
          target: null,
          step: 1,
          armedAt: 0,
        });
      }

      const failReason = formatPlaceError(res);
      this.setStatus(
        res.ok ? 'armed' : 'error',
        res.ok
          ? `${prefix}: step ${step} placed | ${targets.length} targets`
          : `${prefix}: cannot place step ${step} | ${failReason}`,
      );
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const tableId = await getTrackedTableIdForThisTab();
      if (!tableId) return;

      const spin = getIndex(n);
      if (spin === -1) return;

      const cfg = await this.loadCfg();
      const steps = cfg.steps;
      const maxStep = Math.max(1, steps.length);

      if (exec.phase === 'armed') {
        const targets = Array.isArray(exec.target)
          ? exec.target.filter((x) => getIndex(x) !== -1)
          : [];

        if (!targets.length) {
          await this.reset('MISSING19: empty targets -> reset');
          return;
        }

        if (targets.includes(spin)) {
          await this.reset(`MISSING19 WIN: hit ${spin} -> reset`);
          return;
        }

        if (Math.max(1, Math.floor(Number(exec.step || 1))) >= maxStep) {
          await this.reset(
            `MISSING19 LOSS: step ${maxStep} missed -> reset`,
          );
          return;
        }

        await this.placeAndReport(
          exec,
          targets,
          Math.max(1, Math.floor(Number(exec.step || 1))) + 1,
          steps,
          'MISSING19 REBET',
        );
        return;
      }

      if (exec.phase && exec.phase !== 'idle') return;

      const cycle = addSpinToCycle(exec, spin);
      const collecting = {
        ...exec,
        enabled: true,
        phase: 'idle',
        target: null,
        step: 1,
        armedAt: 0,
        seen: cycle.seen,
        repeatCount: cycle.repeatCount,
      };

      if (cycle.seen.length < ENTRY_UNIQUE_COUNT) {
        await this.setExec(
          collecting,
          `MISSING19: collecting ${cycle.seen.length}/19 | repeats ${cycle.repeatCount}`,
        );
        return;
      }

      const targets = targetsFromSeen(cycle.seen);
      if (targets.length !== 37 - ENTRY_UNIQUE_COUNT) {
        await this.reset(
          `MISSING19: invalid targets ${targets.length} -> reset`,
        );
        return;
      }

      const okEntry = await entryGateFor(
        'missing19',
        ENABLED_KEY,
        STATUS_KEY,
        {
          execKey: EXECS_KEY,
          execByTable: true,
          tableId,
        },
      );
      if (!okEntry) return;

      await this.placeAndReport(
        collecting,
        targets,
        1,
        steps,
        `MISSING19 ENTRY: unique 19, repeats ${cycle.repeatCount}`,
      );
    }

    attachStorageListener() {
      chrome.storage.onChanged.addListener(async (ch, area) => {
        if (area !== 'local') return;

        if (this.enabledKey in ch) {
          await this.loadEnabled();
        }

        if (ch[TRACKED_TABLE_STATES_KEY]) {
          const tableId = await getTrackedTableIdForThisTab();
          if (!tableId) return;

          const oldStates =
            ch[TRACKED_TABLE_STATES_KEY].oldValue || {};
          const newStates =
            ch[TRACKED_TABLE_STATES_KEY].newValue || {};

          const oldLogs = Array.isArray(
            oldStates?.[tableId]?.spinLogs,
          )
            ? oldStates[tableId].spinLogs
            : [];
          const newLogs = Array.isArray(
            newStates?.[tableId]?.spinLogs,
          )
            ? newStates[tableId].spinLogs
            : [];

          if (newLogs.length > oldLogs.length) {
            const added = newLogs.slice(oldLogs.length);
            for (const e of added) {
              await this.onSpin(e.n);
            }
          }
        }
      });
    }
  }

  window.__STRAT_MISSING19__ = new Missing19Market();

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    window.__STRAT_MISSING19__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_MISSING19__.init(),
      { once: true },
    );
  }
})();
