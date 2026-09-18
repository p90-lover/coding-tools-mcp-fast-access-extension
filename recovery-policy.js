/* Shared, side-effect-free decisions; no page text or credentials are persisted. */
(() => {
  'use strict';
  const DEFAULT_PROMPT = '@coding-tools-mcp keep going';
  const SAMPLE_BOOLS = Object.freeze([
    'hasUser', 'busy', 'blocked', 'draft', 'editing', 'manualStop', 'error', 'retry',
    'continueButton', 'finished', 'thinkingFailed', 'mcpDisabled', 'branchButton',
  ]);
  const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

  function hash(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    let a = 2166136261, b = 3339675911;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619);
      b = Math.imul(b ^ text.charCodeAt(i), 2246822519);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }

  function chatgptHost(hostname) {
    return String(hostname || '').trim().toLowerCase().replace(/^www\./, '');
  }

  function conversationKey(value) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || !CHATGPT_HOSTS.has(chatgptHost(u.hostname)) || u.port) return null;
      // /c/{id}, nested GPT/project routes, and /c/{id}/branch after SPA navigation.
      return u.pathname.match(/(?:^|\/)c\/([a-zA-Z0-9-]{8,128})(?:\/|$)/)?.[1] || null;
    } catch { return null; }
  }

  function validChatId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9-]{8,128}$/.test(value) ? value : null;
  }

  function resolveConversationKey({ pageUrl, tabUrl, chatId } = {}) {
    return conversationKey(pageUrl) || validChatId(chatId) || conversationKey(tabUrl) || null;
  }

  function normalizePrompt(input) {
    const text = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
    if (!text) return DEFAULT_PROMPT;
    if (/^keep going[.!?]*$/i.test(text)) return DEFAULT_PROMPT;
    return text.slice(0, 1000);
  }

  function options(input = {}) {
    const number = (v, fallback, min, max) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : fallback;
    return {
      autoContinue: input.autoContinue === true,
      longTask: input.longTask === true,
      doNotSpam: input.doNotSpam !== false,
      idleSeconds: number(input.idleSeconds ?? 30, 30, 15, 600),
      maxActions: number(input.maxActions ?? 3, 3, 1, 20),
      prompt: normalizePrompt(input.prompt),
    };
  }

  function initial(now) {
    return {
      userKey: '', fingerprint: '', changedAt: now, attempts: 0, lastActionAt: 0,
      waiting: false, sawBusy: false, expectedUserHash: '', sentContinue: 0,
      status: 'Watching',
    };
  }

  function snapshot(input) {
    if (!input || typeof input !== 'object') throw new Error('Missing page state.');
    const output = {};
    for (const field of ['userKey', 'fingerprint', 'userTextHash']) {
      if (typeof input[field] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input[field])) {
        throw new Error('Invalid turn identity.');
      }
      output[field] = input[field];
    }
    for (const field of SAMPLE_BOOLS) output[field] = input[field] === true;
    return output;
  }

  function continueBudget(opts) {
    if (opts.longTask) return opts.maxActions;
    return opts.doNotSpam ? 1 : opts.maxActions;
  }

  function observe(previous, sample, config, now) {
    const state = { ...previous };
    const opts = options(config);
    const result = (status, action = null) => { state.status = status; return { state, action }; };
    if (!sample.hasUser || !sample.userKey || !sample.fingerprint) return result('Waiting for a conversation turn');
    if (sample.userKey !== state.userKey) {
      const automatic = state.expectedUserHash && sample.userTextHash === state.expectedUserHash;
      if (!automatic) { state.attempts = 0; state.lastActionAt = 0; state.sentContinue = 0; }
      state.userKey = sample.userKey; state.expectedUserHash = ''; state.waiting = false; state.sawBusy = false;
    }
    if (sample.fingerprint !== state.fingerprint) {
      state.fingerprint = sample.fingerprint; state.changedAt = now;
      state.waiting = false;
    }
    if (sample.manualStop) return result('Paused: you stopped the response');
    if (sample.blocked && !sample.mcpDisabled) {
      state.changedAt = now;
      return result('Paused: permission, login, limit or dialog needs attention');
    }
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

    // MCP disabled/FORBIDDEN: branch into a fresh chat. Never keep-going on the disabled source.
    if (sample.mcpDisabled) {
      if (sample.branchButton) {
        state.attempts++; state.lastActionAt = now; state.waiting = true; state.sawBusy = false;
        return result(`Action ${state.attempts}/${opts.maxActions}: send_branch`, 'send_branch');
      }
      return result('Paused: MCP disabled on this chat; branch required');
    }

    const budget = continueBudget(opts);
    const canContinue = opts.autoContinue && (state.sentContinue || 0) < budget;
    const action = sample.continueButton ? 'continue_button'
      : sample.thinkingFailed && canContinue ? 'send_continue'
      : sample.error && sample.retry && !sample.thinkingFailed ? 'retry'
      : !sample.error && !sample.thinkingFailed && sample.finished && canContinue ? 'send_continue'
      : null;
    if (!action) {
      if (sample.thinkingFailed && opts.autoContinue && !canContinue) {
        return result('Idle: do-not-spam holding keep-going');
      }
      if (sample.finished && opts.autoContinue && !canContinue) {
        return result('Idle: do-not-spam holding keep-going');
      }
      return result(sample.error ? 'Error visible: no safe Retry control found' : 'Idle: no recovery needed');
    }
    state.attempts++; state.lastActionAt = now; state.waiting = true; state.sawBusy = false;
    if (action === 'send_continue') {
      state.expectedUserHash = hash(opts.prompt);
      state.sentContinue = (state.sentContinue || 0) + 1;
    }
    return result(`Action ${state.attempts}/${opts.maxActions}: ${action}`, action);
  }

  function isPlausibleModel(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 80) return '';
    if (/^recents?$/i.test(text)) return '';
    if (/^(application|image|text|audio|video|multipart)\/[a-z0-9.+-]+$/i.test(text)) return '';
    if (/^(extra\s*high|xhigh|high|medium|low)$/i.test(text)) return '';
    return text;
  }

  function isEffortLabel(value) {
    const text = String(value || '').trim();
    if (/^extra\s*high$/i.test(text) || /^xhigh$/i.test(text)) return 'Extra High';
    if (/^high$/i.test(text)) return 'High';
    if (/^medium$/i.test(text)) return 'Medium';
    if (/^low$/i.test(text)) return 'Low';
    return '';
  }

  globalThis.CTMChatRecovery = Object.freeze({
    DEFAULT_PROMPT, SAMPLE_BOOLS, hash, chatgptHost, conversationKey, validChatId,
    resolveConversationKey, normalizePrompt, options, initial, snapshot, continueBudget,
    observe, isPlausibleModel, isEffortLabel,
  });
})();
