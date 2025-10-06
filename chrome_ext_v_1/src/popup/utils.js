// src/popup/utils.js
export const TIME_FMT = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};
export const LOCALE = navigator.language || 'en-US';

export async function sget(defs) {
  try {
    return await chrome.storage.local.get(defs || {});
  } catch {
    return defs || {};
  }
}
export async function sset(obj) {
  try {
    await chrome.storage.local.set(obj);
  } catch {}
}

export function fmtTime(x) {
  const t = typeof x === 'number' ? x : Date.parse(x);
  return new Date(t).toLocaleString(LOCALE, TIME_FMT);
}

export function renderDots(hostEl, filledCount, max) {
  const fill = Math.max(0, Math.floor(Number(filledCount || 0)));
  const total = Math.max(1, Math.floor(Number(max || 1)));
  let html = '';
  for (let i = 0; i < total; i++)
    html += `<span class="dot${i < fill ? ' filled' : ''}"></span>`;
  hostEl.innerHTML = html;
}
