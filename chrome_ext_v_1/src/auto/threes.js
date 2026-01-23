// src/auto/threes.js
import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    // Триггер: в хвосте подряд минимум triggerStreak записей,
    // где участвуют НЕ БОЛЕЕ 4 уникальных стритов.
    // includeZero=true: 0 учитывается в длину, но НЕ добавляет улицу;
    // includeZero=false: 0 рвёт окно.
    triggerStreak: 4,
    autoContinue: false, // false → играем "через одну"
    includeZero: false,
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

  // ✅ увеличенное окно ожидания ставок ТОЛЬКО для threes
  const PLACE_MAX_WAIT_MS = 20000;

  // 1..36 -> 0..11, 0 -> -1
  function streetIndex(n) {
    if (n === 0) return -1;
    if (n < 1 || n > 36) return -1;
    return Math.ceil(n / 3) - 1;
  }

  // Узел кнопки: пробуем несколько раскладок стола
  function getStreetNode(idx) {
    return (
      document.querySelector(`#index-${500 + idx}`) || // 500..511
      document.querySelector(`#index-${500 + idx * 2}`) || // 500,502..,522
      document.querySelector(`[data-e2e="street-${idx}"]`) ||
      null
    );
  }

  function labelStreet(idx) {
    const a = idx * 3 + 1;
    const b = a + 2;
    return `стрит ${a}-${b}`;
  }

  // цели — все 12 минус покрытые
  function targetsFromCovered(coveredSet) {
    const skip = new Set(coveredSet || []);
    const res = [];
    for (let s = 0; s < 12; s++) if (!skip.has(s)) res.push(s);
    return res;
  }

  // сигнал попапу для сброса лампочек
  async function signalResetDots() {
    try {
      await chrome.storage.local.set({ threesDotsReset: Date.now() });
    } catch {}
  }

  /**
   * Проверка окна триггера от хвоста.
   *
   * Условие:
   *  - окно РОВНО последние `need` записей
   *  - covered.size === 4 (РОВНО 4 уникальных стрита)
   *
   * Возвращает { ok, covered, startIdx, cnt }.
   */
  function checkTriggerThrees(spinLogs, need, includeZero) {
    const len = Array.isArray(spinLogs) ? spinLogs.length : 0;

    if (len < need) {
      return { ok: false, covered: null, startIdx: -1, cnt: 0 };
    }

    const startIdx = len - need;
    const covered = new Set(); // 0..11
    let cnt = 0;

    for (let i = startIdx; i < len; i++) {
      const n = Number(spinLogs[i]?.n);
      if (!Number.isFinite(n)) {
        return { ok: false, covered: null, startIdx: -1, cnt: 0 };
      }

      if (n === 0) {
        if (!includeZero) {
          return { ok: false, covered: null, startIdx: -1, cnt: 0 };
        }
        cnt++;
        continue;
      }

      const si = streetIndex(n);
      if (si === -1) {
        return { ok: false, covered: null, startIdx: -1, cnt: 0 };
      }

      if (!covered.has(si)) {
        if (covered.size === 4) {
          return { ok: false, covered: null, startIdx: -1, cnt: 0 };
        }
        covered.add(si);
      }

      cnt++;
    }

    if (cnt === need && covered.size === 4) {
      return { ok: true, covered, startIdx, cnt };
    }

    return { ok: false, covered: null, startIdx: -1, cnt };
  }

  // постановка шага (все ставки threes идут через это, значит окно увеличено везде)
  async function placeStep(step, targets, steps, mutex, getNode) {
    const ok = await BET.tryPlace({
      step,
      targets,
      steps,
      getTargetNode: (i) => getNode(i),
      mutex,
      maxWaitMs: PLACE_MAX_WAIT_MS,
    });

    if (!ok) return { ok: false, amount: 0 };

    const chips = await BET.loadGlobalChips();
    const amount =
      BET.perTargetAmountForStep(step, steps, chips.chipValues) *
      targets.length;

    return { ok: true, amount };
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

    async logPlaced(step, amount, message) {
      try {
        const { betLogs = [] } = await this.sget({ betLogs: [] });
        betLogs.push({
          t: Date.now(),
          type: 'placed',
          market: 'threes',
          phase: 'armed',
          message,
          amount,
          step,
        });
        if (betLogs.length > 2000)
          betLogs.splice(0, betLogs.length - 2000);
        await this.sset({ betLogs });
      } catch {}
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      // вытаскиваем логи и гарантируем наличие текущего спина
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

      const ix = this.getIndex(n);

      // ================== IDLE ==================
      if (!exec.phase || exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();
        const need = Math.max(2, triggerStreak | 0);

        const chk = checkTriggerThrees(spinLogs, need, !!includeZero);

        // ✅ ВОЗВРАЩЕНО: guardCutIndex + idleGuard
        const guardCutIndex =
          Number.isInteger(exec.guardCutIndex) &&
          exec.guardCutIndex >= 0
            ? exec.guardCutIndex
            : -1;
        const idleGuard = !!exec.idleGuard;

        // guard: не даём сразу же перезаходить в то же окно
        if (idleGuard) {
          if (chk.ok && chk.startIdx < guardCutIndex) {
            BET.setBetStatus(
              this.statusKey,
              'idle',
              'Ожидание: требуется разрыв окна перед новым входом'
            );
            return;
          }
          const cleared = {
            ...exec,
            idleGuard: false,
            guardCutIndex: -1,
          };
          await this.setExec(
            cleared,
            'Окно разрушено/сдвинуто → guard снят'
          );
        }

        if (chk.ok) {
          const gateOk = await entryGateFor(
            'threes',
            'autoBettingThreesEnabled',
            'bettingStatusThrees',
            { execKey: 'betExecThrees' }
          );
          if (!gateOk) return;

          const targets = targetsFromCovered(chk.covered);
          const next = {
            ...exec,
            phase: 'armed',
            target: targets,
            step: 1,
            armedAt: Date.now(),
            idleGuard: false,
            guardCutIndex: -1,

            // ✅ мини-баг фикс: одно поле
            waitSkipped: false,
            waitStep: 0,
          };

          await this.setExec(
            next,
            `ВХОД → цели: ${targets
              .map(labelStreet)
              .join(', ')} | шаг 1`
          );

          const res = await placeStep(
            1,
            targets,
            steps,
            this.mutex,
            (i) => this.getTargetNode(i)
          );
          if (res.ok)
            await this.logPlaced(1, res.amount, 'Шаг 1 поставлен');

          BET.setBetStatus(
            this.statusKey,
            res.ok ? 'armed' : 'error',
            res.ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
          );
        }
        return;
      }

      // ================== ARMED ==================
      if (exec.phase === 'armed') {
        const isWin = ix !== -1 && exec.target?.includes(ix);

        if (isWin) {
          const reset = {
            ...exec,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
            idleGuard: true,
            guardCutIndex: spinLogs.length, // новый вход только по окну после этой точки

            // ✅ мини-баг фикс: одно поле
            waitSkipped: false,
            waitStep: 0,
          };
          await this.setExec(
            reset,
            `ВЫИГРЫШ на ${labelStreet(ix)} → сброс, ждём новый стрик`
          );
          await signalResetDots();
          BET.setBetStatus(
            this.statusKey,
            'idle',
            'ВЫИГРЫШ → ждём новый стрик'
          );
          return;
        }

        const { steps, autoContinue } = await this.loadCfg();
        const lastStep = Math.max(1, steps.length);

        // слив на последнем шаге → полный сброс + guard
        if (exec.step >= lastStep) {
          const reset = {
            ...exec,
            phase: 'idle',
            target: null,
            step: 1,
            armedAt: 0,
            idleGuard: true,
            guardCutIndex: spinLogs.length,

            // ✅ мини-баг фикс: одно поле
            waitSkipped: false,
            waitStep: 0,
          };
          await this.setExec(
            reset,
            `ПРОИГРЫШ на шаге ${lastStep} → сброс, ждём новый стрик`
          );
          await signalResetDots();
          BET.setBetStatus(
            this.statusKey,
            'idle',
            `ПРОИГРЫШ на шаге ${lastStep} → ждём новый стрик`
          );
          return;
        }

        // ===== режим "ставки подряд" =====
        if (autoContinue) {
          const step = exec.step + 1;
          const t = exec.target?.slice() || [];
          const next = {
            ...exec,
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),

            // ✅ мини-баг фикс: одно поле
            waitSkipped: false,
            waitStep: 0,
          };
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу ставим шаг ${step} на ${t
              .map(labelStreet)
              .join(', ')}`
          );

          const res = await placeStep(
            step,
            t,
            steps,
            this.mutex,
            (i) => this.getTargetNode(i)
          );

          if (res.ok)
            await this.logPlaced(
              step,
              res.amount,
              `Шаг ${step} поставлен (auto)`
            );

          BET.setBetStatus(
            this.statusKey,
            res.ok ? 'armed' : 'error',
            res.ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        // ===== режим "через одну" =====
        const next = {
          ...exec,
          phase: 'waiting',
          waitStep: exec.step + 1,
          // ✅ мини-баг фикс: одно поле
          waitSkipped: false,
        };

        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${next.waitStep} через один`
        );
        BET.setBetStatus(
          this.statusKey,
          'waiting',
          `ПРОИГРЫШ → пропускаем 1 спин; готовим шаг ${next.waitStep}`
        );
        return;
      }

      // ================== WAITING ("через одну") ==================
      if (exec.phase === 'waiting') {
        const { steps } = await this.loadCfg();
        const t = exec.target?.slice() || [];
        const step = exec.waitStep;

        if (!exec.waitSkipped) {
          await this.setExec(
            {
              ...exec,
              waitSkipped: true,
            },
            `Пропущен 1 спин → сейчас ставим шаг ${step}`
          );

          const after = {
            ...exec,
            phase: 'armed',
            step,
            waitSkipped: false,
            waitStep: 0,
            armedAt: Date.now(),
          };

          await this.setExec(
            after,
            `ШАГ ${step} (через одну) на ${t
              .map(labelStreet)
              .join(', ')}`
          );

          const res = await placeStep(
            step,
            t,
            steps,
            this.mutex,
            (i) => this.getTargetNode(i)
          );

          if (res.ok) {
            await this.logPlaced(
              step,
              res.amount,
              `Шаг ${step} поставлен (через одну)`
            );
          }

          BET.setBetStatus(
            this.statusKey,
            res.ok ? 'armed' : 'error',
            res.ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );

          return;
        }

        return;
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
      {
        once: true,
      }
    );
})();
