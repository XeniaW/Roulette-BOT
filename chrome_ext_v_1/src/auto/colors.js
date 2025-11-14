import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2,
    autoContinue: false,
    includeZero: false, // если true — 0 продолжает стрик цвета
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

  // RED set для европейской рулетки
  const RED = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
  ]);
  // idx: 0 = red, 1 = black, -1 = zero
  function colorIndex(n) {
    if (n === 0) return -1;
    return RED.has(n) ? 0 : 1;
  }
  const BTN = ['#index-903', '#index-902']; // red, black
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
      const si = colorIndex(n);
      if (si === -1) break;
      if (ref == null) ref = si;
      if (si !== ref) break;
      cnt++;
    }
    return cnt >= need && ref != null ? ref : null;
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

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const ix = this.getIndex(n);

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
            'colors',
            'autoBettingColorsEnabled',
            'bettingStatusColors',
            { execKey: 'betExecColors' }
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
          BET.setBetStatus(
            'bettingStatusColors',
            ok ? 'armed' : 'error',
            ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
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
            'bettingStatusColors',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }
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
            'bettingStatusColors',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }
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
          'bettingStatusColors',
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

  window.__STRAT_COLORS__ = new ColorsStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_COLORS__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_COLORS__.init(),
      { once: true }
    );
})();
