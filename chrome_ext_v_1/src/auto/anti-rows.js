// src/auto/antirows.js
import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 10, // анти-логика обычно требует больше (поставь что хочешь в UI)
    autoContinue: false,
    includeZero: false, // 0 ломает расчёт "пропусков" если false
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

  // ✅ увеличенное окно ожидания ставок
  const PLACE_MAX_WAIT_MS = 20000;

  // ЖЁСТКАЯ карта селекторов рядов:
  // idx 0 -> row 1 (top)  : n%3===0
  // idx 1 -> row 2 (mid)  : n%3===2
  // idx 2 -> row 3 (bot)  : n%3===1
  const ROW_SEL = ['#index-700', '#index-701', '#index-702'];

  function rowIndex(n) {
    if (n === 0) return -1;
    const r = n % 3;
    if (r === 0) return 0;
    if (r === 2) return 1;
    if (r === 1) return 2;
    return -1;
  }

  function getRowNode(idx) {
    const sel = ROW_SEL[idx] || ROW_SEL[2];
    const node = document.querySelector(sel);
    if (!node)
      console.warn(
        '[antirows] Не найден узел ряда idx=',
        idx,
        'sel=',
        sel
      );
    return node;
  }

  // ====== АНТИ-ЛОГИКА: какой ряд "не выпадал" дольше всего в хвосте ======
  // Возвращает idx ряда 0..2, который не выпадал >= need раз подряд
  // includeZero=false: 0 рвёт хвост
  // includeZero=true: 0 просто увеличивает "пропуск" всех рядов
  function pickMissingRowByTail(
    spinLogs,
    need,
    includeZero,
    getIndex
  ) {
    if (!Array.isArray(spinLogs) || spinLogs.length === 0)
      return null;

    const miss = [0, 0, 0];
    const found = [false, false, false];

    for (let i = spinLogs.length - 1; i >= 0; i--) {
      const n = Number(spinLogs[i]?.n);
      if (!Number.isFinite(n)) continue;

      if (n === 0 && !includeZero) break;

      const ix = getIndex(n); // -1 для 0

      for (let r = 0; r < 3; r++) {
        if (found[r]) continue;
        // если выпал этот ряд — он не "пропущен"
        if (ix !== -1 && r === ix) continue;
        miss[r] += 1;
      }
      if (ix !== -1 && !found[ix]) found[ix] = true;

      // все три уже встречались в хвосте → дальше уже не увеличится
      if (found[0] && found[1] && found[2]) break;
    }

    // берём максимальный miss; тайбрейк: фиксированный (0 -> 1 -> 2)
    let best = 0;
    if (miss[1] > miss[best]) best = 1;
    if (miss[2] > miss[best]) best = 2;

    return miss[best] >= need ? best : null;
  }

  class AntiRowsStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'antirows',
        cfgKey: 'abAntiRowsConfig',
        enabledKey: 'autoBettingAntiRowsEnabled',
        statusKey: 'bettingStatusAntiRows',
        execKey: 'betExecAntiRows',

        getIndex: rowIndex,
        // "others" не нужен, но MarketBase ожидает что-то
        getOthers: (x) => [x],
        getTargetNode: getRowNode,

        defaultCfg: DEFAULT_CFG,
      });
    }

    label(idx) {
      return idx === 0 ? 'ряд 1' : idx === 1 ? 'ряд 2' : 'ряд 3';
    }

    async placeStep(step, exec, steps) {
      const targetRow = exec.targetRow;
      if (!(targetRow === 0 || targetRow === 1 || targetRow === 2)) {
        console.error(
          '[antirows] Некорректный targetRow при постановке',
          exec
        );
        return false;
      }

      const targetsIdx = [targetRow];
      exec.target = targetsIdx.slice();

      const ok = await BET.tryPlace({
        step,
        targets: targetsIdx,
        steps,
        getTargetNode: (i) => getRowNode(i),
        mutex: this.mutex,
        maxWaitMs: PLACE_MAX_WAIT_MS,
      });

      if (ok) {
        const chips = await BET.loadGlobalChips();
        const amount =
          BET.perTargetAmountForStep(step, steps, chips.chipValues) *
          targetsIdx.length;

        try {
          const { betLogs = [] } = await this.sget({ betLogs: [] });
          betLogs.push({
            t: Date.now(),
            type: 'placed',
            market: 'antirows',
            phase: 'armed',
            message: `Шаг ${step} на ${this.label(
              targetRow
            )} (антиряды)`,
            amount,
            step,
            debug: {
              targetRow,
              targetSel: ROW_SEL[targetRow],
            },
          });
          if (betLogs.length > 2000)
            betLogs.splice(0, betLogs.length - 2000);
          await this.sset({ betLogs });
        } catch {}
      }

      BET.setBetStatus(
        'bettingStatusAntiRows',
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

      // Берём логи и гарантируем текущий спин (фикс рассинхры)
      const s = await this.sget({ spinLogs: [] });
      const spinLogs = Array.isArray(s.spinLogs)
        ? s.spinLogs.slice()
        : [];
      if (
        spinLogs.length === 0 ||
        spinLogs[spinLogs.length - 1]?.n !== n
      ) {
        spinLogs.push({ n });
      }

      const ix = this.getIndex(n);

      // --- IDLE: вход по анти-стрику (ряд не выпадал N раз)
      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        const missing = pickMissingRowByTail(
          spinLogs,
          triggerStreak,
          includeZero,
          this.getIndex
        );

        if (missing != null) {
          const gateOk = await entryGateFor(
            'antirows',
            'autoBettingAntiRowsEnabled',
            'bettingStatusAntiRows',
            { execKey: 'betExecAntiRows' }
          );
          if (!gateOk) return;

          const next = {
            ...exec,
            phase: 'armed',
            targetRow: missing,
            target: [missing],
            step: 1,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };

          await this.setExec(
            next,
            `ВХОД → антиряды: ${this.label(
              missing
            )} не выпадал ≥${triggerStreak} | шаг 1`
          );

          await this.placeStep(1, next, steps);
        }
        return;
      }

      // --- ARMED: проверяем исход
      if (exec.phase === 'armed') {
        const tr = exec.targetRow;
        const win =
          ix !== -1 &&
          (tr === 0 || tr === 1 || tr === 2) &&
          ix === tr;

        if (win) {
          const next = {
            ...exec,
            phase: 'idle',
            target: null,
            targetRow: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ВЫИГРЫШ на ${this.label(ix)} → сброс`
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
            targetRow: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
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
            cooldownSkipped: undefined,
          };
          next.target = [next.targetRow];

          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу шаг ${step} на ${this.label(
              next.targetRow
            )} (антиряды)`
          );

          await this.placeStep(step, next, steps);
          return;
        }

        // "через один"
        const next = {
          ...exec,
          phase: 'cooldown',
          step: exec.step + 1,
          armedAt: 0,
          cooldownSkipped: false,
        };
        next.target = [exec.targetRow];

        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${next.step} через один`
        );
        return;
      }

      // --- COOLDOWN: пропустить 1 спин и поставить
      if (exec.phase === 'cooldown') {
        const { steps } = await this.loadCfg();
        const lastStep = Math.max(1, steps.length);

        if (exec.step > lastStep) {
          const reset = {
            ...exec,
            phase: 'idle',
            target: null,
            targetRow: null,
            step: 1,
            armedAt: 0,
            cooldownSkipped: undefined,
          };
          await this.setExec(
            reset,
            `Сброс: превышен лимит шагов (${lastStep}) в cooldown`
          );
          return;
        }

        if (!exec.cooldownSkipped) {
          const step = exec.step;

          const mid = { ...exec, cooldownSkipped: true };
          await this.setExec(
            mid,
            `Cooldown: пропустили 1 спин; ставим шаг ${step} (через один)`
          );

          const next = {
            ...mid,
            phase: 'armed',
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          next.target = [next.targetRow];

          await this.setExec(
            next,
            `ГОТОВ (через один) шаг ${step} на ${this.label(
              next.targetRow
            )} (антиряды)`
          );

          await this.placeStep(step, next, steps);
          return;
        }

        // восстановление (на всякий)
        const step = exec.step;
        const rec = {
          ...exec,
          phase: 'armed',
          armedAt: Date.now(),
          cooldownSkipped: undefined,
        };
        rec.target = [rec.targetRow];

        await this.setExec(
          rec,
          `ГОТОВ (восстановление) шаг ${step} на ${this.label(
            rec.targetRow
          )} (антиряды)`
        );

        await this.placeStep(step, rec, steps);
        return;
      }

      // --- WAITING (back-compat)
      if (exec.phase === 'waiting') {
        // для анти-рядов waiting не нужен, но оставим как safety:
        const tr = exec.targetRow;
        if (
          ix !== -1 &&
          (tr === 0 || tr === 1 || tr === 2) &&
          ix === tr
        ) {
          const step = exec.step;
          const { steps } = await this.loadCfg();
          const next = {
            ...exec,
            phase: 'armed',
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          next.target = [tr];

          await this.setExec(
            next,
            `ГОТОВ шаг ${step} на ${this.label(tr)} (антиряды)`
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

  window.__STRAT_ANTIROWS__ = new AntiRowsStrategy();

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_ANTIROWS__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_ANTIROWS__.init(),
      { once: true }
    );
})();
