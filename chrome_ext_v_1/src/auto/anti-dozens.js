// src/auto/anti-dozens.js
import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    // Триггер: одна из дюжин НЕ выпадала подряд минимум triggerStreak "учитываемых" спинов
    triggerStreak: 10,
    autoContinue: false,
    // includeZero=true: 0 считается как спин, продлевающий невыход (0 не относится к дюжинам)
    // includeZero=false: 0 игнорируем (не влияет на длину невыхода)
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

  // увеличенное окно ожидания ставок
  const PLACE_MAX_WAIT_MS = 20000;

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

  // возвращает индекс дюжины 0..2, которая "не выходит" >= need, иначе null
  async function checkTriggerMissingDozen(
    spinLogs,
    need,
    includeZero,
    getIndex
  ) {
    if (!Array.isArray(spinLogs) || spinLogs.length === 0)
      return null;

    const miss = [0, 0, 0];
    const found = [false, false, false];

    for (let i = spinLogs.length - 1; i >= 0; i--) {
      const n = Number(spinLogs[i]?.n);
      if (!Number.isFinite(n)) continue;

      if (n === 0 && !includeZero) continue;

      const di = getIndex(n); // -1 для 0

      // текущий спин считается "после последнего появления" для всех ещё не найденных дюжин,
      // кроме той, которая выпала на этом спине
      for (let d = 0; d < 3; d++) {
        if (found[d]) continue;
        if (di !== -1 && d === di) continue;
        miss[d]++;
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

    // tie-break: меньший индекс
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

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const ix = this.getIndex(n);

      // IDLE: вход по "невыходу"
      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        const missing = await checkTriggerMissingDozen(
          spinLogs,
          triggerStreak,
          includeZero,
          this.getIndex
        );

        if (missing != null) {
          const gateOk = await entryGateFor(
            'antidozens',
            'autoBettingAntiDozensEnabled',
            'bettingStatusAntiDozens',
            { execKey: 'betExecAntiDozens' }
          );
          if (!gateOk) return;

          const t = [missing];
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
            `ВХОД → не выходила дюжина ${this.label(
              missing
            )} ≥ ${triggerStreak} | ставим НА НЕЁ | шаг 1`
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

            try {
              const { betLogs = [] } = await this.sget({
                betLogs: [],
              });
              betLogs.push({
                t: Date.now(),
                type: 'placed',
                market: 'antidozens',
                phase: 'armed',
                message: `Шаг 1 поставлен на антидюжину ${this.label(
                  missing
                )}`,
                amount,
                step: 1,
              });
              if (betLogs.length > 2000)
                betLogs.splice(0, betLogs.length - 2000);
              await this.sset({ betLogs });
            } catch {}
          }

          BET.setBetStatus(
            'bettingStatusAntiDozens',
            ok ? 'armed' : 'error',
            ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
          );
        }
        return;
      }

      // ARMED: выигрыш / прогрессия
      if (exec.phase === 'armed') {
        const targetIdx = Array.isArray(exec.target)
          ? exec.target[0]
          : null;
        const win =
          ix !== -1 && targetIdx != null && ix === targetIdx;

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
          const t = exec.target?.slice() || [];
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
            `ПРОИГРЫШ → сразу ставим шаг ${step} на антидюжину ${t
              .map((x) => this.label(x))
              .join(',')}`
          );

          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
            maxWaitMs: PLACE_MAX_WAIT_MS,
          });

          BET.setBetStatus(
            'bettingStatusAntiDozens',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        // через один
        const step = exec.step + 1;
        const next = {
          ...exec,
          phase: 'cooldown',
          target: exec.target?.slice(),
          step,
          armedAt: 0,
          cooldownSkipped: false,
        };
        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${step} через один`
        );
        return;
      }

      // COOLDOWN: пропускаем 1 спин, затем ставим
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
            `Сброс: превышен лимит шагов (${lastStep}) в cooldown`
          );
          return;
        }

        if (!exec.cooldownSkipped) {
          const step = exec.step;
          const t = exec.target?.slice() || [];

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
            `ГОТОВ (через один) шаг ${step} на антидюжину ${t
              .map((x) => this.label(x))
              .join(',')}`
          );

          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
            maxWaitMs: PLACE_MAX_WAIT_MS,
          });

          BET.setBetStatus(
            'bettingStatusAntiDozens',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
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
      { once: true }
    );
  }
})();
