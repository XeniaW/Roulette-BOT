import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { catchOptions, chooseCandidate, numberItems } from '../src/shared/catch-options.js';

const copy = value => structuredClone(value);
const tables = [
  { id: 'a', title: 'Roulette', enabled: true },
  { id: 'b', title: 'VIP Roulette', enabled: true },
];
const data = { trackedTables: tables, trackedTableStates: {},
  autoBettingCatchXMatchEnabled: true };
const listeners = [];
const storageEvents = new Set();
let writes = 0;
let messageHandler;
const storage = {
  async get(defaults) {
    return copy(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, data[k] ?? v])));
  },
  async set(patch) {
    assert.ok(++writes < 1000, 'storage changes must not cause an event loop');
    const changes = {};
    for (const [key, value] of Object.entries(patch)) {
      if (JSON.stringify(data[key]) !== JSON.stringify(value)) {
        changes[key] = { oldValue: copy(data[key]), newValue: copy(value) };
      }
    }
    Object.assign(data, copy(patch));
    if (!Object.keys(changes).length) return;
    for (const listener of listeners) {
      const event = Promise.resolve(listener(copy(changes), 'local'));
      storageEvents.add(event);
      event.finally(() => storageEvents.delete(event));
    }
  },
};
const chrome = { runtime: { id: 'test',
  onInstalled: { addListener() {} }, onStartup: { addListener() {} },
  onMessage: { addListener(fn) { messageHandler = fn; } },
}, storage: { local: storage, onChanged: { addListener(fn) { listeners.push(fn); } } } };
vm.runInNewContext(readFileSync(new URL('../src/bg.js', import.meta.url), 'utf8'), { chrome, console });
const sender = (tabId, title) => ({ tab: { id: tabId, title }, frameId: 0 });
const frameSender = (tabId, frameId, title = 'Casino') =>
  ({ tab: { id: tabId, title }, frameId });
const request = (msg, from) => new Promise((resolve, reject) => {
  const handled = messageHandler(msg, from, resolve);
  if (!handled) reject(new Error(`Unhandled message: ${msg.type}`));
});
const hello = (tabId, title, tabTitle = title) => request(
  { type: 'TRACKED_TABLE_HELLO', title }, sender(tabId, tabTitle));
const lookup = tabId => request({ type: 'GET_TRACKED_TABLE_FOR_TAB' }, sender(tabId));
const frameLookup = (tabId, frameId) => request(
  { type: 'GET_TRACKED_TABLE_FOR_TAB' }, frameSender(tabId, frameId));
const append = (tabId, tableId, nums, start) => request({
  type: 'TRACKED_TABLE_APPEND_SPINS', tableId,
  spins: nums.map((n, i) => ({ n, t: start + i })),
}, sender(tabId));

// Exact DOM title wins over a shorter configured name and the browser title.
assert.equal((await hello(2, 'VIP Roulette', 'Roulette')).tableId, 'b');
assert.equal((await hello(1, 'Roulette')).tableId, 'a');
assert.equal((await lookup(1)).tableId, 'a');
assert.equal((await lookup(2)).tableId, 'b');

// Simultaneous appends must not overwrite either table's history.
await Promise.all([append(1, 'a', [10, 24], 100), append(2, 'b', [31, 11], 200)]);
assert.deepEqual(data.trackedTableStates.a.spinLogs.map(e => e.n), [10, 24]);
assert.deepEqual(data.trackedTableStates.b.spinLogs.map(e => e.n), [31, 11]);
assert.equal((await append(2, 'a', [8], 300)).ignored, true);

// Concurrent strategy writes preserve both recovery chains and both logs.
await Promise.all([
  request({ type: 'CATCH_TABLE_SET_EXEC', tableId: 'a', exec: { step: 5, debt: 31 } }, sender(1)),
  request({ type: 'CATCH_TABLE_SET_EXEC', tableId: 'b', exec: { step: 2, debt: 1 } }, sender(2)),
  request({ type: 'CATCH_TABLE_APPEND_BET_LOG', tableId: 'a', entry: { message: 'A only' } }, sender(1)),
  request({ type: 'CATCH_TABLE_APPEND_BET_LOG', tableId: 'b', entry: { message: 'B only' } }, sender(2)),
]);
assert.equal(data.betExecCatchXMatchByTable.a.step, 5);
assert.equal(data.betExecCatchXMatchByTable.b.step, 2);
assert.equal(data.trackedTableBetLogsByTable.a[0].message, 'A only');
assert.equal(data.trackedTableBetLogsByTable.b[0].message, 'B only');
assert.deepEqual(data.trackedTableStates.a.spinLogs.map(e => e.n), [10, 24]);
assert.deepEqual(data.trackedTableStates.b.spinLogs.map(e => e.n), [31, 11]);
assert.equal((await request({ type: 'CATCH_TABLE_SET_EXEC', tableId: 'a', exec: { step: 99 } }, sender(2))).ignored, true);
assert.equal(data.betExecCatchXMatchByTable.a.step, 5);

