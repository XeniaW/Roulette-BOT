// Background: lets you dynamically register CS for newly added domains via UI
chrome.runtime.onInstalled.addListener(async () => {
  // Ensure default domain visible in UI list
  const { domains = [] } = await chrome.storage.local.get({
    domains: [],
  });
  if (!domains.includes('https://play.livetables.io/*')) {
    domains.push('https://play.livetables.io/*');
    await chrome.storage.local.set({ domains });
  }
});

async function reregister() {
  const { domains = [] } = await chrome.storage.local.get({
    domains: [],
  });
  // Unregister previous (ignore errors if none)
  try {
    const regs = await chrome.scripting.getRegisteredContentScripts();
    const ids = regs
      .filter((r) => r.id.startsWith('dyn-'))
      .map((r) => r.id);
    if (ids.length)
      await chrome.scripting.unregisterContentScripts({ ids });
  } catch {}

  // Register a dynamic CS for each granted domain
  for (const origin of domains) {
    const hasPerm = await chrome.permissions.contains({
      origins: [origin],
    });
    if (!hasPerm) continue;
    const id = 'dyn-' + origin.replace(/\W+/g, '_');
    try {
      await chrome.scripting.registerContentScripts([
        {
          id,
          matches: [origin],
          js: ['content.js'],
          runAt: 'document_idle',
          allFrames: true,
          persistAcrossSessions: true,
        },
      ]);
    } catch {}
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'REREGISTER_CS') {
    reregister()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
