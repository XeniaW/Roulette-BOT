const CS_ID = 'cs_all';

async function unregisterAll() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CS_ID] });
  } catch {}
}

async function getGrantedOrigins() {
  const perms = await chrome.permissions.getAll();
  return Array.from(new Set(perms.origins || []));
}

async function registerCS() {
  const origins = await getGrantedOrigins();
  await unregisterAll();
  if (!origins.length) return;

  // Порядок важен: engine -> base -> strategies
  await chrome.scripting.registerContentScripts([
    {
      id: CS_ID,
      js: [
        'content.js',
        'auto/engine.js',
        'auto/market-base.js',
        'auto/dozens.js',
        'auto/rows.js',
      ],
      matches: origins,
      runAt: 'document_idle',
      allFrames: true,
      persistAcrossSessions: true,
    },
  ]);
}

// Seed defaults once, request them, then register
chrome.runtime.onInstalled.addListener(async () => {
  const { domains = [] } = await chrome.storage.local.get({
    domains: [],
  });
  const defaults = [
    'https://play.livetables.io/*',
    'https://*.livetables.io/*',
  ];
  const next = [...new Set([...domains, ...defaults])];
  await chrome.storage.local.set({ domains: next });

  try {
    await chrome.permissions.request({ origins: defaults });
  } catch {}
  await registerCS();
});

chrome.runtime.onStartup.addListener(registerCS);

// Popup → re-register after domain changes
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'REREGISTER_CS') {
    registerCS()
      .then(() => sendResponse(true))
      .catch(() => sendResponse(false));
    return true;
  }
});
