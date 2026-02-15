// src/popup/streaks.js
import { renderDots } from './utils.js';
import {
  dotsDozens,
  dotsRows,
  dotsSix,
  dotsThrees,

  // NEW: anti-dozens
  dotsAntiDozens,

  // NEW: anti-rows
  dotsAntiRows,

  // NEW:
  dotsLowHigh,
  dotsEvenOdd,
  dotsColors,

  // NEW:
  dotsSectors,
  dozensStreakInp,
  rowsStreakInp,
  sixStreakInp,
  threesStreakInp,

  // NEW: anti-dozens
  antidozensStreakInp,

  // NEW: anti-rows
  antirowsStreakInp,

  // NEW:
  lowhighStreakInp,
  evenoddStreakInp,
  colorsStreakInp,

  // NEW:
  sectorsStreakInp,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,

  // NEW: anti-dozens
  antidozensZeroCk,

  // NEW: anti-rows
  antirowsZeroCk,

  // NEW:
  lowhighZeroCk,
  evenoddZeroCk,
  colorsZeroCk,

  // NEW:
  sectorsZeroCk,
} from './dom.js';

let latestSpins = [];
let currStreakState = {
  dozens: { count: 0, idx: null },
  rows: { count: 0, idx: null },
};

// с каких индексов считать прогресс (сбрасываем по тумблерам/сигналам)
const resetIdx = {
  dozens: 0,
  antidozens: 0, // NEW
  antirows: 0, // NEW
  rows: 0,
  six: 0,
  threes: 0,
  lowhigh: 0,
  evenodd: 0,
  colors: 0,
  sectors: 0,
};

export function setLatestSpins(arr) {
  latestSpins = Array.isArray(arr) ? arr : [];
}
export function setCurrStreakState(st) {
  currStreakState = st || currStreakState;
}
export function resetStreakDots(market) {
  const i = Array.isArray(latestSpins) ? latestSpins.length : 0;
  if (market === 'dozens') resetIdx.dozens = i;
  else if (market === 'antidozens') resetIdx.antidozens = i; // NEW
  else if (market === 'antirows') resetIdx.antirows = i; // NEW
  else if (market === 'rows') resetIdx.rows = i;
  else if (market === 'six') resetIdx.six = i;
  else if (market === 'threes') resetIdx.threes = i;
  else if (market === 'lowhigh') resetIdx.lowhigh = i;
  else if (market === 'evenodd') resetIdx.evenodd = i;
  else if (market === 'colors') resetIdx.colors = i;
  else if (market === 'sectors') resetIdx.sectors = i;
}

// индексы
function dozenIndex(n) {
  if (n === 0) return -1;
  if (n <= 12) return 0;
  if (n <= 24) return 1;
  if (n <= 36) return 2;
  return -1;
}
function rowIndex(n) {
  if (n === 0) return -1;
  const r = n % 3;
  if (r === 1) return 0;
  if (r === 2) return 1;
  if (r === 0) return 2;
  return -1;
}
function sixIndex(n) {
  if (n === 0) return -1;
  if (n < 1 || n > 36) return -1;
  return Math.floor((n - 1) / 6);
}
function streetIndex(n) {
  if (n === 0) return -1;
  if (n < 1 || n > 36) return -1;
  return Math.ceil(n / 3) - 1;
}

// NEW: индексы для новых рынков
function lowHighIndex(n) {
  if (n === 0) return -1;
  if (n >= 1 && n <= 18) return 0; // low
  if (n >= 19 && n <= 36) return 1; // high
  return -1;
}
function evenOddIndex(n) {
  if (n === 0) return -1;
  return n % 2 === 0 ? 0 : 1; // 0=even,1=odd
}
const RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);
function colorsIndex(n) {
  if (n === 0) return -1;
  return RED.has(n) ? 0 : 1; // 0=red,1=black
}

// SECTORS index (tiers/orphelins/voisins/zero)
const TIERS = new Set([27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33]);
const ORPHELINS = new Set([17, 34, 6, 1, 20, 14, 31, 9]);
const VOISINS = new Set([
  22, 18, 29, 7, 28, 12, 35, 3, 26, 32, 15, 19, 4, 21, 2, 25,
]);
function sectorsIndex(n, includeZero) {
  if (n === 0) return includeZero ? 3 : -1; // 3=zero
  if (TIERS.has(n)) return 0;
  if (ORPHELINS.has(n)) return 1;
  if (VOISINS.has(n)) return 2;
  return -1;
}

