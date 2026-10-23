// src/bg.js
// tracked tables + tab-level lease + per-table state mirror
(() => {
  if (
    typeof chrome === 'undefined' ||
    !chrome.runtime?.id ||
    !chrome.runtime?.onInstalled ||
    !chrome.runtime?.onStartup ||
    !chrome.runtime?.onMessage ||
    !chrome.storage?.local
  ) {
    return;
  }

  const TRACKED_TABLES_KEY = 'trackedTables';
  const TRACKED_TABLE_STATES_KEY = 'trackedTableStates';
  const TRACKED_TABLE_LEASES_KEY = 'trackedTableLeases';
  const SELECTED_TRACKED_TABLE_KEY = 'selectedTrackedTableId';
  const LEGACY_MIRROR_REVISION_KEY = 'legacyMirrorRevision';

  const LEASE_TTL_MS = 15000;
  const MAX_LOGS = 10000;
  const MAX_BET_LOGS = 5000;

  let bootPromise = null;
  let trackedWrites = Promise.resolve();
  let mirrorRevision = 0;

  // Serialize shared-map read/modify/write operations across all tabs.
  function withTrackedWrite(fn) {
    const next = trackedWrites.then(fn);
    trackedWrites = next.catch(() => {});
    return next;
  }

  async function sget(defaults) {
    try {
      return await chrome.storage.local.get(defaults || {});
    } catch {
      return defaults || {};
    }
  }

  async function sset(obj) {
    try {
      await chrome.storage.local.set(obj);
    } catch {}
  }

  function normalizeTitle(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function defaultStreak() {
    return {
      dozens: { count: 0, idx: null },
      rows: { count: 0, idx: null },
      combo: { count: 0, d: null, r: null },
      lowhigh: { count: 0, idx: null },
      evenodd: { count: 0, idx: null },
      colors: { count: 0, idx: null },
      antidozens: { count: 0, idx: null },
    };
  }

  function sanitizeTrackedTables(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    const out = [];
    const used = new Set();

    for (const item of arr) {
      const title = String(item?.title ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const id = String(item?.id ?? '').trim();
      if (!title || !id || used.has(id)) continue;
      used.add(id);

      out.push({
        ...item,
        id,
        title,
        normTitle: normalizeTitle(title),
        enabled: item?.enabled !== false,
        chipMode: item?.chipMode === 'custom' ? 'custom' : 'global',
        customChipTpl: String(item?.customChipTpl ?? '').trim(),
        customChips: Array.isArray(item?.customChips)
          ? item.customChips
          : [],
      });
    }

    return out;
  }

  function sanitizeTrackedStates(raw) {
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw
      : {};
  }

  function sanitizeLeases(raw) {
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw
      : {};
  }

  function ensureTrackedState(raw, title = '') {
    const state = raw && typeof raw === 'object' ? raw : {};
    const streakState =
      state.streakState && typeof state.streakState === 'object'
        ? { ...defaultStreak(), ...state.streakState }
        : defaultStreak();

    return {
      title: String(state.title ?? title ?? '').trim(),
      matchedTitle: String(state.matchedTitle ?? '').trim(),
      leader:
        state.leader && typeof state.leader === 'object'
          ? state.leader
          : null,
      status:
        state.status && typeof state.status === 'object'
          ? state.status
          : { state: 'off', message: '', at: 0, origin: '' },
      balance:
        state.balance && typeof state.balance === 'object'
          ? state.balance
          : { value: null, t: 0 },
      spinLogs: Array.isArray(state.spinLogs) ? state.spinLogs : [],
      betLogs: Array.isArray(state.betLogs) ? state.betLogs : [],
      streakState,
    };
  }

  function cleanupExpiredLeases(raw) {
    const now = Date.now();
    const next = { ...sanitizeLeases(raw) };

    for (const [tableId, lease] of Object.entries(next)) {
      if (!lease || Number(lease.expiresAt) < now) {
        delete next[tableId];
      }
    }

    return next;
  }

  function findLeaseByTabId(leases, tabId) {
    if (tabId == null) return null;
    const hits = Object.entries(leases || {}).filter(([, lease]) => lease?.tabId === tabId);
    if (hits.length !== 1) return null;
    const [tableId, lease] = hits[0];
    return { tableId, lease };
  }

  function findLeaseForSender(leases, sender) {
    const tabId = sender?.tab?.id ?? null;
    const frameId = sender?.frameId ?? 0;
    if (tabId == null) return null;
    const exact = Object.entries(leases || {}).filter(([, lease]) =>
      lease?.tabId === tabId && lease.frameId === frameId);
    if (exact.length === 1) {
      const [tableId, lease] = exact[0];
      return { tableId, lease };
    }
    if (exact.length > 1) return null;
    return frameId === 0 ? findLeaseByTabId(leases, tabId) : null;
  }

  function isBoundSender(leases, tableId, sender) {
    return findLeaseForSender(leases, sender)?.tableId === tableId;
  }

  function isSameSenderTab(lease, sender) {
    const tabId = sender?.tab?.id ?? null;
    return !!lease && lease.tabId === tabId;
  }

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

  function lowHighIndex(n) {
    if (n === 0) return -1;
    if (n >= 1 && n <= 18) return 0;
    if (n >= 19 && n <= 36) return 1;
    return -1;
  }

  function evenOddIndex(n) {
    if (n === 0) return -1;
    return n % 2 === 0 ? 0 : 1;
  }

  const RED_SET = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
  ]);

  function colorIndex(n) {
    if (n === 0) return -1;
    return RED_SET.has(n) ? 0 : 1;
  }

  function advanceStreakStateWithNumber(st, n) {
    const di = dozenIndex(n);
    const ri = rowIndex(n);
    const li = lowHighIndex(n);
    const ei = evenOddIndex(n);
    const ci = colorIndex(n);

    if (di === -1) st.dozens = { count: 0, idx: null };
    else if (st.dozens.idx === di)
      st.dozens.count = (st.dozens.count | 0) + 1;
    else st.dozens = { count: 1, idx: di };

    if (ri === -1) st.rows = { count: 0, idx: null };
    else if (st.rows.idx === ri)
      st.rows.count = (st.rows.count | 0) + 1;
    else st.rows = { count: 1, idx: ri };

    if (di === -1 || ri === -1)
      st.combo = { count: 0, d: null, r: null };
    else if (st.combo.d === di && st.combo.r === ri)
      st.combo.count = (st.combo.count | 0) + 1;
    else st.combo = { count: 1, d: di, r: ri };

    if (li === -1) st.lowhigh = { count: 0, idx: null };
    else if (st.lowhigh.idx === li)
      st.lowhigh.count = (st.lowhigh.count | 0) + 1;
    else st.lowhigh = { count: 1, idx: li };

    if (ei === -1) st.evenodd = { count: 0, idx: null };
    else if (st.evenodd.idx === ei)
      st.evenodd.count = (st.evenodd.count | 0) + 1;
    else st.evenodd = { count: 1, idx: ei };

    if (ci === -1) st.colors = { count: 0, idx: null };
    else if (st.colors.idx === ci)
      st.colors.count = (st.colors.count | 0) + 1;
    else st.colors = { count: 1, idx: ci };
  }

  function calcAntiDozensFromLogsTail(logs, includeZero) {
    if (!Array.isArray(logs) || !logs.length) {
      return { count: 0, idx: null };
    }

    const miss = [0, 0, 0];
    const found = [false, false, false];

    for (let i = logs.length - 1; i >= 0; i--) {
      const n = Number(logs[i]?.n);
      if (!Number.isFinite(n)) continue;
      if (n === 0 && !includeZero) break;

      const di = dozenIndex(n);

      for (let d = 0; d < 3; d++) {
        if (found[d]) continue;
        if (di !== -1 && d === di) continue;
        miss[d] += 1;
      }

      if (di !== -1 && !found[di]) found[di] = true;
      if (found[0] && found[1] && found[2]) break;
    }

    let bestIdx = 0;
    if (miss[1] > miss[bestIdx]) bestIdx = 1;
    if (miss[2] > miss[bestIdx]) bestIdx = 2;

    const best = miss[bestIdx] || 0;
    return best > 0
      ? { count: best, idx: bestIdx }
      : { count: 0, idx: null };
  }

  async function getAntiDozensIncludeZero() {
    const { abAntiDozensConfig = { includeZero: true } } = await sget(
      {
        abAntiDozensConfig: { includeZero: true },
      },
    );
    return !!abAntiDozensConfig?.includeZero;
  }

  async function normalizeStoredTrackedTables() {
    const {
      [TRACKED_TABLES_KEY]: rawTables = [],
      [TRACKED_TABLE_STATES_KEY]: rawStates = {},
    } = await sget({
      [TRACKED_TABLES_KEY]: [],
      [TRACKED_TABLE_STATES_KEY]: {},
    });

    const tables = sanitizeTrackedTables(rawTables);
    const states = sanitizeTrackedStates(rawStates);
    const nextStates = {};

    for (const table of tables) {
      nextStates[table.id] = ensureTrackedState(
        states[table.id],
        table.title,
      );
    }

    await sset({
      [TRACKED_TABLES_KEY]: tables,
      [TRACKED_TABLE_STATES_KEY]: nextStates,
    });
  }

  async function refreshLegacyMirror() {
    const {
      [TRACKED_TABLES_KEY]: rawTables = [],
      [TRACKED_TABLE_STATES_KEY]: rawStates = {},
      [SELECTED_TRACKED_TABLE_KEY]: rawSelected = '',
    } = await sget({
      [TRACKED_TABLES_KEY]: [],
      [TRACKED_TABLE_STATES_KEY]: {},
      [SELECTED_TRACKED_TABLE_KEY]: '',
    });

    const tables = sanitizeTrackedTables(rawTables);
    const states = sanitizeTrackedStates(rawStates);

    let selectedId = String(rawSelected || '').trim();
    if (!selectedId || !states[selectedId]) {
      selectedId = tables[0]?.id || '';
    }

    let mirror;
    if (!selectedId || !states[selectedId]) {
        mirror = {
          spinLogs: [],
          betLogs: [],
          streakState: defaultStreak(),
          currentBalance: { value: null, t: 0 },
          trackerStatus: {
            state: 'off',
            message: 'No focused tracked table',
            at: 0,
            origin: '',
          },
        };
    } else {
      const state = ensureTrackedState(states[selectedId]);
      mirror = {
        [SELECTED_TRACKED_TABLE_KEY]: selectedId,
        spinLogs: Array.isArray(state.spinLogs) ? state.spinLogs : [],
        betLogs: Array.isArray(state.betLogs) ? state.betLogs : [],
        streakState:
          state.streakState && typeof state.streakState === 'object'
            ? state.streakState
            : defaultStreak(),
        currentBalance:
          state.balance && typeof state.balance === 'object'
            ? state.balance
            : { value: null, t: 0 },
        trackerStatus:
          state.status && typeof state.status === 'object'
            ? state.status
            : {
                state: 'off',
                message: '',
                at: Date.now(),
                origin: '',
              },
      };
    }
    const stored = await sget(Object.fromEntries(Object.keys(mirror).map(key => [key, null])));
    const patch = Object.fromEntries(Object.entries(mirror).filter(([key, value]) =>
      JSON.stringify(stored[key]) !== JSON.stringify(value)));
    if (!Object.keys(patch).length) return;
    // onChanged can arrive after set() resolves; a local boolean is not a
    // reliable way to distinguish our mirror from a legacy writer.
    if ('betLogs' in patch) patch[LEGACY_MIRROR_REVISION_KEY] = `${Date.now()}:${++mirrorRevision}`;
    await sset(patch);
  }

  async function recomputeAntidozensForAllTables() {
    const {
      [TRACKED_TABLES_KEY]: rawTables = [],
      [TRACKED_TABLE_STATES_KEY]: rawStates = {},
    } = await sget({
      [TRACKED_TABLES_KEY]: [],
      [TRACKED_TABLE_STATES_KEY]: {},
    });

    const tables = sanitizeTrackedTables(rawTables);
    const states = sanitizeTrackedStates(rawStates);
    const includeZero = await getAntiDozensIncludeZero();
    const nextStates = { ...states };

    for (const table of tables) {
      const state = ensureTrackedState(states[table.id], table.title);
      state.streakState.antidozens = calcAntiDozensFromLogsTail(
        state.spinLogs,
        includeZero,
      );
      nextStates[table.id] = state;
    }

    await sset({ [TRACKED_TABLE_STATES_KEY]: nextStates });
    await refreshLegacyMirror();
  }

  async function resetStreakKindForAllTables(kind) {
    const {
      [TRACKED_TABLES_KEY]: rawTables = [],
      [TRACKED_TABLE_STATES_KEY]: rawStates = {},
    } = await sget({
      [TRACKED_TABLES_KEY]: [],
      [TRACKED_TABLE_STATES_KEY]: {},
    });

    const tables = sanitizeTrackedTables(rawTables);
    const states = sanitizeTrackedStates(rawStates);
    const nextStates = { ...states };

    for (const table of tables) {
      const state = ensureTrackedState(states[table.id], table.title);

      if (kind === 'dozens')
        state.streakState.dozens = { count: 0, idx: null };
      else if (kind === 'rows')
        state.streakState.rows = { count: 0, idx: null };
      else if (kind === 'combo')
        state.streakState.combo = { count: 0, d: null, r: null };
      else if (kind === 'lowhigh')
        state.streakState.lowhigh = { count: 0, idx: null };
      else if (kind === 'evenodd')
        state.streakState.evenodd = { count: 0, idx: null };
      else if (kind === 'colors')
        state.streakState.colors = { count: 0, idx: null };
      else if (kind === 'antidozens')
        state.streakState.antidozens = { count: 0, idx: null };

      nextStates[table.id] = state;
    }

    await sset({ [TRACKED_TABLE_STATES_KEY]: nextStates });
    await refreshLegacyMirror();
  }

  async function handleTrackedHelloOrHeartbeat(msg, sender) {
    const rawMsgTitle = String(msg?.title ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const rawTabTitle = String(sender?.tab?.title ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    // Prefer the DOM title, but retain the tab-title fallback used by LiveTables.
    const candidates = [...new Set([rawMsgTitle, ...(sender?.frameId === 0 ? [rawTabTitle] : [])].filter(Boolean))];

    const {
      [TRACKED_TABLES_KEY]: rawTables = [],
      [TRACKED_TABLE_STATES_KEY]: rawStates = {},
      [TRACKED_TABLE_LEASES_KEY]: rawLeases = {},
      [SELECTED_TRACKED_TABLE_KEY]: rawSelected = '',
    } = await sget({
      [TRACKED_TABLES_KEY]: [],
      [TRACKED_TABLE_STATES_KEY]: {},
      [TRACKED_TABLE_LEASES_KEY]: {},
      [SELECTED_TRACKED_TABLE_KEY]: '',
    });

    const tables = sanitizeTrackedTables(rawTables);
    const states = sanitizeTrackedStates(rawStates);
    const leases = cleanupExpiredLeases(rawLeases);

    const enabledTables = tables.filter(t => t.enabled);
    let match = null;
    let matchedTitle = '';
    // Check exact names first. For decorated headers, discard generic names
    // contained in a more specific match (Roulette vs VIP Roulette).
    for (const mode of ['exact', 'contains', 'shortened']) {
      for (const candidate of candidates) {
        const title = normalizeTitle(candidate);
        let matches = enabledTables.filter(t => mode === 'exact'
          ? title === t.normTitle
          : mode === 'contains' ? title.includes(t.normTitle) : t.normTitle.includes(title));
        if (mode === 'contains') {
          matches = matches.filter(t => !matches.some(other =>
            other.id !== t.id && other.normTitle !== t.normTitle && other.normTitle.includes(t.normTitle)));
        }
        if (matches.length === 1) {
          match = matches[0];
          matchedTitle = candidate;
          break;
        }
      }
      if (match) break;
    }

    // Only a frame changing tables may release its previous lease.
    for (const [id, lease] of Object.entries(leases)) {
      if (isSameSenderTab(lease, sender) && lease.frameId === (sender?.frameId ?? 0) && id !== match?.id) delete leases[id];
    }

    if (!match) {
      await sset({ [TRACKED_TABLE_LEASES_KEY]: leases });
      return {
        ok: true,
        matched: false,
        role: 'off',
        debug: { msgTitle: rawMsgTitle, tabTitle: rawTabTitle },
      };
    }

    const now = Date.now();
    const currentLease = leases[match.id];
    let role = 'standby';

    if (!currentLease || (isSameSenderTab(currentLease, sender) &&
        (currentLease.frameId === (sender?.frameId ?? 0) || currentLease.frameId === 0))) {
      role = 'leader';
    } else if (Number(currentLease.expiresAt) < now) {
      role = 'leader';
    }

    if (role === 'leader') {
      leases[match.id] = {
        tableId: match.id,
        tabId: sender?.tab?.id ?? null,
        frameId: sender?.frameId ?? 0,
        href: String(msg?.href ?? sender?.url ?? ''),
        title: matchedTitle,
        at: now,
        expiresAt: now + LEASE_TTL_MS,
      };
    } else if (isSameSenderTab(currentLease, sender)) {
      // A host-page heartbeat must not mark its active game iframe as standby.
      return { ok: true, matched: true, tableId: match.id, role: 'standby' };
    }

    const leader = leases[match.id] || null;
    const nextStates = { ...states };
    const state = ensureTrackedState(
      nextStates[match.id],
      match.title,
    );

    // The heartbeat runs every 1.2s. Do not rewrite the complete table state
    // (which can contain thousands of logs) when only the lease timestamp moved.
    const sameLeader =
      state.leader &&
      leader &&
      state.leader.tabId === leader.tabId &&
      state.leader.frameId === leader.frameId &&
      state.leader.href === leader.href;
    const sameTableMeta =
      state.title === match.title && state.matchedTitle === matchedTitle;
    const wasOk = state.status?.state === 'ok';
    const wasStandby = state.status?.state === 'standby';
    const wasWaiting = state.status?.state === 'waiting';

    state.title = match.title;
    state.matchedTitle = matchedTitle;
    state.leader = leader
      ? {
          tabId: leader.tabId,
          frameId: leader.frameId,
          href: leader.href,
          at: leader.at,
        }
      : null;

    if (role === 'standby') {
      state.status = {
        state: 'standby',
        message: 'Standby: another tab is leader',
        at: now,
        origin: String(msg?.href ?? sender?.url ?? ''),
      };
    } else if (state.status?.state !== 'ok') {
      state.status = {
        state: 'waiting',
        message: 'Title matched, waiting for roulette frame',
        at: now,
        origin: String(msg?.href ?? sender?.url ?? ''),
      };
    }

    const stateChanged =
      !sameTableMeta ||
      !sameLeader ||
      (role === 'standby' ? !wasStandby : !wasOk && !wasWaiting);

    if (!stateChanged) {
      await sset({ [TRACKED_TABLE_LEASES_KEY]: leases });
      return {
        ok: true,
        matched: true,
        tableId: match.id,
        role,
        leader: leader
          ? {
              tabId: leader.tabId,
              frameId: leader.frameId,
              href: leader.href,
            }
          : null,
        debug: { msgTitle: rawMsgTitle, tabTitle: rawTabTitle, matchedTitle },
      };
    }

    nextStates[match.id] = state;

    const patch = {
      [TRACKED_TABLE_STATES_KEY]: nextStates,
      [TRACKED_TABLE_LEASES_KEY]: leases,
    };

    if (!String(rawSelected || '').trim()) {
      patch[SELECTED_TRACKED_TABLE_KEY] = match.id;
    }

    await sset(patch);
    await refreshLegacyMirror();

    return {
      ok: true,
      matched: true,
      tableId: match.id,
      role,
      leader: leader
        ? {
            tabId: leader.tabId,
            frameId: leader.frameId,
            href: leader.href,
          }
        : null,
      debug: {
        msgTitle: rawMsgTitle,
        tabTitle: rawTabTitle,
        matchedTitle,
      },
    };
  }

  async function handleGetTrackedTableForTab(_msg, sender) {
    const { [TRACKED_TABLE_LEASES_KEY]: rawLeases = {} } = await sget(
      {
        [TRACKED_TABLE_LEASES_KEY]: {},
      },
    );

    const leases = cleanupExpiredLeases(rawLeases);

    const hit = findLeaseForSender(leases, sender);
    if (!hit) {
      return { ok: true, matched: false, role: 'off' };
    }

    return {
      ok: true,
      matched: true,
      tableId: hit.tableId,
      title: String(hit.lease?.title || ''),
      role: 'leader',
    };
  }

  async function handleTrackedRelease(msg, sender) {
    const tableId = String(msg?.tableId || '').trim();
    if (!tableId) return { ok: true };

    const {
      [TRACKED_TABLE_LEASES_KEY]: rawLeases = {},
      [TRACKED_TABLE_STATES_KEY]: rawStates = {},
    } = await sget({
      [TRACKED_TABLE_LEASES_KEY]: {},
      [TRACKED_TABLE_STATES_KEY]: {},
    });

    const leases = cleanupExpiredLeases(rawLeases);
    const states = sanitizeTrackedStates(rawStates);

    const lease = leases[tableId];
    if (
      lease &&
      isSameSenderTab(lease, sender) &&
      (sender?.frameId === 0 ||
        sender?.frameId === lease.frameId ||
        lease.frameId == null)
    ) {
      delete leases[tableId];
    }

    if (states[tableId]) {
      const state = ensureTrackedState(states[tableId]);
      if (
        state.leader &&
        state.leader.tabId === (sender?.tab?.id ?? null) &&
        (sender?.frameId === 0 ||
          sender?.frameId === state.leader.frameId ||
          state.leader.frameId == null)
      ) {
        state.leader = null;
        state.status = {
          state: 'off',
          message: 'Released',
          at: Date.now(),
          origin: '',
        };
        states[tableId] = state;
      }
    }

    await sset({
      [TRACKED_TABLE_LEASES_KEY]: leases,
      [TRACKED_TABLE_STATES_KEY]: states,
    });
    await refreshLegacyMirror();

    return { ok: true };
  }

  async function handleTrackedSetStatus(msg, sender) {
    const tableId = String(msg?.tableId || '').trim();
    if (!tableId) return { ok: false };

    const {
      [TRACKED_TABLE_STATES_KEY]: rawStates = {},
      [TRACKED_TABLE_LEASES_KEY]: rawLeases = {},
      [TRACKED_TABLES_KEY]: rawTables = [],
    } = await sget({
      [TRACKED_TABLE_STATES_KEY]: {},
      [TRACKED_TABLE_LEASES_KEY]: {},
      [TRACKED_TABLES_KEY]: [],
    });

    const states = sanitizeTrackedStates(rawStates);
    const leases = cleanupExpiredLeases(rawLeases);
    const tables = sanitizeTrackedTables(rawTables);
    const table = tables.find((t) => t.id === tableId);

    const lease = leases[tableId];
    if (!isBoundSender(leases, tableId, sender)) {
      return { ok: false, ignored: true };
    }

    const state = ensureTrackedState(
      states[tableId],
      table?.title || '',
    );

    state.matchedTitle = String(
      msg?.matchedTitle ?? state.matchedTitle ?? '',
    ).trim();

    state.status = {
      state: String(msg?.state || 'off'),
      message: String(msg?.message || ''),
      at: Date.now(),
      origin: String(msg?.href ?? sender?.url ?? ''),
    };

    if (lease) {
      state.leader = {
        tabId: lease.tabId,
        frameId: lease.frameId,
        href: lease.href,
        at: lease.at,
      };
    }

    states[tableId] = state;
    await sset({ [TRACKED_TABLE_STATES_KEY]: states });
    await refreshLegacyMirror();

    return { ok: true };
  }

  async function handleTrackedSetBalance(msg, sender) {
    const tableId = String(msg?.tableId || '').trim();
    if (!tableId) return { ok: false };

    const {
      [TRACKED_TABLE_STATES_KEY]: rawStates = {},
      [TRACKED_TABLE_LEASES_KEY]: rawLeases = {},
      [TRACKED_TABLES_KEY]: rawTables = [],
    } = await sget({
      [TRACKED_TABLE_STATES_KEY]: {},
      [TRACKED_TABLE_LEASES_KEY]: {},
      [TRACKED_TABLES_KEY]: [],
    });

    const states = sanitizeTrackedStates(rawStates);
    const leases = cleanupExpiredLeases(rawLeases);
    const tables = sanitizeTrackedTables(rawTables);
    const table = tables.find((t) => t.id === tableId);

    const lease = leases[tableId];
    if (!isBoundSender(leases, tableId, sender)) {
      return { ok: false, ignored: true };
    }

    const value = Number(msg?.value);
    const state = ensureTrackedState(
      states[tableId],
      table?.title || '',
    );

    const previousValue = state?.balance?.value;
    const missingBalances = Number.isFinite(value) && state.betLogs.some(e => e.balance == null);
    if (
      Number.isFinite(value) &&
      Number.isFinite(previousValue) &&
      previousValue === value && !missingBalances
    ) {
      return { ok: true, unchanged: true };
    }

    state.balance = {
      value: Number.isFinite(value) ? value : null,
      t: Date.now(),
    };

    let logPatch = {};
    if (missingBalances) {
      state.betLogs = state.betLogs.map(e => e.balance == null ? { ...e, balance: value } : e);
      const { trackedTableBetLogsByTable: rawLogs = {} } = await sget({ trackedTableBetLogsByTable: {} });
      const map = sanitizeTrackedStates(rawLogs);
      if (Array.isArray(map[tableId]) && map[tableId].some(e => e.balance == null)) {
        logPatch = { trackedTableBetLogsByTable: { ...map,
          [tableId]: map[tableId].map(e => e.balance == null ? { ...e, balance: value } : e),
        } };
      }
    }

    state.matchedTitle = String(
      msg?.matchedTitle ?? state.matchedTitle ?? '',
    ).trim();

    states[tableId] = state;
    await sset({ [TRACKED_TABLE_STATES_KEY]: states, ...logPatch });
    await refreshLegacyMirror();

    return { ok: true };
  }

  async function handleTrackedAppendSpins(msg, sender) {
    const tableId = String(msg?.tableId || '').trim();
    const spins = Array.isArray(msg?.spins) ? msg.spins : [];
    if (!tableId || !spins.length) return { ok: false };

    const {
      [TRACKED_TABLE_STATES_KEY]: rawStates = {},
      [TRACKED_TABLE_LEASES_KEY]: rawLeases = {},
      [TRACKED_TABLES_KEY]: rawTables = [],
      [SELECTED_TRACKED_TABLE_KEY]: rawSelected = '',
    } = await sget({
      [TRACKED_TABLE_STATES_KEY]: {},
      [TRACKED_TABLE_LEASES_KEY]: {},
      [TRACKED_TABLES_KEY]: [],
      [SELECTED_TRACKED_TABLE_KEY]: '',
    });

    const states = sanitizeTrackedStates(rawStates);
    const leases = cleanupExpiredLeases(rawLeases);
    const tables = sanitizeTrackedTables(rawTables);
    const table = tables.find((t) => t.id === tableId);

    const lease = leases[tableId];
    if (!isBoundSender(leases, tableId, sender)) {
      return { ok: false, ignored: true };
    }

    const state = ensureTrackedState(
      states[tableId],
      table?.title || '',
    );

    for (const item of spins) {
      const n = Number(item?.n);
      if (!Number.isFinite(n)) continue;

      state.spinLogs.push({
        n,
        t: Number(item?.t) || Date.now(),
        t_iso: String(item?.t_iso || new Date().toISOString()),
      });

      advanceStreakStateWithNumber(state.streakState, n);
    }

    if (state.spinLogs.length > MAX_LOGS) {
      state.spinLogs.splice(0, state.spinLogs.length - MAX_LOGS);
    }

    const includeZero = await getAntiDozensIncludeZero();
    state.streakState.antidozens = calcAntiDozensFromLogsTail(
      state.spinLogs,
      includeZero,
    );

    state.matchedTitle = String(
      msg?.matchedTitle ?? state.matchedTitle ?? '',
    ).trim();

    state.leader = {
      tabId: lease.tabId,
      frameId: lease.frameId,
      href: lease.href,
      at: lease.at,
    };

    state.status = {
      state: 'ok',
      message: 'Tracking active',
      at: Date.now(),
      origin: String(msg?.href ?? sender?.url ?? ''),
    };

    states[tableId] = state;

    const patch = {
      [TRACKED_TABLE_STATES_KEY]: states,
      [TRACKED_TABLE_LEASES_KEY]: leases,
    };

    if (!String(rawSelected || '').trim()) {
      patch[SELECTED_TRACKED_TABLE_KEY] = tableId;
    }

    await sset(patch);
    await refreshLegacyMirror();

    return { ok: true };
  }

  async function handleCatchTableWrite(msg, sender) {
    const tableId = String(msg?.tableId || '').trim();
    const bag = await sget({
      [TRACKED_TABLE_LEASES_KEY]: {},
    });
    const hit = findLeaseForSender(cleanupExpiredLeases(bag[TRACKED_TABLE_LEASES_KEY]), sender);
    if (!tableId || hit?.tableId !== tableId) return { ok: false, ignored: true };
    if (msg.type === 'CATCH_TABLE_SET_EXEC') {
      const { betExecCatchXMatchByTable: raw = {} } = await sget({ betExecCatchXMatchByTable: {} });
      const map = sanitizeTrackedStates(raw);
      await sset({ betExecCatchXMatchByTable: { ...map, [tableId]: msg.exec } });
    } else {
      const logsBag = await sget({ [TRACKED_TABLE_STATES_KEY]: {}, trackedTableBetLogsByTable: {} });
      const states = sanitizeTrackedStates(logsBag[TRACKED_TABLE_STATES_KEY]);
      const state = ensureTrackedState(states[tableId]);
      const map = sanitizeTrackedStates(logsBag.trackedTableBetLogsByTable);
      const entry = { ...msg.entry, tableId,
        balance: msg.entry?.balance ?? state.balance?.value ?? null };
      state.betLogs = [...state.betLogs, entry].slice(-MAX_BET_LOGS);
      const logs = Array.isArray(map[tableId]) ? map[tableId] : [];
      await sset({
        [TRACKED_TABLE_STATES_KEY]: { ...states, [tableId]: state },
        trackedTableBetLogsByTable: { ...map, [tableId]: [...logs, entry].slice(-MAX_BET_LOGS) },
      });
    }
    return { ok: true };
  }

  async function bootstrapBackground() {
    await normalizeStoredTrackedTables();
    await refreshLegacyMirror();
  }

  function bootNow() {
    if (!bootPromise) {
      bootPromise = bootstrapBackground().catch((e) => {
        console.warn('[bg bootstrap]', e);
      });
    }
    return bootPromise;
  }

  bootNow();

  chrome.runtime.onInstalled.addListener(async () => {
    await bootstrapBackground();
  });

  chrome.runtime.onStartup.addListener(async () => {
    await bootstrapBackground();
  });

  chrome.runtime.onMessage.addListener(
    (msg, sender, sendResponse) => {
      if (
        msg?.type === 'TRACKED_TABLE_HELLO' ||
        msg?.type === 'TRACKED_TABLE_HEARTBEAT'
      ) {
        bootNow()
          .then(() => withTrackedWrite(() => handleTrackedHelloOrHeartbeat(msg, sender)))
          .then((res) => sendResponse(res))
          .catch((err) =>
            sendResponse({ ok: false, error: String(err) }),
          );
        return true;
      }

      if (msg?.type === 'GET_TRACKED_TABLE_FOR_TAB') {
        withTrackedWrite(() => handleGetTrackedTableForTab(msg, sender))
          .then((res) => sendResponse(res))
          .catch((err) =>
            sendResponse({ ok: false, error: String(err) }),
          );
        return true;
      }

      if (msg?.type === 'TRACKED_TABLE_RELEASE') {
        withTrackedWrite(() => handleTrackedRelease(msg, sender))
          .then((res) => sendResponse(res))
          .catch((err) =>
            sendResponse({ ok: false, error: String(err) }),
          );
        return true;
      }

      if (msg?.type === 'TRACKED_TABLE_SET_STATUS') {
        withTrackedWrite(() => handleTrackedSetStatus(msg, sender))
          .then((res) => sendResponse(res))
          .catch((err) =>
            sendResponse({ ok: false, error: String(err) }),
          );
        return true;
      }

      if (msg?.type === 'TRACKED_TABLE_SET_BALANCE') {
        withTrackedWrite(() => handleTrackedSetBalance(msg, sender))
          .then((res) => sendResponse(res))
          .catch((err) =>
            sendResponse({ ok: false, error: String(err) }),
          );
        return true;
      }

      if (msg?.type === 'TRACKED_TABLE_APPEND_SPINS') {
        withTrackedWrite(() => handleTrackedAppendSpins(msg, sender))
          .then((res) => sendResponse(res))
          .catch((err) =>
            sendResponse({ ok: false, error: String(err) }),
          );
        return true;
      }

      if (msg?.type === 'CATCH_TABLE_SET_EXEC' || msg?.type === 'CATCH_TABLE_APPEND_BET_LOG' ||
          msg?.type === 'TRACKED_TABLE_APPEND_BET_LOG') {
        withTrackedWrite(() => handleCatchTableWrite(msg, sender))
          .then(sendResponse)
          .catch(err => sendResponse({ ok: false, error: String(err) }));
        return true;
      }
    },
  );

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    const watched = [TRACKED_TABLES_KEY, TRACKED_TABLE_STATES_KEY, SELECTED_TRACKED_TABLE_KEY,
      'betLogs', 'abAntiDozensConfig', 'autoBettingDozensEnabled', 'autoBettingRowsEnabled',
      'autoBettingComboEnabled', 'autoBettingLowHighEnabled', 'autoBettingEvenOddEnabled',
      'autoBettingColorsEnabled', 'autoBettingAntiDozensEnabled'];
    if (!watched.some(key => key in ch)) return;
    const mirroredLogs = LEGACY_MIRROR_REVISION_KEY in ch;
    return withTrackedWrite(async () => {
    if (area !== 'local') return;

    if (
      ch[TRACKED_TABLES_KEY] ||
      ch[TRACKED_TABLE_STATES_KEY] ||
      ch[SELECTED_TRACKED_TABLE_KEY]
    ) {
      await refreshLegacyMirror();
    }

    if (ch.betLogs && !mirroredLogs) {
      const {
        [SELECTED_TRACKED_TABLE_KEY]: selectedId = '',
        [TRACKED_TABLE_STATES_KEY]: rawStates = {},
      } = await sget({
        [SELECTED_TRACKED_TABLE_KEY]: '',
        [TRACKED_TABLE_STATES_KEY]: {},
      });

      const tableId = String(selectedId || '').trim();
      if (tableId) {
        const states = sanitizeTrackedStates(rawStates);
        const state = ensureTrackedState(states[tableId]);

        const incoming = Array.isArray(ch.betLogs.newValue) ? ch.betLogs.newValue : [];
        const before = Array.isArray(ch.betLogs.oldValue) ? ch.betLogs.oldValue : [];
        const oldEntries = new Set(before.map(e => JSON.stringify(e)));
        const existing = new Set(state.betLogs.map(e => JSON.stringify(e)));
        const added = incoming.filter(e => !oldEntries.has(JSON.stringify(e)) && !existing.has(JSON.stringify(e)));
        // Import only new events, never replace a live table with an old snapshot.
        if (added.length || (!incoming.length && state.betLogs.length)) {
          state.betLogs = incoming.length ? [...state.betLogs, ...added].slice(-MAX_BET_LOGS) : [];
          states[tableId] = state;
          await sset({ [TRACKED_TABLE_STATES_KEY]: states });
        }
      }
    }

    if ('abAntiDozensConfig' in ch) {
      await recomputeAntidozensForAllTables();
    }

    if ('autoBettingDozensEnabled' in ch) {
      const to = !!ch.autoBettingDozensEnabled.newValue;
      const from = !!ch.autoBettingDozensEnabled.oldValue;
      if (from && !to) await resetStreakKindForAllTables('dozens');
    }

    if ('autoBettingRowsEnabled' in ch) {
      const to = !!ch.autoBettingRowsEnabled.newValue;
      const from = !!ch.autoBettingRowsEnabled.oldValue;
      if (from && !to) await resetStreakKindForAllTables('rows');
    }

    if ('autoBettingComboEnabled' in ch) {
      const to = !!ch.autoBettingComboEnabled.newValue;
      const from = !!ch.autoBettingComboEnabled.oldValue;
      if (from && !to) await resetStreakKindForAllTables('combo');
    }

    if ('autoBettingLowHighEnabled' in ch) {
      const to = !!ch.autoBettingLowHighEnabled.newValue;
      const from = !!ch.autoBettingLowHighEnabled.oldValue;
      if (from && !to) await resetStreakKindForAllTables('lowhigh');
    }

    if ('autoBettingEvenOddEnabled' in ch) {
      const to = !!ch.autoBettingEvenOddEnabled.newValue;
      const from = !!ch.autoBettingEvenOddEnabled.oldValue;
      if (from && !to) await resetStreakKindForAllTables('evenodd');
    }

    if ('autoBettingColorsEnabled' in ch) {
      const to = !!ch.autoBettingColorsEnabled.newValue;
      const from = !!ch.autoBettingColorsEnabled.oldValue;
      if (from && !to) await resetStreakKindForAllTables('colors');
    }

    if ('autoBettingAntiDozensEnabled' in ch) {
      const to = !!ch.autoBettingAntiDozensEnabled.newValue;
      const from = !!ch.autoBettingAntiDozensEnabled.oldValue;
      if (from && !to)
        await resetStreakKindForAllTables('antidozens');
    }
    });
  });
})();
