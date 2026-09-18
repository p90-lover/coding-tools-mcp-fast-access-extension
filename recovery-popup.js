const $ = (id) => document.getElementById(id);
const enabled = $('recoveryEnabled'), more = $('recoveryContinue'), delay = $('recoveryDelay');
const max = $('recoveryMax'), prompt = $('recoveryPrompt'), status = $('recoveryStatus'), apply = $('recoveryApply');
const longTask = $('recoveryLongTask'), doNotSpam = $('recoveryDoNotSpam'), chat = $('recoveryChat');
let tabId, port, seq = 0, saving = false, last = null;
const pending = new Map();

function request(type, extra = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++seq);
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Recovery worker timed out. Reopen the popup.')); }, 5000);
    pending.set(id, { resolve, reject, timer });
    try { port.postMessage({ id, type, tabId, ...extra }); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

function optionsFromForm() {
  return {
    autoContinue: more.checked,
    longTask: longTask.checked,
    doNotSpam: doNotSpam.checked,
    idleSeconds: Number(delay.value),
    maxActions: Number(max.value),
    prompt: prompt.value,
  };
}

function render(result) {
  last = result;
  enabled.checked = result.enabled;
  more.checked = result.options.autoContinue;
  longTask.checked = result.options.longTask;
  doNotSpam.checked = result.options.doNotSpam !== false;
  delay.value = result.options.idleSeconds;
  max.value = result.options.maxActions;
  if (document.activeElement !== prompt) prompt.value = result.options.prompt;
  const chatId = result.chatId || '';
  chat.textContent = chatId ? `Chat ID: ${chatId}` : 'Chat ID: open a saved ChatGPT /c/{id} tab';
  const watch = result.enabled ? 'Watch ON' : 'Watch OFF';
  const saved = result.applied ? 'Re-armed' : 'Saved';
  status.textContent = `${watch} · ${saved} · ${result.status} · ${result.attempts}/${result.options.maxActions}`;
}

async function savePrefs() {
  if (saving) return;
  saving = true;
  apply.disabled = true;
  try { render(await request('prefs', { options: optionsFromForm() })); }
  catch (error) { enabled.checked = last?.enabled === true; status.textContent = error.message; }
  finally { saving = false; apply.disabled = false; }
}

async function saveWatch() {
  if (saving) return;
  saving = true;
  apply.disabled = true;
  try {
    render(await request('set', {
      enabled: enabled.checked,
      rearm: false,
      options: optionsFromForm(),
    }));
  } catch (error) {
    enabled.checked = false;
    status.textContent = error.message;
  } finally { saving = false; apply.disabled = false; }
}

async function rearm() {
  if (saving) return;
  saving = true;
  apply.disabled = true;
  try {
    enabled.checked = true;
    render(await request('set', { enabled: true, rearm: true, options: optionsFromForm() }));
  } catch (error) { enabled.checked = false; status.textContent = error.message; }
  finally { saving = false; apply.disabled = false; }
}

enabled.addEventListener('change', () => { void saveWatch(); });
more.addEventListener('change', () => { void savePrefs(); });
longTask.addEventListener('change', () => { void savePrefs(); });
doNotSpam.addEventListener('change', () => { void savePrefs(); });
delay.addEventListener('change', () => { void savePrefs(); });
max.addEventListener('change', () => { void savePrefs(); });
prompt.addEventListener('change', () => { void savePrefs(); });
apply.addEventListener('click', () => { void rearm(); });

try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open the ChatGPT conversation you want to watch.');
  tabId = tab.id;
  port = chrome.runtime.connect({ name: 'ctm-chatgpt-recovery-v1' });
  port.onMessage.addListener((reply) => {
    const item = pending.get(reply.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(reply.id);
    reply.ok ? item.resolve(reply) : item.reject(new Error(reply.error));
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    enabled.disabled = apply.disabled = true;
    status.textContent = 'Worker disconnected. Reopen the popup; saved recovery state is retained.';
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Worker disconnected')); }
    pending.clear();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.ctmChatRecoveryOptionsV1 && !saving) {
      void request('get').then(render).catch((error) => { status.textContent = error.message; });
    }
  });
  render(await request('get'));
  enabled.disabled = apply.disabled = false;
} catch (error) {
  enabled.disabled = apply.disabled = true;
  status.textContent = error.message;
}
