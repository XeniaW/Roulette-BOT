import { tgl } from './dom.js';

export async function loadToggle() {
  const { trackingEnabled = false } = await chrome.storage.local.get({
    trackingEnabled: false,
  });
  if (tgl) tgl.checked = !!trackingEnabled;
}

export function setToggle(val) {
  chrome.storage.local.set({ trackingEnabled: !!val });
}
