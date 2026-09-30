import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { catchOptions, chooseCandidate, numberItems } from '../src/shared/catch-options.js';

const source = readFileSync(new URL('../src/auto/catch-x-match.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const context = vm.createContext({ catchOptions, chooseCandidate, numberItems,
  BET: { Mutex: class {}, setBetStatus() {} },
  window: { addEventListener() {} }, document: { readyState: 'loading' },
});
vm.runInContext(source, context);
const bot = context.window.__STRAT_CATCH_X_MATCH__;
const realPlaceTargets = bot.placeTargets.bind(bot);
bot.setExec = async () => {};
bot.logEvent = async () => {};
bot.placeTargets = async (_id, exec, targets, matches) => ({ exec: { ...exec, match: matches }, targets });
const logs = ns => ns.map((n, t) => ({ n, t: t + 1 }));
const cfg = { ...catchOptions(), historyCount: 6, triggerCount: 4, maxIncreases: 15,
  steps: Array.from({ length: 16 }, () => [{ chip: 1, times: 1 }]) };
const idle = { step: 6, debt: 50, blocked: [] };

// The signal is black+even; count the red/odd candidate sides.
let result = await bot.maybeEnter('t', logs([1, 3, 17, 20, 28, 10, 2]), idle, cfg, 'test');
assert.equal(result.targets.length, 1);
assert.equal(result.targets[0].factor, 'colors');
assert.equal(result.targets[0].side, 0);
result = await bot.maybeEnter('t', logs([1, 3, 20, 28, 10, 2]), idle, cfg, 'test');
assert.equal(result.ok, false);
assert.equal(result.exec.step, 6);
assert.equal(result.exec.debt, 50);
assert.match(result.exec.selectionText, /TIE/);

// Blocked parity must leave a color entry available.
result = await bot.maybeEnter('t', logs([20, 28, 10, 2]),
  { ...idle, blocked: [{ factor: 'evenodd', side: 0 }] }, cfg, 'test');
assert.equal(result.targets[0].factor, 'colors');

// Mixed layout has equal net return to its total stake on any covered number.
const armed = { ...idle, phase: 'armed', targets: [{ factor: 'colors', side: 0 }],
  match: [{ factor: 'colors', side: 1 }], activeStake: 280, lastAmount: 280 };
let next = await bot.resolveArmed('t', logs([1]), armed, cfg, 1);
assert.equal(next.step, 1);
assert.equal(next.debt, 0);
next = await bot.resolveArmed('t', logs([0]), armed, cfg, 0);
assert.equal(next.step, 7);
assert.equal(next.debt, 330);

const mixed = { ...cfg, numbersEnabled: true, numbersStart: 12,
  numbersDouble: true, numbersDoubles: 3, numberSteps: [[{ chip: 2, times: 1 }]] };
assert.deepEqual(numberItems(mixed, 11), []);
assert.equal(numberItems(mixed, 12)[0].times, 1);
assert.equal(numberItems(mixed, 15)[0].times, 8);
assert.equal(numberItems(mixed, 16), null);
const placements = [];
const node = { getAttribute() { return null; } };
const tableRoot = { querySelector() { return node; } };
context.document.querySelector = () => tableRoot;
context.document.getElementById = () => node;
context.window.getComputedStyle = () => ({ pointerEvents: 'auto', visibility: 'visible', display: 'block' });
context.BET.sget = async defaults => defaults;
context.BET.loadGlobalChips = async () => ({ chipValues: [5, 10] });
context.BET.perTargetAmountForStep = (step, steps, values) =>
  steps[step - 1].reduce((sum, item) => sum + values[item.chip - 1] * item.times, 0);
context.BET.tryPlace = async plan => { placements.push(plan.targets); return true; };
bot.logPlaced = async () => {};
await realPlaceTargets('t', { ...idle, step: 12 }, [{ factor: 'lowhigh', side: 0 }],
  [{ factor: 'lowhigh', side: 1 }], mixed, 'test');
assert.equal(placements.length, 2);
assert.equal(placements[0].length, 1);
assert.deepEqual(Array.from(placements[1]), Array.from({ length: 18 }, (_, i) => i + 1));

// The exact reported odd layout: one half plus exactly the odd numbers.
placements.length = 0;
const amounts = [];
const fields = [];
tableRoot.querySelector = selector => { fields.push(selector); return node; };
context.BET.tryPlace = async plan => {
  placements.push(plan.targets);
  amounts.push(context.BET.perTargetAmountForStep(plan.step, plan.steps, [5, 10]));
  plan.targets.forEach(target => plan.getTargetNode(target));
  if (typeof plan.targets[0] === 'number') assert.equal(plan.strictTargetClick, true);
  return true;
};
await realPlaceTargets('t', { ...idle, step: 12 }, [{ factor: 'evenodd', side: 1 }],
  [{ factor: 'evenodd', side: 0 }], { ...mixed, numberSteps: [[{ chip: 1, times: 1 }]] }, 'test');
const expectedOdds = [1,3,5,7,9,11,13,15,17,19,21,23,25,27,29,31,33,35];
assert.deepEqual(Array.from(placements[1]), expectedOdds);
assert.equal(amounts[1], 5);
assert.deepEqual([...new Set(fields)], expectedOdds.map(n => `#index-${100 + n}`));

