export function catchOptions(raw = {}) {
  const integer = (v, fallback, min) => Number.isFinite(Number(v))
    ? Math.max(min, Math.floor(Number(v))) : fallback;
  return {
    historyCount: integer(raw.historyCount ?? 21, 21, 1),
    numbersEnabled: !!raw.numbersEnabled,
    numbersStart: integer(raw.numbersStart ?? 12, 12, 1),
    numberSteps: Array.isArray(raw.numberSteps) && raw.numberSteps.length
      ? raw.numberSteps : [[{ chip: 1, times: 1 }]],
    numbersDouble: !!raw.numbersDouble,
    numbersDoubles: integer(raw.numbersDoubles ?? 3, 3, 0),
  };
}

export function chooseCandidate(matches, logs, count, factors) {
  if (matches.length > 1 && logs.length < count) {
    return { scores: [], chosen: null, waitingHistory: true, available: logs.length };
  }
  const window = logs.slice(-count);
  const scores = matches.map(match => ({
    ...match,
    count: window.filter(e => Number(e.n) !== 0 &&
      factors[match.factor].index(Number(e.n)) === 1 - match.side).length,
  }));
  const min = Math.min(...scores.map(s => s.count));
  const winners = scores.filter(s => s.count === min);
  return { scores, chosen: winners.length === 1 ? winners[0] : null };
}

export function numberItems(cfg, step) {
  if (!cfg.numbersEnabled || step < cfg.numbersStart) return [];
  const offset = step - cfg.numbersStart;
  const items = cfg.numbersDouble ? cfg.numberSteps[0] : cfg.numberSteps[offset];
  if (!items || (cfg.numbersDouble && offset > cfg.numbersDoubles)) return null;
  return items.map(it => ({ chip: Number(it.chip),
    times: Number(it.times) * (cfg.numbersDouble ? 2 ** offset : 1) }));
}
