// bg.js — dynamic registration of content scripts for granted origins + streakState updater
const CS_ID = 'cs_all';

async function unregisterAll() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CS_ID] });
  } catch {}
}

async function getGrantedOrigins() {
  const perms = await chrome.permissions.getAll();
  const uniq = Array.from(new Set(perms.origins || []));
  return uniq;
}

async function registerCS() {
  const origins = await getGrantedOrigins();
  await unregisterAll();
  if (!origins.length) return;

  await chrome.scripting.registerContentScripts([
    {
      id: CS_ID,
      js: ['content.js'], // bettor.js удалён
      matches: origins,
      runAt: 'document_idle',
      allFrames: true,
      persistAcrossSessions: true,
    },
  ]);
}

// Seed defaults once, request them, then register
chrome.runtime.onInstalled.addListener(async () => {
  const { domains = [] } = await chrome.storage.local.get({
    domains: [],
  });
  const defaults = [
    'https://play.livetables.io/*',
    'https://*.livetables.io/*',
  ];
  const next = [...new Set([...domains, ...defaults])];
  await chrome.storage.local.set({ domains: next });

  try {
    await chrome.permissions.request({ origins: defaults });
  } catch {}
  await registerCS();

  // init streaks from existing logs
  await recomputeStreaksFromAllLogs();
});

chrome.runtime.onStartup.addListener(async () => {
  await registerCS();
  await recomputeStreaksFromAllLogs();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'REREGISTER_CS') {
    registerCS()
      .then(() => sendResponse(true))
      .catch(() => sendResponse(false));
    return true;
  }
});

/* ==================== streakState maintainer ==================== */

const DEFAULT_STREAK = {
  dozens: { count: 0, idx: null },
  rows: { count: 0, idx: null },
  combo: { count: 0, d: null, r: null },

  // NEW:
  lowhigh: { count: 0, idx: null }, // 0: Low(1–18), 1: High(19–36)
  evenodd: { count: 0, idx: null }, // 0: even, 1: odd
  colors: { count: 0, idx: null }, // 0: red,  1: black
};

// ---- indexes ----
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

// 1–18 / 19–36
function lowHighIndex(n) {
  if (n === 0) return -1;
  if (n >= 1 && n <= 18) return 0; // Low
  if (n >= 19 && n <= 36) return 1; // High
  return -1;
}

// even / odd
function evenOddIndex(n) {
  if (n === 0) return -1;
  return n % 2 === 0 ? 0 : 1; // 0-even, 1-odd
}

// colors (European single zero). 0=red, 1=black
const RED_SET = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);
function colorIndex(n) {
  if (n === 0) return -1;
  if (RED_SET.has(n)) return 0; // red
  return 1; // black
}

// ---- storage helpers ----
async function getStreakState() {
  const { streakState = DEFAULT_STREAK } =
    await chrome.storage.local.get({ streakState: DEFAULT_STREAK });
  // normalize (добавим недостающие ключи)
  const st = { ...DEFAULT_STREAK, ...(streakState || {}) };

  if (!('dozens' in st)) st.dozens = { count: 0, idx: null };
  if (!('rows' in st)) st.rows = { count: 0, idx: null };
  if (!('combo' in st)) st.combo = { count: 0, d: null, r: null };
  if (!('lowhigh' in st)) st.lowhigh = { count: 0, idx: null };
  if (!('evenodd' in st)) st.evenodd = { count: 0, idx: null };
  if (!('colors' in st)) st.colors = { count: 0, idx: null };

  return st;
}
async function setStreakState(st) {
  try {
    await chrome.storage.local.set({ streakState: st });
  } catch {}
}

async function recomputeStreaksFromAllLogs() {
  const { spinLogs = [] } = await chrome.storage.local.get({
    spinLogs: [],
  });
  const logs = Array.isArray(spinLogs) ? spinLogs : [];

  const st = {
    dozens: { count: 0, idx: null },
    rows: { count: 0, idx: null },
    combo: { count: 0, d: null, r: null },
    lowhigh: { count: 0, idx: null },
    evenodd: { count: 0, idx: null },
    colors: { count: 0, idx: null },
  };

  if (logs.length) {
    // helper: generic last-run counter for binary indexes (-1 breaks)
    const countTail = (fnIdx) => {
      let i = logs.length - 1;
      const first = fnIdx(logs[i]?.n);
      if (first === -1) return { count: 0, idx: null };
      let c = 1;
      i--;
      while (i >= 0) {
        const ii = fnIdx(logs[i]?.n);
        if (ii === first) c++;
        else break;
        i--;
      }
      return { count: c, idx: first };
    };

    // dozens
    {
      let i = logs.length - 1;
      const lastDi = dozenIndex(logs[i]?.n);
      if (lastDi !== -1) {
        let c = 1;
        i--;
        while (i >= 0) {
          const di = dozenIndex(logs[i]?.n);
          if (di === lastDi) c++;
          else break;
          i--;
        }
        st.dozens = { count: c, idx: lastDi };
      }
    }

    // rows
    {
      let i = logs.length - 1;
      const lastRi = rowIndex(logs[i]?.n);
      if (lastRi !== -1) {
        let c = 1;
        i--;
        while (i >= 0) {
          const ri = rowIndex(logs[i]?.n);
          if (ri === lastRi) c++;
          else break;
          i--;
        }
        st.rows = { count: c, idx: lastRi };
      }
    }

    // combo dozen+row
    {
      let i = logs.length - 1;
      let lastD = dozenIndex(logs[i]?.n),
        lastR = rowIndex(logs[i]?.n);
      if (lastD !== -1 && lastR !== -1) {
        let c = 1;
        i--;
        while (i >= 0) {
          const d = dozenIndex(logs[i]?.n),
            r = rowIndex(logs[i]?.n);
          if (d === lastD && r === lastR) c++;
          else break;
          i--;
        }
        st.combo = { count: c, d: lastD, r: lastR };
      }
    }

    // NEW: low/high, even/odd, colors
    st.lowhigh = countTail(lowHighIndex);
    st.evenodd = countTail(evenOddIndex);
    st.colors = countTail(colorIndex);
  }

  await setStreakState(st);
}

