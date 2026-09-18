import './recovery-policy.js';
const P = globalThis.CTMChatRecovery;
const CHANNEL = 'ctm-chatgpt-recovery-v1', KEY = 'ctmChatRecoveryV1', PREFS = 'ctmChatRecoveryOptionsV1';
const PAGE_KEY = 'ctmChatRecoveryPageV1';
const ALARM = 'ctm-chatgpt-recovery-pulse';
// A delayed browser task must not replay an old reservation after sleep/reload.
const CLAIM_TTL_MS = 15 * 1000;
let queue = Promise.resolve();
const serial = (fn) => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
const read = async () => (await chrome.storage.session.get(KEY))[KEY] || {};
const write = (data) => chrome.storage.session.set({ [KEY]: data });
const readPages = async () => (await chrome.storage.session.get(PAGE_KEY))[PAGE_KEY] || {};
const writePages = (data) => chrome.storage.session.set({ [PAGE_KEY]: data });
const safePost = (port, data) => { try { port.postMessage(data); } catch { /* Disconnected: never replay an action. */ } };

function isChatGptPageOrigin(origin) {
  try {
    return ['chatgpt.com', 'chat.openai.com'].includes(P.chatgptHost(new URL(origin).hostname));
  } catch { return false; }
}

async function rememberPage(tabId, url) {
  const chatId = P.conversationKey(url);
  if (!Number.isInteger(tabId) || !chatId) return chatId;
  const pages = await readPages();
  pages[tabId] = { url, chatId, at: Date.now() };
  const stale = Object.entries(pages).filter(([, value]) => !value?.at || Date.now() - value.at > 6 * 60 * 60 * 1000);
  for (const [id] of stale) delete pages[id];
  await writePages(pages);
  return chatId;
}

