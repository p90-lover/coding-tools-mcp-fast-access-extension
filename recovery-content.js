(() => {
  'use strict';
  if (globalThis.__ctmRecoveryLoaded) return;
  globalThis.__ctmRecoveryLoaded = true;
  const P = globalThis.CTMChatRecovery, CHANNEL = 'ctm-chatgpt-recovery-v1';
  let port = null, sequence = 0, config = { enabled: false }, running = false;
  let localPause = false, lastInput = 0, writing = false, lastUrl = '', connectedGeneration = '';
  const pending = new Map();
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const nativeUi = el => visible(el) && !el.closest('pre,code,blockquote,.markdown,[data-message-author-role="user"]');
  const label = el => (el?.getAttribute('aria-label') || el?.textContent || '').trim();
  const usable = el => nativeUi(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const buttons = root => [...(root?.querySelectorAll('button,[role="button"]') || [])].filter(usable);
  const composer = () => document.querySelector('#prompt-textarea,textarea[data-testid="prompt-textarea"]');
  const text = el => (el?.value ?? el?.textContent ?? '').trim();
  // The composer/Stop control can be a sibling of the transcript, not inside main.
  const stopButton = () => buttons(document).find(el =>
    el.matches('[data-testid="stop-button"]') || /^(stop generating|stop response|停止生成|停止產生|停止回應)$/i.test(label(el)));
  function attachmentPresent(editor) {
    const root = editor?.closest('form') || editor?.parentElement?.parentElement;
    return !!root && ([...root.querySelectorAll('input[type="file"]')].some(el => el.files?.length)
      || [...root.querySelectorAll('[data-testid*="attachment"],[data-testid*="file-thumbnail"],button[aria-label^="Remove file"]')].some(visible));
  }
  function inspect() {
    const main = document.querySelector('main,[role="main"]'), editor = composer();
    const messages = [...(main?.querySelectorAll('[data-message-author-role]') || [])];
    const user = messages.filter(el => el.getAttribute('data-message-author-role') === 'user').at(-1);
    const afterUser = user ? messages.slice(messages.indexOf(user) + 1) : [];
    const assistant = afterUser.filter(el => el.getAttribute('data-message-author-role') === 'assistant').at(-1);
    const turnSelector = '[data-testid^="conversation-turn-"],article';
    // A failed final response may be a separate turn after an interim assistant message.
    // Ignore nested/quoted articles and historical turns preceding the latest user message.
    const turns = [...(main?.querySelectorAll(turnSelector) || [])].filter(el =>
      nativeUi(el) && !el.parentElement?.closest(turnSelector));
    const turn = turns.filter(el => user && !el.contains(user)
      && (user.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1)
      || assistant?.closest(turnSelector);
    const alerts = [...(main?.querySelectorAll('[role="alert"],[data-testid*="error"],.text-token-danger') || [])]
      .filter(el => nativeUi(el) && (!el.closest('[data-testid^="conversation-turn-"],article') || turn?.contains(el)));
    const errors = alerts.map(el => text(el)).join(' ').slice(0, 4000);
    const blockedText = /too many requests|rate limit|usage limit|reached.{0,30}limit|sign in|log in|verify.{0,20}human|captcha|tool.{0,30}disabled|permission|approval|使用上限|已達上限|达到上限|驗證|验证|登入|登錄|權限|批准/i;
    const failureText = /something went wrong|error (in|generating)|network error|failed to (generate|fetch)|unable to (generate|load)|發生錯誤|出現錯誤|发生错误|生成.{0,8}(失敗|失败)|網路錯誤|网络错误/i;
    const choices = buttons(turn);
    const retry = choices.find(el => /^(try again|retry|regenerate(?: response)?|重新嘗試|再試一次|重試|重试|重新生成|重新產生)$/i.test(label(el)));
    const more = choices.find(el => /^(continue generating|繼續產生|繼續生成|继续生成)$/i.test(label(el)));
    const lastText = text(assistant).slice(-600);
    const needsInput = /[?？]\s*$|please (approve|confirm|choose|provide)|need(s)? (your|my) (input|approval|confirmation)|task (is )?(complete|completed|done)|all (done|finished)|任務已完成|任务已完成|全部完成|請.{0,12}(確認|批准|提供)|需要.{0,8}(輸入|批准|確認)/i.test(lastText);
    const busy = !!stopButton() || [...(main?.querySelectorAll('[aria-busy="true"],[data-is-streaming="true"],.result-streaming,[data-testid="thinking-indicator"]') || [])].some(visible);
    const manualStop = localPause || /you stopped this response|response stopped|你已停止|您已停止|已停止回應|已停止生成/i.test(errors + ' ' + lastText);
    const blocked = !main || !editor || blockedText.test(errors)
      || [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].some(visible)
      || buttons(main).some(el => /^(approve|allow|confirm|批准|允許|允许|確認|确认)$/i.test(label(el)));
    const userKey = user ? P.hash(user.getAttribute('data-message-id') || `${messages.indexOf(user)}:${text(user)}`) : 'none';
    return { sample: { hasUser: !!user, userKey, userTextHash: P.hash(text(user)),
      fingerprint: P.hash(`${userKey}:${assistant?.getAttribute('data-message-id') || ''}:${text(assistant)}:${errors}:${!!retry}:${!!more}`),
      busy, blocked, manualStop, draft: !!text(editor) || attachmentPresent(editor), editing: Date.now() - lastInput < 10000,
      error: failureText.test(errors), retry: !!retry, continueButton: !!more,
      finished: !!assistant && !needsInput && choices.some(el => el.matches('[data-testid="copy-turn-action-button"],[data-testid="good-response-turn-action-button"],[data-testid="bad-response-turn-action-button"]')) },
      retry, more, editor };
  }
  function rpc(data) {
    return new Promise((resolve, reject) => {
      try {
        if (!port) {
          port = chrome.runtime.connect({ name: CHANNEL });
          const current = port;
          port.onMessage.addListener(reply => {
            const item = pending.get(reply.id); if (!item) return;
            clearTimeout(item.timer); pending.delete(reply.id);
            reply.ok ? item.resolve(reply) : item.reject(new Error(reply.error || 'Recovery request failed'));
          });
          port.onDisconnect.addListener(() => {
            void chrome.runtime.lastError;
            if (port === current) port = null;
            for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Recovery worker disconnected')); }
            pending.clear();
          });
        }
        const id = String(++sequence);
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Recovery request timed out')); }, 5000);
        pending.set(id, { resolve, reject, timer });
        port.postMessage({ ...data, id, url: location.href, generation: config.generation });
      } catch (error) { reject(error); }
    });
  }
  function accept(next) {
    if (next.generation && next.generation !== connectedGeneration) {
      connectedGeneration = next.generation; localPause = false;
    }
    config = next;
  }
  async function hello() {
    lastUrl = location.href;
    if (!P.conversationKey(lastUrl)) { config.enabled = false; return; }
    accept(await rpc({ type: 'hello' }));
  }
  async function pause() {
    localPause = true; config.enabled = false;
    try { accept(await rpc({ type: 'pause' })); } catch { /* Local latch still prevents actions. */ }
  }
  function unchanged(plan, state) {
    return config.enabled && !localPause && plan.generation === config.generation && plan.key === P.conversationKey(location.href)
      && plan.fingerprint === state.sample.fingerprint && !state.sample.busy && !state.sample.blocked
      && !state.sample.draft && !state.sample.editing && !state.sample.manualStop;
  }
  async function execute(plan) {
    let fresh = inspect();
    if (!unchanged(plan, fresh)) return;
    const claim = await rpc({ type: 'claim', token: plan.token, sample: fresh.sample });
    fresh = inspect();
    if (!claim.allowed || !unchanged(plan, fresh)) return;
    if (plan.kind === 'retry' && fresh.sample.error && usable(fresh.retry)) { fresh.retry.click(); return; }
    if (plan.kind === 'continue_button' && usable(fresh.more)) { fresh.more.click(); return; }
    if (plan.kind !== 'send_continue' || !fresh.sample.finished || !config.options?.autoContinue) return;
    const editor = fresh.editor, started = Date.now();
    writing = true;
    try {
      editor.focus();
      if (editor instanceof HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, plan.prompt);
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: plan.prompt }));
      } else if (!editor.isContentEditable || !document.execCommand('insertText', false, plan.prompt)) {
        await pause(); return; // Never replace editor HTML or overwrite a draft.
      }
    } finally { writing = false; }
    for (let i = 0; i < 15; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const current = inspect();
      if (!config.enabled || plan.generation !== config.generation || localPause || lastInput > started
          || current.sample.fingerprint !== plan.fingerprint || plan.key !== P.conversationKey(location.href)
          || current.sample.busy || current.sample.blocked || current.sample.manualStop || attachmentPresent(editor)
          || P.hash(text(editor)) !== P.hash(plan.prompt) || !editor.isConnected) { await pause(); return; }
      const root = editor.closest('form') || editor.parentElement?.parentElement;
      const send = buttons(root).find(el => el.matches('[data-testid="send-button"],#composer-submit-button')
        || /^(send prompt|send message|傳送提示|傳送訊息|發送訊息|发送消息)$/i.test(label(el)));
      if (send) {
        // The popup can disable/re-arm while we wait for the editor to enable Send.
        // Re-authorize once, then re-read the DOM without another asynchronous gap.
        const permission = await rpc({ type: 'commit_send', token: plan.token,
          sample: current.sample, draftHash: P.hash(text(editor)) });
        const final = inspect();
        if (!permission.allowed || !permission.enabled || permission.generation !== plan.generation
            || !config.enabled || config.generation !== plan.generation || localPause || lastInput > started
            || plan.key !== P.conversationKey(location.href) || final.sample.fingerprint !== plan.fingerprint
            || final.sample.busy || final.sample.blocked || final.sample.manualStop || attachmentPresent(editor)
            || P.hash(text(editor)) !== P.hash(plan.prompt) || !editor.isConnected || !usable(send)) {
          await pause(); return;
        }
        send.click(); return;
      }
    }
    await pause(); // Leave the visible draft for the user if the native Send control is unavailable.
  }
  async function tick() {
    if (running) return;
    running = true;
    try {
      if (lastUrl !== location.href || !port) await hello();
      if (!config.enabled || localPause) return;
      const result = await rpc({ type: 'observe', sample: inspect().sample });
      accept(result);
      if (result.plan && !localPause) await execute(result.plan);
    } catch { /* No speculative retries after transport failures; next observation checks durable state. */ }
    finally { running = false; }
  }
  document.addEventListener('input', event => { if (event.isTrusted && !writing) lastInput = Date.now(); }, true);
  document.addEventListener('pointerdown', event => {
    if (!event.isTrusted) return;
    const button = event.target.closest?.('button,[role="button"]');
    if (button && button === stopButton()) { void pause(); return; }
    if (event.target.closest?.('#prompt-textarea,textarea')) lastInput = Date.now();
  }, true);
  document.addEventListener('click', event => {
    if (event.isTrusted && event.target.closest?.('button,[role="button"]') === stopButton()) void pause();
  }, true);
  chrome.runtime.onConnect.addListener(incoming => {
    if (incoming.name !== `${CHANNEL}-pulse` || incoming.sender?.id !== chrome.runtime.id) return;
    incoming.onMessage.addListener(() => { void hello().then(tick).catch(() => {}); });
  });
  setInterval(() => { void tick(); }, 5000);
  void hello().then(tick).catch(() => {});
})();
