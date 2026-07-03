function emitChanged(container) {
  container?.dispatchEvent(
    new CustomEvent('steps:changed', { bubbles: true }),
  );
}

function normalizeRange(raw = {}) {
  const from = Math.max(1, Math.floor(Number(raw.from ?? 1)));
  const to = Math.max(from, Math.floor(Number(raw.to ?? from)));
  const first = Array.isArray(raw.items) ? raw.items[0] : null;

  return {
    from,
    to,
    chip: Math.max(1, Math.floor(Number(first?.chip ?? raw.chip ?? 1))),
    times: Math.max(
      1,
      Math.floor(Number(first?.times ?? raw.times ?? 1)),
    ),
  };
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
      <span class="small">Chip #</span>
      <input type="number" min="1" step="1" class="range-chip-i" value="${clean.chip}">
      <span class="small">X</span>
      <input type="number" min="1" step="1" class="range-times" value="${clean.times}">
      <button class="btn btn-danger btn-del-step">Remove</button>
    </div>
  `;

  card.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => emitChanged(container));
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
    const chip = Number(card.querySelector('.range-chip-i')?.value);
    const times = Number(card.querySelector('.range-times')?.value);

    if (
      Number.isFinite(from) &&
      from >= 1 &&
      Number.isFinite(to) &&
      to >= 1 &&
      Number.isFinite(chip) &&
      chip >= 1 &&
      Number.isFinite(times) &&
      times >= 1
    ) {
      const cleanFrom = Math.floor(from);
      out.push({
        from: cleanFrom,
        to: Math.max(cleanFrom, Math.floor(to)),
        items: [
          {
            chip: Math.floor(chip),
            times: Math.floor(times),
          },
        ],
      });
    }
  });

  return out;
}
