// src/popup/streaks.js
import { renderDots, sget } from './utils.js';
import {
  dotsDozens,
  dotsRows,
  dotsCombo,
  dotsSix,
  dotsThrees,
  dozensStreakInp,
  rowsStreakInp,
  comboStreakInp,
  sixStreakInp,
  threesStreakInp,
  dozensZeroCk,
  rowsZeroCk,
  sixZeroCk,
  threesZeroCk,
} from './dom.js';

let latestSpins = [];
let currStreakState = {
  dozens: { count: 0, idx: null },
  rows: { count: 0, idx: null },
  combo: { count: 0, d: null, r: null },
};

export function setLatestSpins(arr) {
  latestSpins = Array.isArray(arr) ? arr : [];
}
export function setCurrStreakState(st) {
  currStreakState = st || currStreakState;
}

// dozen 0..2, 0 -> -1
function dozenIndex(n) {
  if (n === 0) return -1;
  if (n <= 12) return 0;
  if (n <= 24) return 1;
  if (n <= 36) return 2;
  return -1;
}
// row 0..2, 0 -> -1
function rowIndex(n) {
  if (n === 0) return -1;
  const r = n % 3;
  if (r === 1) return 0;
  if (r === 2) return 1;
  if (r === 0) return 2;
  return -1;
}
// sixline 0..5, 0 -> -1
function sixIndex(n) {
  if (n === 0) return -1;
  if (n < 1 || n > 36) return -1;
  return Math.floor((n - 1) / 6);
}

function calcOneGroupProgress(spins, need, toIndex, includeZero) {
  let cnt = 0,
    cand = null,
    seenNonZero = false;
  for (
    let i = Array.isArray(spins) ? spins.length - 1 : -1;
    i >= 0 && cnt < need;
    i--
  ) {
    const n = Number(spins[i]?.n);
    if (!Number.isFinite(n)) break;

    if (n === 0) {
      if (!includeZero) break;
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
function calcSixProgress(spins, need, includeZero) {
  let cnt = 0;
  const set = new Set();
  for (
    let i = Array.isArray(spins) ? spins.length - 1 : -1;
    i >= 0 && cnt < need;
    i--
  ) {
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

export function updateDotsFromState() {
  const maxD = Math.max(1, Number(dozensStreakInp.value) || 2);
  const maxR = Math.max(1, Number(rowsStreakInp.value) || 2);
  const maxC = Math.max(1, Number(comboStreakInp.value) || 2);
  const maxS = Math.max(1, Number(sixStreakInp.value) || 2);
  const maxT = Math.max(1, Number(threesStreakInp.value) || 2);

  const incZeroD = !!dozensZeroCk?.checked;
  const incZeroR = !!rowsZeroCk?.checked;
  const incZeroS = !!sixZeroCk?.checked;
  const incZeroT = !!threesZeroCk?.checked;

  const progD = calcOneGroupProgress(
    latestSpins,
    maxD,
    dozenIndex,
    incZeroD
  );
  renderDots(dotsDozens, Math.min(progD.len, maxD), maxD);

  const progR = calcOneGroupProgress(
    latestSpins,
    maxR,
    rowIndex,
    incZeroR
  );
  renderDots(dotsRows, Math.min(progR.len, maxR), maxR);

  renderDots(
    dotsCombo,
    Math.max(0, Number(currStreakState?.combo?.count || 0)),
    maxC
  );

  const progS = calcSixProgress(latestSpins, maxS, incZeroS);
  renderDots(dotsSix, Math.min(progS.len, maxS), maxS);

  const progT = calcOneGroupProgress(
    latestSpins,
    maxT,
    dozenIndex,
    incZeroT
  );
  renderDots(dotsThrees, Math.min(progT.len, maxT), maxT);
}
