(() => {
  class MarketBase {
    constructor(opts) {
      this.marketKey = opts.marketKey; // 'dozens' | 'rows'
      this.cfgKey = opts.cfgKey; // 'abDozensConfig' | 'abRowsConfig'
      this.enabledKey = opts.enabledKey; // 'autoBettingDozensEnabled' | 'autoBettingRowsEnabled'
      this.statusKey = opts.statusKey; // 'bettingStatusDozens' | 'bettingStatusRows'
      this.execKey = opts.execKey; // 'betExecDozens' | 'betExecRows'
      this.getIndex = opts.getIndex;
      this.getOthers = opts.getOthers;
      this.getTargetNode = opts.getTargetNode;
      this.defaultCfg = opts.defaultCfg;
      this.mutex = new BET.Mutex();
      this.destroyed = false;
    }

    async sget(defs) {
      return BET.sget(defs);
    }
    async sset(obj) {
      return BET.sset(obj);
    }

    sanitizeCfg(raw) {
      const src = raw || {};
      const tpl =
        typeof src.chipSelectorTemplate === 'string' &&
        src.chipSelectorTemplate.includes('{{value}}')
          ? src.chipSelectorTemplate
          : this.defaultCfg.chipSelectorTemplate;

      let chipValues = Array.isArray(src.chipValues)
        ? src.chipValues
            .map(Number)
            .filter((v) => Number.isFinite(v) && v > 0)
        : [];
      if (!chipValues.length)
        chipValues = [...this.defaultCfg.chipValues];

      const placeButtonSel =
        typeof src.placeButtonSel === 'string' &&
        src.placeButtonSel.trim()
          ? src.placeButtonSel.trim()
          : null;

      const triggerStreak = Math.max(
        2,
        Math.floor(
          Number(
            src.triggerStreak ?? this.defaultCfg.triggerStreak ?? 2
          )
        )
      );

      // normalize steps
      let steps = Array.isArray(src.steps) ? src.steps : [];
      steps = steps
        .map((st) => (Array.isArray(st) ? st : []))
        .map((st) =>
          st
            .map((it) => ({
              chip: Math.max(
                1,
                Math.min(
                  chipValues.length,
                  Math.floor(Number(it?.chip ?? 1))
                )
              ),
              times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
            }))
            .filter(
              (it) =>
                Number.isFinite(it.chip) && Number.isFinite(it.times)
            )
        )
        .filter((st) => st.length);
      if (!steps.length)
        steps = JSON.parse(JSON.stringify(this.defaultCfg.steps));

      return {
        chipSelectorTemplate: tpl,
        chipValues,
        placeButtonSel,
        steps,
        triggerStreak,
      };
    }

    async loadCfg() {
      const { [this.cfgKey]: cfg = this.defaultCfg } =
        await this.sget({ [this.cfgKey]: this.defaultCfg });
      return this.sanitizeCfg(cfg);
    }
    async saveCfg(cfg) {
      const clean = this.sanitizeCfg(cfg);
      await this.sset({ [this.cfgKey]: clean });
      return clean;
    }

    async getExec() {
      const { [this.execKey]: exec = null } = await this.sget({
        [this.execKey]: null,
      });
      return (
        exec || {
          enabled: false,
          phase: 'idle',
          target: null,
          step: 1,
          armedAt: 0,
        }
      );
    }
    async setExec(next, statusMsg = null) {
      await this.sset({ [this.execKey]: next });
      if (statusMsg)
        BET.setBetStatus(
          this.statusKey,
          next.enabled ? next.phase : 'off',
          statusMsg
        );
    }
    async loadEnabled() {
      const { [this.enabledKey]: enabled = false } = await this.sget({
        [this.enabledKey]: false,
      });
      const exec = await this.getExec();
      exec.enabled = !!enabled;
      if (!exec.enabled) {
        exec.phase = 'idle';
        exec.target = null;
        exec.step = 1;
        exec.armedAt = 0;
        await this.setExec(exec, 'Авто-ставки ВЫКЛ');
      } else {
        await this.setExec(exec, 'Авто-ставки ВКЛ');
      }
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
        const { triggerStreak } = await this.loadCfg();
        let last = [];
        for (
          let i = spinLogs.length - 1;
          i >= 0 && last.length < triggerStreak;
          i--
        ) {
          const di = this.getIndex(spinLogs[i].n);
          if (di !== -1) last.push(di);
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
            `ВХОД → цели ${t
              .map((x) => this.label(x))
              .join(',')} | шаг 1`
          );
          const cfgNow = await this.loadCfg();
          const ok = await BET.tryPlace({
            step: 1,
            targets: t,
            cfg: cfgNow,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
          });
          if (ok) {
            const amount =
              BET.perTargetAmountForStep(1, cfgNow) * t.length;
            try {
              const { betLogs = [] } = await this.sget({
                betLogs: [],
              });
              betLogs.push({
                t: Date.now(),
                type: 'placed',
                market: this.marketKey,
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
            this.statusKey,
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
            `ВЫИГРЫШ на ${this.label(ix)} → сброс`
          );
          return;
        }
        const cfg = await this.loadCfg();
        const lastStep = Math.max(1, cfg.steps.length);
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
          const step = exec.step;
          const t = exec.target;
          const next = {
            ...exec,
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
          };
          await this.setExec(
            next,
            `ГОТОВ шаг ${step} на ${t
              .map((x) => this.label(x))
              .join(',')}`
          );
          const cfgNow = await this.loadCfg();
          const ok = await BET.tryPlace({
            step,
            targets: t,
            cfg: cfgNow,
            getTargetNode: (i) => this.getTargetNode(i),
            mutex: this.mutex,
          });
          if (ok) {
            const amount =
              BET.perTargetAmountForStep(step, cfgNow) * t.length;
            try {
              const { betLogs = [] } = await this.sget({
                betLogs: [],
              });
              betLogs.push({
                t: Date.now(),
                type: 'placed',
                market: this.marketKey,
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
            this.statusKey,
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

    async init() {
      await this.loadEnabled();
      this.attachStorageListener();
      BET.setBetStatus(this.statusKey, 'idle', 'Готово');
    }
  }

  window.MarketBase = MarketBase;
})();
