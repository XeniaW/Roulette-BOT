// src/auto/dozens.js
import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2,
    autoContinue: false,
    includeZero: false, // учитывать 0 как текущую дюжину
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
    if (n === 0) return -1; // 0 отдаём includeZero
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

  // проверка серии одной и той же дюжины (с учётом includeZero)
  async function checkTriggerSameDozen(
    spinLogs,
    need,
    includeZero,
    getIndex
  ) {
    let cnt = 0;
    let ref = null; // целевая дюжина первой валидной записи
    for (let i = spinLogs.length - 1; i >= 0 && cnt < need; i--) {
      const n = spinLogs[i]?.n;
      if (n === 0) {
        if (includeZero) {
          cnt++; // 0 учитывается как продолжение серии
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

      // --- IDLE: ищем вход по серии
      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        const ref = await checkTriggerSameDozen(
          spinLogs,
          triggerStreak,
          includeZero,
          this.getIndex
        );
        if (ref != null) {
          // лимит входа (ваш Gate)
          const gateOk = await entryGateFor(
            'dozens',
            'autoBettingDozensEnabled',
            'bettingStatusDozens',
            { execKey: 'betExecDozens' }
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

      // --- ARMED: проверяем исход и готовим следующий шаг
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

        // === ИЗМЕНЕННАЯ ЛОГИКА ===
        // если autoContinue ВКЛ → ставим сразу следующий шаг (как раньше)
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

        // если autoContinue ВЫКЛ → ПРОПУСТИТЬ 1 СПИН, затем поставить через один по тем же целям
        const step = exec.step + 1;
        const next = {
          ...exec,
          phase: 'cooldown', // НОВАЯ фаза: пропускаем один спин
          target: exec.target?.slice(),
          step,
          armedAt: 0,
          cooldownSkipped: false, // еще не пропустили
        };
        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${step} через один`
        );
        return;
      }

      // --- COOLDOWN: пропускаем один спин, затем СРАЗУ ставим (в этом же вызове) на следующий
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

        // если ещё не отмечали пропуск — считаем, что ЭТОТ спин и был пропущенным,
        // и СРАЗУ ставим "через один" (на текущем вызове onSpin).
        if (!exec.cooldownSkipped) {
          const step = exec.step;
          const t = exec.target?.slice() || [];

          // помечаем, что один спин пропустили
          const mid = { ...exec, cooldownSkipped: true };
          await this.setExec(
            mid,
            `Cooldown: пропустили 1 спин; ставим шаг ${step} (через один)`
          );

          // сразу переходим в armed и ставим
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
            `ГОТОВ (через один) шаг ${step} на дюжины ${t
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
                message: `Шаг ${step} поставлен (через один)`,
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

        // Если каким-то образом сюда попали при cooldownSkipped === true (например, гонка) —
        // просто восстановим armed без второй попытки пропуска.
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
        await this.setExec(
          next,
          `ГОТОВ (восстановление) шаг ${step} на дюжины ${t
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
        BET.setBetStatus(
          'bettingStatusDozens',
          ok ? 'armed' : 'error',
          ok
            ? `Шаг ${step} поставлен`
            : `Не удалось поставить шаг ${step}`
        );
        return;
      }

      // --- WAITING (оставлено для обратной совместимости: не используется в новой схеме)
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
  ) {
    window.__STRAT_DOZENS__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_DOZENS__.init(),
      { once: true }
    );
  }
})();
