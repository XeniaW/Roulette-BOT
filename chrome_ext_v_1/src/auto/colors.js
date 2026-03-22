import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2,
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
  const EXECS_KEY = 'betExecColorsByTable';
  const MAX_BET_LOGS = 2000;

  const RED = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
  ]);

  function colorIndex(n) {
    if (n === 0) return -1;
    return RED.has(n) ? 0 : 1;
  }

  const BTN = ['#index-903', '#index-902'];

  function getNode(idx) {
    const sel = BTN[idx] || BTN[1];
    return document.querySelector(sel);
  }

  function other(idx) {
    return idx === 0 ? [1] : [0];
  }

  function checkTriggerSameSide(spinLogs, need, includeZero) {
    let cnt = 0;
    let ref = null;
    for (let i = spinLogs.length - 1; i >= 0 && cnt < need; i--) {
      const n = spinLogs[i]?.n;
      if (n === 0) {
        if (includeZero && ref != null) {
          cnt++;
          continue;
        }
        break;
      }
      const si = colorIndex(n);
      if (si === -1) break;
      if (ref == null) ref = si;
      if (si !== ref) break;
      cnt++;
    }
    return cnt >= need && ref != null ? ref : null;
  }

  function emptyExec(enabled = false) {
    return {
      enabled: !!enabled,
      phase: 'idle',
      target: null,
      step: 1,
      armedAt: 0,
      cooldownState: null,
      nextStep: 0,
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
      getTargetNode: (i) => getTargetNode(i),
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

  class ColorsStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'colors',
        cfgKey: 'abColorsConfig',
        enabledKey: 'autoBettingColorsEnabled',
        statusKey: 'bettingStatusColors',
        execKey: 'betExecColors',
        getIndex: colorIndex,
        getOthers: other,
        getTargetNode: getNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    label(idx) {
      return idx === 0 ? 'красное' : 'чёрное';
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
        exec.cooldownState = null;
        exec.nextStep = 0;
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
        market: 'colors',
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

      if (!exec.phase || exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();
        const ref = checkTriggerSameSide(
          spinLogs,
          triggerStreak,
          includeZero,
        );

        if (ref != null) {
          const gateOk = await entryGateFor(
            'colors',
            'autoBettingColorsEnabled',
            'bettingStatusColors',
            { execKey: 'betExecColors' },
          );
          if (!gateOk) return;

          const t = this.getOthers(ref);
          const next = {
            ...exec,
            enabled: true,
            phase: 'armed',
            target: t,
            step: 1,
            armedAt: Date.now(),
            cooldownState: null,
            nextStep: 0,
          };
          await this.setExec(
            next,
            `ВХОД → против ${this.label(ref)} | цель: ${this.label(
              t[0],
            )} | шаг 1`,
          );

          const res = await placeStep(1, t, steps, this.mutex, (i) =>
            this.getTargetNode(i),
          );
          if (res.ok) {
            await this.logPlaced(1, res.amount, 'Шаг 1 поставлен');
          }

          BET.setBetStatus(
            'bettingStatusColors',
            res.ok ? 'armed' : 'error',
            res.ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1',
          );
        }
        return;
      }

      if (exec.phase === 'armed') {
        const win = ix !== -1 && exec.target?.includes(ix);
        if (win) {
          const next = {
            ...exec,
            enabled: true,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
            cooldownState: null,
            nextStep: 0,
          };
          await this.setExec(
            next,
            `ВЫИГРЫШ на ${this.label(ix)} → сброс`,
          );
          BET.setBetStatus(
            'bettingStatusColors',
            'idle',
            'ВЫИГРЫШ → ждём новый стрик',
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
            cooldownState: null,
            nextStep: 0,
          };
          await this.setExec(
            reset,
            `ПРОИГРЫШ на шаге ${lastStep} → сброс`,
          );
          BET.setBetStatus(
            'bettingStatusColors',
            'idle',
            `ПРОИГРЫШ на шаге ${lastStep} → ждём новый стрик`,
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
            cooldownState: null,
            nextStep: 0,
          };
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу шаг ${step} на ${this.label(t[0])}`,
          );

          const res = await placeStep(
            step,
            t,
            steps,
            this.mutex,
            (i) => this.getTargetNode(i),
          );
          if (res.ok) {
            await this.logPlaced(
              step,
              res.amount,
              `Шаг ${step} поставлен (auto)`,
            );
          }

          BET.setBetStatus(
            'bettingStatusColors',
            res.ok ? 'armed' : 'error',
            res.ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`,
          );
          return;
        }

        const next = {
          ...exec,
          enabled: true,
          phase: 'cooldown',
          cooldownState: 'waitSkip',
          nextStep: exec.step + 1,
          armedAt: 0,
        };
        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${next.nextStep} через один`,
        );
        BET.setBetStatus(
          'bettingStatusColors',
          'cooldown',
          `ПРОИГРЫШ → пропускаем 1 спин; готовим шаг ${next.nextStep}`,
        );
        return;
      }

      if (exec.phase === 'cooldown') {
        const { steps } = await this.loadCfg();
        const lastStep = Math.max(1, steps.length);
        const step = exec.nextStep || exec.step || 2;
        const t = exec.target?.slice() || [];

        if (step > lastStep) {
          const reset = {
            ...exec,
            enabled: true,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
            cooldownState: null,
            nextStep: 0,
          };
          await this.setExec(
            reset,
            `Сброс: превышен лимит шагов (${lastStep})`,
          );
          BET.setBetStatus(
            'bettingStatusColors',
            'idle',
            `Сброс: лимит шагов ${lastStep}`,
          );
          return;
        }

        if (exec.cooldownState === 'waitSkip') {
          const mid = {
            ...exec,
            enabled: true,
            cooldownState: 'ready',
          };
          await this.setExec(
            mid,
            `Пропущен 1 спин → сейчас ставим шаг ${step}`,
          );
          BET.setBetStatus(
            'bettingStatusColors',
            'cooldown',
            `Пропущен 1 спин → сейчас ставим шаг ${step}`,
          );
          return;
        }

        if (exec.cooldownState === 'ready') {
          const after = {
            ...exec,
            enabled: true,
            phase: 'armed',
            step,
            cooldownState: null,
            nextStep: 0,
            armedAt: Date.now(),
          };
          await this.setExec(
            after,
            `ШАГ ${step} (через одну) на ${this.label(t[0])}`,
          );

          const res = await placeStep(
            step,
            t,
            steps,
            this.mutex,
            (i) => this.getTargetNode(i),
          );
          if (res.ok) {
            await this.logPlaced(
              step,
              res.amount,
              `Шаг ${step} поставлен (через одну)`,
            );
          }

          BET.setBetStatus(
            'bettingStatusColors',
            res.ok ? 'armed' : 'error',
            res.ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`,
          );
          return;
        }

        const reset = {
          ...exec,
          enabled: true,
          phase: 'idle',
          target: null,
          step: 1,
          armedAt: 0,
          cooldownState: null,
          nextStep: 0,
        };
        await this.setExec(reset, 'Неверный state cooldown → сброс');
        BET.setBetStatus(
          'bettingStatusColors',
          'idle',
          'Сброс после ошибки состояния',
        );
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

  window.__STRAT_COLORS__ = new ColorsStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    window.__STRAT_COLORS__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_COLORS__.init(),
      {
        once: true,
      },
    );
  }
})();
