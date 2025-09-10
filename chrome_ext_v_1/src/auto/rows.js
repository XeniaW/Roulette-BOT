(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2,
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
  // индексация: 0→#index-702, 1→#index-701, 2→#index-700
  const rowButtons = [
    $('#index-702'),
    $('#index-701'),
    $('#index-700'),
  ];

  function rowIndex(n) {
    if (n === 0) return -1;
    const r = n % 3;
    if (r === 1) return 0;
    if (r === 2) return 1;
    if (r === 0) return 2;
    return -1;
  }
  function otherTwo(skip) {
    return [0, 1, 2].filter((i) => i !== skip);
  }
  function getRowNode(idx) {
    if (idx === 0)
      return rowButtons[0] || document.querySelector('#index-702');
    if (idx === 1)
      return rowButtons[1] || document.querySelector('#index-701');
    return rowButtons[2] || document.querySelector('#index-700');
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
      return idx + 1;
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const ix = this.getIndex(n);

      if (exec.phase === 'idle') {
        const { triggerStreak, steps } = await this.loadCfg();
        let last = [];
        for (
          let i = spinLogs.length - 1;
          i >= 0 && last.length < triggerStreak;
          i--
        ) {
          const ri = this.getIndex(spinLogs[i].n);
          if (ri !== -1) last.push(ri);
        }
        const allSame =
          last.length >= triggerStreak &&
          last.every((z) => z === last[0]);
        if (allSame) {
          const t = this.getOthers(last[0]);
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
                market: 'rows',
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
            'bettingStatusRows',
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
            `ВЫИГРЫШ на ряду ${this.label(ix)} → сброс`
          );
          return;
        }
        const { steps } = await this.loadCfg();
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
          const step = exec.step,
            t = exec.target;
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
            `ГОТОВ шаг ${step} на ряды ${t
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
