import { sget, sset } from './utils.js';
import {
  TRACKED_TABLES_KEY,
  TRACKED_TABLE_STATES_KEY,
  SELECTED_TRACKED_TABLE_KEY,
  UI_TRACKED_TABLES_OPEN_KEY,
  normalizeTitle,
  makeTrackedTableId,
  sanitizeTrackedTables,
  sanitizeTrackedTableStates,
  getTrackedTableState,
  getTrackedTableBalanceValue,
  getTrackedTableSpinLogs,
  getTrackedTableStatus,
  getTrackedTableMatchedTitle,
  getTrackedTableLeaderText,
  getLiveBadge,
  fmtMoney,
  fmtTime,
  countUniqueLeft,
  normalizeChipValues,
} from '../shared/tracked-tables.js';

const TRACKED_TABLE_BET_LOGS_KEY = 'trackedTableBetLogsByTable';

let booted = false;
let renderTimer = null;

let uiState = {
  topOpen: new Set(),
  subOpen: {},
  scrollTop: {},
  drafts: {},
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#039;';
      default:
        return ch;
    }
  });
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[,"\n;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadText(filename, text) {
  const blob = new Blob([text], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function spinLogsToCsv(logs) {
  const rows = ['Time;Number'];
  for (const item of logs) {
    rows.push(
      [csvEscape(fmtTime(item?.t)), csvEscape(item?.n ?? '')].join(
        ';',
      ),
    );
  }
  return rows.join('\n');
}

function betLogsToCsv(logs) {
  const rows = ['Time;Amount;Balance;Event'];
  for (const item of logs) {
    rows.push(
      [
        csvEscape(fmtTime(item?.t)),
        csvEscape(item?.amount ?? ''),
        csvEscape(item?.balance ?? ''),
        csvEscape(
          item?.message ??
            item?.event ??
            item?.phase ??
            item?.type ??
            '',
        ),
      ].join(';'),
    );
  }
  return rows.join('\n');
}

function renderSpinRows(logs) {
  const arr = Array.isArray(logs) ? logs.slice(-50).reverse() : [];
  if (!arr.length) {
    return `<tr><td colspan="2" class="muted small">No logs</td></tr>`;
  }

  return arr
    .map(
      (item) => `
        <tr>
          <td>${esc(fmtTime(item?.t))}</td>
          <td class="num">${esc(item?.n ?? '')}</td>
        </tr>
      `,
    )
    .join('');
}

function renderBetRows(logs) {
  const arr = Array.isArray(logs) ? logs.slice(-50).reverse() : [];
  if (!arr.length) {
    return `<tr><td colspan="4" class="muted small">No bet logs</td></tr>`;
  }

  return arr
    .map(
      (item) => `
        <tr>
          <td>${esc(fmtTime(item?.t))}</td>
          <td>${esc(item?.amount ?? '')}</td>
          <td>${esc(item?.balance ?? '')}</td>
          <td>${esc(
            item?.message ??
              item?.event ??
              item?.phase ??
              item?.type ??
              '',
          )}</td>
        </tr>
      `,
    )
    .join('');
}

function renderChipRowsFromValues(values) {
  const arr = Array.isArray(values) ? values : [];
  if (!arr.length) {
    return `
      <div class="tracked-chip-row">
        <input
          class="tracked-chip-input"
          type="number"
          step="0.01"
          min="0.01"
          value=""
          placeholder="1"
        />
        <button
          type="button"
          class="btn btn-danger-soft btn-xs"
          data-action="remove-chip-row"
        >
          Remove
        </button>
      </div>
    `;
  }

  return arr
    .map(
      (chip) => `
        <div class="tracked-chip-row">
          <input
            class="tracked-chip-input"
            type="number"
            step="0.01"
            min="0.01"
            value="${esc(chip)}"
            placeholder="1"
          />
          <button
            type="button"
            class="btn btn-danger-soft btn-xs"
            data-action="remove-chip-row"
          >
            Remove
          </button>
        </div>
      `,
    )
    .join('');
}

function getDraft(tableId) {
  return uiState.drafts?.[tableId] || null;
}

function sanitizeTableBetLogsMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  const out = {};
  for (const [tableId, logs] of Object.entries(raw)) {
    out[String(tableId)] = Array.isArray(logs) ? logs.slice() : [];
  }
  return out;
}

function getTrackedTableBetLogsForCard(
  state,
  tableBetLogsMap,
  tableId,
) {
  const fromMap =
    tableId &&
    tableBetLogsMap &&
    typeof tableBetLogsMap === 'object' &&
    Array.isArray(tableBetLogsMap[tableId])
      ? tableBetLogsMap[tableId]
      : null;

  if (Array.isArray(fromMap) && fromMap.length > 0) {
    return fromMap;
  }

  if (Array.isArray(state?.betLogs) && state.betLogs.length > 0) {
    return state.betLogs;
  }

  if (Array.isArray(fromMap)) {
    return fromMap;
  }

  return Array.isArray(state?.betLogs) ? state.betLogs : [];
}

function captureUiStateFromDom() {
  const listEl = document.getElementById('trackedTablesList');
  if (!listEl) return;

  const topOpen = new Set();
  const subOpen = {};
  const scrollTop = {};
  const drafts = { ...uiState.drafts };

  const cards = Array.from(
    listEl.querySelectorAll('.tracked-table-card'),
  );

  for (const card of cards) {
    const tableId = String(card.dataset.tableId || '').trim();
    if (!tableId) continue;

    if (card.open) topOpen.add(tableId);

    subOpen[tableId] = {};
    scrollTop[tableId] = scrollTop[tableId] || {};

    const subs = Array.from(
      card.querySelectorAll('.tracked-subaccordion[data-sub]'),
    );
    for (const sub of subs) {
      const key = String(sub.dataset.sub || '').trim();
      if (!key) continue;

      subOpen[tableId][key] = !!sub.open;

      const shell = sub.querySelector('.tracked-log-shell');
      if (shell) {
        scrollTop[tableId][key] = shell.scrollTop || 0;
      }
    }

    const titleInput = card.querySelector('.tracked-title-input');
    const chipMode = card.querySelector('.tracked-chip-mode');
    const chipTpl = card.querySelector('.tracked-chip-tpl');
    const chipInputs = Array.from(
      card.querySelectorAll('.tracked-chip-input'),
    );

    drafts[tableId] = {
      title: titleInput ? titleInput.value : drafts?.[tableId]?.title,
      chipMode: chipMode
        ? chipMode.value
        : drafts?.[tableId]?.chipMode,
      chipTpl: chipTpl ? chipTpl.value : drafts?.[tableId]?.chipTpl,
      chipValues: chipInputs.length
        ? chipInputs.map((inp) => inp.value)
        : drafts?.[tableId]?.chipValues || [],
    };
  }

  uiState = {
    topOpen,
    subOpen,
    scrollTop,
    drafts,
  };
}

function isTopOpen(tableId, storedOpenIds) {
  if (uiState.topOpen.size) return uiState.topOpen.has(tableId);
  return storedOpenIds.has(tableId);
}

function isSubOpen(tableId, key) {
  return !!uiState.subOpen?.[tableId]?.[key];
}

function restoreScrollPositions() {
  const listEl = document.getElementById('trackedTablesList');
  if (!listEl) return;

  const cards = Array.from(
    listEl.querySelectorAll('.tracked-table-card'),
  );

  for (const card of cards) {
    const tableId = String(card.dataset.tableId || '').trim();
    if (!tableId) continue;

    const spinShell = card.querySelector(
      '.tracked-subaccordion[data-sub="spin"] .tracked-log-shell',
    );
    const betShell = card.querySelector(
      '.tracked-subaccordion[data-sub="bet"] .tracked-log-shell',
    );

    const spinTop = Number(uiState.scrollTop?.[tableId]?.spin ?? 0);
    const betTop = Number(uiState.scrollTop?.[tableId]?.bet ?? 0);

    if (spinShell) spinShell.scrollTop = spinTop;
    if (betShell) betShell.scrollTop = betTop;
  }
}

function buildTableCard({
  table,
  state,
  tableBetLogsMap,
  isOpen,
  isSelected,
}) {
  const status = getTrackedTableStatus(state);
  const badge = getLiveBadge(status?.state);
  const balance = getTrackedTableBalanceValue(state);
  const matchedTitle = getTrackedTableMatchedTitle(state);
  const spinLogs = getTrackedTableSpinLogs(state);
  const betLogs = getTrackedTableBetLogsForCard(
    state,
    tableBetLogsMap,
    table.id,
  );
  const uniqueLeft = countUniqueLeft(spinLogs);
  const leaderText = getTrackedTableLeaderText(state);

  const draft = getDraft(table.id);

  const titleValue =
    typeof draft?.title === 'string' ? draft.title : table.title;

  const chipMode =
    draft?.chipMode === 'custom' || draft?.chipMode === 'global'
      ? draft.chipMode
      : table.chipMode === 'custom'
        ? 'custom'
        : 'global';

  const chipTpl =
    typeof draft?.chipTpl === 'string'
      ? draft.chipTpl
      : table.customChipTpl || '';

  const chipValues =
    Array.isArray(draft?.chipValues) && draft?.chipValues.length
      ? draft.chipValues
      : Array.isArray(table?.customChips)
        ? table.customChips
        : [];

  return `
    <details
      class="tracked-table-card"
      data-table-id="${esc(table.id)}"
      ${isOpen ? 'open' : ''}
    >
      <summary class="tracked-table-summary">
        <div class="tracked-table-summary-main">
          <span class="tracked-table-name">${esc(table.title)}</span>
          <div class="tracked-table-summary-meta">
            <span
              class="${badge.cls}"
              data-role="live-badge"
            >${esc(badge.text)}</span>
            ${
              isSelected
                ? '<span class="focus-badge">FOCUS</span>'
                : ''
            }
            ${
              table.enabled
                ? '<span class="mini-flag enabled">ENABLED</span>'
                : '<span class="mini-flag disabled">DISABLED</span>'
            }
          </div>
        </div>
      </summary>

      <div class="tracked-table-body">
        <div class="tracked-table-toolbar">
          <label class="small guard-check">
            <input
              type="checkbox"
              class="tracked-enabled"
              ${table.enabled ? 'checked' : ''}
            />
            Track this table
          </label>

          <div class="tracked-table-toolbar-right">
            <button
              type="button"
              class="btn btn-xs ${isSelected ? 'btn-primary' : ''}"
              data-action="focus"
            >
              ${isSelected ? 'Focused' : 'Focus'}
            </button>
            <button
              type="button"
              class="btn btn-danger-soft btn-xs"
              data-action="remove"
            >
              Remove
            </button>
          </div>
        </div>

        <div class="tracked-edit-row">
          <input
            class="tracked-title-input"
            type="text"
            value="${esc(titleValue)}"
            placeholder="American Football Auto Roulette"
          />
          <button
            type="button"
            class="btn btn-primary btn-xs"
            data-action="save-title"
          >
            Save title
          </button>
        </div>

        <div class="tracked-meta-grid">
          <div class="tracked-meta-item">
            <span class="tracked-meta-label">Matched DOM title</span>
            <span
              class="tracked-meta-value"
              data-role="matched-title"
            >${esc(matchedTitle || '—')}</span>
          </div>

          <div class="tracked-meta-item">
            <span class="tracked-meta-label">Balance</span>
            <span
              class="tracked-meta-value"
              data-role="balance"
            >${esc(fmtMoney(balance))}</span>
          </div>

          <div class="tracked-meta-item">
            <span class="tracked-meta-label">Leader</span>
            <span
              class="tracked-meta-value"
              data-role="leader"
            >${esc(leaderText)}</span>
          </div>

          <div class="tracked-meta-item">
            <span class="tracked-meta-label">Status</span>
            <span
              class="tracked-meta-value"
              data-role="status-message"
            >${esc(status?.message || '—')}</span>
          </div>
        </div>

        <details
          class="tracked-subaccordion"
          data-sub="spin"
          ${isSubOpen(table.id, 'spin') ? 'open' : ''}
        >
          <summary>
            <span data-role="spin-summary">
              Logs (${spinLogs.length}) · missing ${uniqueLeft}
            </span>
          </summary>
          <div class="tracked-subpanel">
            <div class="table-shell tracked-log-shell">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>#</th>
                  </tr>
                </thead>
                <tbody data-role="spin-tbody">${renderSpinRows(spinLogs)}</tbody>
              </table>
            </div>

            <div class="row row-wrap row-end">
              <button
                type="button"
                class="btn btn-xs"
                data-action="export-spin"
              >
                Export CSV
              </button>
              <button
                type="button"
                class="btn btn-danger-soft btn-xs"
                data-action="clear-spin"
              >
                Clear
              </button>
            </div>
          </div>
        </details>

        <details
          class="tracked-subaccordion"
          data-sub="bet"
          ${isSubOpen(table.id, 'bet') ? 'open' : ''}
        >
          <summary>
            <span data-role="bet-summary">
              Bet Logs (${betLogs.length})
            </span>
          </summary>
          <div class="tracked-subpanel">
            <div class="table-shell tracked-log-shell">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Amount</th>
                    <th>Balance</th>
                    <th>Event</th>
                  </tr>
                </thead>
                <tbody data-role="bet-tbody">${renderBetRows(betLogs)}</tbody>
              </table>
            </div>

            <div class="row row-wrap row-end">
              <button
                type="button"
                class="btn btn-xs"
                data-action="export-bet"
              >
                Export CSV
              </button>
              <button
                type="button"
                class="btn btn-danger-soft btn-xs"
                data-action="clear-bet"
              >
                Clear
              </button>
            </div>
          </div>
        </details>

        <details
          class="tracked-subaccordion"
          data-sub="chips"
          ${isSubOpen(table.id, 'chips') ? 'open' : ''}
        >
          <summary>
            Chips (${chipMode === 'custom' ? 'custom' : 'global'})
          </summary>
          <div class="tracked-subpanel">
            <div class="tracked-chip-mode-row">
              <label class="small">Chip mode</label>
              <select class="tracked-chip-mode">
                <option value="global" ${
                  chipMode === 'global' ? 'selected' : ''
                }>
                  Global
                </option>
                <option value="custom" ${
                  chipMode === 'custom' ? 'selected' : ''
                }>
                  Custom
                </option>
              </select>
            </div>

            <div class="tracked-chip-custom ${
              chipMode === 'custom' ? '' : 'is-hidden'
            }">
              <div class="tracked-edit-row">
                <input
                  class="tracked-chip-tpl"
                  type="text"
                  value="${esc(chipTpl)}"
                  placeholder='[data-e2e="chip-{{value}}"]'
                />
              </div>

              <div class="tracked-chip-list">
                ${renderChipRowsFromValues(chipValues)}
              </div>

              <div class="row row-wrap row-end">
                <button
                  type="button"
                  class="btn btn-xs"
                  data-action="add-chip-row"
                >
                  + Add chip
                </button>
                <button
                  type="button"
                  class="btn btn-primary btn-xs"
                  data-action="save-chips"
                >
                  Save chips
                </button>
              </div>
            </div>
          </div>
        </details>
      </div>
    </details>
  `;
}

async function getSnapshot() {
  const {
    [TRACKED_TABLES_KEY]: rawTables = [],
    [TRACKED_TABLE_STATES_KEY]: rawStates = {},
    [TRACKED_TABLE_BET_LOGS_KEY]: rawTableBetLogsMap = {},
    [SELECTED_TRACKED_TABLE_KEY]: selectedId = '',
    [UI_TRACKED_TABLES_OPEN_KEY]: openIdsRaw = [],
  } = await sget({
    [TRACKED_TABLES_KEY]: [],
    [TRACKED_TABLE_STATES_KEY]: {},
    [TRACKED_TABLE_BET_LOGS_KEY]: {},
    [SELECTED_TRACKED_TABLE_KEY]: '',
    [UI_TRACKED_TABLES_OPEN_KEY]: [],
  });

  return {
    tables: sanitizeTrackedTables(rawTables),
    states: sanitizeTrackedTableStates(rawStates),
    tableBetLogsMap: sanitizeTableBetLogsMap(rawTableBetLogsMap),
    selectedId: String(selectedId || '').trim(),
    openIds: new Set(
      Array.isArray(openIdsRaw) ? openIdsRaw.filter(Boolean) : [],
    ),
  };
}

async function setMsg(text, cls = 'small muted') {
  const msgEl = document.getElementById('trackedTablesMsg');
  if (!msgEl) return;
  msgEl.textContent = text || '';
  msgEl.className = cls;
}

async function renderTrackedTables() {
  const listEl = document.getElementById('trackedTablesList');
  if (!listEl) return;

  captureUiStateFromDom();

  const { tables, states, tableBetLogsMap, selectedId, openIds } =
    await getSnapshot();

  if (!tables.length) {
    listEl.innerHTML = `
      <div class="tracked-empty">
        <div class="small muted">
          No tracked tables yet. Add the exact LiveTables title.
        </div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = tables
    .map((table) =>
      buildTableCard({
        table,
        state: getTrackedTableState(states, table.id),
        tableBetLogsMap,
        isOpen: isTopOpen(table.id, openIds),
        isSelected: selectedId === table.id,
      }),
    )
    .join('');

  restoreScrollPositions();
}

async function patchTrackedTableStates() {
  const listEl = document.getElementById('trackedTablesList');
  if (!listEl) return;

  captureUiStateFromDom();

  const { tables, states, tableBetLogsMap } = await getSnapshot();
  const tableMap = new Map(tables.map((t) => [t.id, t]));

  const cards = Array.from(
    listEl.querySelectorAll('.tracked-table-card'),
  );

  if (cards.length !== tables.length) {
    await renderTrackedTables();
    return;
  }

  for (const card of cards) {
    const tableId = String(card.dataset.tableId || '').trim();
    if (!tableId || !tableMap.has(tableId)) {
      await renderTrackedTables();
      return;
    }

    const state = getTrackedTableState(states, tableId);
    const status = getTrackedTableStatus(state);
    const badge = getLiveBadge(status?.state);
    const balance = getTrackedTableBalanceValue(state);
    const matchedTitle = getTrackedTableMatchedTitle(state);
    const leaderText = getTrackedTableLeaderText(state);
    const spinLogs = getTrackedTableSpinLogs(state);
    const betLogs = getTrackedTableBetLogsForCard(
      state,
      tableBetLogsMap,
      tableId,
    );
    const uniqueLeft = countUniqueLeft(spinLogs);

    const badgeEl = card.querySelector('[data-role="live-badge"]');
    const matchedEl = card.querySelector(
      '[data-role="matched-title"]',
    );
    const balanceEl = card.querySelector('[data-role="balance"]');
    const leaderEl = card.querySelector('[data-role="leader"]');
    const statusEl = card.querySelector(
      '[data-role="status-message"]',
    );
    const spinSummaryEl = card.querySelector(
      '[data-role="spin-summary"]',
    );
    const betSummaryEl = card.querySelector(
      '[data-role="bet-summary"]',
    );
    const spinTbody = card.querySelector('[data-role="spin-tbody"]');
    const betTbody = card.querySelector('[data-role="bet-tbody"]');

    const spinShell = card.querySelector(
      '.tracked-subaccordion[data-sub="spin"] .tracked-log-shell',
    );
    const betShell = card.querySelector(
      '.tracked-subaccordion[data-sub="bet"] .tracked-log-shell',
    );

    const spinTop = spinShell ? spinShell.scrollTop : 0;
    const betTop = betShell ? betShell.scrollTop : 0;

    if (badgeEl) {
      badgeEl.className = badge.cls;
      badgeEl.textContent = badge.text;
    }
    if (matchedEl) matchedEl.textContent = matchedTitle || '—';
    if (balanceEl) balanceEl.textContent = fmtMoney(balance);
    if (leaderEl) leaderEl.textContent = leaderText;
    if (statusEl) statusEl.textContent = status?.message || '—';
    if (spinSummaryEl) {
      spinSummaryEl.textContent = `Logs (${spinLogs.length}) · missing ${uniqueLeft}`;
    }
    if (betSummaryEl) {
      betSummaryEl.textContent = `Bet Logs (${betLogs.length})`;
    }
    if (spinTbody) spinTbody.innerHTML = renderSpinRows(spinLogs);
    if (betTbody) betTbody.innerHTML = renderBetRows(betLogs);

    if (spinShell) spinShell.scrollTop = spinTop;
    if (betShell) betShell.scrollTop = betTop;
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTrackedTables().catch(() => {});
  }, 80);
}

async function addTrackedTable() {
  const input = document.getElementById('trackedTableTitleInput');
  if (!input) return;

  const title = String(input.value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) {
    await setMsg('Enter a table title', 'small error-text');
    return;
  }

  const { tables, states, tableBetLogsMap, selectedId, openIds } =
    await getSnapshot();
  const norm = normalizeTitle(title);

  if (tables.some((item) => item.normTitle === norm)) {
    await setMsg(
      'This table title already exists',
      'small error-text',
    );
    return;
  }

  const id = makeTrackedTableId(
    title,
    tables.map((t) => t.id),
  );

  const nextTables = [
    ...tables,
    {
      id,
      title,
      normTitle: norm,
      enabled: true,
      chipMode: 'global',
      customChipTpl: '',
      customChips: [],
    },
  ];

  const nextStates = {
    ...states,
    [id]: {
      title,
      matchedTitle: '',
      status: {
        state: 'off',
        message: 'Waiting for matching table',
        at: Date.now(),
      },
      leader: null,
      balance: { value: null, t: 0 },
      spinLogs: [],
      betLogs: [],
      streakState: null,
    },
  };

  const nextTableBetLogsMap = {
    ...tableBetLogsMap,
    [id]: [],
  };

  const nextOpen = Array.from(new Set([...openIds, id]));
  uiState.topOpen.add(id);

  await sset({
    [TRACKED_TABLES_KEY]: nextTables,
    [TRACKED_TABLE_STATES_KEY]: nextStates,
    [TRACKED_TABLE_BET_LOGS_KEY]: nextTableBetLogsMap,
    [SELECTED_TRACKED_TABLE_KEY]: selectedId || id,
    [UI_TRACKED_TABLES_OPEN_KEY]: nextOpen,
  });

  input.value = '';
  await setMsg(`Added: ${title}`, 'small muted');
}

function closestTableCard(el) {
  return el?.closest?.('.tracked-table-card') || null;
}

function collectChipValues(card) {
  const values = Array.from(
    card.querySelectorAll('.tracked-chip-input'),
  ).map((input) => input.value);
  return normalizeChipValues(values);
}

async function saveOpenStateFromDom() {
  captureUiStateFromDom();
  await sset({
    [UI_TRACKED_TABLES_OPEN_KEY]: Array.from(uiState.topOpen),
  });
}

async function renameTrackedTable(card) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  const titleInput = card.querySelector('.tracked-title-input');
  const nextTitle = String(titleInput?.value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!nextTitle) {
    await setMsg('Title cannot be empty', 'small error-text');
    return;
  }

  const { tables, states, tableBetLogsMap, selectedId, openIds } =
    await getSnapshot();

  const idx = tables.findIndex((t) => t.id === tableId);
  if (idx === -1) return;

  const nextNorm = normalizeTitle(nextTitle);
  const duplicate = tables.some(
    (t, i) => i !== idx && t.normTitle === nextNorm,
  );
  if (duplicate) {
    await setMsg(
      'Another tracked table already has this title',
      'small error-text',
    );
    return;
  }

  const current = tables[idx];
  const titleChanged = current.title !== nextTitle;

  let nextId = current.id;
  const nextStates = { ...states };
  const nextTableBetLogsMap = { ...tableBetLogsMap };
  const nextOpenIds = new Set(openIds);
  let nextSelectedId = selectedId;

  if (titleChanged) {
    nextId = makeTrackedTableId(
      nextTitle,
      tables.filter((t) => t.id !== current.id).map((t) => t.id),
    );

    if (nextStates[current.id]) {
      nextStates[nextId] = {
        ...nextStates[current.id],
        title: nextTitle,
      };
      delete nextStates[current.id];
    }

    if (
      Object.prototype.hasOwnProperty.call(
        nextTableBetLogsMap,
        current.id,
      )
    ) {
      nextTableBetLogsMap[nextId] = Array.isArray(
        nextTableBetLogsMap[current.id],
      )
        ? nextTableBetLogsMap[current.id].slice()
        : [];
      delete nextTableBetLogsMap[current.id];
    }

    if (nextOpenIds.has(current.id)) {
      nextOpenIds.delete(current.id);
      nextOpenIds.add(nextId);
    }

    if (uiState.topOpen.has(current.id)) {
      uiState.topOpen.delete(current.id);
      uiState.topOpen.add(nextId);
    }

    if (uiState.subOpen[current.id]) {
      uiState.subOpen[nextId] = uiState.subOpen[current.id];
      delete uiState.subOpen[current.id];
    }

    if (uiState.scrollTop[current.id]) {
      uiState.scrollTop[nextId] = uiState.scrollTop[current.id];
      delete uiState.scrollTop[current.id];
    }

    if (uiState.drafts[current.id]) {
      uiState.drafts[nextId] = uiState.drafts[current.id];
      delete uiState.drafts[current.id];
    }

    if (nextSelectedId === current.id) {
      nextSelectedId = nextId;
    }
  } else if (nextStates[current.id]) {
    nextStates[current.id] = {
      ...nextStates[current.id],
      title: nextTitle,
    };
  }

  const nextTables = [...tables];
  nextTables[idx] = {
    ...current,
    id: nextId,
    title: nextTitle,
    normTitle: nextNorm,
  };

  await sset({
    [TRACKED_TABLES_KEY]: nextTables,
    [TRACKED_TABLE_STATES_KEY]: nextStates,
    [TRACKED_TABLE_BET_LOGS_KEY]: nextTableBetLogsMap,
    [SELECTED_TRACKED_TABLE_KEY]: nextSelectedId,
    [UI_TRACKED_TABLES_OPEN_KEY]: Array.from(nextOpenIds),
  });

  await setMsg(`Saved: ${nextTitle}`, 'small muted');
}

async function removeTrackedTable(card) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  const { tables, states, tableBetLogsMap, selectedId, openIds } =
    await getSnapshot();

  const nextTables = tables.filter((t) => t.id !== tableId);
  const nextStates = { ...states };
  const nextTableBetLogsMap = { ...tableBetLogsMap };

  delete nextStates[tableId];
  delete nextTableBetLogsMap[tableId];

  const nextOpenIds = Array.from(openIds).filter(
    (id) => id !== tableId,
  );

  delete uiState.subOpen[tableId];
  delete uiState.scrollTop[tableId];
  delete uiState.drafts[tableId];
  uiState.topOpen.delete(tableId);

  const nextSelectedId =
    selectedId === tableId ? nextTables[0]?.id || '' : selectedId;

  await sset({
    [TRACKED_TABLES_KEY]: nextTables,
    [TRACKED_TABLE_STATES_KEY]: nextStates,
    [TRACKED_TABLE_BET_LOGS_KEY]: nextTableBetLogsMap,
    [SELECTED_TRACKED_TABLE_KEY]: nextSelectedId,
    [UI_TRACKED_TABLES_OPEN_KEY]: nextOpenIds,
  });

  await setMsg('Tracked table removed', 'small muted');
}

async function toggleEnabled(card, checked) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  const { tables } = await getSnapshot();
  const nextTables = tables.map((t) =>
    t.id === tableId ? { ...t, enabled: !!checked } : t,
  );

  await sset({ [TRACKED_TABLES_KEY]: nextTables });
}

async function focusTrackedTable(card) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;
  await sset({ [SELECTED_TRACKED_TABLE_KEY]: tableId });
}

async function clearTableLogs(card, kind) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  const { states, tableBetLogsMap } = await getSnapshot();
  const state = getTrackedTableState(states, tableId) || {};

  if (kind === 'spin') {
    const nextStates = {
      ...states,
      [tableId]: {
        ...state,
        spinLogs: [],
      },
    };

    await sset({ [TRACKED_TABLE_STATES_KEY]: nextStates });
    return;
  }

  const nextStates = {
    ...states,
    [tableId]: {
      ...state,
      betLogs: [],
    },
  };

  const nextTableBetLogsMap = {
    ...tableBetLogsMap,
    [tableId]: [],
  };

  await sset({
    [TRACKED_TABLE_STATES_KEY]: nextStates,
    [TRACKED_TABLE_BET_LOGS_KEY]: nextTableBetLogsMap,
  });
}

async function exportTableLogs(card, kind) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  const { tables, states, tableBetLogsMap } = await getSnapshot();
  const table = tables.find((t) => t.id === tableId);
  const state = getTrackedTableState(states, tableId);

  if (kind === 'spin') {
    const logs = getTrackedTableSpinLogs(state);
    downloadText(
      `${table?.id || tableId}-spin-logs.csv`,
      spinLogsToCsv(logs),
    );
    return;
  }

  const betLogs = getTrackedTableBetLogsForCard(
    state,
    tableBetLogsMap,
    tableId,
  );
  downloadText(
    `${table?.id || tableId}-bet-logs.csv`,
    betLogsToCsv(betLogs),
  );
}

async function addChipRow(card) {
  const list = card.querySelector('.tracked-chip-list');
  if (!list) return;

  list.insertAdjacentHTML(
    'beforeend',
    `
      <div class="tracked-chip-row">
        <input
          class="tracked-chip-input"
          type="number"
          step="0.01"
          min="0.01"
          value=""
          placeholder="1"
        />
        <button
          type="button"
          class="btn btn-danger-soft btn-xs"
          data-action="remove-chip-row"
        >
          Remove
        </button>
      </div>
    `,
  );

  captureUiStateFromDom();
}

async function saveTableChips(card) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  const modeEl = card.querySelector('.tracked-chip-mode');
  const tplEl = card.querySelector('.tracked-chip-tpl');

  const mode = modeEl?.value === 'custom' ? 'custom' : 'global';
  const tpl = String(tplEl?.value || '').trim();
  const chips = collectChipValues(card);

  const { tables } = await getSnapshot();
  const nextTables = tables.map((t) =>
    t.id === tableId
      ? {
          ...t,
          chipMode: mode,
          customChipTpl: tpl,
          customChips: chips,
        }
      : t,
  );

  if (uiState.drafts[tableId]) {
    uiState.drafts[tableId] = {
      ...uiState.drafts[tableId],
      chipMode: mode,
      chipTpl: tpl,
      chipValues: chips.map(String),
    };
  }

  await sset({ [TRACKED_TABLES_KEY]: nextTables });
  await setMsg('Chip settings saved', 'small muted');
}

async function toggleChipMode(card, mode) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  const nextMode = mode === 'custom' ? 'custom' : 'global';

  if (!uiState.drafts[tableId]) uiState.drafts[tableId] = {};
  uiState.drafts[tableId].chipMode = nextMode;

  const customWrap = card.querySelector('.tracked-chip-custom');
  if (customWrap) {
    customWrap.classList.toggle('is-hidden', nextMode !== 'custom');
  }

  const summary = card.querySelector(
    '.tracked-subaccordion[data-sub="chips"] > summary',
  );
  if (summary) {
    summary.textContent = `Chips (${nextMode === 'custom' ? 'custom' : 'global'})`;
  }

  const { tables } = await getSnapshot();
  const nextTables = tables.map((t) =>
    t.id === tableId
      ? {
          ...t,
          chipMode: nextMode,
        }
      : t,
  );

  await sset({ [TRACKED_TABLES_KEY]: nextTables });
}

async function handleClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) return;

  const card = closestTableCard(btn);
  const action = btn.dataset.action;

  if (action === 'focus') {
    event.preventDefault();
    await focusTrackedTable(card);
    return;
  }

  if (action === 'remove') {
    event.preventDefault();
    await removeTrackedTable(card);
    return;
  }

  if (action === 'save-title') {
    event.preventDefault();
    await renameTrackedTable(card);
    return;
  }

  if (action === 'export-spin') {
    event.preventDefault();
    await exportTableLogs(card, 'spin');
    return;
  }

  if (action === 'clear-spin') {
    event.preventDefault();
    await clearTableLogs(card, 'spin');
    return;
  }

  if (action === 'export-bet') {
    event.preventDefault();
    await exportTableLogs(card, 'bet');
    return;
  }

  if (action === 'clear-bet') {
    event.preventDefault();
    await clearTableLogs(card, 'bet');
    return;
  }

  if (action === 'add-chip-row') {
    event.preventDefault();
    await addChipRow(card);
    return;
  }

  if (action === 'remove-chip-row') {
    event.preventDefault();
    btn.closest('.tracked-chip-row')?.remove();
    captureUiStateFromDom();
    return;
  }

  if (action === 'save-chips') {
    event.preventDefault();
    await saveTableChips(card);
  }
}

async function handleChange(event) {
  const card = closestTableCard(event.target);
  if (!card) return;

  if (event.target.classList.contains('tracked-enabled')) {
    await toggleEnabled(card, event.target.checked);
    return;
  }

  if (event.target.classList.contains('tracked-chip-mode')) {
    await toggleChipMode(card, event.target.value);
  }
}

function handleInput(event) {
  const card = closestTableCard(event.target);
  if (!card) return;

  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  if (!uiState.drafts[tableId]) uiState.drafts[tableId] = {};

  if (event.target.classList.contains('tracked-title-input')) {
    uiState.drafts[tableId].title = event.target.value;
    return;
  }

  if (event.target.classList.contains('tracked-chip-tpl')) {
    uiState.drafts[tableId].chipTpl = event.target.value;
    return;
  }

  if (event.target.classList.contains('tracked-chip-input')) {
    uiState.drafts[tableId].chipValues = Array.from(
      card.querySelectorAll('.tracked-chip-input'),
    ).map((inp) => inp.value);
  }
}

async function handleToggle(event) {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement)) return;

  if (details.classList.contains('tracked-table-card')) {
    await saveOpenStateFromDom();
    return;
  }

  if (details.classList.contains('tracked-subaccordion')) {
    captureUiStateFromDom();
  }
}

export async function loadTrackedTablesUI() {
  const addBtn = document.getElementById('btnAddTrackedTable');
  const input = document.getElementById('trackedTableTitleInput');
  const listEl = document.getElementById('trackedTablesList');

  if (!addBtn || !input || !listEl) return;

  if (!booted) {
    booted = true;

    addBtn.addEventListener('click', addTrackedTable);

    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        await addTrackedTable();
      }
    });

    listEl.addEventListener('click', handleClick);
    listEl.addEventListener('change', handleChange);
    listEl.addEventListener('input', handleInput);
    listEl.addEventListener('toggle', handleToggle, true);
    listEl.addEventListener(
      'scroll',
      () => captureUiStateFromDom(),
      true,
    );

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (
        changes[TRACKED_TABLES_KEY] ||
        changes[SELECTED_TRACKED_TABLE_KEY] ||
        changes[UI_TRACKED_TABLES_OPEN_KEY]
      ) {
        scheduleRender();
        return;
      }

      if (
        changes[TRACKED_TABLE_STATES_KEY] ||
        changes[TRACKED_TABLE_BET_LOGS_KEY]
      ) {
        patchTrackedTableStates().catch(() => {
          scheduleRender();
        });
      }
    });
  }

  await renderTrackedTables();
}
