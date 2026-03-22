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
  const SELECTED_TRACKED_TABLE_KEY = 'selectedTrackedTableId';
  const EXEC_MAP_KEY = 'betExecDozensByTable';

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

  function otherTwo(skip) {
    return [0, 1, 2].filter((d) => d !== skip);
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

  function defaultExec(enabled = false) {
    return {
      enabled: !!enabled,
      phase: 'idle',
      target: null,
      step: 1,
      armedAt: 0,
      cooldownSkipped: undefined,
    };
  }

  async function getCurrentTrackedTableId() {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'GET_TRACKED_TABLE_FOR_TAB',
      });
      if (res?.matched && res?.tableId) {
        return String(res.tableId).trim();
      }
    } catch {}

    try {
      const { [SELECTED_TRACKED_TABLE_KEY]: selectedId = '' } =
        await BET.sget({
          [SELECTED_TRACKED_TABLE_KEY]: '',
        });
      return String(selectedId || '').trim();
    } catch {
      return '';
    }
  }

  async function getTrackedStates() {
    const { [TRACKED_TABLE_STATES_KEY]: states = {} } =
      await BET.sget({
        [TRACKED_TABLE_STATES_KEY]: {},
      });
    return states && typeof states === 'object' ? states : {};
  }

  async function getTableState(tableId) {
    if (!tableId) return null;
    const states = await getTrackedStates();
    const state =
      states && typeof states[tableId] === 'object'
        ? states[tableId]
        : null;
    return state;
  }

  async function getTableSpinLogs(tableId) {
    const state = await getTableState(tableId);
    return Array.isArray(state?.spinLogs)
      ? state.spinLogs.slice()
      : [];
  }

  async function appendTableBetLog(tableId, entry) {
    if (!tableId) return;

    const states = await getTrackedStates();
    const prev =
      states && typeof states[tableId] === 'object'
        ? states[tableId]
        : {};

    const nextBetLogs = Array.isArray(prev.betLogs)
      ? prev.betLogs.slice()
      : [];

    nextBetLogs.push(entry);
    if (nextBetLogs.length > 2000) {
      nextBetLogs.splice(0, nextBetLogs.length - 2000);
    }

    states[tableId] = {
      ...prev,
      betLogs: nextBetLogs,
    };

    await BET.sset({
      [TRACKED_TABLE_STATES_KEY]: states,
    });
  }

  function checkTriggerSameDozen(
    spinLogs,
    need,
    includeZero,
    getIndex,
  ) {
    let cnt = 0;
    let ref = null;

    for (let i = spinLogs.length - 1; i >= 0 && cnt < need; i--) {
      const n = spinLogs[i]?.n;

      if (n === 0) {
        if (includeZero) {
          cnt++;
          continue;
        }
        break;
      }

      const di = getIndex(n);
      if (di === -1) break;
      if (ref == null) ref = di;
      if (di !== ref) break;
      cnt++;
    }

    return cnt >= need && ref != null ? ref : null;
  }

  class DozensStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'dozens',
        cfgKey: 'abDozensConfig',
        enabledKey: 'autoBettingDozensEnabled',
        statusKey: 'bettingStatusDozens',
        execKey: 'betExecDozens',
        getIndex: dozenIndex,
        getOthers: otherTwo,
        getTargetNode: getDozenNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    canActInThisFrame() {
      return !!(
        document.querySelector('#index-800') ||
        document.querySelector('#index-801') ||
        document.querySelector('#index-802')
      );
    }

    async getExecForTable(tableId) {
      if (!tableId) return defaultExec(false);

      const {
        [EXEC_MAP_KEY]: rawMap = {},
        [this.enabledKey]: enabled = false,
      } = await this.sget({
        [EXEC_MAP_KEY]: {},
        [this.enabledKey]: false,
      });

      const map = rawMap && typeof rawMap === 'object' ? rawMap : {};

      const exec =
        map[tableId] && typeof map[tableId] === 'object'
          ? {
              ...defaultExec(!!enabled),
              ...map[tableId],
              enabled: !!enabled,
            }
          : defaultExec(!!enabled);

      return exec;
    }

    async setExecForTable(tableId, next, statusMsg = null) {
      if (!tableId) return;

      const { [EXEC_MAP_KEY]: rawMap = {} } = await this.sget({
        [EXEC_MAP_KEY]: {},
      });

      const map =
        rawMap && typeof rawMap === 'object' ? { ...rawMap } : {};

      map[tableId] = {
        ...defaultExec(!!next?.enabled),
        ...(next || {}),
      };

      await this.sset({ [EXEC_MAP_KEY]: map });

      if (statusMsg) {
        BET.setBetStatus(
          this.statusKey,
          map[tableId].enabled ? map[tableId].phase : 'off',
          statusMsg,
        );
      }
    }

    async getExec(tableId = null) {
      const id = tableId || (await getCurrentTrackedTableId());
      return this.getExecForTable(id);
    }

    async setExec(next, statusMsg = null, tableId = null) {
      const id = tableId || (await getCurrentTrackedTableId());
      return this.setExecForTable(id, next, statusMsg);
    }

    async loadEnabled() {
      const tableId = await getCurrentTrackedTableId();
      if (!tableId) return;

      const { [this.enabledKey]: enabled = false } = await this.sget({
        [this.enabledKey]: false,
      });

      const exec = await this.getExecForTable(tableId);
      exec.enabled = !!enabled;

      if (!exec.enabled) {
        exec.phase = 'idle';
        exec.target = null;
        exec.step = 1;
        exec.armedAt = 0;
        exec.cooldownSkipped = undefined;
        await this.setExecForTable(tableId, exec, 'Авто-ставки ВЫКЛ');
      } else {
        await this.setExecForTable(tableId, exec, 'Авто-ставки ВКЛ');
      }
    }

    async onSpin(n, tableIdArg = null) {
      if (!this.canActInThisFrame()) return;

      const tableId =
        tableIdArg || (await getCurrentTrackedTableId());
      if (!tableId) return;

      const exec = await this.getExecForTable(tableId);
      if (!exec.enabled) return;

      const spinLogs = await getTableSpinLogs(tableId);
      if (
        spinLogs.length === 0 ||
        spinLogs[spinLogs.length - 1]?.n !== n
      ) {
        spinLogs.push({ n });
      }

      const ix = this.getIndex(n);

      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        const ref = checkTriggerSameDozen(
          spinLogs,
          triggerStreak,
          includeZero,
          this.getIndex,
        );

        if (ref != null) {
          const gateOk = await entryGateFor(
            'dozens',
            'autoBettingDozensEnabled',
            'bettingStatusDozens',
            { execKey: 'betExecDozens' },
          );
          if (!gateOk) return;

          const t = this.getOthers(ref);
          const next = {
            ...exec,
            phase: 'armed',
            target: t,
            step: 1,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };

          await this.setExecForTable(
            tableId,
            next,
            `ВХОД → дюжины ${t
              .map((x) => this.label(x))
              .join(',')} | шаг 1`,
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

            await appendTableBetLog(tableId, {
              t: Date.now(),
              type: 'placed',
              market: 'dozens',
              phase: 'armed',
              message: 'Шаг 1 поставлен',
              amount,
              step: 1,
              debug: { tableId, targets: t.slice() },
            });
          }

          BET.setBetStatus(
            'bettingStatusDozens',
            ok ? 'armed' : 'error',
            ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1',
          );
        }
        return;
      }

      if (exec.phase === 'armed') {
        const win = ix !== -1 && exec.target?.includes(ix);

        if (win) {
          const next = {
            ...exec,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
          };
          await this.setExecForTable(
            tableId,
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
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
          };
          await this.setExecForTable(
            tableId,
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
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };

          await this.setExecForTable(
            tableId,
            next,
            `ПРОИГРЫШ → сразу ставим шаг ${step} на дюжины ${t
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

            await appendTableBetLog(tableId, {
              t: Date.now(),
              type: 'placed',
              market: 'dozens',
              phase: 'armed',
              message: `Шаг ${step} поставлен (auto)`,
              amount,
              step,
              debug: { tableId, targets: t.slice() },
            });
          }

          BET.setBetStatus(
            'bettingStatusDozens',
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
          phase: 'cooldown',
          target: exec.target?.slice(),
          step,
          armedAt: 0,
          cooldownSkipped: false,
        };

        await this.setExecForTable(
          tableId,
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
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
          };
          await this.setExecForTable(
            tableId,
            reset,
            `Сброс: превышен лимит шагов (${lastStep}) в cooldown`,
          );
          return;
        }

        if (!exec.cooldownSkipped) {
          const step = exec.step;
          const t = exec.target?.slice() || [];

          const mid = { ...exec, cooldownSkipped: true };
          await this.setExecForTable(
            tableId,
            mid,
            `Cooldown: пропустили 1 спин; ставим шаг ${step} (через один)`,
          );

          const next = {
            ...mid,
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };

          await this.setExecForTable(
            tableId,
            next,
            `ГОТОВ (через один) шаг ${step} на дюжины ${t
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

            await appendTableBetLog(tableId, {
              t: Date.now(),
              type: 'placed',
              market: 'dozens',
              phase: 'armed',
              message: `Шаг ${step} поставлен (через один)`,
              amount,
              step,
              debug: { tableId, targets: t.slice() },
            });
          }

          BET.setBetStatus(
            'bettingStatusDozens',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`,
          );
          return;
        }

        const step = exec.step;
        const t = exec.target?.slice() || [];
        const next = {
          ...exec,
          phase: 'armed',
          target: t,
          step,
          armedAt: Date.now(),
          cooldownSkipped: undefined,
        };

        await this.setExecForTable(
          tableId,
          next,
          `ГОТОВ (восстановление) шаг ${step} на дюжины ${t
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

          await appendTableBetLog(tableId, {
            t: Date.now(),
            type: 'placed',
            market: 'dozens',
            phase: 'armed',
            message: `Шаг ${step} поставлен (восстановление)`,
            amount,
            step,
            debug: { tableId, targets: t.slice() },
          });
        }

        BET.setBetStatus(
          'bettingStatusDozens',
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
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };

          await this.setExecForTable(
            tableId,
            next,
            `ГОТОВ шаг ${step} на дюжины ${t
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

            await appendTableBetLog(tableId, {
              t: Date.now(),
              type: 'placed',
              market: 'dozens',
              phase: 'armed',
              message: `Шаг ${step} поставлен`,
              amount,
              step,
              debug: { tableId, targets: t.slice() },
            });
          }

          BET.setBetStatus(
            'bettingStatusDozens',
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

        if (!this.canActInThisFrame()) return;
        if (!ch[TRACKED_TABLE_STATES_KEY]) return;

        const tableId = await getCurrentTrackedTableId();
        if (!tableId) return;

        const oldStates =
          ch[TRACKED_TABLE_STATES_KEY].oldValue &&
          typeof ch[TRACKED_TABLE_STATES_KEY].oldValue === 'object'
            ? ch[TRACKED_TABLE_STATES_KEY].oldValue
            : {};
        const newStates =
          ch[TRACKED_TABLE_STATES_KEY].newValue &&
          typeof ch[TRACKED_TABLE_STATES_KEY].newValue === 'object'
            ? ch[TRACKED_TABLE_STATES_KEY].newValue
            : {};

        const oldLogs = Array.isArray(oldStates?.[tableId]?.spinLogs)
          ? oldStates[tableId].spinLogs
          : [];
        const newLogs = Array.isArray(newStates?.[tableId]?.spinLogs)
          ? newStates[tableId].spinLogs
          : [];

        if (newLogs.length > oldLogs.length) {
          const added = newLogs.slice(oldLogs.length);
          for (const e of added) {
            await this.onSpin(e.n, tableId);
          }
        }
      });
    }
  }

  window.__STRAT_DOZENS__ = new DozensStrategy();

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    window.__STRAT_DOZENS__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_DOZENS__.init(),
      {
        once: true,
      },
    );
  }
})();
