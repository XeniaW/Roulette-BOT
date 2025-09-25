// src/auto/rows.js
(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2,
    autoContinue: false,
    includeZero: false, // 0 считается как текущий ряд, если включено (внутри уже идущей серии)
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
  // ПОРЯДОК НЕ МЕНЯЕМ:
  // 700 -> ряд 1, 701 -> ряд 2, 702 -> ряд 3
  const rowButtons = [
    $('#index-700'), // row 1 (n % 3 == 1)
    $('#index-701'), // row 2 (n % 3 == 2)
    $('#index-702'), // row 3 (n % 3 == 0)
  ];

  // индекс ряда по номеру
  function rowIndex(n) {
    if (n === 0) return -1; // 0 не имеет собственного ряда
    const r = n % 3;
    if (r === 1) return 0; // ряд 1  -> index-700
    if (r === 2) return 1; // ряд 2  -> index-701
    if (r === 0) return 2; // ряд 3  -> index-702
    return -1;
  }

  function otherTwo(skip) {
    // строго исключаем исходный ряд
    return [0, 1, 2].filter((d) => d !== skip);
  }

  function getRowNode(idx) {
    const sel =
      idx === 0
        ? '#index-700'
        : idx === 1
        ? '#index-701'
        : '#index-702';
    const node = rowButtons[idx] || document.querySelector(sel);
    if (!node) {
      console.warn(
        '[rows] Не найден узел ряда idx=',
        idx,
        'sel=',
        sel
      );
    }
    return node;
  }

  /**
   * Ищем серию одного и того же ряда с конца лога.
   * includeZero: 0 засчитывается ТОЛЬКО как продолжение уже найденного ряда.
   * Если серия начинается с нулей — они не формируют ряд.
   * Возвращает индекс ряда (0..2) или null.
   */
  async function checkTriggerSameRow(
    spinLogs,
    need,
    includeZero,
    getIndex
  ) {
    let cnt = 0;
    let ref = null;
    for (let i = spinLogs.length - 1; i >= 0 && cnt < need; i--) {
      const n = spinLogs[i]?.n;

      if (n === 0) {
        if (includeZero && ref != null) {
          // ноль как продолжение уже определённого ряда
          cnt++;
          continue;
        } else {
          break; // ноль прерывает серию до определения ref
        }
      }

      const ri = getIndex(n);
      if (ri === -1) break;

      if (ref == null) ref = ri;
      if (ri !== ref) break;

      cnt++;
    }
    return cnt >= need && ref != null ? ref : null;
  }

  class RowsStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'rows',
        cfgKey: 'abRowsConfig',
        enabledKey: 'autoBettingRowsEnabled',
        statusKey: 'bettingStatusRows',
        execKey: 'betExecRows',
        getIndex: rowIndex,
        getOthers: otherTwo,
        getTargetNode: getRowNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    label(idx) {
      return idx === 0 ? 'ряд 1' : idx === 1 ? 'ряд 2' : 'ряд 3';
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const ix = this.getIndex(n);

      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        const ref = await checkTriggerSameRow(
          spinLogs,
          triggerStreak,
          includeZero,
          this.getIndex
        );

        if (ref != null) {
          // цели — строго две ПРОТИВОПОЛОЖНЫЕ (не включая ref)
          const t = this.getOthers(ref);
          if (t.length !== 2 || t.includes(ref)) {
            console.error(
              '[rows] Неверная цель после вычисления серии',
              { ref, t }
            );
            return;
          }

          const next = {
            ...exec,
            phase: 'armed',
            target: t,
            step: 1,
            armedAt: Date.now(),
          };
          await this.setExec(
            next,
            `ВХОД → ряды ${t
              .map((x) => this.label(x))
              .join(', ')} | шаг 1 (триггер: ${this.label(ref)})`
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
                market: 'rows',
                phase: 'armed',
                message: `Шаг 1 поставлен на ${t
                  .map((x) => this.label(x))
                  .join(', ')}`,
                amount,
                step: 1,
                debug: { triggerRow: ref, targets: t },
              });
              if (betLogs.length > 2000)
                betLogs.splice(0, betLogs.length - 2000);
              await this.sset({ betLogs });
            } catch {}
          }

          BET.setBetStatus(
            'bettingStatusRows',
            ok ? 'armed' : 'error',
            ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
          );
        }
        return;
      }

      if (exec.phase === 'armed') {
        // победа — если выпал один из целевых рядов (0 всегда мимо)
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
            `ВЫИГРЫШ на ряду ${this.label(ix)} → сброс`
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
          // страховка: целевые должны оставаться двумя другими рядами
          if (
            t.length !== 2 ||
            (t.includes(0) && t.includes(1) && t.includes(2))
          ) {
            console.error(
              '[rows] Нарушена целевая пара перед autoContinue',
              { t }
            );
            return;
          }

          const next = {
            ...exec,
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
          };
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу ставим шаг ${step} на ряды ${t
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
                market: 'rows',
                phase: 'armed',
                message: `Шаг ${step} поставлен (auto) на ${t
                  .map((x) => this.label(x))
                  .join(', ')}`,
                amount,
                step,
              });
              if (betLogs.length > 2000)
                betLogs.splice(0, betLogs.length - 2000);
              await this.sset({ betLogs });
            } catch {}
          }

          BET.setBetStatus(
            'bettingStatusRows',
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

          // страховка на всякий случай
          if (t.length !== 2) {
            console.error(
              '[rows] Ожидание: неверное количество целей',
              { t }
            );
            return;
          }

          const next = {
            ...exec,
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
          };
          await this.setExec(
            next,
            `ГОТОВ шаг ${step} на ряды ${t
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
                market: 'rows',
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
            'bettingStatusRows',
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

  window.__STRAT_ROWS__ = new RowsStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_ROWS__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_ROWS__.init(),
      { once: true }
    );
})();
