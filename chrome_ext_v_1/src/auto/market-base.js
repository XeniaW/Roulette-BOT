(() => {
  class MarketBase {
    constructor(opts) {
      this.marketKey = opts.marketKey; // 'dozens' | 'rows' | 'six'
      this.cfgKey = opts.cfgKey; // per-market cfg
      this.enabledKey = opts.enabledKey;
      this.statusKey = opts.statusKey;
      this.execKey = opts.execKey;
      this.getIndex = opts.getIndex; // (n)=> number index (>=0) | -1
      this.getOthers = opts.getOthers; // (i or set)=>[...]
      this.getTargetNode = opts.getTargetNode; // (i)=>HTMLElement
      this.defaultCfg = opts.defaultCfg; // { triggerStreak, steps, autoContinue, includeZero }

      this.mutex = new BET.Mutex();
      this._inited = false;
      this.destroyed = false;
    }

    async sget(defs) {
      return BET.sget(defs);
    }

    async sset(obj) {
      return BET.sset(obj);
    }

    async getTrackedContext() {
      if (typeof BET.getTrackedContext === 'function') {
        return BET.getTrackedContext();
      }
      return { tableId: '', selectedId: '' };
    }

    async getTableId() {
      const ctx = await this.getTrackedContext();
      return String(ctx?.tableId || '').trim();
    }

    async getRuntimeState() {
      const {
        spinLogs = [],
        currentBalance = { value: null, t: 0 },
        streakState = null,
        trackerStatus = { state: 'off', message: '' },
      } = await this.sget({
        spinLogs: [],
        currentBalance: { value: null, t: 0 },
        streakState: null,
        trackerStatus: { state: 'off', message: '' },
      });

      return {
        spinLogs: Array.isArray(spinLogs) ? spinLogs : [],
        currentBalance:
          currentBalance && typeof currentBalance === 'object'
            ? currentBalance
            : { value: null, t: 0 },
        streakState:
          streakState && typeof streakState === 'object'
            ? streakState
            : null,
        trackerStatus:
          trackerStatus && typeof trackerStatus === 'object'
            ? trackerStatus
            : { state: 'off', message: '' },
      };
    }

    async getSpinLogs() {
      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      return Array.isArray(spinLogs) ? spinLogs : [];
    }

    async getCurrentBalance() {
      const { currentBalance = { value: null, t: 0 } } =
        await this.sget({
          currentBalance: { value: null, t: 0 },
        });
      return currentBalance;
    }

    async appendBetLog(entry) {
      if (typeof BET.appendBetLog === 'function') {
        return BET.appendBetLog(entry);
      }

      try {
        const { betLogs = [] } = await this.sget({ betLogs: [] });
        const next = Array.isArray(betLogs) ? betLogs.slice() : [];
        next.push(entry);
        if (next.length > 2000) {
          next.splice(0, next.length - 2000);
        }
        await this.sset({ betLogs: next });
      } catch {}
    }

    // ---- per-market config
    sanitizeCfg(raw) {
      const src = raw || {};
      const triggerStreak = Math.max(
        2,
        Math.floor(
          Number(
            src.triggerStreak ?? this.defaultCfg.triggerStreak ?? 2,
          ),
        ),
      );
      const autoContinue = !!(
        src.autoContinue ??
        this.defaultCfg.autoContinue ??
        false
      );

      // NEW: includeZero флаг
      const includeZero = !!(
        src.includeZero ??
        this.defaultCfg.includeZero ??
        false
      );

      let steps = Array.isArray(src.steps) ? src.steps : [];
      steps = steps
        .map((st) => (Array.isArray(st) ? st : []))
        .map((st) =>
          st
            .map((it) => ({
              chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
              times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
            }))
            .filter(
              (it) =>
                Number.isFinite(it.chip) && Number.isFinite(it.times),
            ),
        )
        .filter((st) => st.length);
      if (!steps.length)
        steps = JSON.parse(JSON.stringify(this.defaultCfg.steps));

      return { triggerStreak, steps, autoContinue, includeZero };
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

    // ---- exec ----
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
      if (statusMsg) {
        BET.setBetStatus(
          this.statusKey,
          next.enabled ? next.phase : 'off',
          statusMsg,
        );
      }
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

    attachStorageListener() {
      /* override in strategies */
    }

    async init() {
      if (this._inited || this.destroyed) return;
      this._inited = true;

      await this.loadEnabled();
      this.attachStorageListener();
      BET.setBetStatus(this.statusKey, 'idle', 'Готово');

      window.addEventListener(
        'beforeunload',
        () => {
          this.destroyed = true;
        },
        { once: true },
      );
    }
  }

  window.MarketBase = MarketBase;
})();
