// src/auto/numbers.js
import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerGap: 120,
    maxTargets: 1, // 0 => все кандидаты (см. pickTargets)
    autoContinue: false,
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
  const PLACE_MAX_WAIT_MS = 20000;
  const TRACKED_TABLE_STATES_KEY = 'trackedTableStates';
  const MAX_BET_LOGS = 2000;

  function numId(n) {
    return `index-${100 + Number(n)}`;
  }

  function getMainTableRoot() {
    return document.querySelector('[data-name="center-section"]');
  }

  function getTargetNode(n) {
    const root = getMainTableRoot();
    if (!root) return null;
    return root.querySelector(`#${numId(n)}`) || null;
  }

  function getIndex(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return -1;
    if (x < 0 || x > 36) return -1;
    return x;
  }

  function allNumbers() {
    const arr = [];
    for (let i = 0; i <= 36; i++) arr.push(i);
    return arr;
  }

  function calcGaps(spinLogs) {
    const nums = allNumbers();
    const lastIdx = new Map();
    for (let i = 0; i < nums.length; i++) lastIdx.set(nums[i], -1);

    for (let i = 0; i < spinLogs.length; i++) {
      const n = getIndex(spinLogs[i]?.n);
      if (n === -1) continue;
      if (lastIdx.has(n)) lastIdx.set(n, i);
    }

    const len = spinLogs.length;
    const gaps = nums.map((n) => {
      const li = lastIdx.get(n);
      const gap = li === -1 ? len : len - 1 - li;
      return { n, gap, last: li };
    });

    gaps.sort((a, b) => b.gap - a.gap || a.n - b.n);
    return gaps;
  }

  function pickTargets(gaps, triggerGap, maxTargets) {
    const cand = gaps.filter((x) => x.gap >= triggerGap);
    if (!cand.length) return { candidates: [], targets: [] };

    const mt = Number(maxTargets);
    const k =
      !Number.isFinite(mt) || mt <= 0
        ? cand.length
        : Math.max(1, Math.min(Math.floor(mt), cand.length));

    const targets = cand.slice(0, k).map((x) => x.n);
    const candidates = cand.map((x) => x.n);
    return { candidates, targets };
  }

  async function getTrackedTableIdForThisTab() {
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

  async function placeStep(
    step,
    targets,
    steps,
    mutex,
    getTargetNode,
  ) {
    const ok = await BET.tryPlace({
      step,
      targets,
      steps,
      getTargetNode: (x) => getTargetNode(x),
      mutex,
      maxWaitMs: PLACE_MAX_WAIT_MS,
    });
    if (!ok) return { ok: false, amount: 0 };

    const chips = await BET.loadGlobalChips();
    const amount =
      BET.perTargetAmountForStep(step, steps, chips.chipValues) *
      targets.length;

    return { ok: true, amount };
  }

  class NumbersMarket extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'numbers',
        cfgKey: 'abNumbersConfig',
        enabledKey: 'autoBettingNumbersEnabled',
        statusKey: 'bettingStatusNumbers',
        execKey: 'betExecNumbers',
        getIndex,
        getOthers: () => [],
        getTargetNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    sanitizeCfg(cfg) {
      const t = cfg || {};
      const base = super.sanitizeCfg(t);

      const triggerGap = Math.max(
        1,
        Math.floor(
          Number(t.triggerGap ?? DEFAULT_CFG.triggerGap ?? 120)
        )
      );

      // разрешаем 0 как “все кандидаты”
      const maxTargets = Math.floor(
        Number(t.maxTargets ?? DEFAULT_CFG.maxTargets ?? 1)
      );

      return { ...base, triggerGap, maxTargets };
    }

    setStatus(state, msg) {
      BET.setBetStatus(this.statusKey, state, msg || '');
    }

    async logPlaced(step, targets, amount, message) {
      const tableId = await getTrackedTableIdForThisTab();
      await appendTrackedBetLog(tableId, {
        t: Date.now(),
        type: 'placed',
        market: 'numbers',
        phase: 'armed',
        message,
        amount,
        step,
        targets: Array.isArray(targets) ? targets.slice() : [],
      });
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const logs = Array.isArray(spinLogs) ? spinLogs : [];
      const last = getIndex(n);

      const { triggerGap, maxTargets, steps, autoContinue } =
        await this.loadCfg();

      const gaps = calcGaps(logs);

      if (exec.phase === 'idle') {
        const { targets } = pickTargets(gaps, triggerGap, maxTargets);
        if (!targets.length) return;

        const okEntry = await entryGateFor(
          this.marketKey,
          this.enabledKey,
          this.statusKey,
          { execKey: this.execKey }
        );
        if (!okEntry) return;

        const nextExec = {
          ...exec,
          phase: 'armed',
          target: targets,
          step: 1,
          armedAt: Date.now(),
        };

        await this.setExec(
          nextExec,
          `NUMBERS BET: step 1 | targets ${targets.join(', ')}`
        );

        const res = await placeStep(
          1,
          targets,
          steps,
          this.mutex,
          (x) => this.getTargetNode(x),
        );
        const ok = !!res.ok;
        if (ok) {
          await this.logPlaced(
            1,
            targets,
            res.amount,
            `Step 1 placed | targets ${targets.join(', ')}`,
          );
        }

        this.setStatus(
          ok ? 'armed' : 'error',
          ok
            ? `NUMBERS BET: step 1 | targets ${targets.join(', ')}`
            : `NUMBERS ERROR: cannot place step 1 | targets ${targets.join(
                ', '
              )}`
        );
        return;
      }

      if (exec.phase === 'armed') {
        const targets = Array.isArray(exec.target) ? exec.target : [];

        if (last !== -1 && targets.includes(last)) {
          const reset = {
            ...exec,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
          };
          await this.setExec(reset, `WIN on ${last} → reset`);
          this.setStatus('idle', `NUMBERS WIN: hit ${last} → reset`);
          return;
        }

        const maxStep = Math.max(1, steps.length);
        if (exec.step >= maxStep) {
          const reset = {
            ...exec,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
          };
          await this.setExec(
            reset,
            `LOSS on step ${maxStep} → reset`
          );
          this.setStatus(
            'idle',
            `NUMBERS LOSS: step ${maxStep} → reset`
          );
          return;
        }

        if (autoContinue) {
          const s = exec.step + 1;
          const armed = {
            ...exec,
            phase: 'armed',
            step: s,
            armedAt: Date.now(),
          };

          await this.setExec(
            armed,
            `NUMBERS BET: step ${s} | targets ${targets.join(', ')}`
          );

          const res = await placeStep(
            s,
            targets,
            steps,
            this.mutex,
            (x) => this.getTargetNode(x),
          );
          const ok = !!res.ok;
          if (ok) {
            await this.logPlaced(
              s,
              targets,
              res.amount,
              `Step ${s} placed | targets ${targets.join(', ')}`,
            );
          }

          this.setStatus(
            ok ? 'armed' : 'error',
            ok
              ? `NUMBERS BET: step ${s} | targets ${targets.join(
                  ', '
                )}`
              : `NUMBERS ERROR: cannot place step ${s}`
          );
          return;
        }

        const waiting = {
          ...exec,
          phase: 'waiting',
          step: exec.step + 1,
        };
        await this.setExec(waiting, `WAIT next step ${waiting.step}`);
        this.setStatus(
          'waiting',
          `NUMBERS WAIT: next step ${waiting.step}`
        );
        return;
      }

      if (exec.phase === 'waiting') {
        const targets = Array.isArray(exec.target) ? exec.target : [];

        if (last !== -1 && targets.includes(last)) {
          const s = exec.step;
          const armed = {
            ...exec,
            phase: 'armed',
            armedAt: Date.now(),
          };

          await this.setExec(
            armed,
            `NUMBERS BET: step ${s} | targets ${targets.join(', ')}`
          );

          const res = await placeStep(
            s,
            targets,
            steps,
            this.mutex,
            (x) => this.getTargetNode(x),
          );
          const ok = !!res.ok;
          if (ok) {
            await this.logPlaced(
              s,
              targets,
              res.amount,
              `Step ${s} placed | targets ${targets.join(', ')}`,
            );
          }

          this.setStatus(
            ok ? 'armed' : 'error',
            ok
              ? `NUMBERS BET: step ${s} | targets ${targets.join(
                  ', '
                )}`
              : `NUMBERS ERROR: cannot place step ${s}`
          );
        }
      }
    }

    attachStorageListener() {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'local') return;

        if (this.enabledKey in changes) {
          await this.loadEnabled();
          const exec = await this.getExec();
          if (!exec.enabled) {
            this.setStatus('off', '');
          } else {
            // пусть popup/markets.js ставит "ON (жду спин)" при включении
            // тут ничего не трогаем, чтобы не перетирать UI.
          }
        }

        if (changes.spinLogs) {
          const { oldValue = [], newValue = [] } = changes.spinLogs;
          if (
            Array.isArray(newValue) &&
            newValue.length > oldValue.length
          ) {
            const delta = newValue.slice(oldValue.length);
            for (const s of delta) await this.onSpin(s.n);
          }
        }
      });
    }
  }

  window.__STRAT_NUMBERS__ = new NumbersMarket();

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    window.__STRAT_NUMBERS__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_NUMBERS__.init(),
      { once: true }
    );
  }
})();