async function tabContext(id, url, chatId) {
  const tab = await chrome.tabs.get(id);
  const pages = await readPages();
  const hint = pages[id];
  const key = P.resolveConversationKey({
    pageUrl: url || hint?.url,
    tabUrl: tab.url,
    chatId: chatId || hint?.chatId,
  });
  if (!key) throw new Error('Open a saved ChatGPT conversation first.');
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

function view(slot, tabId, extra = {}) {
  return {
    enabled: !!slot?.enabled && slot.tabId === tabId,
    generation: slot?.generation || '',
    options: P.options(slot?.options),
    attempts: slot?.state?.attempts || 0,
    status: slot?.state?.status || 'Off: enable only the conversation you want to watch',
    chatId: extra.chatId || '',
    applied: extra.applied === true,
  };
}

function emptySlot(tabId, opts, now = Date.now()) {
  return {
    tabId, enabled: false, generation: '', options: opts,
    state: { ...P.initial(now), status: 'Off: watch disabled' },
    updatedAt: now, token: '', sendToken: '',
  };
}

async function persistPrefs(opts) {
  await chrome.storage.local.set({ [PREFS]: opts });
}

async function prune(db, keepKey) {
  const oldest = Object.keys(db).filter((k) => k !== keepKey && !db[k].enabled).sort((a, b) => db[a].updatedAt - db[b].updatedAt);
  while (Object.keys(db).length > 50 && oldest.length) delete db[oldest.shift()];
  if (Object.keys(db).length > 50) throw new Error('Too many monitored conversations. Disable an old one first.');
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CHANNEL) return;
  const sender = port.sender;
  const ui = sender?.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
  let pageOrigin = '';
  try { pageOrigin = new URL(sender?.url).origin; } catch {}
  const page = sender?.id === chrome.runtime.id && sender.tab && sender.frameId === 0
    && typeof sender.documentId === 'string' && sender.documentId.length > 0
    && isChatGptPageOrigin(pageOrigin);
  if (!ui && !page) { port.disconnect(); return; }
  port.onMessage.addListener((message) => {
    if (!message || typeof message.id !== 'string' || message.id.length > 80) return;
    void serial(async () => {
      const tabId = ui ? message.tabId : sender.tab.id;
      if (page && message.url) await rememberPage(tabId, message.url);
      const { key } = await tabContext(tabId, message.url, message.chatId);
      const db = await read(); let slot = db[key];
      const chatId = key;

      if (message.type === 'prefs') {
        const opts = P.options(message.options);
        await persistPrefs(opts);
        if (slot) {
          slot.options = opts;
          slot.updatedAt = Date.now();
          db[key] = slot;
          await write(db);
        }
        return view(slot, tabId, { chatId });
      }

      if (message.type === 'set') {
        const opts = P.options(message.options);
        await persistPrefs(opts);
        const enabling = message.enabled === true;
        if (!enabling) {
          slot = slot ? { ...slot, tabId, enabled: false, token: '', sendToken: '', options: opts, updatedAt: Date.now() } : emptySlot(tabId, opts);
          slot.state = { ...slot.state, status: 'Off: watch disabled' };
          db[key] = slot;
          await prune(db, key);
          await write(db);
          return view(slot, tabId, { chatId });
        }
        const rearm = message.rearm === true || !slot?.enabled || slot.tabId !== tabId;
        slot = {
          tabId, enabled: true,
          generation: rearm ? crypto.randomUUID() : (slot.generation || crypto.randomUUID()),
          options: opts,
          state: rearm ? P.initial(Date.now()) : slot.state,
          updatedAt: Date.now(), token: '', sendToken: '',
        };
        db[key] = slot;
        await prune(db, key);
        await write(db);
        await ensureAlarm();
        wake(tabId);
        return view(slot, tabId, { chatId, applied: rearm });
      }

      if (message.type === 'get' || (page && message.type === 'hello')) {
        const response = view(slot, tabId, { chatId });
        if (!slot) response.options = P.options((await chrome.storage.local.get(PREFS))[PREFS]);
        return response;
      }

      if (page && message.type === 'arm_followup') {
        const nextKey = P.resolveConversationKey({ pageUrl: message.url, chatId: message.chatId });
        if (!nextKey) throw new Error('Branch follow-up needs a new conversation id.');
        if (!slot?.enabled || slot.tabId !== tabId) return view(slot, tabId, { chatId });
        if (nextKey === key) return view(slot, tabId, { chatId });
        const opts = P.options(slot.options);
        const follow = {
          tabId, enabled: true, generation: crypto.randomUUID(), options: opts,
          state: P.initial(Date.now()), updatedAt: Date.now(), token: '', sendToken: '',
          followUpFrom: key,
        };
        slot.enabled = false; slot.token = ''; slot.sendToken = '';
        slot.state = { ...slot.state, status: 'Paused: MCP disabled source; follow-up armed on the new chat' };
        slot.updatedAt = Date.now();
        db[key] = slot;
        db[nextKey] = follow;
        await prune(db, nextKey);
        await write(db);
        await rememberPage(tabId, message.url);
        await ensureAlarm();
        wake(tabId);
        return view(follow, tabId, { chatId: nextKey, applied: true });
      }

      if (!page || !slot?.enabled || slot.tabId !== tabId || message.generation !== slot.generation) return view(slot, tabId, { chatId });
      if (message.type === 'pause') {
        slot.enabled = false; slot.token = ''; slot.sendToken = ''; slot.state.status = 'Paused: manual Stop or unsafe page action';
        await write(db); return view(slot, tabId, { chatId });
      }
      if (message.type === 'observe') {
        const sample = P.snapshot(message.sample);
        const sync = (await chrome.storage.session.get('activeSyncJob')).activeSyncJob;
        if (sync) sample.blocked = true;
        const outcome = P.observe(slot.state, sample, slot.options, Date.now());
        slot.state = outcome.state; slot.updatedAt = Date.now();
        if (sample.manualStop) slot.enabled = false;
        const plan = outcome.action ? {
          kind: outcome.action, key, fingerprint: sample.fingerprint,
          generation: slot.generation, token: crypto.randomUUID(), prompt: slot.options.prompt,
        } : null;
        if (plan) {
          slot.token = plan.token; slot.tokenKind = plan.kind;
          slot.tokenDocumentId = sender.documentId;
          slot.tokenExpiresAt = Date.now() + CLAIM_TTL_MS;
          slot.sendToken = '';
        }
        await write(db);
        return { ...view(slot, tabId, { chatId }), plan };
      }
      if (message.type === 'claim' || message.type === 'commit_send') {
        const sample = P.snapshot(message.sample);
        const sync = (await chrome.storage.session.get('activeSyncJob')).activeSyncJob;
        const committing = message.type === 'commit_send';
        const token = committing ? slot.sendToken : slot.token;
        const owns = !!token && message.token === token && slot.tokenDocumentId === sender.documentId;
        const sendKinds = new Set(['send_continue']);
        const allowed = !sync && owns && Date.now() < slot.tokenExpiresAt
          && sample.fingerprint === slot.state.fingerprint
          && !sample.busy && !sample.editing && !sample.blocked && !sample.manualStop
          && (committing
            ? sendKinds.has(slot.tokenKind) && slot.options.autoContinue && message.draftHash === P.hash(slot.options.prompt)
            : !sample.draft || slot.tokenKind === 'send_branch');
        if (owns) {
          if (committing) slot.sendToken = '';
          else {
            slot.token = '';
            slot.sendToken = allowed && sendKinds.has(slot.tokenKind) ? token : '';
          }
          await write(db);
        }
        return { ...view(slot, tabId, { chatId }), allowed };
      }
      throw new Error('Unknown recovery request.');
    }).then((data) => safePost(port, { id: message.id, ok: true, ...data }))
      .catch((error) => safePost(port, { id: message.id, ok: false, error: error.message }));
  });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM) return;
  void serial(async () => {
    const db = await read(); const slots = Object.values(db).filter((s) => s.enabled);
    if (!slots.length) { await chrome.alarms.clear(ALARM); return; }
    for (const slot of slots) wake(slot.tabId);
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void serial(async () => {
    const db = await read();
    for (const key of Object.keys(db)) if (db[key].tabId === tabId) delete db[key];
    await write(db);
    const pages = await readPages();
    delete pages[tabId];
    await writePages(pages);
  }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { void ensureAlarm().catch(() => {}); });