// A duplicate tab must not inherit the original table's permission to act.
assert.equal((await hello(3, 'Roulette')).role, 'standby');
assert.equal((await lookup(3)).matched, false);

// Rebinding a tab must remove its old lease, not keep returning the first one.
await request({ type: 'TRACKED_TABLE_RELEASE', tableId: 'b' }, sender(2));
assert.equal((await hello(1, 'VIP Roulette')).tableId, 'b');
assert.equal((await lookup(1)).tableId, 'b');
assert.equal((await append(1, 'a', [8], 301)).ignored, true);
assert.equal((await hello(1, 'Untracked table', 'Untracked table')).matched, false);
assert.equal((await lookup(1)).matched, false);

// A decorated title still identifies the most specific configured table.
assert.equal((await hello(4, 'Play VIP Roulette live')).tableId, 'b');
await request({ type: 'TRACKED_TABLE_RELEASE', tableId: 'b' }, sender(4));
// A generic DOM header must not hide a usable browser-tab title.
assert.equal((await hello(4, 'Live casino', 'VIP Roulette')).tableId, 'b');
await request({ type: 'TRACKED_TABLE_RELEASE', tableId: 'b' }, sender(4));
// Distinct complete names in a single title are genuinely ambiguous.
data.trackedTables.push({ id: 'c', title: 'French Table', enabled: true });
assert.equal((await hello(4, 'VIP Roulette / French Table')).matched, false);
// The old tracker also accepted a unique shortened DOM name.
assert.equal((await hello(4, 'French', 'Casino')).tableId, 'c');
await request({ type: 'TRACKED_TABLE_RELEASE', tableId: 'c' }, sender(4));
data.trackedTables = copy(tables);
while (storageEvents.size) await Promise.all([...storageEvents]);

// Two game frames in one tab must not inherit one another's table.
assert.equal((await request({ type: 'TRACKED_TABLE_HELLO', title: 'Roulette' }, frameSender(9, 101))).tableId, 'a');
assert.equal((await frameLookup(9, 102)).matched, false);
assert.equal((await request({ type: 'TRACKED_TABLE_HELLO', title: 'VIP Roulette' }, frameSender(9, 102))).tableId, 'b');
assert.equal((await frameLookup(9, 101)).tableId, 'a');
assert.equal((await frameLookup(9, 102)).tableId, 'b');
assert.equal((await request({ type: 'TRACKED_TABLE_APPEND_SPINS', tableId: 'b', spins: [{ n: 11, t: 999 }] }, frameSender(9, 101))).ignored, true);
await request({ type: 'TRACKED_TABLE_RELEASE', tableId: 'a' }, frameSender(9, 101));
await request({ type: 'TRACKED_TABLE_RELEASE', tableId: 'b' }, frameSender(9, 102));

// Exercise content.js -> background -> storage, including the title-bearing
// parent page and the separate game iframe where the spin list lives.
const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8')
  .replace('init().catch(() => {});',
    'globalThis.trackerTest = { cycle, handleMutations, get tracked() { return tracked; } };');
const requests = new Set();
async function settle() {
  while (requests.size || storageEvents.size) {
    await Promise.all([...requests, ...storageEvents]);
  }
}
function tracker(tabId, tabTitle, frameId, header = '') {
  let nums = [0];
  const box = { isConnected: true,
    querySelectorAll: () => nums.map(n => ({ getAttribute: () => `cell-${n}` })) };
  const win = { addEventListener() {} };
  win.top = frameId === 0 ? win : {};
  const context = vm.createContext({ window: win, location: { href: 'https://test.invalid/game' },
    document: {
      querySelector(selector) {
        if (selector.includes('casino-control-bar__title')) return header ? { textContent: header } : null;
        if (selector === '[data-name="previous-spins-stack"]') return frameId ? box : null;
        if (selector.includes('balance-value')) return { textContent: '100' };
        return null;
      },
      querySelectorAll(selector) {
        return header && selector.includes('casino-control-bar__title')
          ? [{ textContent: header }] : [];
      },
    },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval() {}, clearTimeout() {},
    chrome: { runtime: { id: 'test', sendMessage(msg) {
      const pending = request(msg, { ...sender(tabId, tabTitle), frameId });
      requests.add(pending);
      pending.finally(() => requests.delete(pending));
      return pending;
    } }, storage: { local: storage } },
  });
  vm.runInContext(contentSource, context);
  return { ...context.trackerTest, spin(n) {
    nums = [n, ...nums];
    context.trackerTest.handleMutations();
  } };
}
data.trackingEnabled = true;
data.trackedTableStates = { a: { spinLogs: [] }, b: { spinLogs: [] } };
await tracker(22, 'Live casino', 0, 'Live casino').cycle();
const frameA = tracker(22, 'Live casino', 101, 'Roulette');
const frameB = tracker(22, 'Live casino', 102, 'VIP Roulette');
await frameA.cycle();
await frameB.cycle();
await settle();
frameA.spin(10);
frameB.spin(31);
await settle();
frameA.spin(24);
frameB.spin(11);
await settle();
assert.deepEqual(data.trackedTableStates.a.spinLogs.map(e => e.n), [10, 24]);
assert.deepEqual(data.trackedTableStates.b.spinLogs.map(e => e.n), [31, 11]);
console.log('Content iframe spin collection and tab-title fallback scenarios passed');

