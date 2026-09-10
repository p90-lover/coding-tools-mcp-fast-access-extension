function isChatGptOrigin(value) {
  try { return ['https://chatgpt.com', 'https://chat.openai.com', 'https://www.chatgpt.com'].includes(new URL(value).origin); }
  catch { return false; }
}

function validChatGptCallback(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://chatgpt.com' || url.username || url.password || url.search || url.hash || value.length > 2048) return false;
    return ['/connector_platform_oauth_redirect', '/connector_platform/oauth/callback', '/aip/oauth/callback'].includes(url.pathname)
      || /^\/(?:oauth\/callback\/)?connector\/oauth\/[A-Za-z0-9_-]+$/.test(url.pathname);
  } catch { return false; }
}

async function oauthSenderContext(job, pageUrl, sender) {
  if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) return null;
  if (!oauthPageMatchesJob(job, pageUrl)) return null;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || new URL(sender.url).href !== url.href) return null;
    const tab = await chrome.tabs.get(sender.tab.id);
    if (new URL(tab.url).href !== url.href) return null;
    // Browser-provided opener metadata, not a URL claimed by a content script.
    // Unlinked/noopener windows remain available for manual password entry.
    if (tab.id !== job.chatGptTabId && tab.openerTabId !== job.chatGptTabId) return null;
    if (job.oauthTabId != null && tab.id !== job.oauthTabId) return null;
    const q = url.searchParams;
    for (const name of ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method']) {
      if (q.getAll(name).length !== 1) return null;
    }
    if (q.get('response_type') !== 'code' || q.get('client_id') !== job.oauthClientId
        || q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(q.get('code_challenge'))
        || !q.get('state') || q.get('state').length > 2048 || !validChatGptCallback(q.get('redirect_uri'))) return null;
    if (job.oauthRequest && job.oauthRequest.url !== url.href) return null;
    return { tabId: tab.id, request: {url:url.href, state:q.get('state'), redirectUri:q.get('redirect_uri')} };
  } catch { return null; }
}

async function handleOauthReady(pageUrl, sender) {
  const job = await getActiveJob();
  if (!job || job.authType !== 'oauth') return { ok: false, reason: 'no_active_oauth_job' };
  if (!job.autoAuthorize) return { ok: false, reason: 'auto_authorize_off' };
  const context = await oauthSenderContext(job, pageUrl, sender);
  if (!context) return { ok: false, reason: 'oauth_sender_or_request_mismatch' };
  if (!job.oauthPassword) return { ok: false, reason: 'oauth_password_missing' };
  job.oauthTabId = context.tabId;
  job.oauthRequest = context.request; // Transient session state, never logged or published.
  job.updatedAt = Date.now();
  await setActiveJob(job);
  await updateSyncState('oauth_authorizing', 'Verified the OAuth popup and request; filling the authorization password.', { jobId: job.id });
  return { ok: true, password: job.oauthPassword };
}

async function handleOauthSubmitted(pageUrl, sender) {
  const job = await getActiveJob();
  if (!job?.oauthRequest || !job.autoAuthorize || !(await oauthSenderContext(job, pageUrl, sender))) return {ok:false};
  job.phase = 'oauth_submitted';
  job.updatedAt = Date.now();
  await setActiveJob(job);
  await updateSyncState('oauth_submitted', 'OAuth approval submitted. Waiting for the popup callback and ChatGPT connection status.', { jobId: job.id });
  return {ok:true};
}

async function observeOAuthNavigation(tabId, pageUrl) {
  const job = await getActiveJob();
  if (!job?.oauthRequest || job.oauthTabId !== tabId || job.phase !== 'oauth_submitted') return;
  try {
    const url = new URL(pageUrl), expected = new URL(job.oauthRequest.redirectUri);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash
        || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== job.oauthRequest.state) return;
    if (url.searchParams.has('error')) {
      job.phase = 'review';
      await updateSyncState('oauth_error', 'The OAuth callback reported an error. Authorization has not been confirmed.', {jobId:job.id});
    } else if (url.searchParams.getAll('code').length === 1 && url.searchParams.get('code')) {
      job.phase = 'oauth_returned';
      await updateSyncState('oauth_returned', 'The correct popup returned to ChatGPT. Waiting for app-specific connection evidence; tool execution is not yet verified.', {jobId:job.id});
    } else return;
    job.updatedAt = Date.now();
    await setActiveJob(job); // Do not retain the authorization code or callback URL.
  } catch { /* A non-URL navigation is not completion evidence. */ }
}

async function handleChatGptResult(result, sender) {
  const job = await getActiveJob();
  if (!job || result?.jobId !== job.id || sender?.id !== chrome.runtime.id || sender.frameId !== 0
      || sender.tab?.id !== job.chatGptTabId || !isChatGptOrigin(sender.url)) return;
  const ok = result?.ok === true;
  if (job.authType === 'oauth' && ok) {
    const connected = ['oauth_submitted','oauth_returned'].includes(job.phase)
      && result.stage === 'connected' && result.connectionObserved === true;
    if (!connected) {
      if (!['oauth_submitted','oauth_returned'].includes(job.phase)) job.phase = 'waiting_oauth_or_create';
      job.updatedAt = Date.now();
      await setActiveJob(job);
      await updateSyncState('waiting_oauth', 'The app exists, but a completed OAuth connection has not been observed.', {jobId:job.id});
      return;
    }
  }
  if (!ok) {
    job.phase = 'review'; job.updatedAt = Date.now();
    await setActiveJob(job);
    await updateSyncState(result?.stage || 'review', result?.message || 'ChatGPT needs manual review.', {jobId:job.id});
    return;
  }
  await updateSyncState('done', job.authType === 'oauth'
    ? 'ChatGPT shows this exact app as connected. Actual MCP tool execution is not verified by the extension.'
    : (result.message || `${APP_NAME} sync completed.`), {jobId:job.id});
  await clearActiveJob();
}
