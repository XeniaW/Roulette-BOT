// src/auto/rows.js
import { entryGateFor } from '../shared/entry-limit.js';
(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2,
    autoContinue: false,
    includeZero: false, // 0 учитываем как продолжение уже определённого ряда
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

  // ✅ увеличенное окно ожидания ставок ТОЛЬКО для rows
  const PLACE_MAX_WAIT_MS = 20000;

  // ЖЁСТКАЯ карта селекторов рядов:
  // idx 0 -> ряд 1 (3..36), idx 1 -> ряд 2 (2..35), idx 2 -> ряд 3 (1..34)
  const ROW_SEL = ['#index-700', '#index-701', '#index-702'];

  // ряд 1 (top): n % 3 === 0 -> idx 0
  // ряд 2 (mid): n % 3 === 2 -> idx 1
  // ряд 3 (bot): n % 3 === 1 -> idx 2
  function rowIndex(n) {
    if (n === 0) return -1;
    const r = n % 3;
    if (r === 0) return 0;
    if (r === 2) return 1;
    if (r === 1) return 2;
    return -1;
  }

  function opponentsOf(triggerIdx) {
    return [0, 1, 2].filter((i) => i !== triggerIdx);
  }

  function getRowNode(idx) {
    const sel = ROW_SEL[idx] || ROW_SEL[2];
    const node = document.querySelector(sel);
    if (!node)
      console.warn(
        '[rows] Не найден узел ряда idx=',
        idx,
        'sel=',
        sel
      );
    return node;
  }

  // Стрик одного ряда с конца. 0 засчитываем ТОЛЬКО как продолжение уже найденного ряда.
  function checkTriggerSameRow(
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
          cnt++;
          continue;
        }
        break;
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
        getOthers: opponentsOf,
        getTargetNode: getRowNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    label(idx) {
      return idx === 0 ? 'ряд 1' : idx === 1 ? 'ряд 2' : 'ряд 3';
    }

    // Единая постановка шага; цели — всегда 2 ряда-противника triggerRow
    async placeStep(step, exec, steps) {
      const trigger = exec.triggerRow;
      if (!(trigger === 0 || trigger === 1 || trigger === 2)) {
        console.error(
          '[rows] Некорректный triggerRow при постановке',
          exec
        );
        return false;
      }

      const targetsIdx = opponentsOf(trigger);
      const triggerSel = ROW_SEL[trigger];
      const targetsSel = targetsIdx.map((i) => ROW_SEL[i]);

      // Параноидальная защита
      if (targetsSel.includes(triggerSel)) {
        console.error('[rows] Цели содержат триггер! Фиксируем...', {
          trigger,
          targetsIdxBefore: targetsIdx,
        });
        targetsIdx.splice(
          0,
          targetsIdx.length,
          ...opponentsOf(trigger)
        );
      }

      exec.target = targetsIdx.slice(); // синхронизируем exec

      const ok = await BET.tryPlace({
        step,
        targets: targetsIdx, // индексы 0..2
        steps,
        getTargetNode: (i) => getRowNode(i),
        mutex: this.mutex,

        // ✅ увеличили окно ожидания “между спином и ставками”
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
            market: 'rows',
            phase: 'armed',
            message: `Шаг ${step} на ${targetsIdx
              .map((x) => this.label(x))
              .join(', ')}`,
            amount,
            step,
            debug: {
              triggerRow: trigger,
              targets: targetsIdx,
              targetSel: targetsIdx.map((i) => ROW_SEL[i]),
            },
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

      // --- IDLE: вход по стрику
      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        const ref = checkTriggerSameRow(
          spinLogs,
          triggerStreak,
          includeZero,
          this.getIndex
        );
        if (ref != null) {
          // 🔒 ГЕЙТ ВХОДА
          const gateOk = await entryGateFor(
            'rows',
            'autoBettingRowsEnabled',
            'bettingStatusRows',
            { execKey: 'betExecRows' }
          );
          if (!gateOk) return;

          const next = {
            ...exec,
            phase: 'armed',
            triggerRow: ref,
            target: opponentsOf(ref),
            step: 1,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          await this.setExec(
            next,
            `ВХОД → против ${this.label(ref)} | цели: ${next.target
              .map((x) => this.label(x))
              .join(', ')} | шаг 1`
          );
          await this.placeStep(1, next, (await this.loadCfg()).steps);
        }
        return;
      }

      // --- ARMED: проверка исхода текущего шага
      if (exec.phase === 'armed') {
        const opp = opponentsOf(exec.triggerRow ?? -99);
        const win = ix !== -1 && opp.includes(ix);

        if (win) {
          const next = {
            ...exec,
            phase: 'idle',
            target: null,
            triggerRow: null,
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
            triggerRow: null,
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
          next.target = opponentsOf(next.triggerRow);
          await this.setExec(
            next,
            `ПРОИГРЫШ → сразу шаг ${step} против ${this.label(
              next.triggerRow
            )} (цели: ${next.target
              .map((x) => this.label(x))
              .join(', ')})`
          );
          await this.placeStep(step, next, steps);
          return;
        }

        // === НОВОЕ ПОВЕДЕНИЕ: "через один" ===
        const next = {
          ...exec,
          phase: 'cooldown', // пропускаем 1 спин
          step: exec.step + 1, // следующий шаг
          armedAt: 0,
          cooldownSkipped: false, // ещё не отметили пропуск
        };
        next.target = opponentsOf(exec.triggerRow);
        await this.setExec(
          next,
          `ПРОИГРЫШ → пропускаем 1 спин; следующий шаг ${next.step} через один`
        );
        return;
      }

      // --- COOLDOWN: пропустить ровно один спин и СРАЗУ ставить (в этом же вызове)
      if (exec.phase === 'cooldown') {
        const { steps } = await this.loadCfg();
        const lastStep = Math.max(1, steps.length);
        if (exec.step > lastStep) {
          const reset = {
            ...exec,
            phase: 'idle',
            target: null,
            triggerRow: null,
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
          next.target = opponentsOf(next.triggerRow);

          await this.setExec(
            next,
            `ГОТОВ (через один) шаг ${step} против ${this.label(
              next.triggerRow
            )} (цели: ${next.target
              .map((x) => this.label(x))
              .join(', ')})`
          );

          await this.placeStep(step, next, steps);
          return;
        }

        const step = exec.step;
        const rec = {
          ...exec,
          phase: 'armed',
          armedAt: Date.now(),
          cooldownSkipped: undefined,
        };
        rec.target = opponentsOf(rec.triggerRow);
        await this.setExec(
          rec,
          `ГОТОВ (восстановление) шаг ${step} против ${this.label(
            rec.triggerRow
          )} (цели: ${rec.target
            .map((x) => this.label(x))
            .join(', ')})`
        );
        await this.placeStep(step, rec, steps);
        return;
      }

      // --- WAITING (оставлено для обратной совместимости; новой логикой не используется)
      if (exec.phase === 'waiting') {
        const opp = opponentsOf(exec.triggerRow ?? -99);
        if (ix !== -1 && opp.includes(ix)) {
          const step = exec.step;
          const { steps } = await this.loadCfg();
          const next = {
            ...exec,
            phase: 'armed',
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          };
          next.target = opp.slice();
          await this.setExec(
            next,
            `ГОТОВ шаг ${step} против ${this.label(
              exec.triggerRow
            )} (цели: ${next.target
              .map((x) => this.label(x))
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
      {
        once: true,
      }
    );
})();
