// bg.js — keeps dynamic registration of content scripts for all granted origins
const CS_IDS = { tracker: 'cs_tracker', bettor: 'cs_bettor' };

// helper: (re)register both content scripts on all granted origins
async function registerCS() {
  const { origins } = await chrome.permissions.getAll();
  // first remove old
  for (const id of Object.values(CS_IDS)) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    } catch {}
  }
  if (!origins || origins.length === 0) return;

  const filesCommon = []; // none for now
  // tracker
  await chrome.scripting.registerContentScripts([
    {
      id: CS_IDS.tracker,
      js: ['content.js'],
      matches: origins,
      runAt: 'document_idle',
      allFrames: true,
      persistAcrossSessions: true,
    },
  ]);

  // bettor
  await chrome.scripting.registerContentScripts([
    {
      id: CS_IDS.bettor,
      js: ['bettor.js'],
      matches: origins,
      runAt: 'document_idle',
      allFrames: true,
      persistAcrossSessions: true,
    },
  ]);
}

chrome.runtime.onInstalled.addListener(async () => {
  // seed default domains in storage (UI will still show them)
  const { domains = [] } = await chrome.storage.local.get({
    domains: [],
  });
  const defaults = [
    'https://play.livetables.io/*',
    'https://*.livetables.io/*',
  ];
  const next = [...new Set([...domains, ...defaults])];
  await chrome.storage.local.set({ domains: next });

  // politely request permissions for defaults (user sees one prompt)
  try {
    await chrome.permissions.request({ origins: defaults });
  } catch {}
  await registerCS();
});

chrome.runtime.onStartup.addListener(registerCS);

// message bus from popup to re-register after domain changes
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'REREGISTER_CS') {
    registerCS()
      .then(() => sendResponse(true))
      .catch(() => sendResponse(false));
    return true;
  }
});
