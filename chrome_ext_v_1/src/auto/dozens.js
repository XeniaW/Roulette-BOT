// src/auto/dozens.js
import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2,
    autoContinue: false,
    includeZero: false, // NEW: считать 0 как текущую дюжину
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

  const $ = (sel) => document.querySelector(sel);
  const dozenButtons = [
    $('#index-800'),
    $('#index-801'),
    $('#index-802'),
  ];

  function dozenIndex(n) {
    if (n === 0) return -1; // 0 даём обработать логикой includeZero
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

  // helper: проверка триггера с опцией includeZero
  async function checkTriggerSameDozen(
    spinLogs,
    need,
    includeZero,
    getIndex
  ) {
    let cnt = 0;
    let ref = null; // фиксируем целевую дюжину первой ненулевой записи
    for (let i = spinLogs.length - 1; i >= 0 && cnt < need; i--) {
      const n = spinLogs[i]?.n;
      if (n === 0) {
        if (includeZero) {
          cnt++; // 0 учитывается
          continue;
        } else break;
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

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const ix = this.getIndex(n);

      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        // NEW: учитываем includeZero при проверке окна
        const ref = await checkTriggerSameDozen(
          spinLogs,
          triggerStreak,
          includeZero,
          this.getIndex
        );

        if (ref != null) {
          // === ВСТАВЛЕН ГЕЙТ ВХОДА ПО ЛИМИТУ ===
          const gateOk = await entryGateFor(
            'dozens',
            'autoBettingDozensEnabled',
            'bettingStatusDozens',
            { execKey: 'betExecDozens' } // ← ДОБАВЛЕНО
          );
          if (!gateOk) return;

          const t = this.getOthers(ref);
          const next = {
            ...exec,
            phase: 'armed',
            target: t,
            step: 1,
            armedAt: Date.now(),
          };
          await this.setExec(
            next,
            `ВХОД → дюжины ${t
              .map((x) => this.label(x))
              .join(',')} | шаг 1`
          );

          const ok = await BET.tryPlace({
            step: 1,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
          });
          if (ok) {
            const chips = await BET.loadGlobalChips();
            const amount =
              BET.perTargetAmountForStep(1, steps, chips.chipValues) *
              t.length;
            try {
              const { betLogs = [] } = await this.sget({
                betLogs: [],
              });
              betLogs.push({
                t: Date.now(),
                type: 'placed',
                market: 'dozens',
                phase: 'armed',
                message: 'Шаг 1 поставлен',
                amount,
                step: 1,
              });
              if (betLogs.length > 2000)
                betLogs.splice(0, betLogs.length - 2000);
              await this.sset({ betLogs });
            } catch {}
          }
          BET.setBetStatus(
            'bettingStatusDozens',
            ok ? 'armed' : 'error',
            ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
          );
        }
        return;
      }

      if (exec.phase === 'armed') {
        const win = ix !== -1 && exec.target.includes(ix);
        if (win) {
          const next = {
            ...exec,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
          };
          await this.setExec(
            next,
            `ВЫИГРЫШ на дюжине ${this.label(ix)} → сброс`
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
          };
          await this.setExec(
            reset,
            `ПРОИГРЫШ на шаге ${lastStep} → сброс`
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
          };
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу ставим шаг ${step} на дюжины ${t
              .map((x) => this.label(x))
              .join(',')}`
          );
          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
          });
          const chips = await BET.loadGlobalChips();
          if (ok) {
            const amount =
              BET.perTargetAmountForStep(
                step,
                steps,
                chips.chipValues
              ) * t.length;
            try {
              const { betLogs = [] } = await this.sget({
                betLogs: [],
              });
              betLogs.push({
                t: Date.now(),
                type: 'placed',
                market: 'dozens',
                phase: 'armed',
                message: `Шаг ${step} поставлен (auto)`,
                amount,
                step,
              });
              if (betLogs.length > 2000)
                betLogs.splice(0, betLogs.length - 2000);
              await this.sset({ betLogs });
            } catch {}
          }
          BET.setBetStatus(
            'bettingStatusDozens',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        // режим ожидания (как раньше)
        const next = {
          ...exec,
          phase: 'waiting',
          step: exec.step + 1,
        };
        await this.setExec(
          next,
          `ПРОИГРЫШ → ожидание, следующий шаг ${next.step}`
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
          };
          await this.setExec(
            next,
            `ГОТОВ шаг ${step} на дюжины ${t
              .map((x) => this.label(x))
              .join(',')}`
          );
          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
          });
          if (ok) {
            const chips = await BET.loadGlobalChips();
            const amount =
              BET.perTargetAmountForStep(
                step,
                steps,
                chips.chipValues
              ) * t.length;
            try {
              const { betLogs = [] } = await this.sget({
                betLogs: [],
              });
              betLogs.push({
                t: Date.now(),
                type: 'placed',
                market: 'dozens',
                phase: 'armed',
                message: `Шаг ${step} поставлен`,
                amount,
                step,
              });
              if (betLogs.length > 2000)
                betLogs.splice(0, betLogs.length - 2000);
              await this.sset({ betLogs });
            } catch {}
          }
          BET.setBetStatus(
            'bettingStatusDozens',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
        }
      }
    }

    attachStorageListener() {
      chrome.storage.onChanged.addListener(async (ch, area) => {
        if (area !== 'local') return;
        if (this.enabledKey in ch) this.loadEnabled();
        if (ch.spinLogs) {
          const { oldValue = [], newValue = [] } = ch.spinLogs;
          if (
            Array.isArray(newValue) &&
            newValue.length > oldValue.length
          ) {
            const added = newValue.slice(oldValue.length);
            for (const e of added) await this.onSpin(e.n);
          }
        }
      });
    }
  }

  window.__STRAT_DOZENS__ = new DozensStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_DOZENS__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_DOZENS__.init(),
      { once: true }
    );
})();
