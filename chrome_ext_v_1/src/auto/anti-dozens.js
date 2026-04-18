import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 10,
    autoContinue: false,
    includeZero: true,
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
  const EXECS_KEY = 'betExecAntiDozensByTable';
  const MAX_BET_LOGS = 2000;

  const $ = (sel) => document.querySelector(sel);
  const dozenButtons = [
    $('#index-800'),
    $('#index-801'),
    $('#index-802'),
  ];

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
    return dozenButtons[idx] || document.querySelector(sel);
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

  async function checkTriggerMissingDozen(
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

      const di = getIndex(n);

      for (let d = 0; d < 3; d++) {
        if (found[d]) continue;
        if (di !== -1 && d === di) continue;
        miss[d] += 1;
      }

      if (di !== -1 && !found[di]) found[di] = true;
      if (found[0] && found[1] && found[2]) break;
    }

    let best = null;
    let bestLen = -1;
    for (let d = 0; d < 3; d++) {
      const len = miss[d];
      if (len >= need && len > bestLen) {
        best = d;
        bestLen = len;
      }
    }
    if (best == null) return null;

    for (let d = 0; d < 3; d++) {
      if (miss[d] === bestLen && miss[d] >= need) return d;
    }
    return best;
  }

  class AntiDozensStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'antidozens',
        cfgKey: 'abAntiDozensConfig',
        enabledKey: 'autoBettingAntiDozensEnabled',
        statusKey: 'bettingStatusAntiDozens',
        execKey: 'betExecAntiDozens',
        getIndex: dozenIndex,
        getOthers: (x) => [x],
        getTargetNode: getDozenNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    label(idx) {
      return idx === 0 ? '1' : idx === 1 ? '2' : '3';
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

    async onSpin(n, ctx = null) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const tableId =
        ctx?.tableId || (await getTrackedTableIdForThisTab());
      if (!tableId) return;

      const spinLogs = Array.isArray(ctx?.spinLogs)
        ? ctx.spinLogs.slice()
        : (await getTrackedSpinLogsForThisTab()).spinLogs.slice();

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

        const missing = await checkTriggerMissingDozen(
          spinLogs,
          triggerStreak,
          includeZero,
          this.getIndex,
        );

        if (missing != null) {
          const gateOk = await entryGateFor(
            'antidozens',
            'autoBettingAntiDozensEnabled',
            'bettingStatusAntiDozens',
            { execKey: EXECS_KEY },
          );
          if (!gateOk) return;

          const t = [missing];
          const next = {
            ...exec,
            enabled: true,
            phase: 'armed',
            target: t,
            step: 1,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };

          await this.setExec(
            next,
            `ВХОД → не выходила дюжина ${this.label(
              missing,
            )} ≥ ${triggerStreak} | ставим НА НЕЁ | шаг 1`,
          );

          const ok = await BET.tryPlace({
            step: 1,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
            maxWaitMs: PLACE_MAX_WAIT_MS,
          });

          if (ok) {
            const chips = await BET.loadGlobalChips();
            const amount =
              BET.perTargetAmountForStep(1, steps, chips.chipValues) *
              t.length;

            await appendTrackedBetLog(tableId, {
              t: Date.now(),
              type: 'placed',
              market: 'antidozens',
              phase: 'armed',
              message: `Шаг 1 поставлен на антидюжину ${this.label(
                missing,
              )}`,
              amount,
              step: 1,
            });
          }

          BET.setBetStatus(
            'bettingStatusAntiDozens',
            ok ? 'armed' : 'error',
            ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1',
          );
        }
        return;
      }

      if (exec.phase === 'armed') {
        const targetIdx = Array.isArray(exec.target)
          ? exec.target[0]
          : null;
        const win =
          ix !== -1 && targetIdx != null && ix === targetIdx;

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
            `ВЫИГРЫШ на дюжине ${this.label(ix)} → сброс`,
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
          const t = exec.target?.slice() || [];
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
            `ПРОИГРЫШ → сразу ставим шаг ${step} на антидюжину ${t
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

            await appendTrackedBetLog(tableId, {
              t: Date.now(),
              type: 'placed',
              market: 'antidozens',
              phase: 'armed',
              message: `Шаг ${step} поставлен на антидюжину ${t
                .map((x) => this.label(x))
                .join(',')}`,
              amount,
              step,
            });
          }

          BET.setBetStatus(
            'bettingStatusAntiDozens',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`,
          );
          return;
        }

        const step = exec.step + 1;
        const next = {
          ...exec,
          enabled: true,
          phase: 'cooldown',
          target: exec.target?.slice(),
          step,
          armedAt: 0,
          cooldownSkipped: false,
        };
        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${step} через один`,
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
          const t = exec.target?.slice() || [];

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
            target: t,
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ГОТОВ (через один) шаг ${step} на антидюжину ${t
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

            await appendTrackedBetLog(tableId, {
              t: Date.now(),
              type: 'placed',
              market: 'antidozens',
              phase: 'armed',
              message: `Шаг ${step} поставлен (через один)`,
              amount,
              step,
            });
          }

          BET.setBetStatus(
            'bettingStatusAntiDozens',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`,
          );
          return;
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
            for (let i = oldLogs.length; i < newLogs.length; i++) {
              const e = newLogs[i];
              await this.onSpin(e?.n, {
                tableId,
                spinLogs: newLogs.slice(0, i + 1),
              });
            }
          }
        }
      });
    }
  }

  window.__STRAT_ANTI_DOZENS__ = new AntiDozensStrategy();

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    window.__STRAT_ANTI_DOZENS__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_ANTI_DOZENS__.init(),
      { once: true },
    );
  }
})();
