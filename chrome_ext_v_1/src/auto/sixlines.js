import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 8,
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
  const EXECS_KEY = 'betExecSixByTable';
  const MAX_BET_LOGS = 2000;

  function sixIndex(n) {
    if (n === 0) return -1;
    if (n < 1 || n > 36) return -1;
    return Math.floor((n - 1) / 6);
  }

  function otherFour(set2) {
    const used = Array.from(set2);
    return [0, 1, 2, 3, 4, 5].filter((x) => !used.includes(x));
  }

  function getSixNode(idx) {
    const evenId = `#index-${600 + idx * 2}`;
    const seqId = `#index-${600 + idx}`;
    return (
      document.querySelector(evenId) || document.querySelector(seqId)
    );
  }

  function checkTriggerTwoSixes(spinLogs, need, includeZero) {
    let cnt = 0;
    const set = new Set();
    for (let i = spinLogs.length - 1; i >= 0 && cnt < need; i--) {
      const n = Number(spinLogs[i]?.n);
      if (!Number.isFinite(n)) break;
      if (n === 0) {
        if (includeZero) {
          cnt++;
          continue;
        }
        break;
      }
      const si = sixIndex(n);
      if (si === -1) break;
      if (!set.has(si)) {
        if (set.size === 2) break;
        set.add(si);
      }
      cnt++;
    }
    return cnt >= need && set.size === 2 ? set : null;
  }

  function emptyExec(enabled = false) {
    return {
      enabled: !!enabled,
      phase: 'idle',
      target: null,
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

  class SixLinesStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'six',
        cfgKey: 'abSixConfig',
        enabledKey: 'autoBettingSixEnabled',
        statusKey: 'bettingStatusSix',
        execKey: 'betExecSix',
        getIndex: sixIndex,
        getOthers: otherFour,
        getTargetNode: getSixNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    label(idx) {
      return idx + 1;
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

    async logPlaced(step, amount, message) {
      const tableId = await getTrackedTableIdForThisTab();
      await appendTrackedBetLog(tableId, {
        t: Date.now(),
        type: 'placed',
        market: 'six',
        phase: 'armed',
        message,
        amount,
        step,
      });
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

        const pairSet = checkTriggerTwoSixes(
          spinLogs,
          triggerStreak,
          includeZero,
        );

        if (pairSet) {
          const gateOk = await entryGateFor(
            'six',
            'autoBettingSixEnabled',
            'bettingStatusSix',
            { execKey: 'betExecSix' },
          );
          if (!gateOk) return;

          const targets = this.getOthers(pairSet);
          const next = {
            ...exec,
            enabled: true,
            phase: 'armed',
            target: targets,
            step: 1,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ВХОД → шестерки ${targets
              .map((x) => this.label(x))
              .join(',')} | шаг 1`,
          );

          const ok = await BET.tryPlace({
            step: 1,
            targets,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
            maxWaitMs: PLACE_MAX_WAIT_MS,
          });

          if (ok) {
            const chips = await BET.loadGlobalChips();
            const amount =
              BET.perTargetAmountForStep(1, steps, chips.chipValues) *
              targets.length;
            await this.logPlaced(1, amount, 'Шаг 1 поставлен');
          }

          BET.setBetStatus(
            'bettingStatusSix',
            ok ? 'armed' : 'error',
            ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1',
          );
        }
        return;
      }

      if (exec.phase === 'armed') {
        const win = ix !== -1 && exec.target.includes(ix);
        if (win) {
          const next = {
            ...exec,
            enabled: true,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ВЫИГРЫШ на шестерке ${this.label(ix)} → сброс`,
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
          const t = exec.target.slice();
          const next = {
            ...exec,
            enabled: true,
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу ставим шаг ${step} на шестерки ${t
              .map((x) => this.label(x))
              .join(',')}`,
          );

          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
            maxWaitMs: PLACE_MAX_WAIT_MS,
          });

          if (ok) {
            const chips = await BET.loadGlobalChips();
            const amount =
              BET.perTargetAmountForStep(
                step,
                steps,
                chips.chipValues,
              ) * t.length;
            await this.logPlaced(
              step,
              amount,
              `Шаг ${step} поставлен (auto)`,
            );
          }

          BET.setBetStatus(
            'bettingStatusSix',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`,
          );
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

          const t = (exec.target || []).slice();
          const next = {
            ...mid,
            enabled: true,
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ГОТОВ (через один) шаг ${step} на шестерки ${t
              .map((x) => this.label(x))
              .join(',')}`,
          );

          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
            maxWaitMs: PLACE_MAX_WAIT_MS,
          });

          if (ok) {
            const chips = await BET.loadGlobalChips();
            const amount =
              BET.perTargetAmountForStep(
                step,
                steps,
                chips.chipValues,
              ) * t.length;
            await this.logPlaced(
              step,
              amount,
              `Шаг ${step} поставлен (через один)`,
            );
          }

          BET.setBetStatus(
            'bettingStatusSix',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`,
          );
          return;
        }

        const step = exec.step;
        const t = (exec.target || []).slice();
        const rec = {
          ...exec,
          enabled: true,
          phase: 'armed',
          target: t,
          step,
          armedAt: Date.now(),
          cooldownSkipped: undefined,
        };
        await this.setExec(
          rec,
          `ГОТОВ (восстановление) шаг ${step} на шестерки ${t
            .map((x) => this.label(x))
            .join(',')}`,
        );

        const ok = await BET.tryPlace({
          step,
          targets: t,
          steps,
          getTargetNode: (i) => this.getTargetNode(i),
          mutex: this.mutex,
          maxWaitMs: PLACE_MAX_WAIT_MS,
        });

        if (ok) {
          const chips = await BET.loadGlobalChips();
          const amount =
            BET.perTargetAmountForStep(
              step,
              steps,
              chips.chipValues,
            ) * t.length;
          await this.logPlaced(step, amount, `Шаг ${step} поставлен`);
        }

        BET.setBetStatus(
          'bettingStatusSix',
          ok ? 'armed' : 'error',
          ok
            ? `Шаг ${step} поставлен`
            : `Не удалось поставить шаг ${step}`,
        );
        return;
      }

      if (exec.phase === 'waiting') {
        if (ix !== -1 && exec.target?.includes(ix)) {
          const step = exec.step;
          const t = exec.target;
          const { steps } = await this.loadCfg();
          const next = {
            ...exec,
            enabled: true,
            phase: 'armed',
            target: t.slice(),
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ГОТОВ шаг ${step} на шестерки ${t
              .map((x) => this.label(x))
              .join(',')}`,
          );

          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
            maxWaitMs: PLACE_MAX_WAIT_MS,
          });

          if (ok) {
            const chips = await BET.loadGlobalChips();
            const amount =
              BET.perTargetAmountForStep(
                step,
                steps,
                chips.chipValues,
              ) * t.length;
            await this.logPlaced(
              step,
              amount,
              `Шаг ${step} поставлен`,
            );
          }

          BET.setBetStatus(
            'bettingStatusSix',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`,
          );
        }
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

  window.__STRAT_SIX__ = new SixLinesStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    window.__STRAT_SIX__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_SIX__.init(),
      { once: true },
    );
  }
})();