// общий прогресс «одна группа»
function calcOneGroupProgress(spins, need, toIndex, includeZero) {
  let cnt = 0,
    cand = null,
    seenNonZero = false;

  for (let i = spins.length - 1; i >= 0 && cnt < need; i--) {
    const n = Number(spins[i]?.n);
    if (!Number.isFinite(n)) break;

    if (n === 0) {
      if (!includeZero) break;

      if (cand == null) {
        // 0 до первой ненулевой — не считаем, но и окно не рвём
        continue;
      }
      cnt++;
      continue;
    }

    const ix = toIndex(n);
    if (ix === -1) break;
    if (cand == null) cand = ix;
    else if (ix !== cand) break;
    seenNonZero = true;
    cnt++;
  }

  if (!seenNonZero) return { len: 0, cand: null };
  return { len: cnt, cand };
}

// шестёрки: максимум 2 разных
function calcSixProgress(spins, need, includeZero) {
  let cnt = 0;
  const set = new Set();
  for (let i = spins.length - 1; i >= 0 && cnt < need; i--) {
    const n = Number(spins[i]?.n);
    if (!Number.isFinite(n)) break;
    if (n === 0) {
      if (!includeZero) break;
      cnt++;
      continue;
    }
    const si = sixIndex(n);
    if (si === -1) break;
    if (!set.has(si)) {
      if (set.size === 2) break;
      set.add(si);
    }
    cnt++;
  }
  return { len: cnt, hasTwo: set.size === 2 };
}

// ТРЁШКИ: гибридная логика под твои примеры
function calcThreesProgress(spins, K, includeZero) {
  let len = 0;
  const streets = new Set();
  for (let i = spins.length - 1; i >= 0 && len < K; i--) {
    const n = Number(spins[i]?.n);
    if (!Number.isFinite(n)) break;
    if (n === 0) {
      if (!includeZero) break;
      len++;
      continue;
    }
    const si = streetIndex(n);
    if (si === -1) break;
    if (!streets.has(si)) {
      if (streets.size === 4) break;
      streets.add(si);
    }
    len++;
  }
  return K <= 4 ? Math.min(streets.size, K) : Math.min(len, K);
}

// NEW: антидюжины — прогресс "сколько спинов не выходила какая-то дюжина"
function calcMissingDozenBestLen(spins, need, includeZero) {
  const miss = [0, 0, 0];
  const found = [false, false, false];

  for (let i = spins.length - 1; i >= 0; i--) {
    const n = Number(spins[i]?.n);
    if (!Number.isFinite(n)) continue;
    if (n === 0 && !includeZero) continue;

    const di = dozenIndex(n); // -1 для 0
    for (let d = 0; d < 3; d++) {
      if (found[d]) continue;
      if (di !== -1 && d === di) continue;
      miss[d]++;
    }
    if (di !== -1 && !found[di]) found[di] = true;

    if (found[0] && found[1] && found[2]) break;
  }

  const bestLen = Math.max(miss[0], miss[1], miss[2]);
  return Math.min(bestLen, need);
}

// NEW: антиряды — прогресс "сколько спинов не выходил какой-то ряд"
function calcMissingRowBestLen(spins, need, includeZero) {
  const miss = [0, 0, 0];
  const found = [false, false, false];

  for (let i = spins.length - 1; i >= 0; i--) {
    const n = Number(spins[i]?.n);
    if (!Number.isFinite(n)) continue;
    if (n === 0 && !includeZero) continue;

    const ri = rowIndex(n); // -1 для 0
    for (let r = 0; r < 3; r++) {
      if (found[r]) continue;
      if (ri !== -1 && r === ri) continue;
      miss[r]++;
    }
    if (ri !== -1 && !found[ri]) found[ri] = true;

    if (found[0] && found[1] && found[2]) break;
  }

  const bestLen = Math.max(miss[0], miss[1], miss[2]);
  return Math.min(bestLen, need);
}

