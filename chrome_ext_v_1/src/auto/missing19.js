// src/auto/missing19.js
import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_STEPS = Object.freeze([
    [{ chip: 1, times: 1 }],
    [{ chip: 1, times: 3 }],
    [{ chip: 2, times: 2 }],
    [
      { chip: 3, times: 1 },
      { chip: 2, times: 1 },
    ],
  ]);

  const DEFAULT_CFG = Object.freeze({
    triggerCount: 19,
    useRebetDouble: true,
    maxDoubles: 3,
    insuranceEnabled: false,
    insuranceChipValue: 1,
    steps: DEFAULT_STEPS,
  });

  const CFG_KEY = 'abMissing19Config';
  const ENABLED_KEY = 'autoBettingMissing19Enabled';
  const STATUS_KEY = 'bettingStatusMissing19';
  const EXECS_KEY = 'betExecMissing19ByTable';
  const TRACKED_TABLE_STATES_KEY = 'trackedTableStates';
  const MAX_BET_LOGS = 5000;
  const PLACE_MAX_WAIT_MS = 20000;
  const ENTRY_UNIQUE_COUNT = 19;
  const TARGET_COUNT = 37 - ENTRY_UNIQUE_COUNT;
  const STRATEGY_VERSION = 3;
  const BASE_STEPS = Object.freeze([[{ chip: 1, times: 1 }]]);

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

    return seen.slice(0, ENTRY_UNIQUE_COUNT);
  }

  function normalizeTargets(value) {
    const arr = Array.isArray(value) ? value : [];
    return arr
      .map((x) => getIndex(x))
      .filter((x, i, src) => x !== -1 && src.indexOf(x) === i);
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
    const triggerCount = Math.max(
      ENTRY_UNIQUE_COUNT,
      Math.floor(Number(src.triggerCount ?? DEFAULT_CFG.triggerCount)),
    );
    const maxDoubles = Math.max(
      0,
      Math.floor(Number(src.maxDoubles ?? DEFAULT_CFG.maxDoubles)),
    );
    const useRebetDouble = !!(
      src.useRebetDouble ?? DEFAULT_CFG.useRebetDouble
    );
    const insuranceEnabled = !!(
      src.insuranceEnabled ?? DEFAULT_CFG.insuranceEnabled
    );
    const insuranceChipValue = normalizeInsuranceChipValue(
      src.insuranceChipValue,
    );

    return {
      triggerCount,
      useRebetDouble,
      maxDoubles,
      insuranceEnabled,
      insuranceChipValue,
      steps: sanitizeSteps(src.steps),
    };
  }

  function finiteMs(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function normalizeInsuranceChipValue(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0
      ? n
      : DEFAULT_CFG.insuranceChipValue;
  }

  function normalizeInsuranceLevel(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function insuranceTimesFromLevel(level) {
    return Math.pow(2, normalizeInsuranceLevel(level));
  }

  function formatStakeValue(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'unknown';
    return Number.isInteger(n) && n >= 1 ? String(n) : n.toFixed(2);
  }

  function findChipIndexByValue(chipValues, wantedValue) {
    const wanted = Number(wantedValue);
    if (!Number.isFinite(wanted) || wanted <= 0) return -1;

    return (Array.isArray(chipValues) ? chipValues : []).findIndex(
      (value) => Math.abs(Number(value) - wanted) <= 1e-9,
    );
  }

  function emptyExec(enabled = false, collectAfter = Date.now()) {
    return {
      strategyVersion: STRATEGY_VERSION,
      enabled: !!enabled,
      phase: 'idle',
      target: null,
      step: 1,
      doubleCount: 0,
      armedAt: 0,
      collectAfter: finiteMs(collectAfter, Date.now()),
      seen: [],
      repeatCount: 0,
      spinCount: 0,
      triggerCount: DEFAULT_CFG.triggerCount,
      maxDoubles: DEFAULT_CFG.maxDoubles,
      useRebetDouble: DEFAULT_CFG.useRebetDouble,
      insuranceEnabled: DEFAULT_CFG.insuranceEnabled,
      insuranceChipValue: DEFAULT_CFG.insuranceChipValue,
      insuranceLevel: 0,
      insuranceTimes: 1,
      insuranceActualChipValue: null,
      insuranceActive: false,
      insuranceLossAmount: 0,
      insuranceStartBalance: null,
      insuranceTargetBalance: null,
      insuranceCurrentBalance: null,
      cycleStartBalance: null,
      cycleStakeTotal: 0,
      baseAmount: 0,
      lastAmount: 0,
    };
  }

  function normalizeExec(saved, enabled) {
    const base = emptyExec(enabled);
    const raw =
      saved && typeof saved === 'object' && !Array.isArray(saved)
        ? saved
        : {};
    const out = {
      ...base,
      ...raw,
      enabled: !!enabled,
      strategyVersion: STRATEGY_VERSION,
    };

    out.phase = out.phase === 'armed' ? 'armed' : 'idle';
    out.target = out.phase === 'armed' ? normalizeTargets(out.target) : null;
    out.step = Math.max(1, Math.floor(Number(out.step || 1)));
    out.doubleCount = Math.max(
      0,
      Math.floor(Number(out.doubleCount || 0)),
    );
    out.armedAt = finiteMs(out.armedAt, 0);
    out.collectAfter = finiteMs(out.collectAfter, base.collectAfter);
    out.seen = normalizeSeen(out.seen);
    out.repeatCount = Math.max(
      0,
      Math.floor(Number(out.repeatCount || 0)),
    );
    out.spinCount = Math.max(
      out.seen.length + out.repeatCount,
      Math.floor(Number(out.spinCount || 0)),
    );
    out.triggerCount = Math.max(
      ENTRY_UNIQUE_COUNT,
      Math.floor(Number(out.triggerCount || DEFAULT_CFG.triggerCount)),
    );
    out.maxDoubles = Math.max(
      0,
      Math.floor(Number(out.maxDoubles ?? DEFAULT_CFG.maxDoubles)),
    );
    out.useRebetDouble = !!(
      out.useRebetDouble ?? DEFAULT_CFG.useRebetDouble
    );
    out.insuranceEnabled = !!(
      out.insuranceEnabled ?? DEFAULT_CFG.insuranceEnabled
    );
    out.insuranceChipValue = normalizeInsuranceChipValue(
      out.insuranceChipValue,
    );
    out.insuranceLevel = normalizeInsuranceLevel(out.insuranceLevel);
    out.insuranceTimes = insuranceTimesFromLevel(out.insuranceLevel);
    out.insuranceActualChipValue = Number.isFinite(
      Number(out.insuranceActualChipValue),
    )
      ? Number(out.insuranceActualChipValue)
      : null;
    delete out.insuranceDoubles;
    delete out.insuranceMultiplier;
    out.insuranceActive = !!out.insuranceActive;
    out.insuranceLossAmount = Number.isFinite(
      Number(out.insuranceLossAmount),
    )
      ? Math.max(0, Number(out.insuranceLossAmount))
      : 0;
    out.insuranceStartBalance = Number.isFinite(
      Number(out.insuranceStartBalance),
    )
      ? Number(out.insuranceStartBalance)
      : null;
    out.insuranceTargetBalance = Number.isFinite(
      Number(out.insuranceTargetBalance),
    )
      ? Number(out.insuranceTargetBalance)
      : null;
    out.insuranceCurrentBalance = Number.isFinite(
      Number(out.insuranceCurrentBalance),
    )
      ? Number(out.insuranceCurrentBalance)
      : null;
    out.cycleStakeTotal = Number.isFinite(Number(out.cycleStakeTotal))
      ? Math.max(0, Number(out.cycleStakeTotal))
      : 0;
    out.cycleStartBalance = Number.isFinite(
      Number(out.cycleStartBalance),
    )
      ? Number(out.cycleStartBalance)
      : null;
    out.baseAmount = Number.isFinite(Number(out.baseAmount))
      ? Number(out.baseAmount)
      : 0;
    out.lastAmount = Number.isFinite(Number(out.lastAmount))
      ? Number(out.lastAmount)
      : 0;

    return out;
  }

  function normalizeLogRows(spinLogs) {
    const rows = [];
    const src = Array.isArray(spinLogs) ? spinLogs : [];

    for (let i = 0; i < src.length; i++) {
      const item = src[i];
      const n = getIndex(item?.n ?? item);
      if (n === -1) continue;

      const rawT = Number(item?.t);
      const t = Number.isFinite(rawT) && rawT > 0 ? rawT : i + 1;
      rows.push({ n, t, index: i });
    }

    return rows;
  }

  function uniqueChronological(rows) {
    const seen = [];
    const used = new Set();

    for (const row of rows) {
      if (used.has(row.n)) continue;
      used.add(row.n);
      seen.push(row.n);
    }

    return seen;
  }

  function buildCycleFromLogs(spinLogs, collectAfter = 0) {
    const after = finiteMs(collectAfter, 0);
    const rows = normalizeLogRows(spinLogs).filter(
      (row) => after <= 0 || row.t > after,
    );

    if (!rows.length) {
      return {
        ready: false,
        seen: [],
        repeatCount: 0,
        spinCount: 0,
        targets: allNumbers(),
        firstT: after,
        collectAfter: after,
      };
    }

    const usedBack = new Set();
    let start = -1;

    for (let i = rows.length - 1; i >= 0; i--) {
      if (usedBack.has(rows[i].n)) continue;
      usedBack.add(rows[i].n);
      if (usedBack.size === ENTRY_UNIQUE_COUNT) {
        start = i;
        break;
      }
    }

    const suffix = start >= 0 ? rows.slice(start) : rows;
    const seen = uniqueChronological(suffix);
    const spinCount = suffix.length;
    const repeatCount = Math.max(0, spinCount - seen.length);
    const firstT = finiteMs(suffix[0]?.t, after);

    return {
      ready: seen.length >= ENTRY_UNIQUE_COUNT,
      seen: seen.slice(0, ENTRY_UNIQUE_COUNT),
      repeatCount,
      spinCount,
      targets: targetsFromSeen(seen),
      firstT,
      collectAfter: start >= 0 ? Math.max(0, firstT - 1) : after,
    };
  }

  function canEnter(cycle, cfg) {
    return (
      cycle.ready &&
      cycle.seen.length === ENTRY_UNIQUE_COUNT &&
      cycle.spinCount >= cfg.triggerCount
    );
  }

  function cycleStatus(cycle, cfg) {
    const unique = cycle.seen.length;
    const repeats = cycle.repeatCount;
    const total = cycle.spinCount;

    if (unique < ENTRY_UNIQUE_COUNT) {
      return `MISSING19: unique ${unique}/19 | repeats ${repeats} | need ${
        ENTRY_UNIQUE_COUNT - unique
      } unique`;
    }

    const needSpins = Math.max(0, cfg.triggerCount - total);
    if (needSpins > 0) {
      return `MISSING19 READY: unique 19/19 | repeats ${repeats} | total ${total}/${cfg.triggerCount} | need ${needSpins} spins`;
    }

    return `MISSING19 READY: unique 19/19 | repeats ${repeats} | targets ${TARGET_COUNT}`;
  }

  function execFromCycle(exec, cycle, cfg) {
    const keepRecovery = cfg.insuranceEnabled && !!exec?.insuranceActive;
    const insuranceLevel = keepRecovery
      ? normalizeInsuranceLevel(exec?.insuranceLevel)
      : 0;

    return {
      ...exec,
      enabled: true,
      phase: 'idle',
      target: null,
      step: 1,
      doubleCount: 0,
      armedAt: 0,
      collectAfter: cycle.collectAfter,
      seen: cycle.seen,
      repeatCount: cycle.repeatCount,
      spinCount: cycle.spinCount,
      triggerCount: cfg.triggerCount,
      maxDoubles: cfg.maxDoubles,
      useRebetDouble: cfg.useRebetDouble,
      insuranceEnabled: cfg.insuranceEnabled,
      insuranceChipValue: cfg.insuranceChipValue,
      insuranceLevel,
      insuranceTimes: insuranceTimesFromLevel(insuranceLevel),
      insuranceActualChipValue: keepRecovery
        ? exec?.insuranceActualChipValue ?? null
        : null,
      insuranceActive: keepRecovery,
      insuranceLossAmount: keepRecovery
        ? Number(exec?.insuranceLossAmount || 0)
        : 0,
      insuranceStartBalance: keepRecovery
        ? exec?.insuranceStartBalance ?? null
        : null,
      insuranceTargetBalance: keepRecovery
        ? exec?.insuranceTargetBalance ?? null
        : null,
      insuranceCurrentBalance: keepRecovery
        ? exec?.insuranceCurrentBalance ?? null
        : null,
      cycleStartBalance: null,
      cycleStakeTotal: 0,
      baseAmount: 0,
      lastAmount: 0,
    };
  }

  function cloneSteps(steps) {
    return (Array.isArray(steps) ? steps : []).map((st) =>
      (Array.isArray(st) ? st : []).map((it) => ({
        chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
        times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
      })),
    );
  }

  function estimateRebetAmount(baseAmount, doubleCount) {
    const base = Number(baseAmount);
    if (!Number.isFinite(base) || base <= 0) return null;
    return base * Math.pow(2, Math.max(0, doubleCount));
  }

  function readBalanceValue(...values) {
    for (const value of values) {
      const raw =
        value && typeof value === 'object' ? value.value : value;
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
    return null;
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

  async function getTrackedSpinLogs(tableId) {
    const {
      [TRACKED_TABLE_STATES_KEY]: states = {},
      spinLogs = [],
    } = await BET.sget({
      [TRACKED_TABLE_STATES_KEY]: {},
      spinLogs: [],
    });

    const stateLogs =
      states &&
      typeof states === 'object' &&
      tableId &&
      Array.isArray(states?.[tableId]?.spinLogs)
        ? states[tableId].spinLogs
        : null;

    return Array.isArray(stateLogs)
      ? stateLogs
      : Array.isArray(spinLogs)
        ? spinLogs
        : [];
  }

  async function getCurrentBalanceValue(tableId) {
    const {
      [TRACKED_TABLE_STATES_KEY]: states = {},
      currentBalance = null,
    } = await BET.sget({
      [TRACKED_TABLE_STATES_KEY]: {},
      currentBalance: null,
    });

    const state =
      states &&
      typeof states === 'object' &&
      tableId &&
      states[tableId] &&
      typeof states[tableId] === 'object'
        ? states[tableId]
        : null;

    return readBalanceValue(
      state?.balance,
      state?.currentBalance,
      currentBalance,
    );
  }

  async function waitForBalanceValue(tableId, waitMs = 0) {
    const deadline = Date.now() + Math.max(0, Math.floor(Number(waitMs)));
    let last = await getCurrentBalanceValue(tableId);

    while (last == null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      last = await getCurrentBalanceValue(tableId);
    }

    return last;
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

      return normalizeExec(saved, enabled);
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

      map[tableId] = normalizeExec(next, !!next?.enabled);
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
        await this.setExec(emptyExec(false, Date.now()), '');
        BET.setBetStatus(STATUS_KEY, 'off', '');
        return;
      }

      if (!Number.isFinite(Number(exec.collectAfter))) {
        exec.collectAfter = Date.now();
      }

      await this.setExec(exec);
      BET.setBetStatus(STATUS_KEY, exec.phase || 'idle', 'MISSING19: ON');
    }

    setStatus(state, message) {
      BET.setBetStatus(STATUS_KEY, state, message || '');
    }

    async logEvent(message, exec, extra = {}) {
      const tableId = await getTrackedTableIdForThisTab();
      await appendTrackedBetLog(tableId, {
        t: Date.now(),
        type: 'event',
        market: 'missing19',
        phase: extra.phase || exec?.phase || 'idle',
        message,
        step: exec?.step ?? null,
        targets: Array.isArray(exec?.target) ? exec.target.slice() : [],
        unique: Array.isArray(exec?.seen) ? exec.seen.length : null,
        repeats: Number(exec?.repeatCount || 0),
        spinCount: Number(exec?.spinCount || 0),
        triggerCount: Number(exec?.triggerCount || 0),
        doubleCount: Number(exec?.doubleCount || 0),
        insuranceActive: !!exec?.insuranceActive,
        insuranceLossAmount: Number(exec?.insuranceLossAmount || 0),
        insuranceTargetBalance: exec?.insuranceTargetBalance ?? null,
        insuranceCurrentBalance: exec?.insuranceCurrentBalance ?? null,
        insuranceChipValue: Number(exec?.insuranceChipValue || 0),
        insuranceActualChipValue: exec?.insuranceActualChipValue ?? null,
        insuranceLevel: Number(exec?.insuranceLevel || 0),
        insuranceTimes: Number(exec?.insuranceTimes || 1),
        cycleStartBalance: exec?.cycleStartBalance ?? null,
        cycleStakeTotal: Number(exec?.cycleStakeTotal || 0),
        ...extra,
      });
    }

    async logPlaced(step, targets, amount, message, exec, method) {
      const tableId = await getTrackedTableIdForThisTab();
      await appendTrackedBetLog(tableId, {
        t: Date.now(),
        type: 'placed',
        market: 'missing19',
        phase: 'armed',
        message,
        amount,
        step,
        method,
        targets: Array.isArray(targets) ? targets.slice() : [],
        unique: Array.isArray(exec?.seen) ? exec.seen.length : null,
        repeats: Number(exec?.repeatCount || 0),
        spinCount: Number(exec?.spinCount || 0),
        triggerCount: Number(exec?.triggerCount || 0),
        doubleCount: Number(exec?.doubleCount || 0),
        insuranceActive: !!exec?.insuranceActive,
        insuranceLossAmount: Number(exec?.insuranceLossAmount || 0),
        insuranceTargetBalance: exec?.insuranceTargetBalance ?? null,
        insuranceCurrentBalance: exec?.insuranceCurrentBalance ?? null,
        insuranceChipValue: Number(exec?.insuranceChipValue || 0),
        insuranceActualChipValue: exec?.insuranceActualChipValue ?? null,
        insuranceLevel: Number(exec?.insuranceLevel || 0),
        insuranceTimes: Number(exec?.insuranceTimes || 1),
        cycleStartBalance: exec?.cycleStartBalance ?? null,
        cycleStakeTotal: Number(exec?.cycleStakeTotal || 0),
      });
    }

    async reset(message, collectAfter = Date.now()) {
      const reset = emptyExec(true, collectAfter);
      await this.setExec(reset);
      await this.logEvent(message, reset, { phase: 'idle' });
      this.setStatus('idle', message);
    }

    async placeAndReport(
      exec,
      targets,
      step,
      steps,
      prefix,
      method,
    ) {
      const baseAmount = Number(exec?.baseAmount || 0);
      const tableId =
        step === 1 ? await getTrackedTableIdForThisTab() : '';
      const cycleStartBalance =
        step === 1
          ? await getCurrentBalanceValue(tableId)
          : exec?.cycleStartBalance;
      const next = {
        ...exec,
        enabled: true,
        phase: 'armed',
        target: targets.slice(),
        step,
        doubleCount: Math.max(0, Math.floor(Number(exec.doubleCount || 0))),
        armedAt: Date.now(),
      };

      await this.setExec(
        next,
        `${prefix}: placing step ${step} | targets ${targets.join(', ')}`,
      );

      const res = await placeStep(step, targets, steps, this.mutex);
      if (res.ok) {
        const amount = Number(res.amount || 0);
        const insuranceLevel = normalizeInsuranceLevel(
          exec?.insuranceLevel,
        );

        const placed = {
          ...next,
          baseAmount: step === 1 ? amount : baseAmount,
          lastAmount: amount,
          insuranceChipValue: normalizeInsuranceChipValue(
            exec?.insuranceChipValue,
          ),
          insuranceActualChipValue:
            exec?.insuranceActualChipValue ?? null,
          insuranceLevel,
          insuranceTimes: insuranceTimesFromLevel(insuranceLevel),
          cycleStartBalance:
            step === 1 && Number.isFinite(Number(cycleStartBalance))
              ? Number(cycleStartBalance)
              : exec?.cycleStartBalance ?? null,
          cycleStakeTotal:
            step === 1
              ? amount
              : Number(exec?.cycleStakeTotal || 0) + amount,
        };
        await this.setExec(placed);
        await this.logPlaced(
          step,
          targets,
          amount,
          `${prefix}: step ${step} placed | targets ${targets.join(', ')}`,
          placed,
          method,
        );
        this.setStatus(
          'armed',
          `${prefix}: step ${step} placed | ${targets.length} targets`,
        );
        return { ok: true, exec: placed };
      }

      const failReason = formatPlaceError(res);
      const reset = emptyExec(true, Date.now());
      await this.setExec(reset);
      await this.logEvent(
        `${prefix}: cannot place step ${step} | ${failReason}`,
        reset,
        { phase: 'error' },
      );
      this.setStatus(
        'error',
        `${prefix}: cannot place step ${step} | ${failReason}`,
      );
      return { ok: false, exec: reset };
    }

    async placeRebetDoubleAndReport(exec, targets, cfg) {
      const currentDouble = Math.max(
        0,
        Math.floor(Number(exec.doubleCount || 0)),
      );
      const nextDouble = currentDouble + 1;
      const nextStep = Math.max(1, Math.floor(Number(exec.step || 1))) + 1;
      const next = {
        ...exec,
        enabled: true,
        phase: 'armed',
        target: targets.slice(),
        step: nextStep,
        doubleCount: nextDouble,
        armedAt: Date.now(),
        triggerCount: cfg.triggerCount,
        maxDoubles: cfg.maxDoubles,
        useRebetDouble: true,
        insuranceEnabled: cfg.insuranceEnabled,
        insuranceChipValue: cfg.insuranceChipValue,
        insuranceLevel: normalizeInsuranceLevel(exec?.insuranceLevel),
        insuranceTimes: insuranceTimesFromLevel(exec?.insuranceLevel),
        insuranceActualChipValue:
          exec?.insuranceActualChipValue ?? null,
      };

      await this.setExec(
        next,
        `MISSING19 REBET+DOUBLE: placing increase ${nextDouble}/${cfg.maxDoubles}`,
      );

      const ok = await BET.tryRebetDouble({
        mutex: this.mutex,
        maxWaitMs: PLACE_MAX_WAIT_MS,
        doubleTimes: 1,
      });

      if (!ok) {
        const reset = emptyExec(true, Date.now());
        await this.setExec(reset);
        await this.logEvent(
          'MISSING19 ERROR: cannot click Rebet/Double -> reset',
          reset,
          { phase: 'error' },
        );
        this.setStatus(
          'error',
          'MISSING19 ERROR: cannot click Rebet/Double -> reset',
        );
        return { ok: false, exec: reset };
      }

      const amount = estimateRebetAmount(exec.baseAmount, nextDouble);
      const placed = {
        ...next,
        lastAmount: amount || 0,
        cycleStakeTotal:
          Number(exec?.cycleStakeTotal || 0) + Number(amount || 0),
      };

      await this.setExec(placed);
      await this.logPlaced(
        nextStep,
        targets,
        amount,
        `MISSING19 REBET+DOUBLE: placed increase ${nextDouble}/${cfg.maxDoubles} | targets ${targets.join(', ')}`,
        placed,
        'rebet-double',
      );
      this.setStatus(
        'armed',
        `MISSING19 REBET+DOUBLE: increase ${nextDouble}/${cfg.maxDoubles} placed | ${targets.length} targets`,
      );
      return { ok: true, exec: placed };
    }

    async activateInsuranceAfterLoss(exec, cfg, tableId, spin) {
      if (!cfg.insuranceEnabled) return exec;

      const lossAmount = Math.max(
        0,
        Number(exec?.cycleStakeTotal || 0),
        Number(exec?.baseAmount || 0),
      );
      if (lossAmount <= 0) return exec;

      const balance = await getCurrentBalanceValue(tableId);
      const prevTarget = Number(exec?.insuranceTargetBalance);
      const cycleStartBalance = Number(exec?.cycleStartBalance);
      const wasInsuranceActive = !!exec?.insuranceActive;
      let target = null;

      if (wasInsuranceActive && Number.isFinite(prevTarget)) {
        target = prevTarget;
      } else if (Number.isFinite(cycleStartBalance)) {
        target = cycleStartBalance;
      } else if (Number.isFinite(balance) && balance != null) {
        target = balance + lossAmount;
      } else if (Number.isFinite(prevTarget)) {
        target = prevTarget;
      }

      if (!wasInsuranceActive && Number.isFinite(prevTarget)) {
        target = Math.max(prevTarget, Number(target || 0));
      }

      const prevLevel = normalizeInsuranceLevel(exec?.insuranceLevel);
      const nextLevel = wasInsuranceActive ? prevLevel + 1 : 0;
      const nextTimes = insuranceTimesFromLevel(nextLevel);

      const insured = {
        ...exec,
        insuranceEnabled: true,
        insuranceChipValue: cfg.insuranceChipValue,
        insuranceLevel: nextLevel,
        insuranceTimes: nextTimes,
        insuranceActualChipValue: null,
        insuranceActive: true,
        insuranceLossAmount:
          Number.isFinite(target) && balance != null
            ? Math.max(0, target - balance)
            : Number(exec?.insuranceLossAmount || 0) + lossAmount,
        insuranceStartBalance:
          exec?.insuranceStartBalance ??
          (Number.isFinite(balance) ? balance : null),
        insuranceTargetBalance: Number.isFinite(target) ? target : null,
        insuranceCurrentBalance:
          Number.isFinite(balance) && balance != null ? balance : null,
      };

      const cycleBank = Number(exec?.cycleStartBalance);
      const cycleBankText = Number.isFinite(cycleBank)
        ? ` | cycle bank ${cycleBank.toFixed(2)}`
        : '';

      await this.logEvent(
        `MISSING19 INSURANCE ON: loss ${lossAmount.toFixed(2)} | chip ${formatStakeValue(
          cfg.insuranceChipValue,
        )} x${nextTimes}${cycleBankText} | target ${
          Number.isFinite(target) ? target.toFixed(2) : 'balance unknown'
        }`,
        insured,
        {
          phase: 'insurance',
          result: spin,
          balance,
          amount: lossAmount,
        },
      );

      return insured;
    }

    async settleInsuranceByBalance(exec, cfg, tableId, waitMs = 0) {
      if (!exec?.insuranceActive) return exec;

      if (!cfg.insuranceEnabled) {
        return {
          ...exec,
          insuranceEnabled: false,
          insuranceActive: false,
          insuranceLossAmount: 0,
          insuranceTargetBalance: null,
          insuranceCurrentBalance: null,
          insuranceStartBalance: null,
          insuranceChipValue: cfg.insuranceChipValue,
          insuranceLevel: 0,
          insuranceTimes: 1,
          insuranceActualChipValue: null,
        };
      }

      const target = Number(exec.insuranceTargetBalance);
      if (!Number.isFinite(target)) return exec;

      const balance = await waitForBalanceValue(tableId, waitMs);
      if (balance == null || balance < target) {
        return {
          ...exec,
          insuranceCurrentBalance: balance,
          insuranceLossAmount:
            balance == null ? exec.insuranceLossAmount : target - balance,
        };
      }

      const cleared = {
        ...exec,
        insuranceActive: false,
        insuranceLossAmount: 0,
        insuranceTargetBalance: null,
        insuranceCurrentBalance: balance,
        insuranceStartBalance: null,
        insuranceChipValue: cfg.insuranceChipValue,
        insuranceLevel: 0,
        insuranceTimes: 1,
        insuranceActualChipValue: null,
      };

      await this.logEvent(
        `MISSING19 INSURANCE OFF: recovered ${target.toFixed(2)} | balance ${balance.toFixed(2)}`,
        cleared,
        { phase: 'insurance', balance },
      );

      return cleared;
    }

    async buildInsuranceBaseSteps(exec, cfg) {
      const requestedChip = normalizeInsuranceChipValue(
        cfg.insuranceChipValue,
      );
      const chips = await BET.loadGlobalChips();
      const chipValues = Array.isArray(chips?.chipValues)
        ? chips.chipValues
        : [];
      const chipIndex = findChipIndexByValue(chipValues, requestedChip);

      if (chipIndex < 0) {
        const available = chipValues.length
          ? chipValues.map(formatStakeValue).join(', ')
          : 'none';
        return {
          ok: false,
          message: `MISSING19 INSURANCE ERROR: chip ${formatStakeValue(
            requestedChip,
          )} is not configured | available ${available}`,
        };
      }

      const level = normalizeInsuranceLevel(exec?.insuranceLevel);
      const times = insuranceTimesFromLevel(level);
      const actualChipValue = Number(chipValues[chipIndex]);

      return {
        ok: true,
        steps: [[{ chip: chipIndex + 1, times }]],
        level,
        times,
        actualChipValue,
      };
    }

    async tryEnterFromCycle(cycle, cfg, prefix, prevExec = null, opts = {}) {
      const tableId = await getTrackedTableIdForThisTab();
      if (!tableId) return { ok: false, gated: true };

      const targets = cycle.targets;
      if (targets.length !== TARGET_COUNT) {
        await this.reset(
          `MISSING19: invalid targets ${targets.length} -> reset`,
        );
        return { ok: false, gated: false };
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
      if (!okEntry) return { ok: false, gated: true };

      const seed = prevExec || emptyExec(true, cycle.collectAfter);
      let entryExec = execFromCycle(seed, cycle, cfg);
      if (!opts.skipInsuranceSettle) {
        entryExec = await this.settleInsuranceByBalance(
          entryExec,
          cfg,
          tableId,
          opts.waitInsuranceBalance ? 7000 : 0,
        );
      }

      let sourceSteps = cfg.useRebetDouble ? BASE_STEPS : cfg.steps;
      let method = cfg.useRebetDouble ? 'manual-base' : 'manual-step';
      let insuranceTag = '';

      if (cfg.insuranceEnabled && entryExec.insuranceActive) {
        const insurancePlan = await this.buildInsuranceBaseSteps(
          entryExec,
          cfg,
        );

        if (!insurancePlan.ok) {
          await this.setExec(entryExec);
          await this.logEvent(insurancePlan.message, entryExec, {
            phase: 'error',
          });
          this.setStatus('error', insurancePlan.message);
          return { ok: false, gated: false, exec: entryExec };
        }

        sourceSteps = insurancePlan.steps;
        method = 'insurance-chip';
        entryExec = {
          ...entryExec,
          insuranceChipValue: cfg.insuranceChipValue,
          insuranceLevel: insurancePlan.level,
          insuranceTimes: insurancePlan.times,
          insuranceActualChipValue: insurancePlan.actualChipValue,
        };
        insuranceTag = ` | insurance chip ${formatStakeValue(
          insurancePlan.actualChipValue,
        )} x${insurancePlan.times}`;
      }

      const steps = cloneSteps(sourceSteps);

      return this.placeAndReport(
        entryExec,
        targets,
        1,
        steps,
        `${prefix}: trigger ${cfg.triggerCount}, repeats ${cycle.repeatCount}${insuranceTag}`,
        method,
      );
    }

    async storeCycleOrEnter(cycle, cfg, prefix, prevExec = null, opts = {}) {
      if (canEnter(cycle, cfg)) {
        return this.tryEnterFromCycle(cycle, cfg, prefix, prevExec, opts);
      }

      const waiting = execFromCycle(
        prevExec || emptyExec(true, cycle.collectAfter),
        cycle,
        cfg,
      );
      await this.setExec(waiting, cycleStatus(cycle, cfg));
      return { ok: false, waiting: true, exec: waiting };
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const tableId = await getTrackedTableIdForThisTab();
      if (!tableId) return;

      const spin = getIndex(n);
      if (spin === -1) return;

      const cfg = await this.loadCfg();
      const logs = await getTrackedSpinLogs(tableId);

      if (exec.phase === 'armed') {
        const targets = normalizeTargets(exec.target);

        if (!targets.length) {
          await this.reset('MISSING19: empty targets -> reset');
          return;
        }

        if (targets.includes(spin)) {
          await this.logEvent(`MISSING19 WIN: hit ${spin}`, exec, {
            phase: 'win',
            result: spin,
          });

          const cycle = buildCycleFromLogs(logs, 0);
          await this.storeCycleOrEnter(
            cycle,
            cfg,
            `MISSING19 ENTRY AFTER WIN ${spin}`,
            exec,
            { waitInsuranceBalance: true },
          );
          return;
        }

        if (cfg.useRebetDouble) {
          const doubleCount = Math.max(
            0,
            Math.floor(Number(exec.doubleCount || 0)),
          );

          if (doubleCount >= cfg.maxDoubles) {
            await this.logEvent(
              `MISSING19 LOSS: max increases ${cfg.maxDoubles} missed`,
              exec,
              { phase: 'loss', result: spin },
            );

            const insuredExec =
              await this.activateInsuranceAfterLoss(
                exec,
                cfg,
                tableId,
                spin,
              );
            const cycle = buildCycleFromLogs(logs, 0);
            await this.storeCycleOrEnter(
              cycle,
              cfg,
              `MISSING19 ENTRY AFTER LOSS ${spin}`,
              insuredExec,
              { skipInsuranceSettle: true },
            );
            return;
          }

          await this.placeRebetDoubleAndReport(exec, targets, cfg);
          return;
        }

        const steps = cfg.steps;
        const maxStep = Math.max(1, steps.length);
        const step = Math.max(1, Math.floor(Number(exec.step || 1)));

        if (step >= maxStep) {
          await this.logEvent(
            `MISSING19 LOSS: step ${maxStep} missed`,
            exec,
            { phase: 'loss', result: spin },
          );

          const insuredExec = await this.activateInsuranceAfterLoss(
            exec,
            cfg,
            tableId,
            spin,
          );
          const cycle = buildCycleFromLogs(logs, 0);
          await this.storeCycleOrEnter(
            cycle,
            cfg,
            `MISSING19 ENTRY AFTER LOSS ${spin}`,
            insuredExec,
            { skipInsuranceSettle: true },
          );
          return;
        }

        await this.placeAndReport(
          exec,
          targets,
          step + 1,
          steps,
          'MISSING19 REBET',
          'manual-step',
        );
        return;
      }

      const cycle = buildCycleFromLogs(logs, exec.collectAfter);
      const collecting = execFromCycle(exec, cycle, cfg);

      if (!canEnter(cycle, cfg)) {
        await this.setExec(collecting, cycleStatus(cycle, cfg));
        return;
      }

      await this.tryEnterFromCycle(cycle, cfg, 'MISSING19 ENTRY', exec);
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
