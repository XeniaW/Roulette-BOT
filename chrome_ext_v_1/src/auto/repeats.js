import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_RANGES = Object.freeze([
    { from: 1, to: 9, items: [{ chip: 1, times: 1 }] },
    { from: 10, to: 12, items: [{ chip: 1, times: 2 }] },
  ]);
  const DEFAULT_INSURANCE_RANGES = Object.freeze([
    { from: 1, to: 9, items: [{ chip: 2, times: 1 }] },
    { from: 10, to: 12, items: [{ chip: 2, times: 2 }] },
  ]);

  const DEFAULT_CFG = Object.freeze({
    ranges: DEFAULT_RANGES,
    insuranceEnabled: false,
    insuranceRanges: DEFAULT_INSURANCE_RANGES,
  });

  const CFG_KEY = 'abRepeatsConfig';
  const ENABLED_KEY = 'autoBettingRepeatsEnabled';
  const STATUS_KEY = 'bettingStatusRepeats';
  const EXECS_KEY = 'betExecRepeatsByTable';
  const TRACKED_TABLE_STATES_KEY = 'trackedTableStates';
  const MAX_BET_LOGS = 5000;
  const PLACE_MAX_WAIT_MS = 20000;
  const STRATEGY_VERSION = 2;
  const MAX_NUMBERS = 37;

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

  function normalizeTargets(value) {
    const arr = Array.isArray(value) ? value : [];
    const out = [];
    const used = new Set();

    for (const raw of arr) {
      const n = getIndex(raw);
      if (n === -1 || used.has(n)) continue;
      used.add(n);
      out.push(n);
    }

    return out.slice(0, MAX_NUMBERS);
  }

  function sanitizeItems(rawItems) {
    const src = Array.isArray(rawItems) ? rawItems : [];
    const items = src
      .map((it) => ({
        chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
        times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
      }))
      .filter(
        (it) => Number.isFinite(it.chip) && Number.isFinite(it.times),
      );

    return items.length ? items : [{ chip: 1, times: 1 }];
  }

  function sanitizeRanges(rawRanges, fallback = DEFAULT_RANGES) {
    const src = Array.isArray(rawRanges) ? rawRanges : fallback;
    const ranges = src
      .map((range) => {
        const from = Math.max(1, Math.floor(Number(range?.from ?? 1)));
        const to = Math.max(
          from,
          Math.floor(Number(range?.to ?? from)),
        );
        return {
          from,
          to: Math.min(MAX_NUMBERS, to),
          items: sanitizeItems(range?.items),
        };
      })
      .filter((range) => range.from <= MAX_NUMBERS)
      .sort((a, b) => a.from - b.from || a.to - b.to);

    return ranges.length
      ? ranges
      : JSON.parse(JSON.stringify(fallback));
  }

  function sanitizeCfg(raw) {
    const src = raw || {};
    return {
      ranges: sanitizeRanges(src.ranges, DEFAULT_RANGES),
      insuranceEnabled: !!(
        src.insuranceEnabled ?? DEFAULT_CFG.insuranceEnabled
      ),
      insuranceRanges: sanitizeRanges(
        src.insuranceRanges,
        DEFAULT_INSURANCE_RANGES,
      ),
    };
  }

  function emptyExec(enabled = false) {
    return {
      strategyVersion: STRATEGY_VERSION,
      enabled: !!enabled,
      phase: 'idle',
      target: [],
      step: 0,
      spinCount: 0,
      chain: 'base',
      chainStep: 0,
      pendingChain: 'base',
      pauseSpins: 0,
      rangeFrom: null,
      rangeTo: null,
      armedAt: 0,
      lastSpin: null,
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
    out.target = out.phase === 'armed' ? normalizeTargets(out.target) : [];
    out.step = Math.max(0, Math.floor(Number(out.step || 0)));
    out.spinCount = Math.max(
      out.target.length,
      Math.floor(Number(out.spinCount || 0)),
    );
    out.chain = out.chain === 'insurance' ? 'insurance' : 'base';
    out.chainStep = Math.max(
      0,
      Math.floor(
        Number(out.chainStep || out.spinCount || out.target.length || 0),
      ),
    );
    out.pendingChain =
      out.pendingChain === 'insurance' ? 'insurance' : 'base';
    out.pauseSpins = Math.max(
      0,
      Math.floor(Number(out.pauseSpins || 0)),
    );
    if (out.phase !== 'armed') {
      out.chain = 'base';
      out.chainStep = 0;
    }
    out.rangeFrom = Number.isFinite(Number(out.rangeFrom))
      ? Number(out.rangeFrom)
      : null;
    out.rangeTo = Number.isFinite(Number(out.rangeTo))
      ? Number(out.rangeTo)
      : null;
    out.armedAt = Number.isFinite(Number(out.armedAt))
      ? Number(out.armedAt)
      : 0;
    out.lastSpin = getIndex(out.lastSpin) === -1 ? null : getIndex(out.lastSpin);
    out.lastAmount = Number.isFinite(Number(out.lastAmount))
      ? Number(out.lastAmount)
      : 0;

    return out;
  }

  function maxRangeTo(ranges) {
    const clean = sanitizeRanges(ranges);
    return clean.reduce((max, range) => Math.max(max, range.to), 1);
  }

  function activeRanges(cfg, chain) {
    return chain === 'insurance' && cfg.insuranceEnabled
      ? cfg.insuranceRanges
      : cfg.ranges;
  }

  function nextChain(chain, cfg) {
    if (!cfg.insuranceEnabled) return 'base';
    return chain === 'insurance' ? 'base' : 'insurance';
  }

  function chainLabel(chain) {
    return chain === 'insurance' ? 'INSURANCE' : 'BASE';
  }

  function pendingChainForExec(exec, cfg) {
    return exec?.pendingChain === 'insurance' && cfg.insuranceEnabled
      ? 'insurance'
      : 'base';
  }

  function isStageExhausted(exec, cfg) {
    if (!cfg.insuranceEnabled) return false;
    const chain = exec?.chain === 'insurance' ? 'insurance' : 'base';
    const limit = maxRangeTo(activeRanges(cfg, chain));
    const chainStep = Math.max(
      0,
      Math.floor(Number(exec?.chainStep || exec?.spinCount || 0)),
    );
    return chainStep >= limit;
  }

  function makeWaitingExec(enabled, pendingChain, pauseSpins, lastSpin) {
    const next = emptyExec(enabled);
    next.pendingChain = pendingChain;
    next.pauseSpins = Math.max(0, Math.floor(Number(pauseSpins || 0)));
    next.lastSpin = getIndex(lastSpin) === -1 ? null : getIndex(lastSpin);
    return next;
  }

  function pickChainState(exec, cfg, isNewCycle) {
    if (isNewCycle) {
      return {
        chain: pendingChainForExec(exec, cfg),
        chainStep: 1,
        switched: false,
      };
    }

    const chain = exec?.chain === 'insurance' ? 'insurance' : 'base';
    const chainStep = Math.max(
      0,
      Math.floor(Number(exec?.chainStep || exec?.spinCount || 0)),
    ) + 1;

    return { chain, chainStep, switched: false };
  }

  function pickRange(ranges, spinCount) {
    const count = Math.max(1, Math.floor(Number(spinCount || 1)));
    const clean = sanitizeRanges(ranges);
    const exact = clean.find(
      (range) => count >= range.from && count <= range.to,
    );
    if (exact) return exact;

    const lower = clean.filter((range) => range.to < count).pop();
    return lower || clean[0];
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

  async function placeStep(targets, range, mutex) {
    const steps = [sanitizeItems(range?.items)];
    const inspection = inspectTargets(targets);
    const ok = await BET.tryPlace({
      step: 1,
      targets,
      steps,
      getTargetNode: (x) => getTargetNode(x),
      mutex,
      maxWaitMs: PLACE_MAX_WAIT_MS,
    });

    if (!ok) {
      return {
        ok: false,
        amount: 0,
        missingTargets: inspection.missing,
        disabledTargets: inspection.disabled,
      };
    }

    const chips = await BET.loadGlobalChips();
    const amount =
      BET.perTargetAmountForStep(1, steps, chips.chipValues) *
      targets.length;

    return { ok: true, amount, steps };
  }

  class RepeatsMarket {
    constructor() {
      this.mutex = new BET.Mutex();
      this._inited = false;
      this.destroyed = false;
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
      map[tableId] = next;
      await BET.sset({ [EXECS_KEY]: map });

      if (statusMsg) {
        BET.setBetStatus(
          STATUS_KEY,
          next.enabled ? next.phase || 'idle' : 'off',
          statusMsg,
        );
      }
    }

    setStatus(state, message) {
      BET.setBetStatus(STATUS_KEY, state, message || '');
    }

    async logEvent(tableId, message, exec, extra = {}) {
      await appendTrackedBetLog(tableId, {
        t: Date.now(),
        type: 'event',
        market: 'repeats',
        phase: extra.phase || exec?.phase || 'idle',
        message,
        step: exec?.step ?? null,
        spinCount: Number(exec?.spinCount || 0),
        chain: exec?.chain || 'base',
        chainStep: Number(exec?.chainStep || 0),
        pendingChain: exec?.pendingChain || 'base',
        pauseSpins: Number(exec?.pauseSpins || 0),
        targets: Array.isArray(exec?.target) ? exec.target.slice() : [],
        rangeFrom: exec?.rangeFrom ?? null,
        rangeTo: exec?.rangeTo ?? null,
        ...extra,
      });
    }

    async logPlaced(tableId, targets, amount, message, exec) {
      await appendTrackedBetLog(tableId, {
        t: Date.now(),
        type: 'placed',
        market: 'repeats',
        phase: 'armed',
        message,
        amount,
        step: exec?.step ?? null,
        spinCount: Number(exec?.spinCount || 0),
        chain: exec?.chain || 'base',
        chainStep: Number(exec?.chainStep || 0),
        pendingChain: exec?.pendingChain || 'base',
        pauseSpins: Number(exec?.pauseSpins || 0),
        targets: targets.slice(),
        rangeFrom: exec?.rangeFrom ?? null,
        rangeTo: exec?.rangeTo ?? null,
      });
    }

    async loadEnabled() {
      const tableId = await getTrackedTableIdForThisTab();
      if (!tableId) return;

      const { [ENABLED_KEY]: enabled = false } = await BET.sget({
        [ENABLED_KEY]: false,
      });
      const exec = await this.getExec(tableId, enabled);

      if (!enabled) {
        const off = emptyExec(false);
        await this.setExec(tableId, off, 'REPEATS: OFF');
        return;
      }

      await this.setExec(tableId, exec, 'REPEATS: wait first spin');
    }

    async scheduleChainPause(tableId, spin, exec, nextChain, reason, phase) {
      await this.logEvent(tableId, reason, exec, {
        phase,
        result: spin,
        nextChain,
        pauseSpins: 1,
      });
      const waiting = makeWaitingExec(true, nextChain, 1, spin);
      const msg = `${reason} -> pause 1 spin -> ${chainLabel(nextChain)}`;
      await this.setExec(tableId, waiting, msg);
      this.setStatus('idle', msg);
      return waiting;
    }

    async resetAfterWin(tableId, spin, exec) {
      if (exec?.chain === 'insurance') {
        return this.scheduleChainPause(
          tableId,
          spin,
          exec,
          'base',
          `REPEATS INSURANCE WIN: repeat ${spin}`,
          'win',
        );
      }

      await this.logEvent(
        tableId,
        `REPEATS WIN: repeat ${spin} -> reset`,
        exec,
        { phase: 'win', result: spin },
      );
      const reset = makeWaitingExec(true, 'base', 0, spin);
      await this.setExec(
        tableId,
        reset,
        `REPEATS WIN: repeat ${spin} -> wait next spin`,
      );
      this.setStatus('idle', `REPEATS WIN: ${spin} -> wait next spin`);
      return reset;
    }

    async placeTargets(tableId, exec, targets, cfg, prefix, isNewCycle) {
      const cleanTargets = normalizeTargets(targets);
      if (!cleanTargets.length || cleanTargets.length > MAX_NUMBERS) {
        const reset = emptyExec(true);
        await this.setExec(tableId, reset);
        await this.logEvent(
          tableId,
          'REPEATS ERROR: invalid targets -> reset',
          reset,
          { phase: 'error' },
        );
        this.setStatus('error', 'REPEATS ERROR: invalid targets');
        return { ok: false, exec: reset };
      }

      if (isNewCycle) {
        const okEntry = await entryGateFor(
          'repeats',
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

      const spinCount = cleanTargets.length;
      const chainState = pickChainState(exec, cfg, isNewCycle);
      const ranges = activeRanges(cfg, chainState.chain);
      const range = pickRange(ranges, chainState.chainStep);
      const next = {
        ...exec,
        enabled: true,
        phase: 'armed',
        target: cleanTargets,
        step: spinCount,
        spinCount,
        chain: chainState.chain,
        chainStep: chainState.chainStep,
        rangeFrom: range.from,
        rangeTo: range.to,
        armedAt: Date.now(),
        lastSpin: cleanTargets[cleanTargets.length - 1],
      };

      await this.setExec(
        tableId,
        next,
        `${prefix}: placing ${cleanTargets.length} numbers | ${chainLabel(
          chainState.chain,
        )} ${chainState.chainStep} | range ${range.from}-${range.to}`,
      );

      const res = await placeStep(cleanTargets, range, this.mutex);
      if (!res.ok) {
        const reset = emptyExec(true);
        const reason = formatPlaceError(res);
        await this.setExec(tableId, reset);
        await this.logEvent(
          tableId,
          `${prefix}: cannot place | ${reason}`,
          reset,
          { phase: 'error' },
        );
        this.setStatus('error', `${prefix}: cannot place | ${reason}`);
        return { ok: false, exec: reset };
      }

      const placed = {
        ...next,
        lastAmount: Number(res.amount || 0),
      };
      await this.setExec(tableId, placed);
      await this.logPlaced(
        tableId,
        cleanTargets,
        res.amount,
        `${prefix}: placed ${cleanTargets.length} numbers | ${chainLabel(
          chainState.chain,
        )} ${chainState.chainStep} | range ${range.from}-${
          range.to
        } | targets ${cleanTargets.join(', ')}`,
        placed,
      );
      this.setStatus(
        'armed',
        `${prefix}: ${cleanTargets.length} numbers | ${chainLabel(
          chainState.chain,
        )} ${chainState.chainStep} | range ${range.from}-${range.to}`,
      );
      return { ok: true, exec: placed };
    }

    async onSpin(n) {
      const tableId = await getTrackedTableIdForThisTab();
      if (!tableId) return;

      const exec = await this.getExec(tableId);
      if (!exec.enabled) return;

      const spin = getIndex(n);
      if (spin === -1) return;

      const cfg = await this.loadCfg();

      if (exec.phase === 'armed') {
        const targets = normalizeTargets(exec.target);

        if (targets.includes(spin)) {
          await this.resetAfterWin(tableId, spin, exec);
          return;
        }

        if (isStageExhausted(exec, cfg)) {
          const nextStage = nextChain(exec.chain, cfg);
          const reason =
            exec.chain === 'insurance'
              ? `REPEATS INSURANCE LOSS: stage exhausted on ${spin}`
              : `REPEATS BASE LOSS: stage exhausted on ${spin}`;
          await this.scheduleChainPause(
            tableId,
            spin,
            exec,
            nextStage,
            reason,
            'loss',
          );
          return;
        }

        const nextTargets = normalizeTargets([...targets, spin]);
        await this.placeTargets(
          tableId,
          exec,
          nextTargets,
          cfg,
          `REPEATS ADD ${spin}`,
          false,
        );
        return;
      }

      const pendingChain = pendingChainForExec(exec, cfg);
      const pauseSpins = Math.max(
        0,
        Math.floor(Number(exec.pauseSpins || 0)),
      );

      if (pauseSpins > 0) {
        const left = pauseSpins - 1;
        const waiting = makeWaitingExec(true, pendingChain, left, spin);
        const msg =
          left > 0
            ? `REPEATS PAUSE: skipped ${spin} -> ${chainLabel(
                pendingChain,
              )} entry in ${left} spin`
            : `REPEATS PAUSE: skipped ${spin} -> starting ${chainLabel(
                pendingChain,
              )} chain`;
        await this.logEvent(tableId, msg, waiting, {
          phase: 'idle',
          result: spin,
        });

        if (left > 0) {
          await this.setExec(tableId, waiting, msg);
          this.setStatus('idle', msg);
          return;
        }
      }

      const entryExec = makeWaitingExec(true, pendingChain, 0, spin);
      await this.placeTargets(
        tableId,
        entryExec,
        [spin],
        cfg,
        `REPEATS ${chainLabel(pendingChain)} ENTRY ${spin}`,
        true,
      );
    }

    attachStorageListener() {
      chrome.storage.onChanged.addListener(async (ch, area) => {
        if (area !== 'local') return;

        if (this.destroyed) return;

        if (ENABLED_KEY in ch) {
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

    async init() {
      if (this._inited || this.destroyed) return;
      this._inited = true;
      await this.loadEnabled();
      this.attachStorageListener();
      this.setStatus('idle', 'REPEATS: ready');

      window.addEventListener(
        'beforeunload',
        () => {
          this.destroyed = true;
        },
        { once: true },
      );
    }
  }

  const strategy = new RepeatsMarket();
  window.__STRAT_REPEATS__ = strategy;

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    strategy.init();
  } else {
    window.addEventListener('DOMContentLoaded', () => strategy.init(), {
      once: true,
    });
  }
})();
