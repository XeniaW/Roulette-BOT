import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const copy = structuredClone;
const rows = Array.from({ length: 10000 }, (_, i) => ({ n: i % 37, t: i + 1 }));
const data = { trackedTables: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
  selectedTrackedTableId: 'a', trackedTableStates: {
    a: { spinLogs: copy(rows), betLogs: [] }, b: { spinLogs: copy(rows), betLogs: [] },
  } };
const listeners = [];
const pending = new Set();
let handler;
let writes = 0;
let bytes = 0;
let overflow = false;
const local = {
  async get(defaults) {
    return copy(Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, data[k] ?? v])));
  },
  async set(patch) {
    writes++;
    bytes += Buffer.byteLength(JSON.stringify(patch));
    if (writes > 200) { overflow = true; return; }
    const changes = {};
    for (const [key, value] of Object.entries(patch)) {
      if (JSON.stringify(data[key]) !== JSON.stringify(value)) {
        changes[key] = { oldValue: copy(data[key]), newValue: copy(value) };
      }
    }
    Object.assign(data, copy(patch));
    if (!Object.keys(changes).length) return;
    // Chrome delivers changes asynchronously, after storage.set can resolve.
    const task = new Promise(resolve => setImmediate(async () => {
      await Promise.all(listeners.map(fn => fn(copy(changes), 'local')));
      resolve();
    }));
    pending.add(task);
    task.then(() => pending.delete(task));
  },
};
const chrome = { runtime: { id: 'test',
  onInstalled: { addListener() {} }, onStartup: { addListener() {} },
  onMessage: { addListener(fn) { handler = fn; } },
}, storage: { local, onChanged: { addListener(fn) { listeners.push(fn); } } } };
vm.runInNewContext(readFileSync(new URL('../src/bg.js', import.meta.url), 'utf8'), { chrome, console });
const request = (msg, tab = 1) => new Promise((resolve, reject) => {
  if (!handler(msg, { tab: { id: tab }, frameId: 0 }, resolve)) reject(new Error(msg.type));
});
async function settle() {
  await new Promise(resolve => setImmediate(resolve));
  while (pending.size) await Promise.all([...pending]);
}
await request({ type: 'TRACKED_TABLE_HELLO', title: 'A' });
await request({ type: 'TRACKED_TABLE_HELLO', title: 'B' }, 2);
await settle();
const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8')
  .replace('init().catch(() => {});', 'tracked = initialTracked; running = true;');
for (const [tableId, tabId, balance] of [['a', 1, 100], ['b', 2, 200]]) {
  const win = { addEventListener() {} }; win.top = {};
  vm.runInNewContext(contentSource, {
    initialTracked: { tableId, title: tableId.toUpperCase(), role: 'leader' },
    window: win, location: { href: `https://test.invalid/${tableId}` },
    document: { querySelector: selector => selector.includes('balance-value')
      ? { textContent: String(balance) } : null, querySelectorAll: () => [] },
    chrome: { runtime: { id: 'test', sendMessage: msg => request(msg, tabId) }, storage: chrome.storage },
  });
}
writes = 0; bytes = 0;
// Two rapid global writers plus two table-local writers used to create an
// endless global -> table -> global feedback loop when events arrived late.
await Promise.all([
  local.set({ betLogs: [{ t: 1, message: 'legacy one' }] }),
  local.set({ betLogs: [{ t: 2, message: 'legacy two' }] }),
  request({ type: 'CATCH_TABLE_APPEND_BET_LOG', tableId: 'a', entry: { t: 3, message: 'A only' } }),
  request({ type: 'CATCH_TABLE_APPEND_BET_LOG', tableId: 'b', entry: { t: 4, message: 'B only' } }, 2),
]);
await settle();
console.log(`Two-table delayed storage: ${writes} writes, ${bytes} serialized bytes`);
assert.equal(overflow, false, 'storage feedback loop must terminate');
assert.ok(writes < 30, 'a small log burst must not amplify into hundreds of writes');
assert.equal(data.trackedTableStates.a.spinLogs.length, 10000);
assert.equal(data.trackedTableStates.b.spinLogs.length, 10000);
for (const message of ['legacy one', 'legacy two', 'A only']) {
  assert.equal(data.trackedTableStates.a.betLogs.filter(e => e.message === message).length, 1);
}
assert.deepEqual(data.trackedTableStates.b.betLogs.map(e => e.message), ['B only']);

writes = 0; bytes = 0;
for (let i = 0; i < 10; i++) {
  await request({ type: 'TRACKED_TABLE_HEARTBEAT', title: 'A' });
  await request({ type: 'TRACKED_TABLE_HEARTBEAT', title: 'B' }, 2);
}
await settle();
assert.ok(bytes < 100000, 'heartbeats must not rewrite spin histories');
console.log(`20 heartbeats: ${writes} writes, ${bytes} serialized bytes`);
console.log('Asynchronous storage performance scenarios passed');
