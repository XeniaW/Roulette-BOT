import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 4,
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
  const EXECS_KEY = 'betExecThreesByTable';
  const MAX_BET_LOGS = 2000;

  function streetIndex(n) {
    if (n === 0) return -1;
    if (n < 1 || n > 36) return -1;
    return Math.ceil(n / 3) - 1;
  }

  function getStreetNode(idx) {
    return (
      document.querySelector(`#index-${500 + idx}`) ||
      document.querySelector(`#index-${500 + idx * 2}`) ||
      document.querySelector(`[data-e2e="street-${idx}"]`) ||
      null
    );
  }

  function labelStreet(idx) {
    const a = idx * 3 + 1;
    const b = a + 2;
    return `стрит ${a}-${b}`;
  }

  function targetsFromCovered(coveredSet) {
    const skip = new Set(coveredSet || []);
    const res = [];
    for (let s = 0; s < 12; s++) {
      if (!skip.has(s)) res.push(s);
    }
    return res;
  }

  async function signalResetDots() {
    try {
      await chrome.storage.local.set({ threesDotsReset: Date.now() });
    } catch {}
  }

  function checkTriggerThrees(spinLogs, need, includeZero) {
    const len = Array.isArray(spinLogs) ? spinLogs.length : 0;

    if (len < need) {
      return { ok: false, covered: null, startIdx: -1, cnt: 0 };
    }

    const startIdx = len - need;
    const covered = new Set();
    let cnt = 0;

    for (let i = startIdx; i < len; i++) {
      const n = Number(spinLogs[i]?.n);
      if (!Number.isFinite(n)) {
        return { ok: false, covered: null, startIdx: -1, cnt: 0 };
      }

      if (n === 0) {
        if (!includeZero) {
          return { ok: false, covered: null, startIdx: -1, cnt: 0 };
        }
        cnt++;
        continue;
      }

      const si = streetIndex(n);
      if (si === -1) {
        return { ok: false, covered: null, startIdx: -1, cnt: 0 };
      }

      if (!covered.has(si)) {
        if (covered.size === 4) {
          return { ok: false, covered: null, startIdx: -1, cnt: 0 };
        }
        covered.add(si);
      }

      cnt++;
    }

    if (cnt === need && covered.size === 4) {
      return { ok: true, covered, startIdx, cnt };
    }

    return { ok: false, covered: null, startIdx: -1, cnt };
  }

  function emptyExec(enabled = false) {
    return {
      enabled: !!enabled,
      phase: 'idle',
      target: null,
      step: 1,
      armedAt: 0,
      idleGuard: false,
      guardCutIndex: -1,
      waitSkipped: false,
      waitStep: 0,
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

  async function placeStep(step, targets, steps, mutex, getNode) {
    const ok = await BET.tryPlace({
      step,
      targets,
      steps,
      getTargetNode: (i) => getNode(i),
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

  class ThreesStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'threes',
        cfgKey: 'abThreesConfig',
        enabledKey: 'autoBettingThreesEnabled',
        statusKey: 'bettingStatusThrees',
        execKey: 'betExecThrees',
        getIndex: streetIndex,
        getOthers: null,
        getTargetNode: getStreetNode,
        defaultCfg: DEFAULT_CFG,
      });
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
        exec.idleGuard = false;
        exec.guardCutIndex = -1;
        exec.waitSkipped = false;
        exec.waitStep = 0;
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
        market: 'threes',
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
        !spinLogs.length ||
        Number(spinLogs[spinLogs.length - 1]?.n) !== Number(n)
      ) {
        spinLogs.push({ n });
      }

      const ix = this.getIndex(n);

      if (!exec.phase || exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();
        const need = Math.max(2, triggerStreak | 0);

        const chk = checkTriggerThrees(spinLogs, need, !!includeZero);

        const guardCutIndex =
          Number.isInteger(exec.guardCutIndex) &&
          exec.guardCutIndex >= 0
            ? exec.guardCutIndex
            : -1;
        const idleGuard = !!exec.idleGuard;

        if (idleGuard) {
          if (chk.ok && chk.startIdx < guardCutIndex) {
            BET.setBetStatus(
              this.statusKey,
              'idle',
              'Ожидание: требуется разрыв окна перед новым входом',
            );
            return;
          }
          const cleared = {
            ...exec,
            enabled: true,
            idleGuard: false,
            guardCutIndex: -1,
          };
          await this.setExec(
            cleared,
            'Окно разрушено/сдвинуто → guard снят',
          );
        }

        if (chk.ok) {
          const gateOk = await entryGateFor(
            'threes',
            'autoBettingThreesEnabled',
            'bettingStatusThrees',
            { execKey: 'betExecThrees' },
          );
          if (!gateOk) return;

          const targets = targetsFromCovered(chk.covered);
          const next = {
            ...exec,
            enabled: true,
            phase: 'armed',
            target: targets,
            step: 1,
            armedAt: Date.now(),
            idleGuard: false,
            guardCutIndex: -1,
            waitSkipped: false,
            waitStep: 0,
          };

          await this.setExec(
            next,
            `ВХОД → цели: ${targets
              .map(labelStreet)
              .join(', ')} | шаг 1`,
          );

          const res = await placeStep(
            1,
            targets,
            steps,
            this.mutex,
            (i) => this.getTargetNode(i),
          );
          if (res.ok) {
            await this.logPlaced(1, res.amount, 'Шаг 1 поставлен');
          }

          BET.setBetStatus(
            this.statusKey,
            res.ok ? 'armed' : 'error',
            res.ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1',
          );
        }
        return;
      }

      if (exec.phase === 'armed') {
        const isWin = ix !== -1 && exec.target?.includes(ix);

        if (isWin) {
          const reset = {
            ...exec,
            enabled: true,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
            idleGuard: true,
            guardCutIndex: spinLogs.length,
            waitSkipped: false,
            waitStep: 0,
          };
          await this.setExec(
            reset,
            `ВЫИГРЫШ на ${labelStreet(ix)} → сброс, ждём новый стрик`,
          );
          await signalResetDots();
          BET.setBetStatus(
            this.statusKey,
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
            idleGuard: true,
            guardCutIndex: spinLogs.length,
            waitSkipped: false,
            waitStep: 0,
          };
          await this.setExec(
            reset,
            `ПРОИГРЫШ на шаге ${lastStep} → сброс, ждём новый стрик`,
          );
          await signalResetDots();
          BET.setBetStatus(
            this.statusKey,
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
            waitSkipped: false,
            waitStep: 0,
          };
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу ставим шаг ${step} на ${t
              .map(labelStreet)
              .join(', ')}`,
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
            this.statusKey,
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
          phase: 'waiting',
          waitStep: exec.step + 1,
          waitSkipped: false,
        };

        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${next.waitStep} через один`,
        );
        BET.setBetStatus(
          this.statusKey,
          'waiting',
          `ПРОИГРЫШ → пропускаем 1 спин; готовим шаг ${next.waitStep}`,
        );
        return;
      }

      if (exec.phase === 'waiting') {
        const { steps } = await this.loadCfg();
        const t = exec.target?.slice() || [];
        const step = exec.waitStep;

        if (!exec.waitSkipped) {
          await this.setExec(
            {
              ...exec,
              enabled: true,
              waitSkipped: true,
            },
            `Пропущен 1 спин → сейчас ставим шаг ${step}`,
          );

          const after = {
            ...exec,
            enabled: true,
            phase: 'armed',
            step,
            waitSkipped: false,
            waitStep: 0,
            armedAt: Date.now(),
          };

          await this.setExec(
            after,
            `ШАГ ${step} (через одну) на ${t
              .map(labelStreet)
              .join(', ')}`,
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
            this.statusKey,
            res.ok ? 'armed' : 'error',
            res.ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`,
          );

          return;
        }

        return;
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

  window.__STRAT_THREES__ = new ThreesStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    window.__STRAT_THREES__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_THREES__.init(),
      {
        once: true,
      },
    );
  }
})();