// рендер
export function updateDotsFromState() {
  const maxD = Math.max(1, Number(dozensStreakInp?.value) || 2);
  const maxAD = Math.max(1, Number(antidozensStreakInp?.value) || 10); // NEW
  const maxAR = Math.max(1, Number(antirowsStreakInp?.value) || 10); // NEW
  const maxR = Math.max(1, Number(rowsStreakInp?.value) || 2);
  const maxS = Math.max(1, Number(sixStreakInp?.value) || 2);
  const K = Math.max(1, Number(threesStreakInp?.value) || 4);

  const maxLH = Math.max(1, Number(lowhighStreakInp?.value) || 2);
  const maxEO = Math.max(1, Number(evenoddStreakInp?.value) || 2);
  const maxCL = Math.max(1, Number(colorsStreakInp?.value) || 2);
  const maxSC = Math.max(1, Number(sectorsStreakInp?.value) || 2);

  const incZeroD = !!dozensZeroCk?.checked;
  const incZeroAD = !!antidozensZeroCk?.checked; // NEW
  const incZeroAR = !!antirowsZeroCk?.checked; // NEW
  const incZeroR = !!rowsZeroCk?.checked;
  const incZeroS = !!sixZeroCk?.checked;
  const incZeroT = !!threesZeroCk?.checked;

  const incZeroLH = !!lowhighZeroCk?.checked;
  const incZeroEO = !!evenoddZeroCk?.checked;
  const incZeroCL = !!colorsZeroCk?.checked;
  const incZeroSC = !!sectorsZeroCk?.checked;

  const spinsD = latestSpins.slice(Math.max(0, resetIdx.dozens));
  const spinsAD = latestSpins.slice(Math.max(0, resetIdx.antidozens)); // NEW
  const spinsAR = latestSpins.slice(Math.max(0, resetIdx.antirows)); // NEW
  const spinsR = latestSpins.slice(Math.max(0, resetIdx.rows));
  const spinsS = latestSpins.slice(Math.max(0, resetIdx.six));
  const spinsT = latestSpins.slice(Math.max(0, resetIdx.threes));
  const spinsLH = latestSpins.slice(Math.max(0, resetIdx.lowhigh));
  const spinsEO = latestSpins.slice(Math.max(0, resetIdx.evenodd));
  const spinsCL = latestSpins.slice(Math.max(0, resetIdx.colors));
  const spinsSC = latestSpins.slice(Math.max(0, resetIdx.sectors));

  const progD = calcOneGroupProgress(
    spinsD,
    maxD,
    dozenIndex,
    incZeroD
  );
  renderDots(dotsDozens, Math.min(progD.len, maxD), maxD);

  // NEW: anti-dozens dots
  const antiLen = calcMissingDozenBestLen(spinsAD, maxAD, incZeroAD);
  renderDots(dotsAntiDozens, antiLen, maxAD);

  // NEW: anti-rows dots
  const antiRowLen = calcMissingRowBestLen(spinsAR, maxAR, incZeroAR);
  renderDots(dotsAntiRows, antiRowLen, maxAR);

  const progR = calcOneGroupProgress(
    spinsR,
    maxR,
    rowIndex,
    incZeroR
  );
  renderDots(dotsRows, Math.min(progR.len, maxR), maxR);

  const progS = calcSixProgress(spinsS, maxS, incZeroS);
  renderDots(dotsSix, Math.min(progS.len, maxS), maxS);

  const threesLen = calcThreesProgress(spinsT, K, incZeroT);
  renderDots(dotsThrees, threesLen, K);

  const progLH = calcOneGroupProgress(
    spinsLH,
    maxLH,
    lowHighIndex,
    incZeroLH
  );
  renderDots(dotsLowHigh, Math.min(progLH.len, maxLH), maxLH);

  const progEO = calcOneGroupProgress(
    spinsEO,
    maxEO,
    evenOddIndex,
    incZeroEO
  );
  renderDots(dotsEvenOdd, Math.min(progEO.len, maxEO), maxEO);

  const progCL = calcOneGroupProgress(
    spinsCL,
    maxCL,
    colorsIndex,
    incZeroCL
  );
  renderDots(dotsColors, Math.min(progCL.len, maxCL), maxCL);

  // sectors progress (важно: sectorsIndex требует includeZero)
  const progSC = calcOneGroupProgress(
    spinsSC,
    maxSC,
    (n) => sectorsIndex(n, incZeroSC),
    incZeroSC
  );
  renderDots(dotsSectors, Math.min(progSC.len, maxSC), maxSC);
}

// ловим системные сигналы от стратегий
export function handleStorageChangeForStreaks(ch, area) {
  if (area !== 'local') return;
  if (ch.threesDotsReset) {
    resetStreakDots('threes');
    updateDotsFromState();
  }
  if (ch.lowhighDotsReset) {
    resetStreakDots('lowhigh');
    updateDotsFromState();
  }
  if (ch.evenoddDotsReset) {
    resetStreakDots('evenodd');
    updateDotsFromState();
  }
  if (ch.colorsDotsReset) {
    resetStreakDots('colors');
    updateDotsFromState();
  }
  if (ch.sectorsDotsReset) {
    resetStreakDots('sectors');
    updateDotsFromState();
  }
  // если захочешь отдельные reset-сигналы:
  if (ch.antidozensDotsReset) {
    resetStreakDots('antidozens');
    updateDotsFromState();
  }
  if (ch.antirowsDotsReset) {
    resetStreakDots('antirows');
    updateDotsFromState();
  }
}
