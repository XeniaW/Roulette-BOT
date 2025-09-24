// src/auto/sixlines.js
(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2, // Сколько последних спинов анализируем
    autoContinue: false, // Ставить следующий шаг сразу после проигрыша
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

  // Кнопки шестерок. В некоторых лобби индексы на сетке идут 600..610,
  // но реально шестерок 6. Пробуем 600 + i*2 (600,602,...,610), если нет — 600+i (600..605).
  function getSixNode(idx) {
    const id1 = 600 + idx * 2;
    const id2 = 600 + idx;
    return (
      $(`#index-${id1}`) ||
      $(`#index-${id2}`) ||
      document.querySelector(`#index-${id1}`) ||
      document.querySelector(`#index-${id2}`)
    );
  }

  // Индекс шестерки: 0..5 (1–6, 7–12, ..., 31–36). 0 → -1 (ноль).
  function sixIndex(n) {
    if (n === 0) return -1;
    if (n < 1 || n > 36) return -1;
    return Math.floor((n - 1) / 6); // 0..5
  }

  // Вернуть индексы остальных шестерок, если заданы ровно 2 "исключения"
  function othersOfTwo(skipSet) {
    const out = [];
    for (let i = 0; i < 6; i++) if (!skipSet.has(i)) out.push(i);
    return out;
  }

  class SixlinesStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'sixlines',
        cfgKey: 'abSixConfig',
        enabledKey: 'autoBettingSixEnabled',
        statusKey: 'bettingStatusSix',
        execKey: 'betExecSix',
        getIndex: sixIndex,
        getOthers: null, // Своя логика входа (2 любых шестерки → ставим на оставшиеся 4)
        getTargetNode: getSixNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    label(idx) {
      const a = idx * 6 + 1;
      const b = a + 5;
      return `${a}-${b}`;
    }

    /**
     * Правило входа:
     * Берём последние triggerStreak НЕ нулевых спинов и смотрим индексы шестерок.
     * Если в них ровно 2 уникальные шестерки, входим: target = остальные 4 шестерки.
     */
    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const ix = this.getIndex(n);
      const { spinLogs = [] } = await this.sget({ spinLogs: [] });

      // ====== IDLE → вооружение по правилу "2 любых шестерки" ======
      if (exec.phase === 'idle') {
        const { triggerStreak, steps } = await this.loadCfg();

        const seq = [];
        for (
          let i = spinLogs.length - 1;
          i >= 0 && seq.length < triggerStreak;
          i--
        ) {
          const si = this.getIndex(spinLogs[i].n);
          if (si !== -1) seq.push(si);
        }

        if (seq.length >= triggerStreak) {
          const set = new Set(seq);
          if (set.size === 2) {
            const target = othersOfTwo(set); // 4 шестерки
            const next = {
              ...exec,
              phase: 'armed',
              target,
              step: 1,
              armedAt: Date.now(),
            };
            await this.setExec(
              next,
              `ВХОД → шестерки ${target
                .map((x) => this.label(x))
                .join(', ')} | шаг 1`
            );

            const ok = await BET.tryPlace({
              step: 1,
              targets: target,
              steps,
              getTargetNode: (i) => this.getTargetNode(i),
              mutex: this.mutex,
            });

            if (ok) {
              const chips = await BET.loadGlobalChips();
              const amount =
                BET.perTargetAmountForStep(
                  1,
                  steps,
                  chips.chipValues
                ) * target.length;
              try {
                const { betLogs = [] } = await this.sget({
                  betLogs: [],
                });
                betLogs.push({
                  t: Date.now(),
                  type: 'placed',
                  market: 'sixlines',
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
              'bettingStatusSix',
              ok ? 'armed' : 'error',
              ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
            );
          }
        }
        return;
      }

      // ====== ARMED ======
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
            `ВЫИГРЫШ на шестерке ${this.label(ix)} → сброс`
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
            `ПРОИГРЫШ → сразу ставим шаг ${step} на шестерки ${t
              .map((x) => this.label(x))
              .join(', ')}`
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
                market: 'sixlines',
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
            'bettingStatusSix',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        // Ожидание, как в дюжинах/рядах
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

      // ====== WAITING → ставим, когда попал один из target ======
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
            `ГОТОВ шаг ${step} на шестерки ${t
              .map((x) => this.label(x))
              .join(', ')}`
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
                market: 'sixlines',
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
            'bettingStatusSix',
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

  window.__STRAT_SIXLINES__ = new SixlinesStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_SIXLINES__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_SIXLINES__.init(),
      { once: true }
    );
})();
