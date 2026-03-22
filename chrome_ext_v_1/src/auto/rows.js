import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2,
    autoContinue: false,
    includeZero: false, // 0 учитываем как продолжение уже определённого ряда
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
  const EXEC_MAP_KEY = 'betExecRowsByTable';

  // idx 0 -> ряд 1 (3..36), idx 1 -> ряд 2 (2..35), idx 2 -> ряд 3 (1..34)
  const ROW_SEL = ['#index-700', '#index-701', '#index-702'];

  function rowIndex(n) {
    if (n === 0) return -1;
    const r = n % 3;
    if (r === 0) return 0;
    if (r === 2) return 1;
    if (r === 1) return 2;
    return -1;
  }

  function opponentsOf(triggerIdx) {
    return [0, 1, 2].filter((i) => i !== triggerIdx);
  }

  function getRowNode(idx) {
    const sel = ROW_SEL[idx] || ROW_SEL[2];
    const node = document.querySelector(sel);
    if (!node)
      console.warn(
        '[rows] Не найден узел ряда idx=',
        idx,
        'sel=',
        sel,
      );
    return node;
  }

  function defaultExec(enabled = false) {
    return {
      enabled: !!enabled,
      phase: 'idle',
      target: null,
      step: 1,
      armedAt: 0,
      triggerRow: null,
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

  function checkTriggerSameRow(
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
        if (includeZero && ref != null) {
          cnt++;
          continue;
        }
        break;
      }

      const ri = getIndex(n);
      if (ri === -1) break;
      if (ref == null) ref = ri;
      if (ri !== ref) break;
      cnt++;
    }

    return cnt >= need && ref != null ? ref : null;
  }

  class RowsStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'rows',
        cfgKey: 'abRowsConfig',
        enabledKey: 'autoBettingRowsEnabled',
        statusKey: 'bettingStatusRows',
        execKey: 'betExecRows',
        getIndex: rowIndex,
        getOthers: opponentsOf,
        getTargetNode: getRowNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    label(idx) {
      return idx === 0 ? 'ряд 1' : idx === 1 ? 'ряд 2' : 'ряд 3';
    }

    canActInThisFrame() {
      return !!(
        document.querySelector(ROW_SEL[0]) ||
        document.querySelector(ROW_SEL[1]) ||
        document.querySelector(ROW_SEL[2])
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
        exec.triggerRow = null;
        exec.cooldownSkipped = undefined;
        await this.setExecForTable(tableId, exec, 'Авто-ставки ВЫКЛ');
      } else {
        await this.setExecForTable(tableId, exec, 'Авто-ставки ВКЛ');
      }
    }

    async placeStep(step, exec, steps, tableId) {
      const trigger = exec.triggerRow;

      if (!(trigger === 0 || trigger === 1 || trigger === 2)) {
        console.error(
          '[rows] Некорректный triggerRow при постановке',
          exec,
        );
        return false;
      }

      const targetsIdx = opponentsOf(trigger);
      const triggerSel = ROW_SEL[trigger];
      const targetsSel = targetsIdx.map((i) => ROW_SEL[i]);

      if (targetsSel.includes(triggerSel)) {
        console.error('[rows] Цели содержат триггер! Фиксируем...', {
          trigger,
          targetsIdxBefore: targetsIdx,
        });
        targetsIdx.splice(
          0,
          targetsIdx.length,
          ...opponentsOf(trigger),
        );
      }

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
        const chips = await BET.loadGlobalChips();
        const amount =
          BET.perTargetAmountForStep(step, steps, chips.chipValues) *
          targetsIdx.length;

        await appendTableBetLog(tableId, {
          t: Date.now(),
          type: 'placed',
          market: 'rows',
          phase: 'armed',
          message: `Шаг ${step} на ${targetsIdx
            .map((x) => this.label(x))
            .join(', ')}`,
          amount,
          step,
          debug: {
            tableId,
            triggerRow: trigger,
            targets: targetsIdx,
            targetSel: targetsIdx.map((i) => ROW_SEL[i]),
          },
        });
      }

      BET.setBetStatus(
        'bettingStatusRows',
        ok ? 'armed' : 'error',
        ok
          ? `Шаг ${step} поставлен`
          : `Не удалось поставить шаг ${step}`,
      );

      return ok;
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

        const ref = checkTriggerSameRow(
          spinLogs,
          triggerStreak,
          includeZero,
          this.getIndex,
        );

        if (ref != null) {
          const gateOk = await entryGateFor(
            'rows',
            'autoBettingRowsEnabled',
            'bettingStatusRows',
            { execKey: 'betExecRows' },
          );
          if (!gateOk) return;

          const next = {
            ...exec,
            phase: 'armed',
            triggerRow: ref,
            target: opponentsOf(ref),
            step: 1,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };

          await this.setExecForTable(
            tableId,
            next,
            `ВХОД → против ${this.label(ref)} | цели: ${next.target
              .map((x) => this.label(x))
              .join(', ')} | шаг 1`,
          );

          await this.placeStep(
            1,
            { ...next },
            (await this.loadCfg()).steps,
            tableId,
          );
        }
        return;
      }

      if (exec.phase === 'armed') {
        const opp = opponentsOf(exec.triggerRow ?? -99);
        const win = ix !== -1 && opp.includes(ix);

        if (win) {
          const next = {
            ...exec,
            phase: 'idle',
            target: null,
            triggerRow: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
          };
          await this.setExecForTable(
            tableId,
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
            phase: 'idle',
            target: null,
            triggerRow: null,
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
          const next = {
            ...exec,
            phase: 'armed',
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          next.target = opponentsOf(next.triggerRow);

          await this.setExecForTable(
            tableId,
            next,
            `ПРОИГРЫШ → сразу шаг ${step} против ${this.label(
              next.triggerRow,
            )} (цели: ${next.target
              .map((x) => this.label(x))
              .join(', ')})`,
          );

          await this.placeStep(step, { ...next }, steps, tableId);
          return;
        }

        const next = {
          ...exec,
          phase: 'cooldown',
          step: exec.step + 1,
          armedAt: 0,
          cooldownSkipped: false,
        };
        next.target = opponentsOf(exec.triggerRow);

        await this.setExecForTable(
          tableId,
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
            phase: 'idle',
            target: null,
            triggerRow: null,
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
          const mid = { ...exec, cooldownSkipped: true };

          await this.setExecForTable(
            tableId,
            mid,
            `Cooldown: пропустили 1 спин; ставим шаг ${step} (через один)`,
          );

          const next = {
            ...mid,
            phase: 'armed',
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          next.target = opponentsOf(next.triggerRow);

          await this.setExecForTable(
            tableId,
            next,
            `ГОТОВ (через один) шаг ${step} против ${this.label(
              next.triggerRow,
            )} (цели: ${next.target
              .map((x) => this.label(x))
              .join(', ')})`,
          );

          await this.placeStep(step, { ...next }, steps, tableId);
          return;
        }

        const step = exec.step;
        const rec = {
          ...exec,
          phase: 'armed',
          armedAt: Date.now(),
          cooldownSkipped: undefined,
        };
        rec.target = opponentsOf(rec.triggerRow);

        await this.setExecForTable(
          tableId,
          rec,
          `ГОТОВ (восстановление) шаг ${step} против ${this.label(
            rec.triggerRow,
          )} (цели: ${rec.target
            .map((x) => this.label(x))
            .join(', ')})`,
        );

        await this.placeStep(step, { ...rec }, steps, tableId);
        return;
      }

      if (exec.phase === 'waiting') {
        const opp = opponentsOf(exec.triggerRow ?? -99);
        if (ix !== -1 && opp.includes(ix)) {
          const step = exec.step;
          const { steps } = await this.loadCfg();
          const next = {
            ...exec,
            phase: 'armed',
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          next.target = opp.slice();

          await this.setExecForTable(
            tableId,
            next,
            `ГОТОВ шаг ${step} против ${this.label(
              exec.triggerRow,
            )} (цели: ${next.target
              .map((x) => this.label(x))
              .join(', ')})`,
          );

          await this.placeStep(step, { ...next }, steps, tableId);
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

  window.__STRAT_ROWS__ = new RowsStrategy();

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    window.__STRAT_ROWS__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_ROWS__.init(),
      {
        once: true,
      },
    );
  }
})();
