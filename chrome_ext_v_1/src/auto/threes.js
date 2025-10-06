// src/auto/threes.js
(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2, // длина стрика по дюжине для входа
    autoContinue: false, // true — сразу ставим следующий шаг; false — ждём сигнала
    includeZero: false, // 0 считается продолжением текущей дюжины
    steps: [
      // ПРОГРЕССИЯ на ОДИН стрит; за спин ставим на 8 стритов
      [{ chip: 1, times: 1 }],
      [{ chip: 1, times: 3 }],
      [{ chip: 2, times: 2 }],
      [
        { chip: 3, times: 1 },
        { chip: 2, times: 1 },
      ],
    ],
  });

  // ЖЁСТКО: индексы 0..11 → селекторы index-500..index-511
  const STREET_SEL = Array.from(
    { length: 12 },
    (_, i) => `#index-${500 + i}`
  );

  const $ = (sel) => document.querySelector(sel);

  function getStreetNode(idx) {
    const sel = STREET_SEL[idx];
    const node = $(sel);
    if (!node)
      console.warn(
        '[streets8] Не найден узел idx=',
        idx,
        'sel=',
        sel
      );
    return node;
  }

  // Индекс стрита по числу: 1–3 -> 0, 4–6 -> 1, …, 34–36 -> 11; 0 -> -1
  function streetIndex(n) {
    if (n === 0) return -1;
    if (n < 1 || n > 36) return -1;
    return Math.ceil(n / 3) - 1; // 0..11
  }

  // Индекс дюжины по числу: 1–12 -> 0, 13–24 -> 1, 25–36 -> 2; 0 -> -1
  function dozenIndex(n) {
    if (n === 0) return -1;
    if (n <= 12) return 0;
    if (n <= 24) return 1;
    if (n <= 36) return 2;
    return -1;
  }

  // Дюжина по индексу стрита (0..11) → 0..2
  const dozenOfStreet = (streetIdx) => Math.floor(streetIdx / 4);

  // Стрик по ДЮЖИНЕ: хвост need событий все в одной и той же дюжине.
  // includeZero=true → 0 считается продолжением уже определённой дюжины; иначе — рвёт окно.
  function checkTriggerSameDozenByStreets(
    spinLogs,
    need,
    includeZero
  ) {
    let cnt = 0;
    let refDozen = null; // 0..2
    let seenNonZero = false;
    for (let i = spinLogs.length - 1; i >= 0 && cnt < need; i--) {
      const n = spinLogs[i]?.n;
      if (!Number.isFinite(Number(n))) break;
      const num = Number(n);

      if (num === 0) {
        if (includeZero && refDozen != null) {
          cnt++;
          continue;
        }
        break;
      }

      const dz = dozenIndex(num);
      if (dz === -1) break;
      if (refDozen == null) refDozen = dz;
      else if (dz !== refDozen) break;

      seenNonZero = true;
      cnt++;
    }
    return seenNonZero && cnt >= need ? refDozen : null;
  }

  // Цели для входа: ВСЕ 8 стритов вне дюжины triggerDozen
  function targetStreetsForDozen(triggerDozen) {
    const res = [];
    for (let s = 0; s < 12; s++) {
      if (dozenOfStreet(s) !== triggerDozen) res.push(s);
    }
    if (res.length !== 8) {
      console.error(
        '[streets8] Ожидали 8 стритов-целей, получили',
        res.length,
        res
      );
    }
    return res;
  }

  class Streets8Strategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'streets8',
        cfgKey: 'abStreets8Config',
        enabledKey: 'autoBettingStreets8Enabled',
        statusKey: 'bettingStatusStreets8',
        execKey: 'betExecStreets8',
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
    labelDozen(dz) {
      return dz === 0
        ? 'дюжина 1–12'
        : dz === 1
        ? 'дюжина 13–24'
        : 'дюжина 25–36';
    }

    async placeStep(step, exec, steps) {
      const triggerDozen = exec.triggerDozen;
      if (
        !(
          triggerDozen === 0 ||
          triggerDozen === 1 ||
          triggerDozen === 2
        )
      ) {
        console.error(
          '[streets8] Некорректный triggerDozen при постановке',
          exec
        );
        return false;
      }
      const targets = targetStreetsForDozen(triggerDozen);
      exec.target = targets.slice();

      const ok = await BET.tryPlace({
        step,
        targets,
        steps,
        getTargetNode: (i) => this.getTargetNode(i),
        mutex: this.mutex,
      });

      if (ok) {
        const chips = await BET.loadGlobalChips();
        const amountPer = BET.perTargetAmountForStep(
          step,
          steps,
          chips.chipValues
        );
        const amount = amountPer * targets.length; // 8 * per-target
        try {
          const { betLogs = [] } = await this.sget({ betLogs: [] });
          betLogs.push({
            t: Date.now(),
            type: 'placed',
            market: 'streets8',
            phase: 'armed',
            message: `Шаг ${step} на ${targets
              .map((x) => this.labelStreet(x))
              .join(', ')}`,
            amount,
            step,
            debug: { triggerDozen, targets },
          });
          if (betLogs.length > 5000)
            betLogs.splice(0, betLogs.length - 5000);
          await this.sset({ betLogs });
        } catch {}
      }

      BET.setBetStatus(
        'bettingStatusStreets8',
        ok ? 'armed' : 'error',
        ok
          ? `Шаг ${step} поставлен`
          : `Не удалось поставить шаг ${step}`
      );
      return ok;
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      // Актуальные логи + текущий спин, если отсутствует
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

      const streetIx = this.getIndex(n); // -1 для нуля

      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        const refDozen = checkTriggerSameDozenByStreets(
          spinLogs,
          triggerStreak,
          includeZero
        );

        if (refDozen != null) {
          const next = {
            ...exec,
            phase: 'armed',
            triggerDozen: refDozen, // фиксируем дюжину стрика
            target: targetStreetsForDozen(refDozen), // 8 стритов вне неё
            step: 1,
            armedAt: Date.now(),
          };

          await this.setExec(
            next,
            `ВХОД → ПРОТИВ ${this.labelDozen(
              refDozen
            )} | цели: ${next.target
              .map((x) => this.labelStreet(x))
              .join(', ')} | шаг 1`
          );

          await this.placeStep(1, next, steps);
        }
        return;
      }

      if (exec.phase === 'armed') {
        const { steps, autoContinue } = await this.loadCfg();
        const targets = targetStreetsForDozen(
          exec.triggerDozen ?? -99
        );

        const win = streetIx !== -1 && targets.includes(streetIx);
        if (win) {
          const next = {
            ...exec,
            phase: 'idle',
            target: null,
            triggerDozen: null,
            step: 1,
            armedAt: 0,
          };
          await this.setExec(
            next,
            `ВЫИГРЫШ на ${this.labelStreet(streetIx)} → сброс`
          );
          return;
        }

        const lastStep = Math.max(1, steps.length);
        if (exec.step >= lastStep) {
          const reset = {
            ...exec,
            phase: 'idle',
            target: null,
            triggerDozen: null,
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
          const next = {
            ...exec,
            phase: 'armed',
            step,
            armedAt: Date.now(),
          };
          next.target = targets.slice();
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу шаг ${step} против ${this.labelDozen(
              next.triggerDozen
            )} (цели: ${next.target
              .map((x) => this.labelStreet(x))
              .join(', ')})`
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
        const targets = targetStreetsForDozen(
          exec.triggerDozen ?? -99
        );

        if (streetIx !== -1 && targets.includes(streetIx)) {
          const step = exec.step;
          const next = {
            ...exec,
            phase: 'armed',
            step,
            armedAt: Date.now(),
          };
          next.target = targets.slice();
          await this.setExec(
            next,
            `ГОТОВ шаг ${step} против ${this.labelDozen(
              exec.triggerDozen
            )} (цели: ${next.target
              .map((x) => this.labelStreet(x))
              .join(', ')})`
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

  window.__STRAT_STREETS8__ = new Streets8Strategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_STREETS8__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_STREETS8__.init(),
      { once: true }
    );
})();
