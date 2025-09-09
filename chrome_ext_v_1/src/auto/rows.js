/* src/auto/rows.js
   РЯДЫ (колонны):
   Остаток по модулю 3 → колонна → кнопка:
   - n % 3 === 1 → колонна 1 → #index-702
   - n % 3 === 2 → колонна 2 → #index-701
   - n % 3 === 0 → колонна 3 → #index-700
*/
(() => {
  const DEFAULT_CFG = Object.freeze({
    chipSelectorTemplate: '[data-e2e="chip-{{value}}"]',
    chipValues: [0.2, 1, 5, 20],
    placeButtonSel: null,
    triggerStreak: 2, // сколько одинаковых рядов подряд для входа
    steps: [
      [{ chip: 1, times: 1 }],
      [{ chip: 1, times: 3 }],
      [{ chip: 2, times: 2 }],
      [
        { chip: 3, times: 1 },
        { chip: 2, times: 1 },
      ],
    ],
  });

  const $ = (sel) => document.querySelector(sel);

  // Порядок важен и соответствует колоночным индексам 0..2:
  // 0 → ряд 1 → #index-702
  // 1 → ряд 2 → #index-701
  // 2 → ряд 3 → #index-700
  const rowButtons = [
    $('#index-702'),
    $('#index-701'),
    $('#index-700'),
  ];

  // Возвращаем ИМЕННО индекс колонки 0..2:
  // 0 = колонна 1 (n%3===1), 1 = колонна 2 (n%3===2), 2 = колонна 3 (n%3===0)
  function rowIndex(n) {
    if (n === 0) return -1;
    const r = n % 3;
    if (r === 1) return 0; // колонна 1
    if (r === 2) return 1; // колонна 2
    if (r === 0) return 2; // колонна 3
    return -1;
  }

  // Два других ряда (как у дюжин)
  function otherTwo(skip) {
    return [0, 1, 2].filter((i) => i !== skip);
  }

  // Маппинг индекса колонки → DOM-кнопка
  function getRowNode(idx) {
    // соответствующий заранее кешированный элемент или fallback query
    if (idx === 0)
      return rowButtons[0] || document.querySelector('#index-702');
    if (idx === 1)
      return rowButtons[1] || document.querySelector('#index-701');
    // idx === 2
    return rowButtons[2] || document.querySelector('#index-700');
  }

  class RowsStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'rows',
        cfgKey: 'abRowsConfig',
        enabledKey: 'autoBettingRowsEnabled',
        statusKey: 'bettingStatusRows',
        execKey: 'betExecRows',
        getIndex: rowIndex,
        getOthers: otherTwo,
        getTargetNode: getRowNode,
        defaultCfg: DEFAULT_CFG,
      });
    }

    // Для сообщений хотим видеть «1/2/3», где 1 — колонна (n%3===1)
    label(idx) {
      return idx + 1;
    }
  }

  window.__STRAT_ROWS__ = new RowsStrategy();

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_ROWS__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_ROWS__.init(),
      { once: true }
    );

  window.addEventListener('beforeunload', () => {
    window.__STRAT_ROWS__.destroyed = true;
  });
})();
