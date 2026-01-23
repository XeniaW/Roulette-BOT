// src/auto/lowhigh.js
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

  // ✅ увеличенное окно ожидания ставок ТОЛЬКО для lowhigh
  const PLACE_MAX_WAIT_MS = 20000;

  // idx: 0 = 1–18, 1 = 19–36, -1 = 0/мусор
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

  // стрик одной стороны с конца
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
      const si = sideIndex(n);
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

      // ✅ увеличили окно ожидания “между спином и ставками”
      maxWaitMs: PLACE_MAX_WAIT_MS,
    });
    if (!ok) return { ok: false, amount: 0 };

    const chips = await BET.loadGlobalChips();
    const amount =
      BET.perTargetAmountForStep(step, steps, chips.chipValues) *
      targets.length;

    return { ok: true, amount };
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

    async logPlaced(step, amount, message) {
      try {
        const { betLogs = [] } = await this.sget({ betLogs: [] });
        betLogs.push({
          t: Date.now(),
          type: 'placed',
          market: 'lowhigh',
          phase: 'armed',
          message,
          amount,
          step,
        });
        if (betLogs.length > 2000)
          betLogs.splice(0, betLogs.length - 2000);
        await this.sset({ betLogs });
      } catch {}
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const ix = this.getIndex(n);

      // ========== IDLE ==========
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
            'lowhigh',
            'autoBettingLowHighEnabled',
            'bettingStatusLowHigh',
            { execKey: 'betExecLowHigh' }
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
          if (res.ok)
            await this.logPlaced(1, res.amount, 'Шаг 1 поставлен');

          BET.setBetStatus(
            'bettingStatusLowHigh',
            res.ok ? 'armed' : 'error',
            res.ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
          );
        }
        return;
      }

      // ========== ARMED ==========
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
            'bettingStatusLowHigh',
            'idle',
            'ВЫИГРЫШ → ждём новый стрик'
          );
          return;
        }

        const { steps, autoContinue } = await this.loadCfg();
        const lastStep = Math.max(1, steps.length);

        // слив на последнем шаге
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
            'bettingStatusLowHigh',
            'idle',
            `ПРОИГРЫШ на шаге ${lastStep} → ждём новый стрик`
          );
          return;
        }

        // авто — сразу следующий шаг
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
          if (res.ok)
            await this.logPlaced(
              step,
              res.amount,
              `Шаг ${step} поставлен (auto)`
            );

          BET.setBetStatus(
            'bettingStatusLowHigh',
            res.ok ? 'armed' : 'error',
            res.ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        // режим "через одну": уходим в cooldown
        const next = {
          ...exec,
          phase: 'cooldown',
          cooldownState: 'waitSkip', // ждём один спин
          nextStep: exec.step + 1,
          armedAt: 0,
        };
        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${next.nextStep} через один`
        );
        BET.setBetStatus(
          'bettingStatusLowHigh',
          'cooldown',
          `ПРОИГРЫШ → пропускаем 1 спин; готовим шаг ${next.nextStep}`
        );
        return;
      }

      // ========== COOLDOWN (через одну) ==========
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
            'bettingStatusLowHigh',
            'idle',
            `Сброс: лимит шагов ${lastStep}`
          );
          return;
        }

        // первый спин после проигрыша — считаем пропущенным, БЕЗ ставки
        if (exec.cooldownState === 'waitSkip') {
          const mid = {
            ...exec,
            cooldownState: 'ready',
          };
          await this.setExec(
            mid,
            `Пропущен 1 спин → сейчас ставим шаг ${step}`
          );
          BET.setBetStatus(
            'bettingStatusLowHigh',
            'cooldown',
            `Пропущен 1 спин → сейчас ставим шаг ${step}`
          );
          return;
        }

        // второй спин: ставим шаг N и возвращаемся в ARMED
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
          if (res.ok)
            await this.logPlaced(
              step,
              res.amount,
              `Шаг ${step} поставлен (через одну)`
            );

          BET.setBetStatus(
            'bettingStatusLowHigh',
            res.ok ? 'armed' : 'error',
            res.ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        // если вдруг какое-то левое состояние — жёстко в idle
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
          'bettingStatusLowHigh',
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
      {
        once: true,
      }
    );
})();
