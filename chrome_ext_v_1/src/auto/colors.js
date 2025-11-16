// src/auto/colors.js
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

  const RED = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
  ]);

  function colorIndex(n) {
    if (n === 0) return -1;
    return RED.has(n) ? 0 : 1; // 0=красное,1=чёрное
  }

  const BTN = ['#index-903', '#index-902']; // red, black

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

  async function placeStep(step, targets, steps, mutex, getNode) {
    const ok = await BET.tryPlace({
      step,
      targets,
      steps,
      getTargetNode: (i) => getNode(i),
      mutex,
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

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const ix = this.getIndex(n);

      // IDLE
      if (!exec.phase || exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();
        const ref = checkTriggerSameSide(
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
            cooldownState: null,
            nextStep: 0,
          };
          await this.setExec(
            next,
            `ВХОД → против ${this.label(ref)} | цель: ${this.label(
              t[0]
            )} | шаг 1`
          );

          const res = await placeStep(1, t, steps, this.mutex, (i) =>
            this.getTargetNode(i)
          );

          BET.setBetStatus(
            'bettingStatusColors',
            res.ok ? 'armed' : 'error',
            res.ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
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
            cooldownState: null,
            nextStep: 0,
          };
          await this.setExec(
            next,
            `ВЫИГРЫШ на ${this.label(ix)} → сброс`
          );
          BET.setBetStatus(
            'bettingStatusColors',
            'idle',
            'ВЫИГРЫШ → ждём новый стрик'
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
            cooldownState: null,
            nextStep: 0,
          };
          await this.setExec(
            reset,
            `ПРОИГРЫШ на шаге ${lastStep} → сброс`
          );
          BET.setBetStatus(
            'bettingStatusColors',
            'idle',
            `ПРОИГРЫШ на шаге ${lastStep} → ждём новый стрик`
          );
          return;
        }

        if (autoContinue) {
          const step = exec.step + 1;
          const t = exec.target?.slice() || [];
          const next = {
            ...exec,
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
            cooldownState: null,
            nextStep: 0,
          };
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу шаг ${step} на ${this.label(t[0])}`
          );
          const res = await placeStep(
            step,
            t,
            steps,
            this.mutex,
            (i) => this.getTargetNode(i)
          );
          BET.setBetStatus(
            'bettingStatusColors',
            res.ok ? 'armed' : 'error',
            res.ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        const next = {
          ...exec,
          phase: 'cooldown',
          cooldownState: 'waitSkip',
          nextStep: exec.step + 1,
          armedAt: 0,
        };
        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${next.nextStep} через один`
        );
        BET.setBetStatus(
          'bettingStatusColors',
          'cooldown',
          `ПРОИГРЫШ → пропускаем 1 спин; готовим шаг ${next.nextStep}`
        );
        return;
      }

      // COOLDOWN
      if (exec.phase === 'cooldown') {
        const { steps } = await this.loadCfg();
        const lastStep = Math.max(1, steps.length);
        const step = exec.nextStep || exec.step || 2;
        const t = exec.target?.slice() || [];

        if (step > lastStep) {
          const reset = {
            ...exec,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
            cooldownState: null,
            nextStep: 0,
          };
          await this.setExec(
            reset,
            `Сброс: превышен лимит шагов (${lastStep})`
          );
          BET.setBetStatus(
            'bettingStatusColors',
            'idle',
            `Сброс: лимит шагов ${lastStep}`
          );
          return;
        }

        if (exec.cooldownState === 'waitSkip') {
          const mid = { ...exec, cooldownState: 'ready' };
          await this.setExec(
            mid,
            `Пропущен 1 спин → сейчас ставим шаг ${step}`
          );
          BET.setBetStatus(
            'bettingStatusColors',
            'cooldown',
            `Пропущен 1 спин → сейчас ставим шаг ${step}`
          );
          return;
        }

        if (exec.cooldownState === 'ready') {
          const after = {
            ...exec,
            phase: 'armed',
            step,
            cooldownState: null,
            nextStep: 0,
            armedAt: Date.now(),
          };
          await this.setExec(
            after,
            `ШАГ ${step} (через одну) на ${this.label(t[0])}`
          );
          const res = await placeStep(
            step,
            t,
            steps,
            this.mutex,
            (i) => this.getTargetNode(i)
          );
          BET.setBetStatus(
            'bettingStatusColors',
            res.ok ? 'armed' : 'error',
            res.ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        const reset = {
          ...exec,
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
          'Сброс после ошибки состояния'
        );
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
