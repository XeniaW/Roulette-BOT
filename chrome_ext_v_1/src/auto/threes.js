// src/auto/threes.js
(() => {
  const DEFAULT_CFG = Object.freeze({
    // triggerStreak (K): требуемая длина окна из хвоста, в котором встречается ≤4 уникальных стрита
    triggerStreak: 4,
    autoContinue: false, // после проигрыша сразу ставим следующий шаг
    includeZero: false, // если true — 0 НЕ рвёт окно и засчитывается в длину
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

  function streetIndex(n) {
    if (n === 0) return -1;
    if (n < 1 || n > 36) return -1;
    return Math.ceil(n / 3) - 1; // 0..11
  }

  // Узел кнопки: несколько вариантов селекторов
  function getStreetNode(idx) {
    const seq = document.querySelector(`#index-${500 + idx}`); // 500..511
    if (seq) return seq;
    const even = document.querySelector(`#index-${500 + idx * 2}`); // 500,502,..,522
    if (even) return even;
    const dataE2E = document.querySelector(
      `[data-e2e="street-${idx}"]`
    );
    if (dataE2E) return dataE2E;
    console.warn('[threes] Не найден узел кнопки для idx=', idx);
    return null;
  }

  // === ОКНО ТРИГГЕРА ТРЁШЕК ===
  // На вход подаём ТОЛЬКО "хвост после якоря".
  // Считаем длину окна len, в котором встречается НЕ БОЛЕЕ 4 стрита.
  // includeZero=true → 0 увеличивает len, НЕ добавляет новый стрит; false → 0 обрывает окно.
  function threesCoverageWindow(spinsTail, K, includeZero) {
    let len = 0;
    const streets = new Set();
    for (let i = spinsTail.length - 1; i >= 0; i--) {
      const n = Number(spinsTail[i]?.n);
      if (!Number.isFinite(n)) break;

      if (n === 0) {
        if (!includeZero) break;
        len++;
        if (len >= K) break;
        continue;
      }

      const si = streetIndex(n);
      if (si === -1) break;

      if (!streets.has(si)) {
        if (streets.size === 4) break; // пятая тройка ломает окно
        streets.add(si);
      }
      len++;
      if (len >= K) break;
    }
    return { len, streets };
  }

  // Цели: все стриты, КРОМЕ покрытых (их ≤4). При size=4 → 8 целей.
  function targetsFromCoveredStreets(coveredSet) {
    const skip = new Set(coveredSet || []);
    const res = [];
    for (let s = 0; s < 12; s++) if (!skip.has(s)) res.push(s);
    return res;
  }

  async function signalResetDotsThrees() {
    try {
      await chrome.storage.local.set({ threesDotsReset: Date.now() });
    } catch {}
  }

  class ThreesStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'threes',
        cfgKey: 'abThreesConfig',
        enabledKey: 'autoBettingThreesEnabled',
        statusKey: 'bettingStatusThrees',
        execKey: 'betExecThrees',
        getIndex: streetIndex,
        getOthers: null,
        getTargetNode: getStreetNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    labelStreet(idx) {
      const a = idx * 3 + 1;
      const b = a + 2;
      return `стрит ${a}-${b}`;
    }

    // Обновить якорь на «текущую длину логов», чтобы новый стрик считался только после события
    async setAnchorToNow(exec, spinLogsLen, msg) {
      const next = { ...exec, anchorFrom: Math.max(0, spinLogsLen) };
      await this.setExec(next, msg || `anchor=${next.anchorFrom}`);
      return next;
    }

    // Вход (постановка шага)
    async placeStep(step, exec, steps) {
      const targets = Array.isArray(exec.target) ? exec.target : [];
      const ok = await BET.tryPlace({
        step,
        targets,
        steps,
        getTargetNode: (i) => this.getTargetNode(i),
        mutex: this.mutex,
      });

      if (ok) {
        const chips = await BET.loadGlobalChips();
        const per = BET.perTargetAmountForStep(
          step,
          steps,
          chips.chipValues
        );
        const amount = per * targets.length;
        try {
          const { betLogs = [] } = await this.sget({ betLogs: [] });
          betLogs.push({
            t: Date.now(),
            type: 'placed',
            market: 'threes',
            phase: 'armed',
            message: `Шаг ${step} на ${targets
              .map((x) => this.labelStreet(x))
              .join(', ')}`,
            amount,
            step,
            debug: {
              covered: exec.coveredStreets,
              targets,
              anchorFrom: exec.anchorFrom,
            },
          });
          if (betLogs.length > 5000)
            betLogs.splice(0, betLogs.length - 5000);
          await this.sset({ betLogs });
        } catch {}
      }

      BET.setBetStatus(
        'bettingStatusThrees',
        ok ? 'armed' : 'error',
        ok
          ? `Шаг ${step} поставлен (целей: ${targets.length})`
          : `Не удалось поставить шаг ${step}`
      );
      return ok;
    }

    async tryEntryWithLimit() {
      try {
        const mod = await import('../shared/entry-limit.js');
        if (mod && typeof mod.canEnter === 'function') {
          const ok = await mod.canEnter('threes');
          if (!ok) {
            BET.setBetStatus(
              'bettingStatusThrees',
              'waiting',
              'Лимит входов: пропуск'
            );
            return false;
          }
          if (typeof mod.onEnter === 'function')
            await mod.onEnter('threes');
        }
      } catch {}
      return true;
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const s = await this.sget({ spinLogs: [] });
      const spinLogs = Array.isArray(s.spinLogs)
        ? s.spinLogs.slice()
        : [];
      if (
        !spinLogs.length ||
        spinLogs[spinLogs.length - 1]?.n !== n
      ) {
        spinLogs.push({ n });
      }
      const L = spinLogs.length;
      const si = this.getIndex(n); // -1 для 0

      // ====== ВХОД ======
      if (exec.phase === 'idle') {
        const {
          triggerStreak: K,
          steps,
          includeZero,
        } = await this.loadCfg();
        const wantK = Math.max(1, K | 0);

        // считаем окно ТОЛЬКО по спинам ПОСЛЕ якоря
        const anchor = Math.max(0, exec.anchorFrom | 0);
        const tail = spinLogs.slice(anchor);
        const { len, streets } = threesCoverageWindow(
          tail,
          wantK,
          !!includeZero
        );

        // вход, когда хвост после якоря достиг K и в нём ≤4 уникальных
        if (len >= wantK && streets.size >= 1 && streets.size <= 4) {
          if (!(await this.tryEntryWithLimit())) return;

          const targets = targetsFromCoveredStreets(streets); // size≤4 → целей 12-size, при 4 → 8
          // фиксируем якорь на текущую длину логов — чтобы следующий стрик считался ТОЛЬКО после новых спинов
          let next = { ...exec, anchorFrom: L };

          next = {
            ...next,
            phase: 'armed',
            coveredStreets: Array.from(streets),
            target: targets,
            step: 1,
            armedAt: Date.now(),
          };

          await this.setExec(
            next,
            `ВХОД: покрыты ${Array.from(streets)
              .map((x) => this.labelStreet(x))
              .join(', ')} → цели: ${targets
              .map((x) => this.labelStreet(x))
              .join(', ')} | шаг 1`
          );

          await signalResetDotsThrees(); // сброс лампочек в попапе
          await this.placeStep(1, next, steps);
        }
        return;
      }

      // ====== ИГРА ======
      if (exec.phase === 'armed') {
        const { steps, autoContinue } = await this.loadCfg();
        const targets = (exec.target || []).slice();

        const win = si !== -1 && targets.includes(si);
        if (win) {
          // при выигрыше: сбрасываем состояние и СТАВИМ ЯКОРЬ на текущую длину логов
          let next = {
            ...exec,
            phase: 'idle',
            target: null,
            coveredStreets: null,
            step: 1,
            armedAt: 0,
          };
          next = await this.setAnchorToNow(
            next,
            L,
            `ВЫИГРЫШ на ${this.labelStreet(si)} → сброс (anchor=${L})`
          );
          await signalResetDotsThrees();
          return;
        }

        const lastStep = Math.max(1, steps.length);
        if (exec.step >= lastStep) {
          // серия проиграна: сброс и также обновляем якорь — чтобы не ре-войти на тот же хвост
          let reset = {
            ...exec,
            phase: 'idle',
            target: null,
            coveredStreets: null,
            step: 1,
            armedAt: 0,
          };
          reset = await this.setAnchorToNow(
            reset,
            L,
            `ПРОИГРЫШ на шаге ${lastStep} → сброс (anchor=${L})`
          );
          return;
        }

        if (autoContinue) {
          const step = exec.step + 1;
          const next = {
            ...exec,
            phase: 'armed',
            step,
            armedAt: Date.now(),
            target: targets.slice(),
          };
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу шаг ${step} (целей: ${next.target.length})`
          );
          await this.placeStep(step, next, steps);
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
        const { steps } = await this.loadCfg();
        const targets = (exec.target || []).slice();

        if (si !== -1 && targets.includes(si)) {
          const step = exec.step;
          const next = {
            ...exec,
            phase: 'armed',
            step,
            armedAt: Date.now(),
            target: targets.slice(),
          };
          await this.setExec(
            next,
            `ГОТОВ шаг ${step} (целей: ${next.target.length})`
          );
          await this.placeStep(step, next, steps);
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

  window.__STRAT_THREES__ = new ThreesStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_THREES__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_THREES__.init(),
      { once: true }
    );
})();
