// src/popup/steps-ui.js

function emitChanged(container) {
  container?.dispatchEvent(
    new CustomEvent('steps:changed', { bubbles: true })
  );
}

export function makeStepItemRow(chipIndex1 = 1, times = 1) {
  const row = document.createElement('div');
  row.className = 'row step-item';
  row.innerHTML = `
    <span class="small">Chip #</span>
    <input type="number" min="1" step="1" class="step-chip-i" value="${chipIndex1}">
    <span class="small">X</span>
    <input type="number" min="1" step="1" class="step-times" value="${times}">
    <button class="btn btn-danger btn-del-item">x</button>
  `;
  const chipInp = row.querySelector('.step-chip-i');
  const timesInp = row.querySelector('.step-times');

  // эмитим на контейнер карточек (stepsBox) через всплытие
  const bubbleTarget = () => row.parentElement?.parentElement; // .step-card

  chipInp.addEventListener('input', () =>
    emitChanged(bubbleTarget())
  );
  timesInp.addEventListener('input', () =>
    emitChanged(bubbleTarget())
  );

  row.querySelector('.btn-del-item').addEventListener('click', () => {
    row.remove();
    emitChanged(bubbleTarget());
  });

  return row;
}

/**
 * Создание карточки шага.
 * opts.emitOnCreate: эмитить steps:changed после добавления карточки (по умолчанию false)
 */
export function makeStepCard(container, items, opts = {}) {
  const { emitOnCreate = false } = opts;

  const card = document.createElement('div');
  card.className = 'step-card';
  card.innerHTML = `
    <div class="row step-head">
      <strong>Step</strong>
      <div class="row gap-tight">
        <button class="btn btn-plain btn-add-item">+ Add item</button>
        <button class="btn btn-danger btn-del-step">Remove step</button>
      </div>
    </div>
    <div class="step-items"></div>
  `;

  const box = card.querySelector('.step-items');
  const src = items && items.length ? items : [{ chip: 1, times: 1 }];
  src.forEach((it) =>
    box.appendChild(makeStepItemRow(it.chip ?? 1, it.times ?? 1))
  );

  card
    .querySelector('.btn-add-item')
    .addEventListener('click', () => {
      box.appendChild(makeStepItemRow());
      emitChanged(container);
    });

  card
    .querySelector('.btn-del-step')
    .addEventListener('click', () => {
      card.remove();
      emitChanged(container);
    });

  container.appendChild(card);
  if (emitOnCreate) emitChanged(container);
  return card;
}

/**
 * Программный рендер. По умолчанию — ТИХИЙ (silent=true), чтобы не сносить состояние.
 */
export function renderSteps(box, steps, { silent = true } = {}) {
  box.innerHTML = '';
  const src =
    Array.isArray(steps) && steps.length
      ? steps
      : [[{ chip: 1, times: 1 }]];
  src.forEach((st) => makeStepCard(box, st, { emitOnCreate: false }));
  if (!silent) emitChanged(box);
}

/**
 * Хелпер для кнопки «+ Add step»: добавляет НОВУЮ карточку и эмитит одно событие.
 */
export function addStep(box, items = [{ chip: 1, times: 1 }]) {
  makeStepCard(box, items, { emitOnCreate: true });
}

export function getStepsFromUI(box) {
  const out = [];
  box.querySelectorAll('.step-card').forEach((card) => {
    const items = [];
    card.querySelectorAll('.step-item').forEach((it) => {
      const iVal = Number(it.querySelector('.step-chip-i').value);
      const tVal = Number(it.querySelector('.step-times').value);
      if (
        Number.isFinite(iVal) &&
        iVal >= 1 &&
        Number.isFinite(tVal) &&
        tVal >= 1
      ) {
        items.push({
          chip: Math.floor(iVal),
          times: Math.floor(tVal),
        });
      }
    });
    if (items.length) out.push(items);
  });
  return out;
}
