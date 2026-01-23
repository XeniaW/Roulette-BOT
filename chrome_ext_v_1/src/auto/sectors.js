// src/auto/sectors.js
import { entryGateFor } from '../shared/entry-limit.js';

(() => {
  const DEFAULT_CFG = Object.freeze({
    triggerStreak: 2,
    autoContinue: false,
    includeZero: true, // true: 4 сектора (вкл Zero); false: 3 сектора (0 игнор)
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

  // UI кнопки (ты дала индексы)
  const $ = (sel) => document.querySelector(sel);
  const sectorButtons = [
    $('#index-1000'), // tiers
    $('#index-1001'), // orphelins
    $('#index-1002'), // voisins
    $('#index-1003'), // zero
  ];

  // Классические наборы French roulette (racetrack)
  const VOISINS = new Set([
    22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25,
  ]);
  const TIERS = new Set([
    27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33,
  ]);
  const ORPHELINS = new Set([1, 20, 14, 31, 9, 6, 34, 17]);

  // Индексы секторов в стратегии:
  // 0=tiers, 1=orphelins, 2=voisins, 3=zero
  function sectorIndex4(n) {
    if (n === 0) return 3;
    if (TIERS.has(n)) return 0;
    if (ORPHELINS.has(n)) return 1;
    if (VOISINS.has(n)) return 2; // (в VOISINS есть 0, но выше отловили)
    return -1;
  }

  // Для режима 3 секторов: 0 не принадлежит ничему
  function sectorIndex3(n) {
    if (n === 0) return -1;
    if (TIERS.has(n)) return 0;
    if (ORPHELINS.has(n)) return 1;
    if (VOISINS.has(n)) return 2;
    return -1;
  }

  function getTargetNode(idx) {
    // idx: 0 tiers,1 orphelins,2 voisins,3 zero
    const sel =
      idx === 0
        ? '#index-1000'
        : idx === 1
        ? '#index-1001'
        : idx === 2
        ? '#index-1002'
        : '#index-1003';
    return sectorButtons[idx] || document.querySelector(sel);
  }

  function otherSectors(ref, includeZero) {
    // индексы: 0=tiers, 1=orphelins, 2=voisins, 3=zero
    if (includeZero) {
      // ставки максимум на 2 сектора, и NEVER ставим на ZERO.
      // всегда выбираем две другие из (tiers/orphelins/voisins)
      if (ref === 3) return [0, 1]; // ZERO → TIERS + ORPHELINS
      if (ref === 2) return [0, 1]; // VOISINS → TIERS + ORPHELINS
      if (ref === 0) return [1, 2]; // TIERS → ORPHELINS + VOISINS
      if (ref === 1) return [0, 2]; // ORPHELINS → TIERS + VOISINS
      return [0, 1]; // fallback
    }

    // includeZero=false: игра между 3 секторами, zero игнор
    return [0, 1, 2].filter((x) => x !== ref);
  }

  function label(idx) {
    return idx === 0
      ? 'TIERS'
      : idx === 1
      ? 'ORPHELINS'
      : idx === 2
      ? 'VOISINS'
      : 'ZERO';
  }

  // Триггер: K подряд в одном секторе
  // includeZero=true: 0 = сектор ZERO и участвует на равных (смешение ≠ стрик)
  // includeZero=false: 0 игнорируем (не рвёт и не считает)
  async function checkTriggerSameSector(spinLogs, need, includeZero) {
    let cnt = 0;
    let ref = null;

    const toIndex = includeZero ? sectorIndex4 : sectorIndex3;

    for (let i = spinLogs.length - 1; i >= 0 && cnt < need; i--) {
      const n = Number(spinLogs[i]?.n);
      if (!Number.isFinite(n)) break;

      if (!includeZero && n === 0) {
        // ✅ режим 3 секторов: 0 игнорируется полностью
        continue;
      }

      const ix = toIndex(n);
      if (ix === -1) break;

      if (ref == null) ref = ix;
      if (ix !== ref) break;

      cnt++;
    }

    return cnt >= need && ref != null ? ref : null;
  }

  class SectorsStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'sectors',
        cfgKey: 'abSectorsConfig',
        enabledKey: 'autoBettingSectorsEnabled',
        statusKey: 'bettingStatusSectors',
        execKey: 'betExecSectors',

        // MarketBase это поле не использует напрямую в этой стратегии,
        // но оставляем корректно:
        getIndex: sectorIndex4,
        getOthers: (ref) => otherSectors(ref, true),
        getTargetNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    async onSpin(n) {
      const exec = await this.getExec();
      if (!exec.enabled) return;

      const { spinLogs = [] } = await this.sget({ spinLogs: [] });

      // --- IDLE: ищем вход по серии
      if (exec.phase === 'idle') {
        const { triggerStreak, steps, includeZero } =
          await this.loadCfg();

        const ref = await checkTriggerSameSector(
          spinLogs,
          triggerStreak,
          includeZero
        );

        if (ref != null) {
          const gateOk = await entryGateFor(
            'sectors',
            'autoBettingSectorsEnabled',
            'bettingStatusSectors',
            { execKey: 'betExecSectors' }
          );
          if (!gateOk) return;

          const targets = otherSectors(ref, includeZero);

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
            `ВХОД → против ${label(ref)} | ставим ${targets
              .map(label)
              .join(', ')} | шаг 1`
          );

          const ok = await BET.tryPlace({
            step: 1,
            targets,
            steps,
            getTargetNode: (i) => getTargetNode(i),
            mutex: this.mutex,
          });

          BET.setBetStatus(
            'bettingStatusSectors',
            ok ? 'armed' : 'error',
            ok ? 'Шаг 1 поставлен' : 'Не удалось поставить шаг 1'
          );
        }
        return;
      }

      // --- ARMED: проверяем исход и следующий шаг
      if (exec.phase === 'armed') {
        const { includeZero, steps, autoContinue } =
          await this.loadCfg();
        const ix = (includeZero ? sectorIndex4 : sectorIndex3)(n);

        const win = ix !== -1 && exec.target?.includes(ix);
        if (win) {
          await this.setExec(
            {
              ...exec,
              phase: 'idle',
              target: null,
              step: 1,
              armedAt: 0,
              cooldownSkipped: undefined,
            },
            `ВЫИГРЫШ на ${label(ix)} → сброс`
          );
          return;
        }

        const lastStep = Math.max(1, steps.length);
        if (exec.step >= lastStep) {
          await this.setExec(
            {
              ...exec,
              phase: 'idle',
              target: null,
              step: 1,
              armedAt: 0,
              cooldownSkipped: undefined,
            },
            `ПРОИГРЫШ на шаге ${lastStep} → сброс`
          );
          return;
        }

        // autoContinue: ставим следующий шаг сразу
        if (autoContinue) {
          const step = exec.step + 1;
          const t = exec.target.slice();

          await this.setExec(
            {
              ...exec,
              phase: 'armed',
              target: t,
              step,
              armedAt: Date.now(),
              cooldownSkipped: undefined,
            },
            `ПРОИГРЫШ → шаг ${step} на ${t.map(label).join(', ')}`
          );

          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => getTargetNode(i),
            mutex: this.mutex,
          });

          BET.setBetStatus(
            'bettingStatusSectors',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        // иначе: через один (как у dozens)
        const step = exec.step + 1;
        await this.setExec(
          {
            ...exec,
            phase: 'cooldown',
            target: exec.target?.slice(),
            step,
            armedAt: 0,
            cooldownSkipped: false,
          },
          `ПРОИГРЫШ → пропускаем 1 спин; шаг ${step} через один`
        );
        return;
      }

      // --- COOLDOWN: пропустили 1 спин → ставим
      if (exec.phase === 'cooldown') {
        const { steps } = await this.loadCfg();
        const lastStep = Math.max(1, steps.length);

        if (exec.step > lastStep) {
          await this.setExec(
            {
              ...exec,
              phase: 'idle',
              target: null,
              step: 1,
              armedAt: 0,
              cooldownSkipped: undefined,
            },
            `Сброс: превышен лимит шагов (${lastStep}) в cooldown`
          );
          return;
        }

        if (!exec.cooldownSkipped) {
          const step = exec.step;
          const t = exec.target?.slice() || [];

          await this.setExec(
            { ...exec, cooldownSkipped: true },
            `Cooldown: пропустили 1 спин; ставим шаг ${step}`
          );

          await this.setExec(
            {
              ...exec,
              phase: 'armed',
              target: t,
              step,
              armedAt: Date.now(),
              cooldownSkipped: undefined,
            },
            `ГОТОВ (через один) шаг ${step} на ${t
              .map(label)
              .join(', ')}`
          );

          const ok = await BET.tryPlace({
            step,
            targets: t,
            steps,
            getTargetNode: (i) => getTargetNode(i),
            mutex: this.mutex,
          });

          BET.setBetStatus(
            'bettingStatusSectors',
            ok ? 'armed' : 'error',
            ok
              ? `Шаг ${step} поставлен`
              : `Не удалось поставить шаг ${step}`
          );
          return;
        }

        // fallback
        const step = exec.step;
        const t = exec.target?.slice() || [];

        await this.setExec(
          {
            ...exec,
            phase: 'armed',
            target: t,
            step,
            armedAt: Date.now(),
            cooldownSkipped: undefined,
          },
          `ГОТОВ (восстановление) шаг ${step} на ${t
            .map(label)
            .join(', ')}`
        );

        const ok = await BET.tryPlace({
          step,
          targets: t,
          steps,
          getTargetNode: (i) => getTargetNode(i),
          mutex: this.mutex,
        });

        BET.setBetStatus(
          'bettingStatusSectors',
          ok ? 'armed' : 'error',
          ok
            ? `Шаг ${step} поставлен`
            : `Не удалось поставить шаг ${step}`
        );
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

  window.__STRAT_SECTORS__ = new SectorsStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    window.__STRAT_SECTORS__.init();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_SECTORS__.init(),
      { once: true }
    );
  }
})();