// User's X=4 scenario through two independent strategy contexts.
class Mutex {
  tail = Promise.resolve();
  run(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
}
const strategySource = readFileSync(new URL('../src/auto/catch-x-match.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const cfg = { ...catchOptions(), historyCount: 4, triggerCount: 4, maxIncreases: 3,
  steps: Array.from({ length: 4 }, () => [{ chip: 1, times: 1 }]) };
const bets = [];
function market(tableId) {
  const changes = [];
  const context = vm.createContext({ catchOptions, chooseCandidate, numberItems,
    BET: { Mutex, setBetStatus() {}, sget: storage.get,
      getTrackedTableForThisTab: async () => ({ tableId }) },
    chrome: { storage: { onChanged: { addListener(fn) { changes.push(fn); } } } },
    window: { addEventListener() {} }, document: { readyState: 'loading' },
  });
  vm.runInContext(strategySource, context);
  const bot = context.window.__STRAT_CATCH_X_MATCH__;
  bot.canActInThisFrame = () => true;
  bot.loadCfg = async () => cfg;
  const execs = new Map();
  bot.getExec = async id => copy(execs.get(id) ?? { enabled: true, phase: 'idle', step: 1, debt: 0, blocked: [] });
  bot.setExec = async (id, exec) => { execs.set(id, copy(exec)); };
  bot.logEvent = async () => {};
  bot.placeTargets = async (id, exec, targets, matches) => {
    bets.push({ tableId: id, step: exec.step, targets: copy(targets) });
    const next = { ...exec, phase: 'armed', targets, match: matches, activeStake: 1 };
    await bot.setExec(id, next);
    return { ok: true, exec: next };
  };
  bot.attachStorageListener();
  return { bot, execs, changes };
}
const a = market('a');
const b = market('b');
async function deliver(tableId, n, t) {
  const oldValue = copy(data.trackedTableStates);
  data.trackedTableStates[tableId].spinLogs.push({ n, t });
  const change = { trackedTableStates: { oldValue, newValue: copy(data.trackedTableStates) } };
  await Promise.all([...a.changes, ...b.changes].map(fn => fn(change, 'local')));
}
data.trackedTableStates = { a: { spinLogs: [] }, b: { spinLogs: [] } };
await deliver('a', 10, 1);
await deliver('b', 31, 2);
await deliver('a', 24, 3);
await deliver('b', 11, 4);
assert.equal(bets.length, 0, 'two plus two spins are not a four-spin signal');
await deliver('a', 8, 5);
await deliver('a', 17, 6);
assert.equal(bets.length, 1);
assert.equal(bets[0].tableId, 'a');
assert.equal(bets[0].targets[0].factor, 'colors');
assert.equal(bets[0].targets[0].side, 0);
assert.equal(b.execs.get('b').phase, 'idle');
await deliver('a', 26, 7); // loss on A must not advance B
assert.equal(a.execs.get('a').step, 2);
assert.equal(b.execs.get('b').step, 1);
await deliver('b', 20, 8);
await deliver('b', 26, 9);
assert.equal(bets.length, 2);
assert.equal(bets[1].tableId, 'b');
assert.equal(bets[1].step, 1);

// An event queued before navigation cannot import A's history into B.
const before = copy(b.execs.get('b'));
await b.bot.onSpin(8, [10, 24, 8, 17].map((n, t) => ({ n, t })), 'a');
assert.deepEqual(b.execs.get('b'), before);
assert.equal(bets.length, 2);
console.log('Table routing, concurrent history and independent X=4 scenarios passed');
