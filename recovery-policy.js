/* Shared, side-effect-free decisions; no page text or credentials are persisted. */
(() => {
  'use strict';
  const DEFAULT_PROMPT = 'Continue the unfinished task from the last verified step. Do not repeat completed actions. If the task is complete or needs my input or approval, stop and tell me.';
  function hash(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    let a = 2166136261, b = 3339675911;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619);
      b = Math.imul(b ^ text.charCodeAt(i), 2246822519);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  function conversationKey(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || !['chatgpt.com', 'chat.openai.com'].includes(u.hostname) || u.port) return null;
      return u.pathname.match(/(?:^|\/)c\/([a-zA-Z0-9-]{8,128})\/?$/)?.[1] || null;
    } catch { return null; }
  }
  function options(input = {}) {
    const number = (v, fallback, min, max) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : fallback;
    return { autoContinue: input.autoContinue === true,
      idleSeconds: number(input.idleSeconds ?? 30, 30, 15, 600),
      maxActions: number(input.maxActions ?? 3, 3, 1, 20),
      prompt: typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt.trim().slice(0, 1000) : DEFAULT_PROMPT };
  }
  function initial(now) {
    return { userKey: '', fingerprint: '', changedAt: now, attempts: 0, lastActionAt: 0,
      waiting: false, sawBusy: false, expectedUserHash: '', status: 'Watching' };
  }
  function observe(previous, sample, config, now) {
    const state = { ...previous }, opts = options(config);
    const result = (status, action = null) => { state.status = status; return { state, action }; };
    if (!sample.hasUser || !sample.userKey || !sample.fingerprint) return result('Waiting for a conversation turn');
    if (sample.userKey !== state.userKey) {
      const automatic = state.expectedUserHash && sample.userTextHash === state.expectedUserHash;
      if (!automatic) { state.attempts = 0; state.lastActionAt = 0; }
      state.userKey = sample.userKey; state.expectedUserHash = ''; state.waiting = false; state.sawBusy = false;
    }
    if (sample.fingerprint !== state.fingerprint) {
      state.fingerprint = sample.fingerprint; state.changedAt = now;
      // A changed rendered turn is proof of progress, not proof a request succeeded.
      state.waiting = false;
    }
    if (sample.manualStop) return result('Paused: you stopped the response');
    if (sample.blocked) { state.changedAt = now; return result('Paused: permission, login, limit or dialog needs attention'); }
    if (sample.draft || sample.editing) { state.changedAt = now; return result('Paused: composer or recent user input'); }
    if (sample.busy) {
      state.changedAt = now;
      if (state.waiting) state.sawBusy = true;
      return result('Working: never interrupting generation or tools');
    }
    if (state.sawBusy) { state.waiting = false; state.sawBusy = false; state.changedAt = now; }
    if (state.attempts >= opts.maxActions) return result('Safety limit reached: send a new message or re-arm');
    if (state.waiting) return result('Waiting for progress after the last action');
    const delay = opts.idleSeconds * 1000;
    if (now - state.changedAt < delay || (state.lastActionAt && now - state.lastActionAt < delay * 2 ** Math.min(state.attempts, 5))) {
      return result('Waiting for a stable page / retry cooldown');
    }
    const action = sample.continueButton ? 'continue_button'
      : sample.error && sample.retry ? 'retry'
      : !sample.error && sample.finished && opts.autoContinue ? 'send_continue' : null;
    if (!action) return result(sample.error ? 'Error visible: no safe Retry control found' : 'Idle: no recovery needed');
    state.attempts++; state.lastActionAt = now; state.waiting = true; state.sawBusy = false;
    if (action === 'send_continue') state.expectedUserHash = hash(opts.prompt);
    return result(`Action ${state.attempts}/${opts.maxActions}: ${action}`, action);
  }
  globalThis.CTMChatRecovery = Object.freeze({ hash, conversationKey, options, initial, observe });
})();