function advanceStreakStateWithNumber(st, n) {
  const di = dozenIndex(n);
  const ri = rowIndex(n);
  const li = lowHighIndex(n);
  const ei = evenOddIndex(n);
  const ci = colorIndex(n);

  // dozens
  if (di === -1) {
    st.dozens = { count: 0, idx: null };
  } else if (st.dozens.idx === di) {
    st.dozens.count = (st.dozens.count | 0) + 1;
  } else {
    st.dozens = { count: 1, idx: di };
  }

  // rows
  if (ri === -1) {
    st.rows = { count: 0, idx: null };
  } else if (st.rows.idx === ri) {
    st.rows.count = (st.rows.count | 0) + 1;
  } else {
    st.rows = { count: 1, idx: ri };
  }

  // combo
  if (di === -1 || ri === -1) {
    st.combo = { count: 0, d: null, r: null };
  } else if (st.combo.d === di && st.combo.r === ri) {
    st.combo.count = (st.combo.count | 0) + 1;
  } else {
    st.combo = { count: 1, d: di, r: ri };
  }

  // NEW: low/high
  if (li === -1) {
    st.lowhigh = { count: 0, idx: null };
  } else if (st.lowhigh.idx === li) {
    st.lowhigh.count = (st.lowhigh.count | 0) + 1;
  } else {
    st.lowhigh = { count: 1, idx: li };
  }

  // NEW: even/odd
  if (ei === -1) {
    st.evenodd = { count: 0, idx: null };
  } else if (st.evenodd.idx === ei) {
    st.evenodd.count = (st.evenodd.count | 0) + 1;
  } else {
    st.evenodd = { count: 1, idx: ei };
  }

  // NEW: colors
  if (ci === -1) {
    st.colors = { count: 0, idx: null };
  } else if (st.colors.idx === ci) {
    st.colors.count = (st.colors.count | 0) + 1;
  } else {
    st.colors = { count: 1, idx: ci };
  }
}

/* === helper to reset a single streak kind === */
async function resetStreak(kind) {
  const st = await getStreakState();
  if (kind === 'dozens') st.dozens = { count: 0, idx: null };
  else if (kind === 'rows') st.rows = { count: 0, idx: null };
  else if (kind === 'combo')
    st.combo = { count: 0, d: null, r: null };
  else if (kind === 'lowhigh') st.lowhigh = { count: 0, idx: null };
  else if (kind === 'evenodd') st.evenodd = { count: 0, idx: null };
  else if (kind === 'colors') st.colors = { count: 0, idx: null };
  await setStreakState(st);
}

chrome.storage.onChanged.addListener(async (ch, area) => {
  if (area !== 'local') return;

  // spin logs -> update streaks
  if ('spinLogs' in ch) {
    const oldVal = Array.isArray(ch.spinLogs.oldValue)
      ? ch.spinLogs.oldValue
      : [];
    const newVal = Array.isArray(ch.spinLogs.newValue)
      ? ch.spinLogs.newValue
      : [];

    if (newVal.length > oldVal.length) {
      const added = newVal.slice(oldVal.length);
      if (added.length) {
        const st = await getStreakState();
        for (const e of added) advanceStreakStateWithNumber(st, e.n);
        await setStreakState(st);
      }
    } else {
      await recomputeStreaksFromAllLogs();
    }
  }

  /* === autoBet toggles -> reset only when turned OFF === */
  if ('autoBettingDozensEnabled' in ch) {
    const to = !!ch.autoBettingDozensEnabled.newValue;
    const from = !!ch.autoBettingDozensEnabled.oldValue;
    if (from && !to) await resetStreak('dozens');
  }
  if ('autoBettingRowsEnabled' in ch) {
    const to = !!ch.autoBettingRowsEnabled.newValue;
    const from = !!ch.autoBettingRowsEnabled.oldValue;
    if (from && !to) await resetStreak('rows');
  }
  if ('autoBettingComboEnabled' in ch) {
    const to = !!ch.autoBettingComboEnabled.newValue;
    const from = !!ch.autoBettingComboEnabled.oldValue;
    if (from && !to) await resetStreak('combo');
  }

  // NEW: low/high
  if ('autoBettingLowHighEnabled' in ch) {
    const to = !!ch.autoBettingLowHighEnabled.newValue;
    const from = !!ch.autoBettingLowHighEnabled.oldValue;
    if (from && !to) await resetStreak('lowhigh');
  }
  // NEW: even/odd
  if ('autoBettingEvenOddEnabled' in ch) {
    const to = !!ch.autoBettingEvenOddEnabled.newValue;
    const from = !!ch.autoBettingEvenOddEnabled.oldValue;
    if (from && !to) await resetStreak('evenodd');
  }
  // NEW: colors
  if ('autoBettingColorsEnabled' in ch) {
    const to = !!ch.autoBettingColorsEnabled.newValue;
    const from = !!ch.autoBettingColorsEnabled.oldValue;
    if (from && !to) await resetStreak('colors');
  }
});
