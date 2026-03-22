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
  getTrackedTableBetLogs,
  getTrackedTableStatus,
  getTrackedTableMatchedTitle,
  fmtTime,
  countUniqueLeft,
  normalizeChipValues,
} from '../shared/tracked-tables.js';

let _booted = false;

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

function safeMoney(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function humanBadge(table, state) {
  if (!table?.enabled) {
    return { cls: 'live-badge off', text: 'Disabled' };
  }

  const raw = String(state?.status?.state || state?.state || 'off');

  if (raw === 'ok') {
    return { cls: 'live-badge ok', text: 'Live' };
  }
  if (raw === 'standby') {
    return { cls: 'live-badge waiting', text: 'Standby' };
  }
  if (raw === 'waiting') {
    return { cls: 'live-badge waiting', text: 'Waiting' };
  }
  if (raw === 'error') {
    return { cls: 'live-badge error', text: 'Error' };
  }
  return { cls: 'live-badge off', text: 'Off' };
}

function humanStatusMessage(table, status, matchedTitle) {
  if (!table?.enabled) return 'Tracking disabled for this table';

  const raw = String(status?.state || 'off');
  const msg = String(status?.message || '').trim();

  if (raw === 'ok') {
    return msg || 'Tracking active';
  }
  if (raw === 'standby') {
    return msg || 'Another tab currently owns tracking';
  }
  if (raw === 'waiting') {
    return matchedTitle
      ? `Matched title: ${matchedTitle}`
      : 'No matching page title detected yet';
  }
  if (raw === 'error') {
    return msg || 'Tracker error';
  }
  return msg || 'Waiting for matching table';
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

function renderChipRows(table) {
  const chips = Array.isArray(table?.customChips)
    ? table.customChips
    : [];

  if (!chips.length) {
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

  return chips
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

function buildTableCard({ table, state, isOpen, isSelected }) {
  const status = getTrackedTableStatus(state);
  const badge = humanBadge(table, state);
  const balance = getTrackedTableBalanceValue(state);
  const matchedTitle = getTrackedTableMatchedTitle(state);
  const spinLogs = getTrackedTableSpinLogs(state);
  const betLogs = getTrackedTableBetLogs(state);
  const uniqueLeft = countUniqueLeft(spinLogs);
  const statusText = humanStatusMessage(table, status, matchedTitle);

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
            <span class="${badge.cls}">${esc(badge.text)}</span>
            ${
              isSelected
                ? '<span class="focus-badge">Shown in main panel</span>'
                : ''
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
              ${isSelected ? 'Shown' : 'Show here'}
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
            value="${esc(table.title)}"
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
            <span class="tracked-meta-label">Matched page title</span>
            <span class="tracked-meta-value">${esc(
              matchedTitle || '—',
            )}</span>
          </div>

          <div class="tracked-meta-item">
            <span class="tracked-meta-label">Balance</span>
            <span class="tracked-meta-value">${esc(
              safeMoney(balance),
            )}</span>
          </div>

          <div class="tracked-meta-item tracked-meta-item--wide">
            <span class="tracked-meta-label">Tracker</span>
            <span class="tracked-meta-value">${esc(statusText)}</span>
          </div>
        </div>

        <details class="tracked-subaccordion">
          <summary>
            Logs (${spinLogs.length}) · missing ${uniqueLeft}
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
                <tbody>${renderSpinRows(spinLogs)}</tbody>
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

        <details class="tracked-subaccordion">
          <summary>Bet Logs (${betLogs.length})</summary>
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
                <tbody>${renderBetRows(betLogs)}</tbody>
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

        <details class="tracked-subaccordion">
          <summary>
            Chips (${table.chipMode === 'custom' ? 'custom' : 'global'})
          </summary>
          <div class="tracked-subpanel">
            <div class="tracked-chip-mode-row">
              <label class="small">Chip mode</label>
              <select class="tracked-chip-mode">
                <option value="global" ${
                  table.chipMode === 'global' ? 'selected' : ''
                }>
                  Global
                </option>
                <option value="custom" ${
                  table.chipMode === 'custom' ? 'selected' : ''
                }>
                  Custom
                </option>
              </select>
            </div>

            <div class="tracked-chip-custom ${
              table.chipMode === 'custom' ? '' : 'is-hidden'
            }">
              <div class="tracked-edit-row">
                <input
                  class="tracked-chip-tpl"
                  type="text"
                  value="${esc(table.customChipTpl || '')}"
                  placeholder='[data-e2e="chip-{{value}}"]'
                />
              </div>

              <div class="tracked-chip-list">
                ${renderChipRows(table)}
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
    [SELECTED_TRACKED_TABLE_KEY]: selectedId = '',
    [UI_TRACKED_TABLES_OPEN_KEY]: openIdsRaw = [],
  } = await sget({
    [TRACKED_TABLES_KEY]: [],
    [TRACKED_TABLE_STATES_KEY]: {},
    [SELECTED_TRACKED_TABLE_KEY]: '',
    [UI_TRACKED_TABLES_OPEN_KEY]: [],
  });

  return {
    tables: sanitizeTrackedTables(rawTables),
    states: sanitizeTrackedTableStates(rawStates),
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

  const { tables, states, selectedId, openIds } = await getSnapshot();

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
        isOpen: openIds.has(table.id),
        isSelected: selectedId === table.id,
      }),
    )
    .join('');
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

  const { tables, states, selectedId, openIds } = await getSnapshot();

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

  await sset({
    [TRACKED_TABLES_KEY]: nextTables,
    [TRACKED_TABLE_STATES_KEY]: nextStates,
    [SELECTED_TRACKED_TABLE_KEY]: selectedId || id,
    [UI_TRACKED_TABLES_OPEN_KEY]: Array.from(
      new Set([...openIds, id]),
    ),
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
  const cards = Array.from(
    document.querySelectorAll('.tracked-table-card'),
  );
  const openIds = cards
    .filter((card) => card.open)
    .map((card) => card.dataset.tableId)
    .filter(Boolean);

  await sset({
    [UI_TRACKED_TABLES_OPEN_KEY]: openIds,
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

  const { tables, states, selectedId, openIds } = await getSnapshot();

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

    if (nextOpenIds.has(current.id)) {
      nextOpenIds.delete(current.id);
      nextOpenIds.add(nextId);
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
    [SELECTED_TRACKED_TABLE_KEY]: nextSelectedId,
    [UI_TRACKED_TABLES_OPEN_KEY]: Array.from(nextOpenIds),
  });

  await setMsg(`Saved: ${nextTitle}`, 'small muted');
}

async function removeTrackedTable(card) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  const { tables, states, selectedId, openIds } = await getSnapshot();

  const nextTables = tables.filter((t) => t.id !== tableId);
  const nextStates = { ...states };
  delete nextStates[tableId];

  const nextOpenIds = Array.from(openIds).filter(
    (id) => id !== tableId,
  );
  const nextSelectedId =
    selectedId === tableId ? nextTables[0]?.id || '' : selectedId;

  await sset({
    [TRACKED_TABLES_KEY]: nextTables,
    [TRACKED_TABLE_STATES_KEY]: nextStates,
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

  const { states } = await getSnapshot();
  const state = getTrackedTableState(states, tableId) || {};

  const nextStates = {
    ...states,
    [tableId]: {
      ...state,
      [kind === 'spin' ? 'spinLogs' : 'betLogs']: [],
    },
  };

  await sset({ [TRACKED_TABLE_STATES_KEY]: nextStates });
}

async function exportTableLogs(card, kind) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  const { tables, states } = await getSnapshot();
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

  const betLogs = getTrackedTableBetLogs(state);
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

  await sset({ [TRACKED_TABLES_KEY]: nextTables });
  await setMsg('Chip settings saved', 'small muted');
}

async function toggleChipMode(card, mode) {
  const tableId = String(card?.dataset?.tableId || '').trim();
  if (!tableId) return;

  const { tables } = await getSnapshot();
  const nextTables = tables.map((t) =>
    t.id === tableId
      ? {
          ...t,
          chipMode: mode === 'custom' ? 'custom' : 'global',
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

async function handleToggle(event) {
  const details = event.target;
  if (!details.classList?.contains('tracked-table-card')) return;
  await saveOpenStateFromDom();
}

export async function loadTrackedTablesUI() {
  const addBtn = document.getElementById('btnAddTrackedTable');
  const input = document.getElementById('trackedTableTitleInput');
  const listEl = document.getElementById('trackedTablesList');

  if (!addBtn || !input || !listEl) return;

  if (!_booted) {
    _booted = true;

    addBtn.addEventListener('click', addTrackedTable);

    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        await addTrackedTable();
      }
    });

    listEl.addEventListener('click', handleClick);
    listEl.addEventListener('change', handleChange);
    listEl.addEventListener('toggle', handleToggle, true);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;

      if (
        changes[TRACKED_TABLES_KEY] ||
        changes[TRACKED_TABLE_STATES_KEY] ||
        changes[SELECTED_TRACKED_TABLE_KEY] ||
        changes[UI_TRACKED_TABLES_OPEN_KEY]
      ) {
        renderTrackedTables().catch(() => {});
      }
    });
  }

  await renderTrackedTables();
}
