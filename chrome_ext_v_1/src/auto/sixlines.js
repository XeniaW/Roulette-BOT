// src/auto/sixlines.js
(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 8, // по ТЗ по умолчанию 8
    autoContinue: false,
    includeZero: false, // NEW: 0 входит в стрик двух шестерок, если включено
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

  // sixIndex: 1..36 -> 0..5, 0 -> -1
  function sixIndex(n) {
    if (n === 0) return -1; // 0 обрабатываем отдельно через includeZero
    if (n < 1 || n > 36) return -1;
    return Math.floor((n - 1) / 6);
  }

  // выбрать оставшиеся 4 шестерки при известной паре
  function otherFour(set2) {
    const used = Array.from(set2);
    return [0, 1, 2, 3, 4, 5].filter((x) => !used.includes(x));
  }

  // Узел кнопки шестерки. НЕКОТОРЫЕ столы используют шаг 2 в id (600,602,...),
  // другие — подряд (600,601,...). Пробуем оба варианта.
  function getSixNode(idx) {
    const evenId = `#index-${600 + idx * 2}`;
    const seqId = `#index-${600 + idx}`;
    return (
      document.querySelector(evenId) || document.querySelector(seqId)
    );
  }

  // Проверка окна по ТЗ:
  // С хвоста берём подряд числа, где допускаются только нули (если includeZero)
  // и числа из НЕ БОЛЕЕ ЧЕМ ДВУХ шестерок. Как только встретили третью — стоп.
  // Требуем, чтобы в окне было РОВНО две шестерки (set.size === 2) и длина окна >= need.
  function checkTriggerTwoSixes(spinLogs, need, includeZero) {
    let cnt = 0;
    const set = new Set(); // собираем индексы 0..5
    for (let i = spinLogs.length - 1; i >= 0 && cnt < need; i--) {
      const n = Number(spinLogs[i]?.n);
      if (!Number.isFinite(n)) break;
      if (n === 0) {
        if (includeZero) {
          cnt++;
          continue;
        } else break;
      }
      const si = sixIndex(n);
      if (si === -1) break;
      if (!set.has(si)) {
        if (set.size === 2) break; // третья шестерка ломает окно
        set.add(si);
      }
      cnt++;
    }
    return cnt >= need && set.size === 2 ? set : null;
  }

  class SixLinesStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'six',
        cfgKey: 'abSixConfig',
        enabledKey: 'autoBettingSixEnabled',
        statusKey: 'bettingStatusSix',
        execKey: 'betExecSix',
        getIndex: sixIndex,
        getOthers: otherFour, // для six передаём Set из двух
        getTargetNode: getSixNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    label(idx) {
      // 1..6 по UI
      return idx + 1;
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const ix = this.getIndex(n);

      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        // проверяем окно: 2 любые шестерки (+ноль при включенном флаге)
        const pairSet = checkTriggerTwoSixes(
          spinLogs,
          triggerStreak,
          includeZero
        );

        if (pairSet) {
          const targets = this.getOthers(pairSet); // 4 остальные
          const next = {
            ...exec,
            phase: 'armed',
            target: targets,
            step: 1,
            armedAt: Date.now(),
          };
          await this.setExec(
            next,
            `ВХОД → шестерки ${targets
              .map((x) => this.label(x))
              .join(',')} | шаг 1`
          );

          const ok = await BET.tryPlace({
            step: 1,
            targets,
            steps,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
          });
          if (ok) {
            const chips = await BET.loadGlobalChips();
            const amount =
              BET.perTargetAmountForStep(1, steps, chips.chipValues) *
              targets.length;
            try {
              const { betLogs = [] } = await this.sget({
                betLogs: [],
              });
              betLogs.push({
                t: Date.now(),
                type: 'placed',
                market: 'six',
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
                market: 'six',
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

        // режим ожидания
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
            `ГОТОВ шаг ${step} на шестерки ${t
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
                market: 'six',
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

  window.__STRAT_SIX__ = new SixLinesStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_SIX__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_SIX__.init(),
      { once: true }
    );
})();
