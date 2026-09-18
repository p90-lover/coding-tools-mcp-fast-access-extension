(() => {
  'use strict';
  if (globalThis.__ctmRecoveryHudLoaded) return;
  globalThis.__ctmRecoveryHudLoaded = true;
  const P = globalThis.CTMChatRecovery, CHANNEL = 'ctm-chatgpt-recovery-v1';
  let port = null, sequence = 0, saving = false, lastView = null;
  const pending = new Map();
  const httpLog = [];
  let networkModel = '', networkEffort = '', networkAt = 0;

  function rpc(data) {
    return new Promise((resolve, reject) => {
      try {
        if (!port) {
          port = chrome.runtime.connect({ name: CHANNEL });
          const current = port;
          port.onMessage.addListener((reply) => {
            const item = pending.get(reply.id); if (!item) return;
            clearTimeout(item.timer); pending.delete(reply.id);
            reply.ok ? item.resolve(reply) : item.reject(new Error(reply.error || 'HUD request failed'));
          });
          port.onDisconnect.addListener(() => {
            void chrome.runtime.lastError;
            if (port === current) port = null;
            for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('HUD worker disconnected')); }
            pending.clear();
          });
        }
        const id = String(++sequence);
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('HUD request timed out')); }, 5000);
        pending.set(id, { resolve, reject, timer });
        port.postMessage({
          ...data, id, url: location.href, chatId: P.conversationKey(location.href),
          generation: lastView?.generation,
        });
      } catch (error) { reject(error); }
    });
  }

  const css = `
    :host { all: initial; }
    .shell {
      width: 320px; max-width: min(320px, 92vw);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #e8eaed; background: #1c1d21; border: 1px solid rgba(255,255,255,.12);
      border-radius: 12px; padding: 12px; display: grid; gap: 8px;
      box-shadow: 0 10px 28px rgba(0,0,0,.28);
    }
    header { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
    h1 { margin: 0; font-size: 14px; line-height: 1.2; }
    .sub { margin: 3px 0 0; font-size: 11px; opacity: .68; }
    .badge { font-size: 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 3px 7px; white-space: nowrap; }
    .badge.on { border-color: #8fd19e; color: #8fd19e; }
    .chat { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; opacity: .86; overflow-wrap: anywhere; }
    .check { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.35; }
    .check input { width: 15px; height: 15px; margin: 1px 0 0; }
    label { font-size: 11px; font-weight: 650; }
    textarea, button { font: inherit; }
    textarea {
      width: 100%; min-height: 52px; border-radius: 8px; border: 1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.04); color: inherit; padding: 7px 8px; font-size: 11px; resize: vertical;
    }
    .actions { display: grid; grid-template-columns: 1fr; gap: 6px; }
    button {
      min-height: 32px; border-radius: 8px; padding: 6px 10px; cursor: pointer;
      background: #f4f4f5; color: #111; border: 1px solid transparent; font-size: 12px; font-weight: 650;
    }
    button.secondary { background: transparent; color: inherit; border-color: rgba(255,255,255,.18); }
    button:disabled { opacity: .45; cursor: progress; }
    .hint, .status { margin: 0; font-size: 11px; line-height: 1.4; opacity: .78; overflow-wrap: anywhere; }
    .status.ok { color: #8fd19e; opacity: 1; }
    .status.warn { color: #e6c07b; opacity: 1; }
    details { border-top: 1px solid rgba(255,255,255,.08); padding-top: 6px; }
    summary { cursor: pointer; font-size: 11px; font-weight: 650; }
    .http { margin: 6px 0 0; max-height: 140px; overflow: auto; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 10px; line-height: 1.35; opacity: .8; }
    .http div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .model { font-size: 11px; opacity: .82; }
  `;

  function mount() {
    let host = document.getElementById('ctm-recovery-hud-host');
    if (host) return host.shadowRoot;
    host = document.createElement('div');
    host.id = 'ctm-recovery-hud-host';
    host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483646;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${css}</style>
      <div class="shell">
        <header>
          <div>
            <h1>coding-tools-mcp</h1>
            <p class="sub">HUD · Watch / recover this chat</p>
          </div>
          <span id="badge" class="badge">Off</span>
        </header>
        <div class="chat">Chat ID: <span id="chatId">checking…</span></div>
        <div class="model" id="modelLine">Model: waiting for network</div>
        <label class="check"><input id="watch" type="checkbox" /><span>Watch this chat / 監察目前對話</span></label>
        <label class="check"><input id="more" type="checkbox" /><span>Also send “continue” after replies</span></label>
        <label class="check"><input id="longTask" type="checkbox" /><span>Long task / 長任務</span></label>
        <label class="check"><input id="doNotSpam" type="checkbox" checked /><span>Do not spam / 不要洗版</span></label>
        <label for="prompt">Continue message / 繼續訊息</label>
        <textarea id="prompt" maxlength="1000"></textarea>
        <div class="actions">
          <button id="apply" class="secondary" type="button">Re-arm · 重新啟用</button>
        </div>
        <p id="status" class="status" role="status">Checking current chat…</p>
        <p class="hint">Watch, Long task, Do not spam and the continue message save immediately. Re-arm only resets the per-turn budget.</p>
        <details>
          <summary>HTTP (collapsed) / 網路紀錄</summary>
          <div class="http" id="httpLog">No ChatGPT conversation requests yet.</div>
        </details>
      </div>
    `;
    (document.body || document.documentElement).appendChild(host);
    return shadow;
  }

  const root = mount();
  const $ = (id) => root.getElementById(id);
  const watch = $('watch'), more = $('more'), longTask = $('longTask'), doNotSpam = $('doNotSpam');
  const prompt = $('prompt'), apply = $('apply'), status = $('status'), badge = $('badge');
  const chatIdEl = $('chatId'), modelLine = $('modelLine'), httpEl = $('httpLog');

  function currentChatId() {
    return P.conversationKey(location.href) || '';
  }

  function optionsFromForm() {
    return {
      autoContinue: more.checked,
      longTask: longTask.checked,
      doNotSpam: doNotSpam.checked,
      idleSeconds: lastView?.options?.idleSeconds,
      maxActions: lastView?.options?.maxActions,
      prompt: prompt.value,
    };
  }

  function render(view) {
    lastView = view;
    const chatId = view.chatId || currentChatId();
    chatIdEl.textContent = chatId || 'open a saved /c/{id} conversation';
    watch.checked = view.enabled === true;
    more.checked = view.options?.autoContinue === true;
    longTask.checked = view.options?.longTask === true;
    doNotSpam.checked = view.options?.doNotSpam !== false;
    if (document.activeElement !== prompt) prompt.value = view.options?.prompt || P.DEFAULT_PROMPT;
    const watching = view.enabled === true;
    badge.textContent = watching ? 'Watch ON' : 'Watch OFF';
    badge.classList.toggle('on', watching);
    apply.disabled = !chatId;
    watch.disabled = !chatId;
    const applyHint = view.applied ? 'Re-armed. ' : watching ? 'Saved. ' : '';
    status.textContent = `${applyHint}${view.status || (watching ? 'Watching' : 'Off')} · ${view.attempts || 0}/${view.options?.maxActions || 3}`;
    status.className = `status${watching ? ' ok' : ''}`;
    renderModel();
  }

  function renderModel() {
    const model = P.isPlausibleModel(networkModel);
    const effort = P.isEffortLabel(networkEffort);
    if (!model && !effort) {
      modelLine.textContent = 'Model: waiting for network';
      return;
    }
    const age = networkAt ? Math.round((Date.now() - networkAt) / 1000) : 0;
    const bits = [];
    if (model) bits.push(model);
    if (effort) bits.push(`${effort} effort`);
    modelLine.textContent = `Model: ${bits.join(' · ')}${age > 120 ? ' · stale until next network model' : ''}`;
  }

  function renderHttp() {
    if (!httpLog.length) {
      httpEl.textContent = 'No ChatGPT conversation requests yet.';
      return;
    }
    httpEl.innerHTML = httpLog.slice(-24).reverse().map((row) =>
      `<div>${row.status || '…'} ${row.method} ${row.path}${row.ms != null ? ` ${row.ms}ms` : ''}</div>`).join('');
  }

  async function savePrefs() {
    if (saving) return;
    saving = true;
    apply.disabled = true;
    try { render(await rpc({ type: 'prefs', options: optionsFromForm() })); }
    catch (error) { status.textContent = error.message; status.className = 'status warn'; }
    finally { saving = false; apply.disabled = !currentChatId(); }
  }

  async function saveWatch() {
    if (saving) return;
    saving = true;
    apply.disabled = true;
    try {
      render(await rpc({
        type: 'set',
        enabled: watch.checked,
        rearm: false,
        options: optionsFromForm(),
      }));
    } catch (error) {
      watch.checked = false;
      status.textContent = error.message;
      status.className = 'status warn';
    } finally { saving = false; apply.disabled = !currentChatId(); }
  }

  async function rearm() {
    if (saving) return;
    saving = true;
    apply.disabled = true;
    try {
      watch.checked = true;
      render(await rpc({ type: 'set', enabled: true, rearm: true, options: optionsFromForm() }));
    } catch (error) { status.textContent = error.message; status.className = 'status warn'; }
    finally { saving = false; apply.disabled = !currentChatId(); }
  }

  watch.addEventListener('change', () => { void saveWatch(); });
  more.addEventListener('change', () => { void savePrefs(); });
  longTask.addEventListener('change', () => { void savePrefs(); });
  doNotSpam.addEventListener('change', () => { void savePrefs(); });
  prompt.addEventListener('change', () => { void savePrefs(); });
  apply.addEventListener('click', () => { void rearm(); });

  window.addEventListener('ctm-recovery-view', (event) => {
    if (event.detail && !saving) render(event.detail);
  });
  document.addEventListener('ctm-hud-http', (event) => {
    const row = event.detail || {};
    if (row.mcpDisabled) globalThis.__ctmHudMcpDisabled = true;
    const model = P.isPlausibleModel(row.model);
    const effort = P.isEffortLabel(row.effort);
    if (model) { networkModel = model; networkAt = Date.now(); }
    if (effort) { networkEffort = effort; networkAt = Date.now(); }
    if (row.method && row.method !== 'MODEL' && row.method !== 'HINT' && row.path) {
      httpLog.push({ method: row.method, path: row.path, status: row.status, ms: row.ms });
      if (httpLog.length > 40) httpLog.shift();
      renderHttp();
    }
    renderModel();
  });

  async function refresh() {
    try { render(await rpc({ type: 'get' })); }
    catch (error) { status.textContent = error.message; status.className = 'status warn'; }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.ctmChatRecoveryOptionsV1 && !saving) void refresh();
  });
  setInterval(() => {
    const id = currentChatId();
    if (id && chatIdEl.textContent !== id) chatIdEl.textContent = id;
    renderModel();
  }, 1000);
  void refresh();
})();
