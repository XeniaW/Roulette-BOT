import { entryGateFor } from '../shared/entry-limit.js';
import { catchOptions, chooseCandidate, numberItems } from '../shared/catch-options.js';

(() => {
  const DEFAULT_STEPS = Object.freeze([
    [{ chip: 1, times: 1 }],
    [{ chip: 1, times: 2 }],
    [{ chip: 1, times: 4 }],
    [{ chip: 2, times: 2 }],
  ]);

  const DEFAULT_CFG = Object.freeze({
    triggerCount: 2,
    maxIncreases: 3,
    steps: DEFAULT_STEPS,
  });

  const CFG_KEY = 'abCatchXMatchConfig';
  const ENABLED_KEY = 'autoBettingCatchXMatchEnabled';
  const STATUS_KEY = 'bettingStatusCatchXMatch';
  const EXECS_KEY = 'betExecCatchXMatchByTable';
  const TRACKED_TABLE_STATES_KEY = 'trackedTableStates';
  const TRACKED_TABLE_BET_LOGS_KEY = 'trackedTableBetLogsByTable';
  const MAX_BET_LOGS = 5000;
  const PLACE_MAX_WAIT_MS = 20000;
  const STRATEGY_VERSION = 1;

  const RED = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
  ]);

  const FACTORS = Object.freeze({
    lowhigh: {
      label: 'LOW/HIGH',
      sides: ['LOW', 'HIGH'],
      selectors: ['#index-900', '#index-905'],
      index(n) {
        if (n === 0) return -1;
        if (n >= 1 && n <= 18) return 0;
        if (n >= 19 && n <= 36) return 1;
        return -1;
      },
    },
    colors: {
      label: 'COLOR',
      sides: ['RED', 'BLACK'],
      selectors: ['#index-903', '#index-902'],
      index(n) {
        if (n === 0) return -1;
        return RED.has(n) ? 0 : 1;
      },
    },
    evenodd: {
      label: 'EVEN/ODD',
      sides: ['EVEN', 'ODD'],
      selectors: ['#index-901', '#index-904'],
      index(n) {
        if (n === 0) return -1;
        return n % 2 === 0 ? 0 : 1;
      },
    },
  });

  const FACTOR_ORDER = ['lowhigh', 'colors', 'evenodd'];

  function roundMoney(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  }

  function makeDocumentSession() {
    const timeOrigin = Number(globalThis.performance?.timeOrigin);
    return Number.isFinite(timeOrigin)
      ? `page-${timeOrigin}`
      : `page-${Date.now()}`;
  }

  function getNumber(raw) {
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 36 ? n : null;
  }

  function opposite(side) {
    return side === 0 ? 1 : 0;
  }

  function targetKey(target) {
    return `${target.factor}:${target.side}`;
  }

  function normalizeTarget(raw) {
    const factor = String(raw?.factor || '').trim();
    if (!FACTORS[factor]) return null;
    const side = Number(raw?.side);
    if (side !== 0 && side !== 1) return null;
    return { factor, side };
  }

  function normalizeTargets(rawTargets) {
    const src = Array.isArray(rawTargets) ? rawTargets : [];
    const out = [];
    const used = new Set();

    for (const raw of src) {
      const target = normalizeTarget(raw);
      if (!target) continue;
      const key = targetKey(target);
      if (used.has(key)) continue;
      used.add(key);
      out.push(target);
    }

    return out;
  }

  function labelSide(target) {
    const factor = FACTORS[target.factor];
    return factor ? factor.sides[target.side] : '?';
  }

  function labelTarget(target) {
    const factor = FACTORS[target.factor];
    return factor ? `${factor.label}:${factor.sides[target.side]}` : '?';
  }

  function getTargetNode(target) {
    const clean = normalizeTarget(target);
    if (!clean) return null;
    const factor = FACTORS[clean.factor];
    const sel = factor.selectors[clean.side];
    return document.querySelector(sel);
  }

  function hasHalfBetGrid() {
    return FACTOR_ORDER.some((factorKey) =>
      FACTORS[factorKey].selectors.some((sel) =>
        document.querySelector(sel),
      ),
    );
  }

  function getNumberNode(n) {
    // The page can have duplicate index-* elements outside the live board.
    // Number strategy already uses this root; use the same source here.
    const root = document.querySelector('[data-name="center-section"]');
    return root?.querySelector(`#index-${100 + Number(n)}`) || null;
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

    for (const target of normalizeTargets(targets)) {
      const node = getTargetNode(target);
      if (!node) missing.push(labelTarget(target));
      else if (!isNodeEnabled(node)) disabled.push(labelTarget(target));
    }

    return { missing, disabled };
  }

  function formatPlaceError(res) {
    const parts = [];
    if (Array.isArray(res?.missingTargets) && res.missingTargets.length) {
      parts.push(`missing nodes ${res.missingTargets.join(', ')}`);
    }
    if (Array.isArray(res?.disabledTargets) && res.disabledTargets.length) {
      parts.push(`disabled nodes ${res.disabledTargets.join(', ')}`);
    }
    return parts.join(' | ') || 'target/chip timeout';
  }

  function sanitizeItems(rawItems) {
    const src = Array.isArray(rawItems) ? rawItems : [];
    const items = src
      .map((it) => ({
        chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
        times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
      }))
      .filter((it) => Number.isFinite(it.chip) && Number.isFinite(it.times));

    return items.length ? items : [{ chip: 1, times: 1 }];
  }

  function sanitizeSteps(rawSteps) {
    const src = Array.isArray(rawSteps) ? rawSteps : DEFAULT_STEPS;
    const steps = src
      .map((step) => sanitizeItems(step))
      .filter((step) => step.length);

    return steps.length ? steps : JSON.parse(JSON.stringify(DEFAULT_STEPS));
  }

  function sanitizeCfg(raw) {
    const src = raw || {};
    return {
      ...catchOptions(src),
      triggerCount: Math.max(
        2,
        Math.floor(Number(src.triggerCount ?? DEFAULT_CFG.triggerCount)),
      ),
      maxIncreases: Math.max(
        0,
        Math.floor(Number(src.maxIncreases ?? DEFAULT_CFG.maxIncreases)),
      ),
      steps: sanitizeSteps(src.steps),
    };
  }

  function stepLimit(cfg) {
    const maxByIncreases = Math.max(1, Number(cfg.maxIncreases || 0) + 1);
    return Math.max(1, Math.min(cfg.steps.length, maxByIncreases));
  }

  function emptyExec(enabled = false) {
    return {
      strategyVersion: STRATEGY_VERSION,
      enabled: !!enabled,
      phase: 'idle',
      targets: [],
      match: [],
      step: 1,
      debt: 0,
      triggerCount: DEFAULT_CFG.triggerCount,
      maxIncreases: DEFAULT_CFG.maxIncreases,
      blocked: [],
      lastWindow: [],
      lastSpin: null,
      lastAmount: 0,
      activeStake: 0,
      armedAt: 0,
      lastHandledSpinKey: '',
    };
  }

  function resetPatternKeepRecovery(exec, cfg, overrides = {}) {
    return {
      ...emptyExec(true),
      step: Math.max(1, Number(overrides.step ?? exec?.step ?? 1)),
      debt: roundMoney(Math.max(0, Number(overrides.debt ?? exec?.debt ?? 0))),
      triggerCount: cfg.triggerCount,
      maxIncreases: cfg.maxIncreases,
      lastSpin: overrides.lastSpin ?? null,
      lastHandledSpinKey:
        overrides.lastHandledSpinKey ?? exec?.lastHandledSpinKey ?? '',
    };
  }

  function normalizeExec(saved, enabled) {
    const raw = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    const out = {
      ...emptyExec(enabled),
      ...raw,
      enabled: !!enabled,
      strategyVersion: STRATEGY_VERSION,
    };

    out.phase = out.phase === 'armed' ? 'armed' : 'idle';
    out.targets = out.phase === 'armed' ? normalizeTargets(out.targets) : [];
    out.match = normalizeTargets(out.match);
    out.blocked = normalizeTargets(out.blocked);
    out.step = Math.max(1, Math.floor(Number(out.step || 1)));
    out.debt = roundMoney(Math.max(0, Number(out.debt || 0)));
    out.triggerCount = Math.max(
      2,
      Math.floor(
        Number(out.triggerCount ?? DEFAULT_CFG.triggerCount),
      ),
    );
    out.maxIncreases = Math.max(
      0,
      Math.floor(
        Number(out.maxIncreases ?? DEFAULT_CFG.maxIncreases),
      ),
    );
    out.lastWindow = Array.isArray(out.lastWindow)
      ? out.lastWindow.map(getNumber).filter((n) => n != null)
      : [];
    out.lastSpin = getNumber(out.lastSpin);
    out.lastAmount = roundMoney(out.lastAmount);
    out.activeStake = roundMoney(out.activeStake);
    out.armedAt = Number.isFinite(Number(out.armedAt)) ? Number(out.armedAt) : 0;
    out.documentSession = String(out.documentSession || '');
    out.lastHandledSpinKey = String(out.lastHandledSpinKey || '');

    return out;
  }

  function spinsAfterLastZero(spinLogs) {
    const logs = Array.isArray(spinLogs) ? spinLogs : [];
    const out = [];

    for (let i = logs.length - 1; i >= 0; i--) {
      const n = getNumber(logs[i]?.n);
      if (n == null) continue;
      if (n === 0) break;
      out.push(n);
    }

    return out.reverse();
  }

  function detectMatches(spinLogs, cfg) {
    const clean = spinsAfterLastZero(spinLogs);
    const triggerCount = Math.max(2, Math.floor(Number(cfg.triggerCount || 2)));
    const windowNums = clean.slice(-triggerCount);
    const matches = [];

    if (windowNums.length < triggerCount) {
      return { windowNums, matches, targets: [] };
    }

    for (const factorKey of FACTOR_ORDER) {
      const factor = FACTORS[factorKey];
      const first = factor.index(windowNums[0]);
      if (first === -1) continue;
      const ok = windowNums.every((n) => factor.index(n) === first);
      if (!ok) continue;
      matches.push({ factor: factorKey, side: first });
    }

    return {
      windowNums,
      matches,
      targets: matches.map((m) => ({ factor: m.factor, side: opposite(m.side) })),
    };
  }

  function splitBlockedMatches(matches, blocked) {
    const cleanMatches = normalizeTargets(matches);
    const activeBlocked = normalizeTargets(blocked).filter((block) =>
      cleanMatches.some(
        (match) => match.factor === block.factor && match.side === block.side,
      ),
    );
    const availableMatches = cleanMatches.filter(
      (match) =>
        !activeBlocked.some(
          (block) => block.factor === match.factor && block.side === match.side,
        ),
    );

    return { activeBlocked, availableMatches };
  }

  function resolveTargets(targets, spin) {
    const cleanTargets = normalizeTargets(targets);
    const wins = [];
    const losses = [];

    for (const target of cleanTargets) {
      const factor = FACTORS[target.factor];
      const actual = factor.index(spin);
      if (actual === target.side) wins.push(target);
      else losses.push(target);
    }

    return { wins, losses };
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

  async function getTrackedSpinLogsForThisTab() {
    const tableId = await getTrackedTableIdForThisTab();
    if (!tableId) return { tableId: '', spinLogs: [] };

    const { [TRACKED_TABLE_STATES_KEY]: states = {} } = await BET.sget({
      [TRACKED_TABLE_STATES_KEY]: {},
    });
    const state = states && typeof states === 'object' ? states[tableId] : null;

    return {
      tableId,
      spinLogs: Array.isArray(state?.spinLogs) ? state.spinLogs.slice() : [],
    };
  }

  async function appendTrackedBetLog(tableId, entry) {
    if (!tableId) return;

    const {
      [TRACKED_TABLE_STATES_KEY]: states = {},
      [TRACKED_TABLE_BET_LOGS_KEY]: tableLogMap = {},
    } = await BET.sget({
      [TRACKED_TABLE_STATES_KEY]: {},
      [TRACKED_TABLE_BET_LOGS_KEY]: {},
    });

    const nextStates = states && typeof states === 'object' ? { ...states } : {};
    const nextTableLogMap =
      tableLogMap && typeof tableLogMap === 'object' && !Array.isArray(tableLogMap)
        ? { ...tableLogMap }
        : {};
    const prevState =
      nextStates[tableId] && typeof nextStates[tableId] === 'object'
        ? { ...nextStates[tableId] }
        : {};

    const betLogs = Array.isArray(prevState.betLogs) ? prevState.betLogs.slice() : [];
    betLogs.push(entry);
    if (betLogs.length > MAX_BET_LOGS) {
      betLogs.splice(0, betLogs.length - MAX_BET_LOGS);
    }

    prevState.betLogs = betLogs;
    nextStates[tableId] = prevState;

    const tableLogs = Array.isArray(nextTableLogMap[tableId])
      ? nextTableLogMap[tableId].slice()
      : [];
    tableLogs.push(entry);
    if (tableLogs.length > MAX_BET_LOGS) {
      tableLogs.splice(0, tableLogs.length - MAX_BET_LOGS);
    }
    nextTableLogMap[tableId] = tableLogs;

    await BET.sset({
      [TRACKED_TABLE_STATES_KEY]: nextStates,
      [TRACKED_TABLE_BET_LOGS_KEY]: nextTableLogMap,
    });
  }

  async function getCurrentBalanceValue() {
    try {
      const { currentBalance = null } = await BET.sget({
        currentBalance: null,
      });
      const value = Number(currentBalance?.value);
      return Number.isFinite(value) ? roundMoney(value) : null;
    } catch {
      return null;
    }
  }

  async function placeStep(targets, step, steps, mutex) {
    const cleanTargets = normalizeTargets(targets);
    const inspection = inspectTargets(cleanTargets);
    const cappedStep = Math.max(1, Math.min(step, steps.length));
    const ok = await BET.tryPlace({
      step: cappedStep,
      targets: cleanTargets,
      steps,
      getTargetNode: (target) => getTargetNode(target),
      mutex,
      maxWaitMs: PLACE_MAX_WAIT_MS,
    });

    if (!ok) {
      return {
        ok: false,
        amount: 0,
        perTarget: 0,
        missingTargets: inspection.missing,
        disabledTargets: inspection.disabled,
      };
    }

    const chips = await BET.loadGlobalChips();
    const perTarget = roundMoney(
      BET.perTargetAmountForStep(cappedStep, steps, chips.chipValues),
    );
    const amount = roundMoney(perTarget * cleanTargets.length);

    return { ok: true, amount, perTarget };
  }

  class CatchXMatchMarket {
    constructor() {
      this.mutex = new BET.Mutex();
      this.spinMutex = new BET.Mutex();
      this._inited = false;
      this.destroyed = false;
      this.documentSession = makeDocumentSession();
      this.restoreInFlight = false;
    }

    canActInThisFrame() {
      return hasHalfBetGrid();
    }

    async loadCfg() {
      const { [CFG_KEY]: cfg = DEFAULT_CFG } = await BET.sget({
        [CFG_KEY]: DEFAULT_CFG,
      });
      return sanitizeCfg(cfg);
    }

    async getExec(tableId, enabled = null) {
      const { [ENABLED_KEY]: storedEnabled = false, [EXECS_KEY]: raw = {} } =
        await BET.sget({
          [ENABLED_KEY]: false,
          [EXECS_KEY]: {},
        });
      const map = raw && typeof raw === 'object' ? raw : {};
      return normalizeExec(
        map[tableId],
        enabled == null ? storedEnabled : enabled,
      );
    }

    async setExec(tableId, next, statusMsg = null) {
      const { [EXECS_KEY]: raw = {} } = await BET.sget({
        [EXECS_KEY]: {},
      });
      const map = raw && typeof raw === 'object' ? { ...raw } : {};
      map[tableId] = normalizeExec(next, next?.enabled !== false);
      await BET.sset({ [EXECS_KEY]: map });

      if (statusMsg) {
        BET.setBetStatus(
          STATUS_KEY,
          map[tableId].enabled ? map[tableId].phase || 'idle' : 'off',
          statusMsg,
        );
      }
    }

    setStatus(state, message) {
      BET.setBetStatus(STATUS_KEY, state, message || '');
    }

    async logEvent(tableId, message, exec, extra = {}) {
      const balance = await getCurrentBalanceValue();
      await appendTrackedBetLog(tableId, {
        t: Date.now(),
        type: 'event',
        market: 'catchxmatch',
        phase: extra.phase || exec?.phase || 'idle',
        message,
        step: exec?.step ?? null,
        debt: roundMoney(exec?.debt || 0),
        targets: normalizeTargets(exec?.targets).map(labelTarget),
        match: normalizeTargets(exec?.match).map(labelTarget),
        blocked: normalizeTargets(exec?.blocked).map(labelTarget),
        window: Array.isArray(exec?.lastWindow) ? exec.lastWindow.slice() : [],
        balance,
        ...extra,
      });
    }

    async logPlaced(tableId, targets, amount, perTarget, message, exec) {
      const balance = await getCurrentBalanceValue();
      await appendTrackedBetLog(tableId, {
        t: Date.now(),
        type: 'placed',
        market: 'catchxmatch',
        phase: 'armed',
        message,
        amount: roundMoney(amount),
        perTarget: roundMoney(perTarget),
        step: exec?.step ?? null,
        debt: roundMoney(exec?.debt || 0),
        balance,
        targets: normalizeTargets(targets).map(labelTarget),
        match: normalizeTargets(exec?.match).map(labelTarget),
        window: Array.isArray(exec?.lastWindow) ? exec.lastWindow.slice() : [],
      });
    }

    async loadEnabled() {
      if (!this.canActInThisFrame()) return;

      const tableId = await getTrackedTableIdForThisTab();
      if (!tableId) return;

      const { [ENABLED_KEY]: enabled = false } = await BET.sget({
        [ENABLED_KEY]: false,
      });
      const exec = await this.getExec(tableId, enabled);

      if (!enabled) {
        await this.setExec(tableId, emptyExec(false), 'CATCH X MATCH: OFF');
        return;
      }

      await this.setExec(tableId, exec, 'CATCH X MATCH: wait match');
    }

    async placeTargets(
      tableId,
      exec,
      targets,
      matches,
      cfg,
      prefix,
      opts = {},
    ) {
      const cleanTargets = normalizeTargets(targets);
      const cleanMatches = normalizeTargets(matches);
      if (cleanTargets.length !== 1) {
        const stopped = {
          ...exec,
          phase: 'idle',
          targets: [],
          match: [],
          armedAt: 0,
        };
        const message = `${prefix}: rejected ${cleanTargets.length} targets; one target required`;
        await this.setExec(tableId, stopped, message);
        this.setStatus('error', message);
        return { ok: false, invalidTargets: true, exec: stopped };
      }

      const limit = stepLimit(cfg);
      const step = Math.max(1, Math.min(Number(exec.step || 1), limit));
      const debt = roundMoney(exec.debt || 0);
      const isBaseEntry = debt <= 0 && step === 1;

      if (isBaseEntry && !opts.restore) {
        const okEntry = await entryGateFor(
          'catchxmatch',
          ENABLED_KEY,
          STATUS_KEY,
          {
            execKey: EXECS_KEY,
            execByTable: true,
            tableId,
          },
        );
        if (!okEntry) return { ok: false, gated: true, exec };
      }

      const windowText = Array.isArray(exec.lastWindow)
        ? exec.lastWindow.join(',')
        : '';
      const next = {
        ...exec,
        enabled: true,
        phase: 'armed',
        targets: cleanTargets,
        match: cleanMatches,
        step,
        debt,
        triggerCount: cfg.triggerCount,
        maxIncreases: cfg.maxIncreases,
        armedAt: Date.now(),
        documentSession: this.documentSession,
      };

      await this.setExec(
        tableId,
        next,
        `${prefix}: placing ${cleanTargets.map(labelSide).join(' + ')} | step ${step} | debt ${debt.toFixed(2)} | window ${windowText}`,
      );

      const items = numberItems(cfg, step);
      if (items === null) {
        await BET.sset({ [ENABLED_KEY]: false });
        this.setStatus('error', `CATCH X MATCH: no number configuration for step ${step}`);
        return { ok: false, exec };
      }
      const chips = await BET.loadGlobalChips();
      const halfAmount = roundMoney(BET.perTargetAmountForStep(step, cfg.steps, chips.chipValues));
      const numberAmount = items.length
        ? roundMoney(BET.perTargetAmountForStep(1, [items], chips.chipValues)) : 0;
      const target = cleanTargets[0];
      const numbers = numberAmount > 0 ? Array.from({ length: 36 }, (_, i) => i + 1)
        .filter(n => FACTORS[target.factor].index(n) === target.side) : [];
      const uniqueNumbers = [...new Set(numbers)];
      if (numberAmount > 0 && uniqueNumbers.length !== 18) {
        await BET.sset({ [ENABLED_KEY]: false });
        this.setStatus(
          'error',
          `CATCH X MATCH: expected 18 numbers, got ${uniqueNumbers.length}`,
        );
        return { ok: false, exec };
      }
      const layout = { key: targetKey(target), halfAmount, numberAmount,
        numberTargets: uniqueNumbers, documentSession: this.documentSession, step };
      const previous = exec.previousLayout;
      const otherKeys = ['Dozens', 'Rows', 'Six', 'Threes', 'LowHigh', 'EvenOdd',
        'Colors', 'Sectors', 'Neighbors', 'AntiDozens', 'AntiRows', 'Numbers',
        'Missing19', 'Repeats', 'Combo'].map(name => `autoBetting${name}Enabled`);
      const otherMarkets = await BET.sget(Object.fromEntries(otherKeys.map(key => [key, false])));
      const canDouble = !otherKeys.some(key => otherMarkets[key]) &&
        !opts.restore && cfg.numbersDouble && uniqueNumbers.length === 18 &&
        previous?.key === layout.key && previous.documentSession === this.documentSession &&
        previous.step === step - 1 &&
        Array.isArray(previous.numberTargets) &&
        previous.numberTargets.length === 18 &&
        previous.numberTargets.every((n, index) => n === uniqueNumbers[index]) &&
        halfAmount === roundMoney(previous.halfAmount * 2) &&
        numberAmount === roundMoney(previous.numberAmount * 2);
      let res;
      if (canDouble) {
        const ok = await BET.tryRebetDouble({ mutex: this.mutex, doubleTimes: 1,
          maxWaitMs: PLACE_MAX_WAIT_MS });
        res = { ok, amount: halfAmount + 18 * numberAmount,
          perTarget: halfAmount + 18 * numberAmount };
      } else {
        // Validate every required number before placing the half to avoid a
        // known incomplete layout. Failures after clicking stop the strategy.
        const missing = uniqueNumbers.filter(n => !getNumberNode(n));
        if (missing.length) {
          res = { ok: false, missingTargets: missing };
        } else {
          res = await placeStep(cleanTargets, step, cfg.steps, this.mutex);
          if (res.ok && uniqueNumbers.length) {
            const ok = await BET.tryPlace({ step: 1, steps: [items], targets: uniqueNumbers,
              getTargetNode: getNumberNode, mutex: this.mutex, maxWaitMs: PLACE_MAX_WAIT_MS,
              strictTargetClick: true });
            res = { ok, amount: roundMoney(halfAmount + 18 * numberAmount),
              perTarget: roundMoney(halfAmount + 18 * numberAmount) };
          }
        }
      }
      if (!res.ok) {
        if (numbers.length) {
          await BET.sset({ [ENABLED_KEY]: false });
        }
        const idle = {
          ...next,
          phase: 'idle',
          targets: [],
          armedAt: 0,
        };
        const reason = formatPlaceError(res);
        await this.setExec(tableId, idle);
        await this.logEvent(
          tableId,
          `${prefix}: cannot place | ${reason}`,
          idle,
          { phase: 'error' },
        );
        this.setStatus('error', `${prefix}: cannot place | ${reason}`);
        return { ok: false, exec: idle };
      }

      const placed = {
        ...next,
        lastAmount: roundMoney(res.amount),
        activeStake: roundMoney(res.perTarget),
        layout,
      };
      await this.setExec(tableId, placed);
      await this.logPlaced(
        tableId,
        cleanTargets,
        res.amount,
        res.perTarget,
        `${prefix}: placed | step ${step} | half ${halfAmount} | each number ${numberAmount} x ${uniqueNumbers.length} | numbers ${uniqueNumbers.join(',')} | total ${roundMoney(res.amount)} | ${canDouble ? 'rebet x2' : 'chips'} | targets ${cleanTargets.map(labelTarget).join(', ')} | ${exec.selectionText || ''}`,
        placed,
      );
      this.setStatus(
        'armed',
        `${prefix}: ${cleanTargets.length} targets | step ${step} | debt ${debt.toFixed(2)}`,
      );
      return { ok: true, exec: placed };
    }

    async restorePendingBet() {
      if (this.restoreInFlight || !this.canActInThisFrame()) return;
      this.restoreInFlight = true;

      try {
        const tableId = await getTrackedTableIdForThisTab();
        if (!tableId) return;

        const exec = await this.getExec(tableId);
        if (
          !exec.enabled ||
          exec.phase !== 'armed' ||
          exec.documentSession === this.documentSession
        ) {
          return;
        }

        const { spinLogs } = await getTrackedSpinLogsForThisTab();
        const logs = Array.isArray(spinLogs) ? spinLogs : [];
        const firstNewSpin = logs.findIndex(
          (entry) => Number(entry?.t) > Number(exec.armedAt || 0),
        );

        // A result arrived while the frame was reloading. Replay it from the
        // tracked history instead of placing an already-settled old bet.
        if (firstNewSpin >= 0) {
          const cfg = await this.loadCfg();
          const progress = logs.slice(0, firstNewSpin);
          for (const entry of logs.slice(firstNewSpin)) {
            progress.push(entry);
            await this.onSpin(entry?.n, progress);
          }
          return;
        }

        const cfg = await this.loadCfg();
        const restored = await this.placeTargets(
          tableId,
          exec,
          exec.targets,
          exec.match,
          cfg,
          'CATCH X MATCH RESTORE',
          { restore: true },
        );

        if (restored.invalidTargets) return;
        if (!restored.ok) {
          // Keep the saved progression intact. The next normal state update
          // can retry it once the roulette controls are available again.
          const { [ENABLED_KEY]: stillEnabled } = await BET.sget({ [ENABLED_KEY]: false });
          if (!stillEnabled) return;
          await this.setExec(
            tableId,
            exec,
            'CATCH X MATCH RESTORE: waiting for betting controls',
          );
        }
      } finally {
        this.restoreInFlight = false;
      }
    }

    async maybeEnter(tableId, spinLogs, exec, cfg, prefix) {
      // Winning resets the stake, not the rolling history. Per-factor blocks
      // prevent reusing a consumed stream while other factors remain eligible.
      const detected = detectMatches(spinLogs, cfg);
      const idle = {
        ...exec,
        enabled: true,
        phase: 'idle',
        targets: [],
        match: detected.matches,
        triggerCount: cfg.triggerCount,
        maxIncreases: cfg.maxIncreases,
        lastWindow: detected.windowNums,
        armedAt: 0,
      };

      if (detected.windowNums.length < cfg.triggerCount) {
        const msg = `${prefix}: collecting ${detected.windowNums.length}/${cfg.triggerCount} non-zero spins`;
        await this.setExec(tableId, idle, msg);
        this.setStatus('idle', msg);
        return { ok: false, exec: idle };
      }

      if (!detected.targets.length) {
        const msg = `${prefix}: no X match | window ${detected.windowNums.join(',')}`;
        await this.setExec(tableId, { ...idle, blocked: [] }, msg);
        this.setStatus('idle', msg);
        return { ok: false, exec: { ...idle, blocked: [] } };
      }

      const { activeBlocked, availableMatches } = splitBlockedMatches(
        detected.matches,
        exec.blocked,
      );
      const availableTargets = availableMatches.map((match) => ({
        factor: match.factor,
        side: opposite(match.side),
      }));

      if (!availableTargets.length) {
        const waiting = { ...idle, blocked: activeBlocked };
        const msg = `${prefix}: wait chain break | blocked ${activeBlocked.map(labelTarget).join(', ')}`;
        await this.setExec(tableId, waiting, msg);
        this.setStatus('idle', msg);
        return { ok: false, exec: waiting };
      }

      const selection = chooseCandidate(availableMatches, spinLogs, cfg.historyCount, FACTORS);
      if (selection.waitingHistory) {
        const message = `N ${cfg.historyCount} | history ${selection.available}/${cfg.historyCount} | wait history`;
        const waiting = { ...idle, blocked: activeBlocked, selectionText: message };
        await this.setExec(tableId, waiting, `${prefix}: ${message}`);
        return { ok: false, exec: waiting };
      }
      const selectionText = selection.scores.map(s =>
        `${labelSide({ factor: s.factor, side: opposite(s.side) })}=${s.count}`).join(', ');
      const ready = { ...idle, blocked: activeBlocked,
        selectionText: `N ${cfg.historyCount} | ${selectionText}${selection.chosen ? '' : ' | TIE: skip'}` };
      if (!selection.chosen) {
        await this.setExec(tableId, ready, `${prefix}: ${ready.selectionText}`);
        return { ok: false, exec: ready };
      }
      return this.placeTargets(
        tableId,
        ready,
        [{ factor: selection.chosen.factor, side: opposite(selection.chosen.side) }],
        availableMatches,
        cfg,
        prefix,
      );
    }

    async resolveArmed(tableId, spinLogs, exec, cfg, spin) {
      const targets = normalizeTargets(exec.targets);
      const activeStake = roundMoney(
        exec.activeStake || (targets.length ? exec.lastAmount / targets.length : 0),
      );

      if (spin === 0) {
        const lostAmount = roundMoney(activeStake * targets.length);
        const nextDebt = roundMoney(Number(exec.debt || 0) + lostAmount);
        const nextStep = Math.max(1, Number(exec.step || 1)) + 1;
        const limit = stepLimit(cfg);
        const exhausted = nextDebt > 0 && nextStep > limit;
        const reset = exhausted
          ? resetPatternKeepRecovery(exec, cfg, {
              step: 1,
              debt: 0,
              lastSpin: 0,
            })
          : resetPatternKeepRecovery(exec, cfg, {
              step: nextStep,
              debt: nextDebt,
              lastSpin: 0,
            });
        await this.logEvent(
          tableId,
          exhausted
            ? `CATCH X MATCH ZERO: loss ${lostAmount.toFixed(2)} -> exhausted/reset`
            : `CATCH X MATCH ZERO: loss ${lostAmount.toFixed(2)} -> keep step ${nextStep}`,
          exec,
          { phase: 'zero', result: 0, amount: lostAmount },
        );
        await this.setExec(
          tableId,
          reset,
          exhausted
            ? 'CATCH X MATCH ZERO: exhausted, reset and wait new non-zero chain'
            : `CATCH X MATCH ZERO: keep step ${nextStep}, wait new non-zero chain`,
        );
        this.setStatus(
          'idle',
          exhausted
            ? 'CATCH X MATCH ZERO: exhausted/reset'
            : `CATCH X MATCH ZERO: progression kept at step ${nextStep}`,
        );
        return reset;
      }

      const { wins, losses } = resolveTargets(targets, spin);
      const pnl = roundMoney((wins.length - losses.length) * activeStake);
      const won = wins.length === targets.length && targets.length > 0;
      const nextDebt = won ? 0 : roundMoney(Math.max(0, Number(exec.debt || 0) - pnl));
      // A used X-window is consumed. It cannot seed the next entry until its
      // source stream breaks, even if the selected bet won.
      const currentMatches = detectMatches(spinLogs, cfg).matches;
      const { activeBlocked } = splitBlockedMatches(
        currentMatches,
        exec.blocked,
      );
      const blockedFactors = normalizeTargets([
        ...activeBlocked,
        ...normalizeTargets(exec.match),
      ]);
      const limit = stepLimit(cfg);
      let nextStep = Math.max(1, Number(exec.step || 1));

      if (nextDebt <= 0) {
        nextStep = 1;
      } else if (pnl < 0) {
        // One roulette result advances the shared progression by one step,
        // regardless of how many half-bets lost on that same result.
        nextStep += 1;
      }

      const resultMsg =
        `CATCH X MATCH RESULT ${spin}: wins ${wins.map(labelSide).join('+') || '-'} | losses ${losses.map(labelSide).join('+') || '-'} | pnl ${pnl.toFixed(2)} | debt ${nextDebt.toFixed(2)}`;

      await this.logEvent(tableId, resultMsg, exec, {
        phase: wins.length ? 'result' : 'loss',
        result: spin,
        amount: pnl,
        wins: wins.map(labelTarget),
        losses: losses.map(labelTarget),
      });

      if (nextDebt > 0 && nextStep > limit) {
        const reset = emptyExec(true);
        reset.triggerCount = cfg.triggerCount;
        reset.maxIncreases = cfg.maxIncreases;
        reset.lastSpin = spin;
        reset.blocked = blockedFactors;
        reset.lastHandledSpinKey = exec.lastHandledSpinKey;
        await this.setExec(
          tableId,
          reset,
          `CATCH X MATCH EXHAUSTED: limit ${limit} -> reset`,
        );
        this.setStatus('idle', `CATCH X MATCH EXHAUSTED: limit ${limit} -> reset`);
        return reset;
      }

      const next = {
        ...emptyExec(true),
        step: nextStep,
        debt: nextDebt,
        triggerCount: cfg.triggerCount,
        maxIncreases: cfg.maxIncreases,
        blocked: blockedFactors,
        lastSpin: spin,
        lastHandledSpinKey: exec.lastHandledSpinKey,
        previousLayout: exec.layout || null,
      };

      if (nextDebt <= 0) {
        await this.setExec(tableId, next, `${resultMsg} -> recovered/reset`);
      } else if (blockedFactors.length) {
        await this.setExec(tableId, next, `${resultMsg} -> wait chain break`);
      } else {
        await this.setExec(tableId, next, `${resultMsg} -> wait next match`);
      }

      return next;
    }

    async onSpin(n, spinLogsOverride = null) {
      return this.spinMutex.run(() => this.processSpin(n, spinLogsOverride));
    }

    async processSpin(n, spinLogsOverride = null) {
      if (!this.canActInThisFrame()) return;

      const spin = getNumber(n);
      if (spin == null) return;

      const tableBag = spinLogsOverride
        ? { tableId: await getTrackedTableIdForThisTab(), spinLogs: spinLogsOverride }
        : await getTrackedSpinLogsForThisTab();
      const { tableId } = tableBag;
      if (!tableId) return;

      let spinLogs = Array.isArray(tableBag.spinLogs) ? tableBag.spinLogs.slice() : [];
      if (
        spinLogs.length === 0 ||
        Number(spinLogs[spinLogs.length - 1]?.n) !== spin
      ) {
        spinLogs.push({ n: spin });
      }

      const exec = await this.getExec(tableId);
      if (!exec.enabled) return;

      const lastLog = spinLogs[spinLogs.length - 1] || null;
      const loggedAt = Number(lastLog?.t);
      const spinKey = Number.isFinite(loggedAt)
        ? `${loggedAt}:${spin}`
        : '';
      if (spinKey && exec.lastHandledSpinKey === spinKey) return;

      // Persist this before resolving/entering. Storage can deliver the same
      // spin through more than one listener path, especially after a reload.
      const guardedExec = spinKey
        ? { ...exec, lastHandledSpinKey: spinKey }
        : exec;
      if (spinKey) await this.setExec(tableId, guardedExec);

      const cfg = await this.loadCfg();

      // States made by the old multi-half implementation are never reused.
      // Keep the recovery step, discard the old layout, and enter only through
      // the current one-target selector.
      if (
        guardedExec.phase === 'armed' &&
        normalizeTargets(guardedExec.targets).length !== 1
      ) {
        const recovered = resetPatternKeepRecovery(guardedExec, cfg, {
          lastSpin: spin,
        });
        await this.setExec(
          tableId,
          recovered,
          'CATCH X MATCH: discarded legacy multi-target layout',
        );
        if (spin !== 0) {
          await this.maybeEnter(
            tableId,
            spinLogs,
            recovered,
            cfg,
            'CATCH X MATCH',
          );
        }
        return;
      }

      if (guardedExec.phase === 'armed') {
        const afterResult = await this.resolveArmed(
          tableId,
          spinLogs,
          guardedExec,
          cfg,
          spin,
        );
        if (spin === 0) return;
        await this.maybeEnter(tableId, spinLogs, afterResult, cfg, 'CATCH X MATCH');
        return;
      }

      if (spin === 0) {
        const reset = resetPatternKeepRecovery(guardedExec, cfg, { lastSpin: 0 });
        await this.setExec(
          tableId,
          reset,
          `CATCH X MATCH ZERO: keep step ${reset.step}, wait new non-zero chain`,
        );
        this.setStatus(
          'idle',
          `CATCH X MATCH ZERO: progression kept at step ${reset.step}`,
        );
        return;
      }

      await this.maybeEnter(tableId, spinLogs, guardedExec, cfg, 'CATCH X MATCH');
    }

    attachStorageListener() {
      chrome.storage.onChanged.addListener(async (ch, area) => {
        if (area !== 'local') return;
        if (this.destroyed) return;

        if (ENABLED_KEY in ch) {
          await this.loadEnabled();
        }

        if (ch[TRACKED_TABLE_STATES_KEY]) {
          if (!this.canActInThisFrame()) return;

          const tableId = await getTrackedTableIdForThisTab();
          if (!tableId) return;

          const oldStates = ch[TRACKED_TABLE_STATES_KEY].oldValue || {};
          const newStates = ch[TRACKED_TABLE_STATES_KEY].newValue || {};

          const oldLogs = Array.isArray(oldStates?.[tableId]?.spinLogs)
            ? oldStates[tableId].spinLogs
            : [];
          const newLogs = Array.isArray(newStates?.[tableId]?.spinLogs)
            ? newStates[tableId].spinLogs
            : [];

          if (newLogs.length > oldLogs.length) {
            const progress = oldLogs.slice();
            const added = newLogs.slice(oldLogs.length);
            for (const e of added) {
              progress.push(e);
              await this.onSpin(e.n, progress);
            }
          }
        }
      });
    }

    async init() {
      if (this._inited || this.destroyed) return;
      this._inited = true;
      this.attachStorageListener();

      if (this.canActInThisFrame()) {
        await this.loadEnabled();
        await this.restorePendingBet();
      }

      const { [ENABLED_KEY]: enabled = false } = await BET.sget({
        [ENABLED_KEY]: false,
      });
      if (enabled && this.canActInThisFrame()) {
        this.setStatus('idle', 'CATCH X MATCH: ready');
      }

      window.addEventListener(
        'beforeunload',
        () => {
          this.destroyed = true;
        },
        { once: true },
      );
    }
  }

  const strategy = new CatchXMatchMarket();
  window.__STRAT_CATCH_X_MATCH__ = strategy;

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    strategy.init();
  } else {
    window.addEventListener('DOMContentLoaded', () => strategy.init(), {
      once: true,
    });
  }
})();