// Both matching streams are consumed even though only odd is selected.
const cfg3 = { ...cfg, historyCount: 5, triggerCount: 3 };
const sequence = logs([2, 0, 34, 18, 18]);
const entry = await bot.maybeEnter('t', sequence, idle, cfg3, 'test');
assert.equal(entry.targets[0].factor, 'evenodd');
assert.equal(entry.targets[0].side, 1);
next = await bot.resolveArmed('t', [...sequence, { n: 9, t: 6 }], {
  ...entry.exec, targets: entry.targets, phase: 'armed', activeStake: 5,
}, cfg3, 9);
assert.equal(next.step, 1);
assert.equal(next.debt, 0);
result = await bot.maybeEnter('t', [...sequence, { n: 9, t: 6 }], next, cfg3, 'test');
// The red stream is blocked, but 18,18,9 is a newly eligible LOW stream.
assert.equal(result.targets[0].factor, 'lowhigh');
assert.equal(result.targets[0].side, 1);
assert.equal(result.exec.step, 1);
assert.ok(result.exec.blocked.some(b => b.factor === 'colors' && b.side === 0));

// A color win preserves the overlapping even window: 18,24,12.
const colorEntry = await bot.maybeEnter('t', logs([36, 7, 18]), idle, cfg3, 'test');
assert.equal(colorEntry.targets[0].factor, 'colors');
assert.equal(colorEntry.targets[0].side, 1);
const colorWin = await bot.resolveArmed('t', logs([36, 7, 18, 24]), {
  ...colorEntry.exec, targets: colorEntry.targets, phase: 'armed', activeStake: 5,
}, cfg3, 24);
assert.equal(colorWin.step, 1);
assert.equal(colorWin.debt, 0);
const oddEntry = await bot.maybeEnter('t', logs([36, 7, 18, 24, 12]),
  { ...colorWin, collectAfter: 4 }, cfg3, 'test');
assert.equal(oddEntry.targets[0].factor, 'evenodd');
assert.equal(oddEntry.targets[0].side, 1);
assert.equal(oddEntry.exec.step, 1);

// Pre-win observations still determine the choice between opposite halves.
const retainedHistory = await bot.maybeEnter('t', logs([1,3,5,7,9,11,0,34,18,18]),
  { ...colorWin, blocked: [], collectAfter: 7 }, { ...cfg3, historyCount: 10 }, 'test');
assert.equal(retainedHistory.targets[0].factor, 'colors');
assert.match(retainedHistory.exec.selectionText, /BLACK=1/);
assert.match(retainedHistory.exec.selectionText, /ODD=6/);

// No comparison on an incomplete N window, no step/debt reset while waiting.
for (const historyCount of [10, 21]) {
  const windowCfg = { ...cfg3, historyCount };
  const short = logs([0, 34, 18, 18]);
  const waiting = await bot.maybeEnter('t', short, idle, windowCfg, 'test');
  assert.equal(waiting.ok, false);
  assert.equal(waiting.exec.step, idle.step);
  assert.equal(waiting.exec.debt, idle.debt);
  assert.match(waiting.exec.selectionText, new RegExp(`history 4/${historyCount}`));
  const full = logs([...Array(historyCount - 4).fill(2), 0, 34, 18, 18]);
  const selected = await bot.maybeEnter('t', full, waiting.exec, windowCfg, 'test');
  assert.equal(selected.targets.length, 1);
  assert.equal(selected.targets[0].factor, 'evenodd');
  assert.equal(selected.targets[0].side, 1);
  assert.equal(selected.exec.step, idle.step);
  const single = await bot.maybeEnter('t', logs([36, 7, 18]), idle, windowCfg, 'test');
  assert.equal(single.targets[0].factor, 'colors');
}

// A winning target does not reuse the same X-window as a new entry.
const redRun = logs([1, 3, 5]);
next = await bot.resolveArmed('t', redRun, {
  ...armed,
  targets: [{ factor: 'colors', side: 1 }],
  match: [{ factor: 'colors', side: 0 }],
}, cfg, 5);
assert.deepEqual(JSON.parse(JSON.stringify(next.blocked)), [{ factor: 'colors', side: 0 }]);
console.log('Catch X Match regression scenarios passed');

// Exercise the real click dispatcher: exactly one click, and no click when
// coordinates hit another field (including zero) or a stale DOM node.
const events = [];
let nativeCalls = 0;
const field = { isConnected: true, contains: () => false,
  getBoundingClientRect: () => ({ left: 10, top: 20, width: 20, height: 20 }),
  dispatchEvent: event => events.push(event.type), click: () => nativeCalls++ };
let hit = field;
const engineContext = vm.createContext({ window: {},
  document: { elementFromPoint: () => hit },
  MouseEvent: class { constructor(type) { this.type = type; } },
  setTimeout: fn => fn(),
});
const engineSource = readFileSync(new URL('../src/auto/engine.js', import.meta.url), 'utf8')
  .replace('window.BET = {', 'window.BET = { clickElement,');
vm.runInContext(engineSource, engineContext);
const strictClick = () => engineContext.window.BET.clickElement(field,
  { nativeClick: false, strictTargetClick: true });
assert.equal(await strictClick(), true);
assert.equal(events.filter(type => type === 'click').length, 1);
assert.equal(nativeCalls, 0);
events.length = 0;
hit = {};
assert.equal(await strictClick(), false);
assert.equal(events.length, 0);
hit = field;
field.isConnected = false;
assert.equal(await strictClick(), false);
assert.equal(events.length, 0);
console.log('Strict number click scenarios passed');
