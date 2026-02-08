// src/auto/neighbors.js
// Neighbors: main bet via RACETRACK (one click per center) + extra closure via GRID (straight-ups)
//
// FIX: HIT must include extras too (gap-closures). Otherwise numbers from "доп" count as loss.
//
// Additional logic:
// - Dynamic steps: maxStep = steps.length.
// - Cycle reset: WIN anywhere OR LOSS while already at maxStep => restart with step=1.
// - Max coverage center choice: on loss choose center that still covers spin and maximizes unique coverage.
// - Trim centers by removing smallest marginal contribution.
// - No parallel processing: queue + spinLogs length cursor.
// - No duplicate clicks: main unique; extras unique; extras exclude main covered.

(() => {
  const CFG_KEY = 'abNeighborsConfig';
  const ENABLED_KEY = 'autoBettingNeighborsEnabled';
  const STATUS_KEY = 'bettingStatusNeighbors';
  const EXEC_KEY = 'betExecNeighbors';

  const DEFAULT_CFG = Object.freeze({
    steps: [
      [{ chip: 1, times: 1 }],
      [{ chip: 1, times: 3 }],
      [{ chip: 2, times: 2 }],
      [
        { chip: 3, times: 1 },
        { chip: 2, times: 1 },
      ],
      [{ chip: 4, times: 2 }],
    ],
    maxExtraClicks: 12,
    neighborsK: 2,
    closeGapMaxLen: 4,
  });

  const WHEEL = Object.freeze([
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
    10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3,
    26,
  ]);

  const POS = (() => {
    const m = new Map();
    for (let i = 0; i < WHEEL.length; i++) m.set(WHEEL[i], i);
    return m;
  })();

  function clampInt(n, a, b) {
    n = Math.floor(Number(n));
    if (!Number.isFinite(n)) n = a;
    return Math.max(a, Math.min(b, n));
  }

  function sanitizeCfg(raw) {
    const src = raw || {};
    let steps = Array.isArray(src.steps)
      ? src.steps
      : DEFAULT_CFG.steps;

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
              Number.isFinite(it.chip) && Number.isFinite(it.times)
          )
      )
      .filter((st) => st.length);

    if (!steps.length)
      steps = JSON.parse(JSON.stringify(DEFAULT_CFG.steps));

    const maxExtraClicks = clampInt(
      src.maxExtraClicks ?? DEFAULT_CFG.maxExtraClicks,
      0,
      30
    );
    const neighborsK = clampInt(
      src.neighborsK ?? DEFAULT_CFG.neighborsK,
      1,
      3
    );
    const closeGapMaxLen = clampInt(
      src.closeGapMaxLen ?? DEFAULT_CFG.closeGapMaxLen,
      0,
      10
    );

    return { steps, maxExtraClicks, neighborsK, closeGapMaxLen };
  }

  function uniqPreserve(arr) {
    const out = [];
    const seen = new Set();
    for (const x of arr) {
      if (!seen.has(x)) {
        seen.add(x);
        out.push(x);
      }
    }
    return out;
  }

  function excludeSet(arr, set) {
    const out = [];
    const seen = new Set();
    for (const x of arr) {
      if (set.has(x)) continue;
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
    }
    return out;
  }

  function wheelNeighbors(n, k) {
    const p = POS.get(n);
    if (p == null) return [n];
    const out = [];
    const L = WHEEL.length;
    for (let d = -k; d <= k; d++) out.push(WHEEL[(p + d + L) % L]);
    return out;
  }

  function coveredSetByCenters(centers, k) {
    const set = new Set();
    for (const c of centers) {
      for (const x of wheelNeighbors(c, k)) set.add(x);
    }
    return set;
  }

  function coveredMaskFromSet(covSet) {
    const mask = new Array(WHEEL.length).fill(false);
    for (let i = 0; i < WHEEL.length; i++)
      mask[i] = covSet.has(WHEEL[i]);
    return mask;
  }

  function findUncoveredGaps(mask) {
    const L = mask.length;
    const anyCovered = mask.some(Boolean);
    if (!anyCovered) return [{ startIdx: 0, len: L }];

    let start = mask.findIndex((v) => v);
    if (start < 0) start = 0;

    const gaps = [];
    let len = 0;
    let gapStart = -1;

    for (let t = 1; t <= L; t++) {
      const idx = (start + t) % L;
      if (!mask[idx]) {
        if (len === 0) gapStart = idx;
        len++;
      } else if (len > 0) {
        gaps.push({ startIdx: gapStart, len });
        len = 0;
        gapStart = -1;
      }
    }
    return gaps;
  }

  function computeExtraClosures(
    covSet,
    closeGapMaxLen,
    maxExtraClicks
  ) {
    if (closeGapMaxLen <= 0 || maxExtraClicks <= 0) return [];

    const mask = coveredMaskFromSet(covSet);
    const gaps = findUncoveredGaps(mask)
      .filter((g) => g.len > 0 && g.len <= closeGapMaxLen)
      .sort((a, b) => a.len - b.len);

    const extras = [];
    const seen = new Set();
    for (const g of gaps) {
      for (let i = 0; i < g.len; i++) {
        const x = WHEEL[(g.startIdx + i) % WHEEL.length];
        if (covSet.has(x)) continue;
        if (seen.has(x)) continue;
        seen.add(x);
        extras.push(x);
        if (extras.length >= maxExtraClicks) return extras;
      }
    }
    return extras;
  }

  // --------- Max coverage logic ---------

  function coverageSize(centers, k) {
    return coveredSetByCenters(uniqPreserve(centers), k).size;
  }

  function chooseBestCenterForSpin(spin, currentCenters, k) {
    const candidates = wheelNeighbors(spin, k);
    const base = uniqPreserve(currentCenters);

    let best = candidates[0];
    let bestSize = -1;
    let bestTie = -1;

    for (const c of candidates) {
      const sz = coverageSize(base.concat([c]), k);

      let tie = 0;
      if (c === spin) tie += 1000;

      const pc = POS.get(c) ?? 0;
      let minDist = 999;
      for (const e of base) {
        const pe = POS.get(e);
        if (pe == null) continue;
        const d = Math.abs(pc - pe);
        const dd = Math.min(d, WHEEL.length - d);
        if (dd < minDist) minDist = dd;
      }
      tie += minDist === 999 ? 50 : minDist;

      if (sz > bestSize || (sz === bestSize && tie > bestTie)) {
        bestSize = sz;
        best = c;
        bestTie = tie;
      }
    }
    return best;
  }

  function trimCentersMaxCoverage(centers, step, k) {
    let out = centers.slice();
    while (out.length > step) {
      const fullSize = coveredSetByCenters(uniqPreserve(out), k).size;

      let removeIdx = 0;
      let bestMarginal = Infinity;

      for (let i = 0; i < out.length; i++) {
        const test = out.slice(0, i).concat(out.slice(i + 1));
        const testSize = coveredSetByCenters(
          uniqPreserve(test),
          k
        ).size;
        const marginal = fullSize - testSize;
        if (marginal < bestMarginal) {
          bestMarginal = marginal;
          removeIdx = i;
        }
      }
      out.splice(removeIdx, 1);
    }
    return out;
  }

  // ---------- DOM targeting ----------

  function numId(n) {
    return `index-${100 + Number(n)}`;
  }

  function getRacetrackNode(n) {
    const id = numId(n);
    const track =
      document.querySelector('[name="racetrack"]') ||
      document.querySelector('div[name="racetrack"]') ||
      null;

    if (track) {
      return (
        track.querySelector(`#${id}`) ||
        track.querySelector(`[id="${id}"]`)
      );
    }
    return (
      document.getElementById(id) || document.querySelector(`#${id}`)
    );
  }

  function getGridNode(n) {
    const id = numId(n);

    const roots = [
      document.querySelector('#bet-grid-desktop'),
      document.querySelector('[data-e2e="bet-grid-desktop"]'),
      document.querySelector('[data-testid="bet-grid-desktop"]'),
      document.querySelector('#bet-grid'),
    ].filter(Boolean);

    for (const r of roots) {
      const node =
        r.querySelector(`#${id}`) || r.querySelector(`[id="${id}"]`);
      if (node) return node;
    }
    return (
      document.getElementById(id) || document.querySelector(`#${id}`)
    );
  }

  // ---------- storage ----------

  async function sget(obj) {
    return BET.sget(obj);
  }
  async function sset(obj) {
    return BET.sset(obj);
  }

  async function getExec() {
    const { [EXEC_KEY]: e = null } = await sget({ [EXEC_KEY]: null });
    return (
      e || {
        enabled: false,
        step: 0,
        centers: [],
      }
    );
  }

  async function setStatus(state, msg) {
    BET.setBetStatus(STATUS_KEY, state, msg);
  }

  function normalizeCenters(arr) {
    let out = Array.isArray(arr) ? arr.slice() : [];
    out = out
      .map((x) => clampInt(x, 0, 36))
      .filter((x) => Number.isFinite(x));
    return out;
  }

  // ---------- serialize ----------

  const MUTEX = new BET.Mutex();
  let spinQueue = Promise.resolve();
  let lastSpinLogsLen = 0;

  function enqueueSpin(n) {
    spinQueue = spinQueue
      .then(() => handleSpinInternal(n))
      .catch(async (err) => {
        try {
          await setStatus(
            'error',
            `NEIGHBORS: ошибка: ${String(err?.message || err)}`
          );
        } catch (_) {}
      });
  }

  async function placeMixed({
    step,
    stepsCfg,
    racetrackCenters,
    extraTargets,
  }) {
    const main = uniqPreserve(racetrackCenters);
    let extras = uniqPreserve(extraTargets);
    extras = excludeSet(extras, new Set(main));

    let okMain = true;
    if (main.length > 0) {
      okMain = await BET.tryPlace({
        step,
        targets: main,
        steps: stepsCfg,
        getTargetNode: getRacetrackNode,
        mutex: MUTEX,
      });
    }

    let okExtra = true;
    if (extras.length > 0) {
      okExtra = await BET.tryPlace({
        step,
        targets: extras,
        steps: stepsCfg,
        getTargetNode: getGridNode,
        mutex: MUTEX,
      });
    }

    return { okMain, okExtra, main, extras };
  }

  async function handleSpinInternal(spinRaw) {
    const exec = await getExec();
    if (!exec.enabled) return;

    const spin = clampInt(spinRaw, 0, 36);

    const { [CFG_KEY]: raw = DEFAULT_CFG } = await sget({
      [CFG_KEY]: DEFAULT_CFG,
    });
    const cfg = sanitizeCfg(raw);

    const stepsCfg = cfg.steps;
    const maxStep = Math.max(1, stepsCfg.length);

    let step = clampInt(exec.step ?? 0, 0, maxStep);
    let centers = normalizeCenters(exec.centers);

    // ===== FIX: include extras in HIT check =====
    const curUnique = uniqPreserve(centers);
    const curMainCov = coveredSetByCenters(curUnique, cfg.neighborsK);

    const curExtrasRaw = computeExtraClosures(
      curMainCov,
      cfg.closeGapMaxLen,
      cfg.maxExtraClicks
    );
    const curExtras = excludeSet(curExtrasRaw, curMainCov);

    const hit = curMainCov.has(spin) || curExtras.includes(spin);
    const wasAtMax = step > 0 && step === maxStep;
    // ===========================================

    let reason = '';

    if (hit) {
      step = 1;
      const best = chooseBestCenterForSpin(spin, [], cfg.neighborsK);
      centers = [best];
      reason = 'WIN→reset';
    } else if (wasAtMax) {
      step = 1;
      const best = chooseBestCenterForSpin(spin, [], cfg.neighborsK);
      centers = [best];
      reason = 'MAX_LOSS→reset';
    } else {
      step = step === 0 ? 1 : Math.min(step + 1, maxStep);

      const best = chooseBestCenterForSpin(
        spin,
        centers,
        cfg.neighborsK
      );
      centers = centers.concat([best]);

      if (centers.length > step) {
        centers = trimCentersMaxCoverage(
          centers,
          step,
          cfg.neighborsK
        );
      }
      reason = 'LOSS→progress';
    }

    const mainCentersUnique = uniqPreserve(centers);
    const mainCov = coveredSetByCenters(
      mainCentersUnique,
      cfg.neighborsK
    );

    const extraRaw = computeExtraClosures(
      mainCov,
      cfg.closeGapMaxLen,
      cfg.maxExtraClicks
    );
    const extraTargets = excludeSet(extraRaw, mainCov);

    const totalCov = new Set(mainCov);
    for (const x of extraTargets) totalCov.add(x);

    exec.step = step;
    exec.centers = centers;
    await sset({ [EXEC_KEY]: exec });

    const { okMain, okExtra, main, extras } = await placeMixed({
      step,
      stepsCfg,
      racetrackCenters: mainCentersUnique,
      extraTargets,
    });

    if (!okMain) {
      await setStatus(
        'error',
        `NEIGHBORS: не удалось поставить шаг ${step} (racetrack)`
      );
      return;
    }
    if (!okExtra) {
      await setStatus(
        'error',
        `NEIGHBORS: шаг ${step} поставлен, но допы НЕ поставились`
      );
      return;
    }

    await setStatus(
      'armed',
      `NEIGHBORS: ${reason} | шаг ${step} | центры ${centers.length} (${main.length} uniq) | ` +
        `racetrack кликов ${main.length} | доп кликов ${extras.length} | ` +
        `всего кликов ${main.length + extras.length} | покрытие ${
          totalCov.size
        } | ` +
        `центры: ${main.join(', ')}` +
        (extras.length ? ` | доп: ${extras.join(', ')}` : '')
    );
  }

  async function loadEnabled() {
    const { [ENABLED_KEY]: en = false } = await sget({
      [ENABLED_KEY]: false,
    });
    const exec = await getExec();
    exec.enabled = !!en;

    exec.step = 0;
    exec.centers = [];
    await sset({ [EXEC_KEY]: exec });

    const { spinLogs } = await sget({ spinLogs: [] });
    lastSpinLogsLen = Array.isArray(spinLogs) ? spinLogs.length : 0;

    await setStatus(
      exec.enabled ? 'idle' : 'off',
      exec.enabled ? 'NEIGHBORS: ON (жду спин)' : 'NEIGHBORS: OFF'
    );
  }

  function attach() {
    chrome.storage.onChanged.addListener(async (ch, area) => {
      if (area !== 'local') return;

      if (ENABLED_KEY in ch) {
        await loadEnabled();
      }

      if (ch.spinLogs) {
        const newArr = Array.isArray(ch.spinLogs.newValue)
          ? ch.spinLogs.newValue
          : [];

        if (newArr.length <= lastSpinLogsLen) {
          lastSpinLogsLen = newArr.length;
          return;
        }

        const delta = newArr.slice(lastSpinLogsLen);
        lastSpinLogsLen = newArr.length;

        for (const s of delta) {
          if (s && typeof s.n === 'number') enqueueSpin(s.n);
        }
      }
    });
  }

  async function init() {
    await loadEnabled();
    attach();
  }

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
