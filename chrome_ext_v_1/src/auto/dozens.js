(() => {
  const DEFAULT_CFG = Object.freeze({
    chipSelectorTemplate: '[data-e2e="chip-{{value}}"]',
    chipValues: [0.2, 1, 5, 20],
    placeButtonSel: null,
    triggerStreak: 2,
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
  const dozenButtons = [
    $('#index-800'),
    $('#index-801'),
    $('#index-802'),
  ];

  function dozenIndex(n) {
    if (n === 0) return -1;
    if (n >= 1 && n <= 12) return 0;
    if (n >= 13 && n <= 24) return 1;
    if (n >= 25 && n <= 36) return 2;
    return -1;
  }
  function otherTwo(skip) {
    return [0, 1, 2].filter((d) => d !== skip);
  }
  function getDozenNode(idx) {
    const fallbackSel =
      idx === 0
        ? '#index-800'
        : idx === 1
        ? '#index-801'
        : '#index-802';
    return dozenButtons[idx] || document.querySelector(fallbackSel);
  }

  class DozensStrategy extends window.MarketBase {
    constructor() {
      super({
        marketKey: 'dozens',
        cfgKey: 'abDozensConfig',
        enabledKey: 'autoBettingDozensEnabled',
        statusKey: 'bettingStatusDozens',
        execKey: 'betExecDozens',
        getIndex: dozenIndex,
        getOthers: otherTwo,
        getTargetNode: getDozenNode,
        defaultCfg: DEFAULT_CFG,
      });
    }
  }

  window.__STRAT_DOZENS__ = new DozensStrategy();
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  )
    window.__STRAT_DOZENS__.init();
  else
    window.addEventListener(
      'DOMContentLoaded',
      () => window.__STRAT_DOZENS__.init(),
      { once: true }
    );

  window.addEventListener('beforeunload', () => {
    window.__STRAT_DOZENS__.destroyed = true;
  });
})();
