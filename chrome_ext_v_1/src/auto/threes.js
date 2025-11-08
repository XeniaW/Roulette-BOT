// src/auto/threes.js
import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    // Триггер: в хвосте подряд ровно need записей, в которых встречается НЕ БОЛЕЕ 4 уникальных "троек" (стритов).
    // При includeZero=true нули учитываются в длину (но НЕ добавляют новую тройку). При includeZero=false — 0 рвёт окно.
    triggerStreak: 4,
    autoContinue: false,
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

  // 1..36 -> 0..11, 0 -> -1
  function streetIndex(n) {
    if (n === 0) return -1;
    if (n < 1 || n > 36) return -1;
    return Math.ceil(n / 3) - 1;
  }

  // Узел кнопки: разные раскладки столов — пробуем последовательные id и шаг 2, плюс data-e2e
  function getStreetNode(idx) {
    return (
      document.querySelector(`#index-${500 + idx}`) || // 500..511
      document.querySelector(`#index-${500 + idx * 2}`) || // 500,502..,522
      document.querySelector(`[data-e2e="street-${idx}"]`) || // e2e-атрибут
      null
    );
  }

  // Подпись для логов
  function labelStreet(idx) {
    const a = idx * 3 + 1;
    const b = a + 2;
    return `стрит ${a}-${b}`;
  }

  // Дополняем: цели — все 12 минус покрытые
  function targetsFromCovered(coveredSet) {
    const skip = new Set(coveredSet || []);
    const res = [];
    for (let s = 0; s < 12; s++) if (!skip.has(s)) res.push(s);
    return res;
  }

  // Единый сигнал для попапа, чтобы погасить лампы мгновенно
  async function signalResetDots(marketKey) {
    try {
      await chrome.storage.local.set({
        [`${marketKey}DotsReset`]: Date.now(),
      });
    } catch {}
  }

  // Проверка окна триггера для троек:
  // Идём от хвоста, считаем подряд ровно need элементов,
  // допускаем только 0 (если includeZero) и числа не более чем из 4 улиц.
  // Возвращаем Set покрытых улиц (size 1..4), либо null.
  function checkTriggerThrees(spinLogs, need, includeZero) {
    let cnt = 0;
    const set = new Set(); // индексы 0..11
    for (let i = spinLogs.length - 1; i >= 0 && cnt < need; i--) {
      const n = Number(spinLogs[i]?.n);
      if (!Number.isFinite(n)) break;

      if (n === 0) {
        if (!includeZero) break; // 0 рвёт окно
        cnt++; // 0 учитываем в длину, но НЕ добавляет улицу
        continue;
      }

      const si = streetIndex(n);
      if (si === -1) break;

      if (!set.has(si)) {
        if (set.size === 4) break; // пятую улицу не допускаем
        set.add(si);
      }
      cnt++;
    }
    return cnt >= need && set.size >= 1 && set.size <= 4 ? set : null;
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

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });
      const ix = this.getIndex(n);

      // ====== IDLE: ищем вход ======
      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();
        const need = Math.max(2, triggerStreak | 0);

        const covered = checkTriggerThrees(
          spinLogs,
          need,
          !!includeZero
        );
        if (covered) {
          // 🔒 ГЕЙТ ВХОДА ПО ЛИМИТУ
          const gateOk = await entryGateFor(
            'threes',
            'autoBettingThreesEnabled',
            'bettingStatusThrees',
            { execKey: 'betExecThrees' }
          );
          if (!gateOk) return;

          const targets = targetsFromCovered(covered);
          const next = {
            ...exec,
            phase: 'armed',
            target: targets,
            step: 1,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ВХОД → цели: ${targets
              .map(labelStreet)
              .join(', ')} | шаг 1`
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
                market: 'threes',
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
            'bettingStatusThrees',
            ok ? 'armed' : 'error',
            ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
          );
        }
        return;
      }

      // ====== ARMED: проверяем win/loss, двигаем шаг ======
      if (exec.phase === 'armed') {
        const isWin = ix !== -1 && exec.target?.includes(ix);
        if (isWin) {
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
            `ВЫИГРЫШ на ${labelStreet(ix)} → сброс`
          );
          await signalResetDots('threes');
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
          await signalResetDots('threes');
          return;
        }

        if (autoContinue) {
          const step = exec.step + 1;
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
            `ПРОИГРЫШ → сразу ставим шаг ${step} на ${t
              .map(labelStreet)
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
                market: 'threes',
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
            'bettingStatusThrees',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        // === НОВОЕ ПОВЕДЕНИЕ: autoContinue=false → "через один" ===
        const next = {
          ...exec,
          phase: 'cooldown', // пропускаем 1 спин
          step: exec.step + 1, // следующий шаг
          armedAt: 0,
          cooldownSkipped: false, // ещё не отметили пропуск
        };
        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${next.step} через один`
        );
        return;
      }

      // ====== COOLDOWN: пропустить ровно один спин и СРАЗУ ставить (в этом же вызове)
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
          await signalResetDots('threes');
          return;
        }

        if (!exec.cooldownSkipped) {
          const step = exec.step;
          const t = (exec.target || []).slice();
          const mid = { ...exec, cooldownSkipped: true };
          await this.setExec(
            mid,
            `Cooldown: пропустили 1 спин; ставим шаг ${step} (через один)`
          );

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
            `ГОТОВ (через один) шаг ${step} на ${t
              .map(labelStreet)
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
                market: 'threes',
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
            'bettingStatusThrees',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        // Если сюда попали повторно уже после отметки пропуска — восстановим armed и поставим
        const step = exec.step;
        const t = (exec.target || []).slice();
        const rec = {
          ...exec,
          phase: 'armed',
          target: t,
          step,
          armedAt: Date.now(),
          cooldownSkipped: undefined,
        };
        await this.setExec(
          rec,
          `ГОТОВ (восстановление) шаг ${step} на ${t
            .map(labelStreet)
            .join(', ')}`
        );
        const ok = await BET.tryPlace({
          step,
          targets: t,
          steps,
          getTargetNode: (i) => this.getTargetNode(i),
          mutex: this.mutex,
        });
        BET.setBetStatus(
          'bettingStatusThrees',
          ok ? 'armed' : 'error',
          ok
            ? `Шаг ${step} поставлен`
            : `Не удалось поставить шаг ${step}`
        );
        return;
      }

      // ====== WAITING: оставлено для обратной совместимости; новой логикой не используется
      if (exec.phase === 'waiting') {
        if (ix !== -1 && exec.target?.includes(ix)) {
          const step = exec.step;
          const t = exec.target?.slice() || [];
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
            `ГОТОВ шаг ${step} на ${t.map(labelStreet).join(', ')}`
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
                market: 'threes',
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
            'bettingStatusThrees',
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
