import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2,
    autoContinue: false,
    includeZero: false, // если true — 0 продолжает стрик стороны
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

  // idx: 0 = 1..18, 1 = 19..36, -1 = 0
  function sideIndex(n) {
    if (n === 0) return -1;
    if (n >= 1 && n <= 18) return 0;
    if (n >= 19 && n <= 36) return 1;
    return -1;
  }
  const BTN = ['#index-900', '#index-905'];
  function getNode(idx) {
    const sel = BTN[idx] || BTN[1];
    return document.querySelector(sel);
  }
  function other(idx) {
    return idx === 0 ? [1] : [0];
  }
  async function checkTriggerSameSide(spinLogs, need, includeZero) {
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
      const si = sideIndex(n);
      if (si === -1) break;
      if (ref == null) ref = si;
      if (si !== ref) break;
      cnt++;
    }
    return cnt >= need && ref != null ? ref : null;
  }

  class LowHighStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'lowhigh',
        cfgKey: 'abLowHighConfig',
        enabledKey: 'autoBettingLowHighEnabled',
        statusKey: 'bettingStatusLowHigh',
        execKey: 'betExecLowHigh',
        getIndex: sideIndex,
        getOthers: other,
        getTargetNode: getNode,
        defaultCfg: DEFAULT_CFG,
      });
    }
    label(idx) {
      return idx === 0 ? '1–18' : '19–36';
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const ix = this.getIndex(n);

      // IDLE → вход по стрику
      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();
        const ref = await checkTriggerSameSide(
          spinLogs,
          triggerStreak,
          includeZero
        );
        if (ref != null) {
          const gateOk = await entryGateFor(
            'lowhigh',
            'autoBettingLowHighEnabled',
            'bettingStatusLowHigh',
            { execKey: 'betExecLowHigh' }
          );
          if (!gateOk) return;

          const t = this.getOthers(ref); // одна противоположная сторона
          const next = {
            ...exec,
            phase: 'armed',
            target: t,
            step: 1,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ВХОД → против ${this.label(ref)} | цель: ${this.label(
              t[0]
            )} | шаг 1`
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
                market: 'lowhigh',
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
            'bettingStatusLowHigh',
            ok ? 'armed' : 'error',
            ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
          );
        }
        return;
      }

      // ARMED
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
          await this.setExec(
            next,
            `ВЫИГРЫШ на ${this.label(ix)} → сброс`
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
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу шаг ${step} на ${this.label(t[0])}`
          );
          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
          });
          BET.setBetStatus(
            'bettingStatusLowHigh',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }
        // через один
        const next = {
          ...exec,
          phase: 'cooldown',
          step: exec.step + 1,
          armedAt: 0,
          cooldownSkipped: false,
        };
        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${next.step} через один`
        );
        return;
      }

      // COOLDOWN: пропустить 1 спин и сразу ставить (в этом же вызове)
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
          await this.setExec(
            reset,
            `Сброс: превышен лимит шагов (${lastStep})`
          );
          return;
        }
        if (!exec.cooldownSkipped) {
          const step = exec.step;
          const t = (exec.target || []).slice();
          const mid = { ...exec, cooldownSkipped: true };
          await this.setExec(
            mid,
            `Cooldown: пропустили 1 спин; ставим шаг ${step} (через один)`
          );

          const next = {
            ...mid,
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ГОТОВ (через один) шаг ${step} на ${this.label(t[0])}`
          );
          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
          });
          BET.setBetStatus(
            'bettingStatusLowHigh',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }
        // защита
        const step = exec.step;
        const t = (exec.target || []).slice();
        const rec = {
          ...exec,
          phase: 'armed',
          target: t,
          step,
          armedAt: Date.now(),
          cooldownSkipped: undefined,
        };
        await this.setExec(
          rec,
          `ГОТОВ (восстановление) шаг ${step} на ${this.label(t[0])}`
        );
        const ok = await BET.tryPlace({
          step,
          targets: t,
          steps,
          getTargetNode: (i) => this.getTargetNode(i),
          mutex: this.mutex,
        });
        BET.setBetStatus(
          'bettingStatusLowHigh',
          ok ? 'armed' : 'error',
          ok
            ? `Шаг ${step} поставлен`
            : `Не удалось поставить шаг ${step}`
        );
        return;
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

  window.__STRAT_LOWHIGH__ = new LowHighStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_LOWHIGH__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_LOWHIGH__.init(),
      { once: true }
    );
})();
