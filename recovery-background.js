import './recovery-policy.js';
const P = globalThis.CTMChatRecovery;
const CHANNEL = 'ctm-chatgpt-recovery-v1', KEY = 'ctmChatRecoveryV1', PREFS = 'ctmChatRecoveryOptionsV1';
const ALARM = 'ctm-chatgpt-recovery-pulse';
// A delayed browser task must not replay an old reservation after sleep/reload.
const CLAIM_TTL_MS = 15 * 1000;
let queue = Promise.resolve();
const serial = (fn) => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
const read = async () => (await chrome.storage.session.get(KEY))[KEY] || {};
const write = (data) => chrome.storage.session.set({ [KEY]: data });
const safePost = (port, data) => { try { port.postMessage(data); } catch { /* Disconnected: never replay an action. */ } };
async function tabContext(id, url) {
  const tab = await chrome.tabs.get(id);
  const key = P.conversationKey(tab.url);
  if (!key || (url && key !== P.conversationKey(url))) throw new Error('Open a saved ChatGPT conversation first.');
  return { tab, key };
}
function wake(tabId) {
  // Dedicated ports avoid competing with the existing OAuth runtime.onMessage handler.
  try {
    const port = chrome.tabs.connect(tabId, { name: `${CHANNEL}-pulse`, frameId: 0 });
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; });
    port.postMessage({ type: 'pulse' });
    setTimeout(() => { try { port.disconnect(); } catch {} }, 1000);
  } catch { /* Closed/discarded tabs are not reopened. */ }
}
async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
}
function view(slot, tabId) {
  return { enabled: !!slot?.enabled && slot.tabId === tabId, generation: slot?.generation || '',
    options: P.options(slot?.options), attempts: slot?.state?.attempts || 0,
    status: slot?.state?.status || 'Off: enable only the conversation you want to watch' };
}
function snapshot(input) {
  if (!input || typeof input !== 'object') throw new Error('Missing page state.');
  const output = {};
  for (const field of ['userKey','fingerprint','userTextHash']) {
    if (typeof input[field] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input[field])) throw new Error('Invalid turn identity.');
    output[field] = input[field];
  }
  for (const field of ['hasUser','busy','blocked','draft','editing','manualStop','error','retry','continueButton','finished']) output[field] = input[field] === true;
  return output;
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CHANNEL) return;
  const sender = port.sender;
  const ui = sender?.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
  let pageOrigin = '';
  try { pageOrigin = new URL(sender?.url).origin; } catch {}
  const page = sender?.id === chrome.runtime.id && sender.tab && sender.frameId === 0
    && typeof sender.documentId === 'string' && sender.documentId.length > 0
    && ['https://chatgpt.com', 'https://chat.openai.com'].includes(pageOrigin);
  if (!ui && !page) { port.disconnect(); return; }
  port.onMessage.addListener((message) => {
    if (!message || typeof message.id !== 'string' || message.id.length > 80) return;
    void serial(async () => {
      const tabId = ui ? message.tabId : sender.tab.id;
      const { key } = await tabContext(tabId, page ? message.url : null);
      const db = await read(); let slot = db[key];
      if (ui && message.type === 'set') {
        const opts = P.options(message.options);
        slot = { tabId, enabled: message.enabled === true, generation: crypto.randomUUID(), options: opts,
          state: P.initial(Date.now()), updatedAt: Date.now(), token: '' };
        db[key] = slot;
        // Bound metadata retention; only explicitly enabled conversations are kept active.
        const oldest = Object.keys(db).filter(k => k !== key && !db[k].enabled).sort((a,b) => db[a].updatedAt - db[b].updatedAt);
        while (Object.keys(db).length > 50 && oldest.length) delete db[oldest.shift()];
        if (Object.keys(db).length > 50) throw new Error('Too many monitored conversations. Disable an old one first.');
        await write(db); await chrome.storage.local.set({ [PREFS]: opts });
        if (slot.enabled) await ensureAlarm();
        wake(tabId);
        return view(slot, tabId);
      }
      if (message.type === 'get' || (page && message.type === 'hello')) {
        const response = view(slot, tabId);
        if (!slot) response.options = P.options((await chrome.storage.local.get(PREFS))[PREFS]);
        return response;
      }
      if (!page || !slot?.enabled || slot.tabId !== tabId || message.generation !== slot.generation) return view(slot, tabId);
      if (message.type === 'pause') {
        slot.enabled = false; slot.token = ''; slot.sendToken = ''; slot.state.status = 'Paused: manual Stop or unsafe page action';
        await write(db); return view(slot, tabId);
      }
      if (message.type === 'observe') {
        const sample = snapshot(message.sample);
        // Never race the extension's own MCP setup/OAuth automation.
        const sync = (await chrome.storage.session.get('activeSyncJob')).activeSyncJob;
        if (sync) sample.blocked = true;
        const outcome = P.observe(slot.state, sample, slot.options, Date.now());
        slot.state = outcome.state; slot.updatedAt = Date.now();
        if (sample.manualStop) slot.enabled = false;
        const plan = outcome.action ? { kind: outcome.action, key, fingerprint: sample.fingerprint,
          generation: slot.generation, token: crypto.randomUUID(), prompt: slot.options.prompt } : null;
        if (plan) {
          slot.token = plan.token; slot.tokenKind = plan.kind;
          slot.tokenDocumentId = sender.documentId;
          slot.tokenExpiresAt = Date.now() + CLAIM_TTL_MS;
          slot.sendToken = '';
        }
        await write(db); // Reserve BEFORE delivering; worker restart/duplicate tabs cannot replay.
        return { ...view(slot, tabId), plan };
      }
      if (message.type === 'claim' || message.type === 'commit_send') {
        const sample = snapshot(message.sample);
        const sync = (await chrome.storage.session.get('activeSyncJob')).activeSyncJob;
        const committing = message.type === 'commit_send';
        const token = committing ? slot.sendToken : slot.token;
        const owns = !!token && message.token === token && slot.tokenDocumentId === sender.documentId;
        const allowed = !sync && owns && Date.now() < slot.tokenExpiresAt
          && sample.fingerprint === slot.state.fingerprint
          && !sample.busy && !sample.editing && !sample.blocked && !sample.manualStop
          && (committing ? slot.tokenKind === 'send_continue' && slot.options.autoContinue
            && message.draftHash === P.hash(slot.options.prompt) : !sample.draft);
        if (owns) {
          if (committing) slot.sendToken = '';
          else {
            slot.token = '';
            slot.sendToken = allowed && slot.tokenKind === 'send_continue' ? token : '';
          }
          await write(db); // Consume each phase before returning its authorization.
        }
        return { ...view(slot, tabId), allowed };
      }
      throw new Error('Unknown recovery request.');
    }).then(data => safePost(port, { id: message.id, ok: true, ...data }))
      .catch(error => safePost(port, { id: message.id, ok: false, error: error.message }));
  });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM) return;
  void serial(async () => {
    const db = await read(); const slots = Object.values(db).filter(s => s.enabled);
    if (!slots.length) { await chrome.alarms.clear(ALARM); return; }
    for (const slot of slots) wake(slot.tabId);
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => {
  void serial(async () => {
    const db = await read();
    for (const key of Object.keys(db)) if (db[key].tabId === tabId) delete db[key];
    await write(db);
  }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { void ensureAlarm().catch(() => {}); });
