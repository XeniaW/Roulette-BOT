function emitChanged(container) {
  container?.dispatchEvent(
    new CustomEvent('steps:changed', { bubbles: true }),
  );
}

function normalizeRange(raw = {}) {
  const from = Math.max(1, Math.floor(Number(raw.from ?? 1)));
  const to = Math.max(from, Math.floor(Number(raw.to ?? from)));
  const rawItems =
    Array.isArray(raw.items) && raw.items.length
      ? raw.items
      : [{ chip: raw.chip ?? 1, times: raw.times ?? 1 }];
  const items = rawItems
    .map((it) => ({
      chip: Math.max(1, Math.floor(Number(it?.chip ?? 1))),
      times: Math.max(1, Math.floor(Number(it?.times ?? 1))),
    }))
    .filter(
      (it) => Number.isFinite(it.chip) && Number.isFinite(it.times),
    );

  return {
    from,
    to,
    items: items.length ? items : [{ chip: 1, times: 1 }],
  };
}

function makeRangeItemRow(container, item = { chip: 1, times: 1 }) {
  const row = document.createElement('div');
  row.className = 'row step-item range-item';
  row.innerHTML = `
    <span class="small">Chip #</span>
    <input type="number" min="1" step="1" class="range-chip-i" value="${item.chip ?? 1}">
    <span class="small">X</span>
    <input type="number" min="1" step="1" class="range-times" value="${item.times ?? 1}">
    <button class="btn btn-danger btn-del-item">x</button>
  `;

  row.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => emitChanged(container));
  });

  row.querySelector('.btn-del-item')?.addEventListener('click', () => {
    row.remove();
    emitChanged(container);
  });

  return row;
}

export function makeRangeCard(container, range, opts = {}) {
  const { emitOnCreate = false } = opts;
  const clean = normalizeRange(range);
  const card = document.createElement('div');
  card.className = 'step-card range-step-card';
  card.innerHTML = `
    <div class="row row-wrap range-step-row">
      <span class="small">Spins</span>
      <input type="number" min="1" step="1" class="range-from" value="${clean.from}">
      <span class="small">-</span>
      <input type="number" min="1" step="1" class="range-to" value="${clean.to}">
      <button class="btn btn-plain btn-add-item">+ Add item</button>
      <button class="btn btn-danger btn-del-step">Remove</button>
    </div>
    <div class="range-items"></div>
  `;

  card.querySelectorAll('.range-from,.range-to').forEach((input) => {
    input.addEventListener('input', () => emitChanged(container));
  });

  const itemsBox = card.querySelector('.range-items');
  clean.items.forEach((item) =>
    itemsBox.appendChild(makeRangeItemRow(container, item)),
  );

  card.querySelector('.btn-add-item')?.addEventListener('click', () => {
    itemsBox.appendChild(makeRangeItemRow(container));
    emitChanged(container);
  });

  card.querySelector('.btn-del-step')?.addEventListener('click', () => {
    card.remove();
    emitChanged(container);
  });

  container.appendChild(card);
  if (emitOnCreate) emitChanged(container);
  return card;
}

export function renderRanges(box, ranges, { silent = true } = {}) {
  if (!box) return;
  box.innerHTML = '';
  const src =
    Array.isArray(ranges) && ranges.length
      ? ranges
      : [{ from: 1, to: 37, items: [{ chip: 1, times: 1 }] }];
  src.forEach((range) =>
    makeRangeCard(box, range, { emitOnCreate: false }),
  );
  if (!silent) emitChanged(box);
}

export function addRange(
  box,
  range = { from: 1, to: 37, items: [{ chip: 1, times: 1 }] },
) {
  if (!box) return;
  makeRangeCard(box, range, { emitOnCreate: true });
}

export function getRangesFromUI(box) {
  const out = [];
  if (!box) return out;

  box.querySelectorAll('.range-step-card').forEach((card) => {
    const from = Number(card.querySelector('.range-from')?.value);
    const to = Number(card.querySelector('.range-to')?.value);

    if (
      !Number.isFinite(from) ||
      from < 1 ||
      !Number.isFinite(to) ||
      to < 1
    ) {
      return;
    }

    const items = [];
    card.querySelectorAll('.range-item').forEach((row) => {
      const chip = Number(row.querySelector('.range-chip-i')?.value);
      const times = Number(row.querySelector('.range-times')?.value);

      if (
        Number.isFinite(chip) &&
        chip >= 1 &&
        Number.isFinite(times) &&
        times >= 1
      ) {
        items.push({
          chip: Math.floor(chip),
          times: Math.floor(times),
        });
      }
    });

    if (!items.length) return;

    const cleanFrom = Math.floor(from);
    out.push({
      from: cleanFrom,
      to: Math.max(cleanFrom, Math.floor(to)),
      items,
    });
  });

  return out;
}
