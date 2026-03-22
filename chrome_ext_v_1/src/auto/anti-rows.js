import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 10,
    autoContinue: false,
    includeZero: false,
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
  const EXECS_KEY = 'betExecAntiRowsByTable';
  const MAX_BET_LOGS = 2000;

  const ROW_SEL = ['#index-700', '#index-701', '#index-702'];

  function rowIndex(n) {
    if (n === 0) return -1;
    const r = n % 3;
    if (r === 0) return 0;
    if (r === 2) return 1;
    if (r === 1) return 2;
    return -1;
  }

  function getRowNode(idx) {
    const sel = ROW_SEL[idx] || ROW_SEL[2];
    const node = document.querySelector(sel);
    if (!node) {
      console.warn(
        '[antirows] Не найден узел ряда idx=',
        idx,
        'sel=',
        sel,
      );
    }
    return node;
  }

  function emptyExec(enabled = false) {
    return {
      enabled: !!enabled,
      phase: 'idle',
      target: null,
      targetRow: null,
      step: 1,
      armedAt: 0,
      cooldownSkipped: undefined,
    };
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

  async function getTrackedState(tableId) {
    if (!tableId) return null;
    const { [TRACKED_TABLE_STATES_KEY]: states = {} } =
      await BET.sget({
        [TRACKED_TABLE_STATES_KEY]: {},
      });
    return states && typeof states === 'object'
      ? states[tableId] || null
      : null;
  }

  async function getTrackedSpinLogsForThisTab() {
    const tableId = await getTrackedTableIdForThisTab();
    if (!tableId) return { tableId: '', spinLogs: [] };
    const state = await getTrackedState(tableId);
    return {
      tableId,
      spinLogs: Array.isArray(state?.spinLogs)
        ? state.spinLogs.slice()
        : [],
    };
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

  function pickMissingRowByTail(
    spinLogs,
    need,
    includeZero,
    getIndex,
  ) {
    if (!Array.isArray(spinLogs) || spinLogs.length === 0)
      return null;

    const miss = [0, 0, 0];
    const found = [false, false, false];

    for (let i = spinLogs.length - 1; i >= 0; i--) {
      const n = Number(spinLogs[i]?.n);
      if (!Number.isFinite(n)) continue;

      if (n === 0 && !includeZero) continue;

      const ix = getIndex(n);

      for (let r = 0; r < 3; r++) {
        if (found[r]) continue;
        if (ix !== -1 && r === ix) continue;
        miss[r] += 1;
      }

      if (ix !== -1 && !found[ix]) found[ix] = true;
      if (found[0] && found[1] && found[2]) break;
    }

    let best = 0;
    if (miss[1] > miss[best]) best = 1;
    if (miss[2] > miss[best]) best = 2;

    return miss[best] >= need ? best : null;
  }

  class AntiRowsStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'antirows',
        cfgKey: 'abAntiRowsConfig',
        enabledKey: 'autoBettingAntiRowsEnabled',
        statusKey: 'bettingStatusAntiRows',
        execKey: 'betExecAntiRows',
        getIndex: rowIndex,
        getOthers: (x) => [x],
        getTargetNode: getRowNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    label(idx) {
      return idx === 0 ? 'ряд 1' : idx === 1 ? 'ряд 2' : 'ряд 3';
    }

    async getExec() {
      const tableId = await getTrackedTableIdForThisTab();
      const {
        [this.enabledKey]: enabled = false,
        [EXECS_KEY]: map = {},
      } = await this.sget({
        [this.enabledKey]: false,
        [EXECS_KEY]: {},
      });

      const base =
        tableId &&
        map &&
        typeof map === 'object' &&
        map[tableId] &&
        typeof map[tableId] === 'object'
          ? map[tableId]
          : emptyExec(enabled);

      return {
        ...emptyExec(enabled),
        ...base,
        enabled: !!enabled,
      };
    }

    async setExec(next, statusMsg = null) {
      const tableId = await getTrackedTableIdForThisTab();
      if (!tableId) return;

      const { [EXECS_KEY]: rawMap = {} } = await this.sget({
        [EXECS_KEY]: {},
      });
      const map =
        rawMap && typeof rawMap === 'object' ? { ...rawMap } : {};

      map[tableId] = {
        ...emptyExec(!!next?.enabled),
        ...(next || {}),
      };

      await this.sset({ [EXECS_KEY]: map });

      if (statusMsg) {
        BET.setBetStatus(
          this.statusKey,
          map[tableId].enabled ? map[tableId].phase : 'off',
          statusMsg,
        );
      }
    }

    async loadEnabled() {
      const tableId = await getTrackedTableIdForThisTab();
      if (!tableId) return;

      const {
        [this.enabledKey]: enabled = false,
        [EXECS_KEY]: rawMap = {},
      } = await this.sget({
        [this.enabledKey]: false,
        [EXECS_KEY]: {},
      });

      const map =
        rawMap && typeof rawMap === 'object' ? { ...rawMap } : {};
      const exec = {
        ...emptyExec(enabled),
        ...(map[tableId] && typeof map[tableId] === 'object'
          ? map[tableId]
          : {}),
        enabled: !!enabled,
      };

      if (!enabled) {
        exec.phase = 'idle';
        exec.target = null;
        exec.targetRow = null;
        exec.step = 1;
        exec.armedAt = 0;
        exec.cooldownSkipped = undefined;
        map[tableId] = exec;
        await this.sset({ [EXECS_KEY]: map });
        BET.setBetStatus(this.statusKey, 'off', 'Авто-ставки ВЫКЛ');
        return;
      }

      map[tableId] = exec;
      await this.sset({ [EXECS_KEY]: map });
      BET.setBetStatus(
        this.statusKey,
        exec.phase || 'idle',
        'Авто-ставки ВКЛ',
      );
    }

    async placeStep(step, exec, steps) {
      const targetRow = exec.targetRow;
      if (!(targetRow === 0 || targetRow === 1 || targetRow === 2)) {
        console.error(
          '[antirows] Некорректный targetRow при постановке',
          exec,
        );
        return false;
      }

      const targetsIdx = [targetRow];
      exec.target = targetsIdx.slice();

      const ok = await BET.tryPlace({
        step,
        targets: targetsIdx,
        steps,
        getTargetNode: (i) => getRowNode(i),
        mutex: this.mutex,
        maxWaitMs: PLACE_MAX_WAIT_MS,
      });

      if (ok) {
        const tableId = await getTrackedTableIdForThisTab();
        const chips = await BET.loadGlobalChips();
        const amount =
          BET.perTargetAmountForStep(step, steps, chips.chipValues) *
          targetsIdx.length;

        await appendTrackedBetLog(tableId, {
          t: Date.now(),
          type: 'placed',
          market: 'antirows',
          phase: 'armed',
          message: `Шаг ${step} на ${this.label(
            targetRow,
          )} (антиряды)`,
          amount,
          step,
          debug: {
            targetRow,
            targetSel: ROW_SEL[targetRow],
          },
        });
      }

      BET.setBetStatus(
        'bettingStatusAntiRows',
        ok ? 'armed' : 'error',
        ok
          ? `Шаг ${step} поставлен`
          : `Не удалось поставить шаг ${step}`,
      );

      return ok;
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { tableId, spinLogs: trackedLogs } =
        await getTrackedSpinLogsForThisTab();
      if (!tableId) return;

      const spinLogs = Array.isArray(trackedLogs)
        ? trackedLogs.slice()
        : [];

      if (
        spinLogs.length === 0 ||
        Number(spinLogs[spinLogs.length - 1]?.n) !== Number(n)
      ) {
        spinLogs.push({ n });
      }

      const ix = this.getIndex(n);

      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        const missing = pickMissingRowByTail(
          spinLogs,
          triggerStreak,
          includeZero,
          this.getIndex,
        );

        if (missing != null) {
          const gateOk = await entryGateFor(
            'antirows',
            'autoBettingAntiRowsEnabled',
            'bettingStatusAntiRows',
            { execKey: 'betExecAntiRows' },
          );
          if (!gateOk) return;

          const next = {
            ...exec,
            enabled: true,
            phase: 'armed',
            targetRow: missing,
            target: [missing],
            step: 1,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };

          await this.setExec(
            next,
            `ВХОД → антиряды: ${this.label(
              missing,
            )} не выпадал ≥${triggerStreak} | шаг 1`,
          );

          await this.placeStep(1, next, steps);
        }
        return;
      }

      if (exec.phase === 'armed') {
        const tr = exec.targetRow;
        const win =
          ix !== -1 &&
          (tr === 0 || tr === 1 || tr === 2) &&
          ix === tr;

        if (win) {
          const next = {
            ...exec,
            enabled: true,
            phase: 'idle',
            target: null,
            targetRow: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ВЫИГРЫШ на ${this.label(ix)} → сброс`,
          );
          return;
        }

        const { steps, autoContinue } = await this.loadCfg();
        const lastStep = Math.max(1, steps.length);

        if (exec.step >= lastStep) {
          const reset = {
            ...exec,
            enabled: true,
            phase: 'idle',
            target: null,
            targetRow: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
          };
          await this.setExec(
            reset,
            `ПРОИГРЫШ на шаге ${lastStep} → сброс`,
          );
          return;
        }

        if (autoContinue) {
          const step = exec.step + 1;
          const next = {
            ...exec,
            enabled: true,
            phase: 'armed',
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          next.target = [next.targetRow];

          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу шаг ${step} на ${this.label(
              next.targetRow,
            )} (антиряды)`,
          );

          await this.placeStep(step, next, steps);
          return;
        }

        const next = {
          ...exec,
          enabled: true,
          phase: 'cooldown',
          step: exec.step + 1,
          armedAt: 0,
          cooldownSkipped: false,
        };
        next.target = [exec.targetRow];

        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${next.step} через один`,
        );
        return;
      }

      if (exec.phase === 'cooldown') {
        const { steps } = await this.loadCfg();
        const lastStep = Math.max(1, steps.length);

        if (exec.step > lastStep) {
          const reset = {
            ...exec,
            enabled: true,
            phase: 'idle',
            target: null,
            targetRow: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
          };
          await this.setExec(
            reset,
            `Сброс: превышен лимит шагов (${lastStep}) в cooldown`,
          );
          return;
        }

        if (!exec.cooldownSkipped) {
          const step = exec.step;

          const mid = {
            ...exec,
            enabled: true,
            cooldownSkipped: true,
          };
          await this.setExec(
            mid,
            `Cooldown: пропустили 1 спин; ставим шаг ${step} (через один)`,
          );

          const next = {
            ...mid,
            enabled: true,
            phase: 'armed',
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          next.target = [next.targetRow];

          await this.setExec(
            next,
            `ГОТОВ (через один) шаг ${step} на ${this.label(
              next.targetRow,
            )} (антиряды)`,
          );

          await this.placeStep(step, next, steps);
          return;
        }

        const step = exec.step;
        const rec = {
          ...exec,
          enabled: true,
          phase: 'armed',
          armedAt: Date.now(),
          cooldownSkipped: undefined,
        };
        rec.target = [rec.targetRow];

        await this.setExec(
          rec,
          `ГОТОВ (восстановление) шаг ${step} на ${this.label(
            rec.targetRow,
          )} (антиряды)`,
        );

        await this.placeStep(step, rec, steps);
      }
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

  window.__STRAT_ANTIROWS__ = new AntiRowsStrategy();

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    window.__STRAT_ANTIROWS__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_ANTIROWS__.init(),
      { once: true },
    );
  }
})();
