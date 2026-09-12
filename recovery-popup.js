const $ = id => document.getElementById(id);
const enabled = $('recoveryEnabled'), more = $('recoveryContinue'), delay = $('recoveryDelay');
const max = $('recoveryMax'), prompt = $('recoveryPrompt'), status = $('recoveryStatus'), apply = $('recoveryApply');
let tabId, port, seq = 0;
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
function render(result) {
  enabled.checked = result.enabled;
  more.checked = result.options.autoContinue;
  delay.value = result.options.idleSeconds; max.value = result.options.maxActions;
  prompt.value = result.options.prompt;
  status.textContent = `${result.status} · ${result.attempts}/${result.options.maxActions} automatic actions`;
}
async function save() {
  apply.disabled = true;
  try {
    render(await request('set', { enabled: enabled.checked, options: {
      autoContinue: more.checked, idleSeconds: Number(delay.value), maxActions: Number(max.value), prompt: prompt.value } }));
  } catch (error) { enabled.checked = false; status.textContent = error.message; }
  finally { apply.disabled = false; }
}
enabled.addEventListener('change', save);
apply.addEventListener('click', save);
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open the ChatGPT conversation you want to watch.');
  tabId = tab.id;
  port = chrome.runtime.connect({ name: 'ctm-chatgpt-recovery-v1' });
  port.onMessage.addListener(reply => {
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
  render(await request('get')); enabled.disabled = apply.disabled = false;
} catch (error) { enabled.disabled = apply.disabled = true; status.textContent = error.message; }
