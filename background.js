import {
  APP_NAME,
  blocksNewSync,
  DEFAULT_EXE_PATH,
  cleanExecutablePath,
  deriveProfilesPath,
  windowsPathToFileUrl,
  selectWorkspaceSnapshot,
  isRemoteHttpsMcpUrl,
  oauthUrlsFromMcpUrl,
} from './lib.mjs';

const HELPER_VERSION = '0.0.3';
const CHATGPT_HOME_URL = 'https://chatgpt.com/';
const CHATGPT_PERSONAL_PLUGINS_URL = 'https://chatgpt.com/plugins?view=personal';
const CHATGPT_PATTERNS = ['https://chatgpt.com/*', 'https://*.chatgpt.com/*', 'https://chat.openai.com/*'];
const TRY_CLOUDFLARE_PATTERN = 'https://*.trycloudflare.com/*';
const ACTIVE_JOB_KEY = 'activeSyncJob';
const WATCHDOG_ALARM = 'coding-tools-mcp-sync-watchdog';
// Authorization now happens after creation, so the job has to outlive a full OAuth round trip.
const JOB_TIMEOUT_MS = 8 * 60 * 1000;
const OFFSCREEN_PATH = 'offscreen.html';
// Stages that mean "the page was not in the expected state yet", not "the user must intervene".
const RECOVERABLE_PREPARE_STAGES = new Set(['wrong_page', 'list_not_rendered', 'page_step_timeout', 'comparison_in_progress', 'exception']);
const MAX_PREPARE_ATTEMPTS = 3;

// ChatGPT redirects /plugins?view=personal to a bare /plugins when the personal list is empty,
// so both spellings identify the list page this job drives.
//
// This MUST agree with isPersonalPluginsUrl() in content.js, and it used to disagree twice over: it
// rejected chat.openai.com, and it demanded that "view" be the only query parameter. ChatGPT adds
// parameters of its own, so a page the content script accepted was read here as a failed
// navigation — openPersonalPluginsTab then abandoned the correct tab and opened a fresh one on
// every pass, discarding the one-shot post-creation connect prompt with it.
function isBasePersonalPluginsUrl(urlString) {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    if (!/(^|\.)chatgpt\.com$/.test(host) && host !== 'chat.openai.com') return false;
    if (url.pathname.replace(/\/+$/, '') !== '/plugins') return false;
    const view = url.searchParams.get('view');
    return !view || view === 'personal';
  } catch {
    return false;
  }
}

// ChatGPT has moved the manager UI between /plugins and settings-style routes. The worker cannot
// inspect DOM structure, so manager-like routes are allowed to reach content.js, which applies the
// stronger page-evidence classifier. Conversation/detail routes are still rejected here.
function isPotentialPluginsManagerUrl(urlString) {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    if (!/(^|\.)chatgpt\.com$/.test(host) && host !== 'chat.openai.com') return false;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (/^\/plugins\/[^/]+/i.test(path)) return false;
    return /(^|\/)(plugins|connectors|apps)(\/|$)/i.test(path);
  } catch {
    return false;
  }
}
let offscreenCreating = null;

// Timestamp rather than a boolean: a step that never settles used to leave this latched true, so
// every later watchdog tick returned immediately and the job was stuck until JOB_TIMEOUT_MS.
let resumeRunningSince = 0;
const RESUME_STUCK_MS = 2 * 60 * 1000;

async function hasSyncOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    return contexts.length > 0;
  }
  const clientsList = await clients.matchAll();
  return clientsList.some((client) => client.url === offscreenUrl);
}

async function ensureSyncOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) return false;
  if (await hasSyncOffscreenDocument()) return true;
  if (offscreenCreating) {
    await offscreenCreating;
    return true;
  }
  offscreenCreating = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['WORKERS'],
    justification: 'Run a short-lived heartbeat worker while an MCP sync/OAuth job is active so the service worker can coordinate page transitions reliably.',
  });
  try {
    await offscreenCreating;
    return true;
  } finally {
    offscreenCreating = null;
  }
}

async function closeSyncOffscreenDocument() {
  if (!chrome.offscreen?.closeDocument) return;
  if (!(await hasSyncOffscreenDocument())) return;
  await chrome.offscreen.closeDocument().catch(() => {});
}

async function updateSyncState(stage, message, extra = {}) {
  await chrome.storage.local.set({
    lastSyncState: {
      stage,
      message,
      at: Date.now(),
      ...extra,
    },
  });
}

async function getSettings() {
  const stored = await chrome.storage.local.get({
    executablePath: DEFAULT_EXE_PATH,
    profilesPathOverride: '',
    selectedWorkspaceId: '',
    replaceExisting: true,
    autoAuthorize: true,
    recentExecutablePaths: [DEFAULT_EXE_PATH],
  });
  stored.executablePath = cleanExecutablePath(stored.executablePath || DEFAULT_EXE_PATH);
  return stored;
}

async function isFileAccessAllowed() {
  return await new Promise((resolve) => {
    chrome.extension.isAllowedFileSchemeAccess((allowed) => resolve(Boolean(allowed)));
  });
}

async function permissionContains(originPattern) {
  try {
    return await chrome.permissions.contains({ origins: [originPattern] });
  } catch {
    return false;
  }
}

async function getDiagnostics() {
  return {
    fileAccessAllowed: await isFileAccessAllowed(),
    chatGptAccessAllowed: await permissionContains('https://chatgpt.com/*'),
    tryCloudflareAccessAllowed: await permissionContains(TRY_CLOUDFLARE_PATTERN),
    offscreenActive: await hasSyncOffscreenDocument().catch(() => false),
  };
}

async function readLocalSnapshot(preferredWorkspaceId = '') {
  if (!(await isFileAccessAllowed())) {
    const error = new Error('Chrome local-file access is OFF. Open extension Details and enable “Allow access to file URLs”, then retry.');
    error.code = 'FILE_ACCESS_DISABLED';
    throw error;
  }

  const settings = await getSettings();
  const profilesPath = settings.profilesPathOverride || deriveProfilesPath(settings.executablePath);
  if (!profilesPath) {
    const error = new Error('Could not derive profiles.json from the executable path. Set an advanced profiles.json override.');
    error.code = 'PROFILES_PATH_INVALID';
    throw error;
  }

  const fileUrl = windowsPathToFileUrl(profilesPath);
  let response;
  try {
    response = await fetch(fileUrl, { cache: 'no-store' });
  } catch (cause) {
    const error = new Error(`Unable to read Coding Tools MCP state at ${profilesPath}. Check file URL access and the path.`);
    error.code = 'PROFILES_READ_FAILED';
    error.cause = cause;
    throw error;
  }
  if (!response.ok) throw new Error(`Unable to read ${profilesPath} (HTTP ${response.status}).`);

  const raw = await response.text();
  const data = JSON.parse(raw);
  const snapshot = selectWorkspaceSnapshot(data, preferredWorkspaceId || settings.selectedWorkspaceId);
  return { ...snapshot, profilesPath, executablePath: settings.executablePath };
}

function originPatternFor(urlString) {
  try {
    return `${new URL(urlString).origin}/*`;
  } catch {
    return '';
  }
}

async function resolveOAuthEndpoints(selected) {
  const fallback = { ...oauthUrlsFromMcpUrl(selected.publicUrl), metadataStale: false };
  const pattern = originPatternFor(fallback.metadataUrl);
  if (!pattern || !(await permissionContains(pattern))) return fallback;

  try {
    const response = await fetch(fallback.metadataUrl, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return fallback;
    const metadata = await response.json();
    const advertised = String(metadata.authorization_endpoint || '');

    // Coding Tools MCP caches the tunnel hostname at first start, so after the Quick Tunnel
    // rotates the live server still advertises the previous host. Anything ChatGPT discovers from
    // it then points at a dead tunnel, so the locally derived URLs must win.
    let metadataStale = false;
    try {
      metadataStale = Boolean(advertised)
        && new URL(advertised).origin.toLowerCase() !== new URL(fallback.baseUrl).origin.toLowerCase();
    } catch {
      metadataStale = false;
    }
    if (metadataStale) return { ...fallback, metadataStale: true };

    return {
      ...fallback,
      authorizationUrl: advertised || fallback.authorizationUrl,
      tokenUrl: String(metadata.token_endpoint || fallback.tokenUrl),
    };
  } catch {
    return fallback;
  }
}

async function getActiveJob() {
  const stored = await chrome.storage.session.get({ [ACTIVE_JOB_KEY]: null });
  return stored[ACTIVE_JOB_KEY];
}

async function setActiveJob(job) {
  await chrome.storage.session.set({ [ACTIVE_JOB_KEY]: job });
}

async function clearActiveJob() {
  await chrome.storage.session.remove(ACTIVE_JOB_KEY);
  await chrome.alarms.clear(WATCHDOG_ALARM).catch(() => false);
  await closeSyncOffscreenDocument();
}

async function startWatchdog() {
  await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 0.5 });
}

async function createSyncJob(message) {
  const snapshot = await readLocalSnapshot(message.workspaceId || '');
  const selected = snapshot.selected;
  if (!selected?.publicUrl) throw new Error('The selected workspace has no public MCP URL. Start its tunnel first.');
  if (!isRemoteHttpsMcpUrl(selected.publicUrl)) {
    throw new Error(`ChatGPT needs a remote HTTPS /mcp endpoint. Current value: ${selected.publicUrl}`);
  }
  if (selected.authType === 'bearer') throw new Error('Bearer auth was detected. This sync flow handles OAuth or no-auth MCP apps.');
  if (selected.authType === 'oauth' && !selected.oauthClientId) {
    throw new Error('OAuth is enabled but no OAuth Client ID was found in the selected workspace/shared configuration.');
  }

  const oauth = await resolveOAuthEndpoints(selected);
  const job = {
    id: crypto.randomUUID(),
    appName: APP_NAME,
    workspaceId: selected.id,
    workspaceName: selected.name,
    endpoint: selected.publicUrl,
    authType: selected.authType,
    oauthClientId: selected.oauthClientId || '',
    oauthClientSecret: selected.oauthClientSecret || '',
    oauthPassword: selected.oauthPassword || '',
    oauthAuthorizeUrl: oauth.authorizationUrl || selected.oauthAuthorizeUrl || '',
    oauthTokenUrl: oauth.tokenUrl || selected.oauthTokenUrl || '',
    oauthMetadataStale: oauth.metadataStale === true,
    replaceExisting: message.replaceExisting !== false,
    autoAuthorize: message.autoAuthorize !== false,
    phase: 'queued',
    chatGptTabId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    prepareAttempts: 0,
  };

  await setActiveJob(job);
  await ensureSyncOffscreenDocument();
  await startWatchdog();
  await updateSyncState('queued', `Sync queued for ${selected.name || APP_NAME}. Opening ChatGPT…`, { jobId: job.id });
  return { snapshot, job: { ...job, oauthClientSecret: '', oauthPassword: '' } };
}

async function findOrOpenChatGptTab(preferredTabId = null) {
  if (preferredTabId) {
    const preferred = await chrome.tabs.get(preferredTabId).catch(() => null);
    if (preferred?.id && preferred.url && /(^https:\/\/([^/]+\.)?chatgpt\.com\/)|(^https:\/\/chat\.openai\.com\/)/i.test(preferred.url)) {
      await chrome.tabs.update(preferred.id, { active: true });
      return preferred.id;
    }
  }

  const tabs = await chrome.tabs.query({ url: CHATGPT_PATTERNS });
  let tab = tabs.find((item) => item.active) || tabs[0];
  if (!tab?.id) tab = await chrome.tabs.create({ url: CHATGPT_HOME_URL, active: true });
  else await chrome.tabs.update(tab.id, { active: true });
  if (!tab?.id) throw new Error('Unable to open a ChatGPT tab.');
  return tab.id;
}

async function openPersonalPluginsTab(preferredTabId = null, { forceFresh = false } = {}) {
  const existing = await chrome.tabs.query({ url: CHATGPT_PATTERNS });
  const alreadyOpen = existing.find((item) => isBasePersonalPluginsUrl(item.url || ''))
    || existing.find((item) => isPotentialPluginsManagerUrl(item.url || ''));
  if (alreadyOpen?.id && !forceFresh) {
    const focused = await chrome.tabs.update(alreadyOpen.id, { active: true });
    return focused?.id || alreadyOpen.id;
  }

  let tab = null;
  if (preferredTabId) {
    tab = await chrome.tabs.get(preferredTabId).catch(() => null);
  }
  if (!tab?.id) {
    tab = existing.find((item) => item.active) || existing[0] || null;
  }
  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: CHATGPT_PERSONAL_PLUGINS_URL, active: true });
  } else if (isBasePersonalPluginsUrl(tab.url || '')) {
    tab = await chrome.tabs.update(tab.id, { active: true });
  } else {
    // A chat tab is not the plugins page. Always navigate there before detect or create.
    tab = await chrome.tabs.update(tab.id, { url: CHATGPT_PERSONAL_PLUGINS_URL, active: true });
  }
  if (!tab?.id) throw new Error('Unable to open ChatGPT personal plugins.');

  // A long-lived ChatGPT tab can answer a /plugins navigation by restoring its last conversation
  // instead of honouring the route — verified: the same URL lands on /c/<id> in a reused tab and on
  // the real plugins list in a fresh one. When that happens the list is empty, every existing app
  // looks absent, and sync creates a duplicate. Retry once in a clean tab.
  await waitForTabReady(tab.id);
  const settled = await chrome.tabs.get(tab.id).catch(() => null);
  if (settled?.url && !isBasePersonalPluginsUrl(settled.url) && !isPotentialPluginsManagerUrl(settled.url)) {
    const fresh = await chrome.tabs.create({ url: CHATGPT_PERSONAL_PLUGINS_URL, active: true });
    if (fresh?.id) {
      await waitForTabReady(fresh.id);
      return fresh.id;
    }
  }
  return tab.id;
}

async function waitForTabReady(tabId, timeoutMs = 15000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === 'complete') return true;
  return await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeoutMs);
    function listener(updatedId, info) {
      if (updatedId !== tabId || info.status !== 'complete') return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(true);
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function pingTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'CODING_TOOLS_MCP_PING' });
    return response?.ok === true && response?.version === HELPER_VERSION;
  } catch {
    return false;
  }
}

async function ensureChatGptHelper(tabId) {
  if (await pingTab(tabId)) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (cause) {
    const error = new Error('Chrome blocked access to chatgpt.com. In the extension Details page, allow site access for chatgpt.com, then retry Sync + OAuth.');
    error.code = 'CHATGPT_SITE_ACCESS_DISABLED';
    error.cause = cause;
    throw error;
  }
  for (let i = 0; i < 10; i += 1) {
    if (await pingTab(tabId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The ChatGPT page helper could not start. Reload the ChatGPT tab and retry.');
}

// A page step that never answers used to stall the whole job until JOB_TIMEOUT_MS, which looks
// exactly like "nothing is happening" and tempts a second Sync click — stacking concurrent jobs on
// the same tab. Bound every page round trip instead.
const PAGE_STEP_TIMEOUT_MS = 90 * 1000;

async function sendToChatGpt(tabId, payload, timeoutMs = PAGE_STEP_TIMEOUT_MS) {
  let timer = null;
  try {
    // ensureChatGptHelper must be inside the race: pingTab() can hang on an unresponsive page, and
    // awaiting it first meant the timeout below never got the chance to fire.
    return await Promise.race([
      (async () => {
        await ensureChatGptHelper(tabId);
        return await chrome.tabs.sendMessage(tabId, payload);
      })(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({
          ok: false,
          stage: 'page_step_timeout',
          message: `The ChatGPT page did not finish "${payload?.type}" within ${Math.round(timeoutMs / 1000)}s. Nothing was created; the step will be retried.`,
        }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function drivePrepare(job) {
  const tabId = await openPersonalPluginsTab(job.chatGptTabId, { forceFresh: job.freshTabRequired === true });
  await waitForTabReady(tabId);

  const current = await getActiveJob();
  if (!current || current.id !== job.id) return;
  current.chatGptTabId = tabId;
  // One escalation per failure. Leaving this latched meant every later attempt — and every
  // watchdog tick — opened yet another ChatGPT tab, even after a clean one had been obtained.
  current.freshTabRequired = false;
  current.phase = 'preparing';
  current.prepareAttempts = (current.prepareAttempts || 0) + 1;
  current.updatedAt = Date.now();

  // A Quick Tunnel hostname can rotate between pressing Sync and reaching the form, which would
  // publish an endpoint that is already dead. Re-read the workspace and use the freshest URL.
  try {
    const fresh = await readLocalSnapshot(current.workspaceId || '');
    const freshUrl = fresh?.selected?.publicUrl || '';
    if (freshUrl && isRemoteHttpsMcpUrl(freshUrl) && freshUrl !== current.endpoint) {
      const oauth = await resolveOAuthEndpoints(fresh.selected);
      current.endpoint = freshUrl;
      current.oauthAuthorizeUrl = oauth.authorizationUrl || current.oauthAuthorizeUrl;
      current.oauthTokenUrl = oauth.tokenUrl || current.oauthTokenUrl;
      current.oauthMetadataStale = oauth.metadataStale === true;
      await updateSyncState('endpoint_refreshed', `The tunnel URL changed since this sync was queued; using ${freshUrl}.`, { jobId: job.id });
    }
  } catch {
    // Keep the captured endpoint if the local state cannot be re-read right now.
  }

  await setActiveJob(current);
  await updateSyncState('preparing', 'Opening ChatGPT personal plugins, deleting any existing coding-tools-mcp, and creating a clean replacement…', { jobId: job.id });

  const prepared = await sendToChatGpt(tabId, {
    type: 'SYNC_MCP_APP_PREPARE',
    jobId: current.id,
    attempt: current.prepareAttempts || 0,
    appName: current.appName,
    endpoint: current.endpoint,
    authType: current.authType,
    oauthClientId: current.oauthClientId,
    oauthClientSecret: current.oauthClientSecret,
    oauthAuthorizeUrl: current.oauthAuthorizeUrl,
    oauthTokenUrl: current.oauthTokenUrl,
    replaceExisting: current.replaceExisting,
  });

  const latest = await getActiveJob();
  if (!latest || latest.id !== job.id) return;
  if (!prepared?.ok) {
    const attempts = latest.prepareAttempts || 0;
    if (RECOVERABLE_PREPARE_STAGES.has(prepared?.stage) && attempts < MAX_PREPARE_ATTEMPTS) {
      // A tab that answered /plugins with a restored conversation will keep doing so; escalate to a
      // brand-new tab for the retry rather than asking the same one again.
      if (prepared?.stage === 'wrong_page') latest.freshTabRequired = true;
      // A navigation/redirect race is not a configuration problem. Stay in the preparing phase so
      // the watchdog alarm or the next page event retries instead of ending the job.
      latest.phase = 'preparing';
      latest.updatedAt = Date.now();
      await setActiveJob(latest);
      await updateSyncState('preparing_retry', `${prepared?.message || 'ChatGPT was not ready yet.'} Retrying (${attempts}/${MAX_PREPARE_ATTEMPTS}).`, { jobId: job.id });
      return;
    }
    latest.phase = 'review';
    latest.updatedAt = Date.now();
    await setActiveJob(latest);
    await updateSyncState(prepared?.stage || 'prepare_failed', prepared?.message || 'ChatGPT configuration needs review.', { jobId: job.id, inventory: prepared?.inventory });
    return;
  }

  if (prepared?.continue === 'wait') {
    latest.phase = 'preparing';
    latest.updatedAt = Date.now();
    await setActiveJob(latest);
    await updateSyncState(prepared.stage || 'comparison_in_progress', prepared.message || 'Existing MCP comparison is still running…', { jobId: job.id });
    return;
  }

  if (prepared?.continue === 'return_to_plugins') {
    latest.phase = 'creating';
    latest.updatedAt = Date.now();
    await setActiveJob(latest);
    await updateSyncState('removed_old_app', prepared.message || `Deleted ${APP_NAME}. Going back to the plugins page to create the replacement.`, { jobId: job.id });
    await driveCreateReplacement(latest);
    return;
  }

  if (prepared?.continue === 'inspect_details' && prepared?.detailUrl) {
    latest.phase = 'inspect_details';
    latest.detailUrl = prepared.detailUrl;
    latest.updatedAt = Date.now();
    await setActiveJob(latest);
    await updateSyncState('opening_existing_details', prepared.message || `Opening ${APP_NAME} details to read its current MCP URL…`, { jobId: job.id });
    await chrome.tabs.update(tabId, { url: prepared.detailUrl, active: true });
    return;
  }

  latest.phase = latest.authType === 'oauth' ? 'waiting_oauth_or_create' : 'waiting_create';
  latest.updatedAt = Date.now();
  await setActiveJob(latest);
  await updateSyncState(
    latest.authType === 'oauth' ? 'waiting_oauth' : 'scanning',
    prepared.message || (latest.authType === 'oauth' ? 'Scan Tools started; waiting for OAuth.' : 'Scan Tools started; waiting for Create.'),
    { jobId: job.id },
  );
}

async function driveInspectDetails(job) {
  if (!job.chatGptTabId) return;
  const tab = await chrome.tabs.get(job.chatGptTabId).catch(() => null);
  if (!tab?.id) return;
  if (tab.status !== 'complete') return;

  // A successful delete can navigate ChatGPT back to the Personal plugins list and destroy the
  // in-flight content-script request. Re-enter the normal list inspection there; if the app is
  // gone, prepareSync will create the replacement, and if it is still present it will re-check it.
  if (isBasePersonalPluginsUrl(tab.url || '')) {
    await drivePrepare(job);
    return;
  }

  const result = await sendToChatGpt(tab.id, {
    type: 'SYNC_MCP_APP_INSPECT_DETAILS',
    jobId: job.id,
    appName: job.appName,
    endpoint: job.endpoint,
    replaceExisting: job.replaceExisting,
  });

  const latest = await getActiveJob();
  if (!latest || latest.id !== job.id) return;
  if (!result?.ok) {
    latest.phase = 'review';
    latest.updatedAt = Date.now();
    await setActiveJob(latest);
    await updateSyncState(result?.stage || 'details_failed', result?.message || 'Could not inspect the existing MCP app details safely.', { jobId: job.id });
    return;
  }
  if (result?.removed) {
    latest.phase = 'creating';
    latest.updatedAt = Date.now();
    delete latest.detailUrl;
    await setActiveJob(latest);
    await updateSyncState('removed_old_app', result.message || `Removed the old ${APP_NAME}; creating the replacement…`, { jobId: job.id });
    await driveCreateReplacement(latest);
  }
}

async function driveCreateReplacement(job) {
  const tabId = await openPersonalPluginsTab(job.chatGptTabId);
  await waitForTabReady(tabId);
  const current = await getActiveJob();
  if (!current || current.id !== job.id) return;
  current.chatGptTabId = tabId;
  current.phase = 'creating';
  current.updatedAt = Date.now();
  await setActiveJob(current);
  await updateSyncState('creating', `Creating a new ${APP_NAME} with the current MCP URL…`, { jobId: job.id });

  const created = await sendToChatGpt(tabId, {
    type: 'SYNC_MCP_APP_CREATE_REPLACEMENT',
    jobId: current.id,
    appName: current.appName,
    endpoint: current.endpoint,
    authType: current.authType,
    oauthClientId: current.oauthClientId,
    oauthClientSecret: current.oauthClientSecret,
    oauthAuthorizeUrl: current.oauthAuthorizeUrl,
    oauthTokenUrl: current.oauthTokenUrl,
    replaceExisting: current.replaceExisting,
  });

  const latest = await getActiveJob();
  if (!latest || latest.id !== job.id) return;
  if (!created?.ok) {
    latest.phase = 'review';
    latest.updatedAt = Date.now();
    await setActiveJob(latest);
    await updateSyncState(created?.stage || 'create_failed', created?.message || 'The replacement app form needs review.', { jobId: job.id, inventory: created?.inventory });
    return;
  }

  latest.phase = latest.authType === 'oauth' ? 'waiting_oauth_or_create' : 'waiting_create';
  latest.updatedAt = Date.now();
  await setActiveJob(latest);
  await updateSyncState(
    latest.authType === 'oauth' ? 'waiting_oauth' : 'scanning',
    created.message || (latest.authType === 'oauth' ? 'Scan Tools started; waiting for OAuth.' : 'Scan Tools started; waiting for Create.'),
    { jobId: job.id },
  );
}

async function nudgeChatGptFinalizer(job) {
  if (!job.chatGptTabId) return;
  const tab = await chrome.tabs.get(job.chatGptTabId).catch(() => null);
  if (!tab?.id || tab.status !== 'complete') return;
  try {
    await sendToChatGpt(tab.id, { type: 'SYNC_MCP_APP_RESUME', appName: job.appName, jobId: job.id, authType: job.authType });
  } catch {
    // The watchdog/tab update will retry. No long-lived polling in the worker.
  }
}

async function resumeActiveJob(trigger = 'event') {
  if (resumeRunningSince && Date.now() - resumeRunningSince < RESUME_STUCK_MS) return;
  resumeRunningSince = Date.now();
  try {
    const job = await getActiveJob();
    if (!job) {
      await closeSyncOffscreenDocument();
      return;
    }
    await ensureSyncOffscreenDocument();
    if (Date.now() - job.createdAt > JOB_TIMEOUT_MS) {
      await updateSyncState('timeout', 'The sync job timed out. Reopen ChatGPT Apps and press Sync + OAuth again.', { jobId: job.id, trigger });
      await clearActiveJob();
      return;
    }

    if (['queued', 'preparing'].includes(job.phase)) {
      await drivePrepare(job);
      return;
    }
    if (job.phase === 'inspect_details') {
      await driveInspectDetails(job);
      return;
    }
    if (job.phase === 'creating') {
      await driveCreateReplacement(job);
      return;
    }
    // The OAuth form was submitted on the MCP host. Once the browser is back on chatgpt.com the
    // round trip is over and the connector is authorized.
    if (job.phase === 'oauth_submitted') {
      const tab = job.chatGptTabId ? await chrome.tabs.get(job.chatGptTabId).catch(() => null) : null;
      if (tab?.url && tab.status === 'complete' && /^https:\/\/([^/]+\.)?chatgpt\.com\//i.test(tab.url)) {
        await updateSyncState('done', `${APP_NAME} was created and authorized with the current MCP URL.`, { jobId: job.id, trigger });
        await clearActiveJob();
        return;
      }
      await nudgeChatGptFinalizer(job);
      return;
    }

    if (['waiting_oauth_or_create', 'waiting_create'].includes(job.phase)) {
      await nudgeChatGptFinalizer(job);
    }
  } catch (error) {
    await updateSyncState(error?.code || 'error', error?.message || String(error), { trigger }).catch(() => {});
  } finally {
    resumeRunningSince = 0;
  }
}

function oauthPageMatchesJob(job, pageUrl) {
  if (!job?.oauthAuthorizeUrl || !pageUrl) return false;
  try {
    const expected = new URL(job.oauthAuthorizeUrl);
    const current = new URL(pageUrl);
    return expected.origin === current.origin && expected.pathname.replace(/\/$/, '') === current.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}

async function handleOauthReady(pageUrl) {
  const job = await getActiveJob();
  if (!job || job.authType !== 'oauth') return { ok: false, reason: 'no_active_oauth_job' };
  if (!job.autoAuthorize) return { ok: false, reason: 'auto_authorize_off' };
  if (!oauthPageMatchesJob(job, pageUrl)) return { ok: false, reason: 'oauth_url_mismatch' };
  if (!job.oauthPassword) return { ok: false, reason: 'oauth_password_missing' };
  await updateSyncState('oauth_authorizing', 'Coding Tools MCP OAuth page detected; submitting the captured authorization password…', { jobId: job.id });
  return { ok: true, password: job.oauthPassword };
}

async function handleOauthSubmitted(pageUrl) {
  const job = await getActiveJob();
  if (!job || !oauthPageMatchesJob(job, pageUrl)) return;
  job.phase = 'oauth_submitted';
  job.updatedAt = Date.now();
  await setActiveJob(job);
  await updateSyncState('oauth_submitted', 'OAuth approval submitted. Waiting for ChatGPT Scan Tools / Create to finish…', { jobId: job.id });
  void resumeActiveJob('oauth_submitted');
}

async function handleChatGptResult(result) {
  const job = await getActiveJob();
  if (!job) return;
  if (result?.jobId && result.jobId !== job.id) return;
  const ok = result?.ok === true;

  // Creation is not the end of an OAuth sync: ChatGPT only offers Sign in once the connector
  // exists. Clearing the job here left handleOauthReady with no active job, so the OAuth page
  // helper was never injected and the captured authorization password was never submitted.
  if (ok && result?.awaitingOauth) {
    job.phase = 'waiting_oauth_or_create';
    job.updatedAt = Date.now();
    await setActiveJob(job);
    await updateSyncState(result.stage || 'authorizing', result?.message || `${APP_NAME} was created; waiting for OAuth authorization.`, { jobId: job.id });
    return;
  }

  await updateSyncState(ok ? 'done' : (result?.stage || 'review'), result?.message || (ok ? `${APP_NAME} sync completed.` : 'ChatGPT needs manual review.'), { jobId: job.id });
  await clearActiveJob();
}

async function maybeInjectOauthHelper(tabId, url) {
  const job = await getActiveJob();
  if (!job || !job.autoAuthorize || !oauthPageMatchesJob(job, url)) return;
  const pattern = originPatternFor(url);
  if (!pattern || !(await permissionContains(pattern))) {
    await updateSyncState('oauth_permission_missing', `OAuth opened at ${new URL(url).hostname}, but Chrome has no site access for that host. Grant the current MCP host permission and retry.`, { jobId: job.id });
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['oauth-content.js'] });
  } catch (error) {
    await updateSyncState('oauth_injection_failed', `OAuth page opened, but Chrome blocked the helper: ${error?.message || error}`, { jobId: job.id });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void updateSyncState('ready', `v${HELPER_VERSION} loaded. Sync starts at ChatGPT personal plugins, tolerates the empty-list redirect to /plugins, and compares the existing MCP URL before replacing anything.`);
});

chrome.runtime.onStartup.addListener(() => {
  void resumeActiveJob('startup');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WATCHDOG_ALARM) void resumeActiveJob('watchdog');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (/^https:\/\/([^/]+\.)?chatgpt\.com\//i.test(tab.url) || /^https:\/\/chat\.openai\.com\//i.test(tab.url)) {
    void resumeActiveJob('chatgpt_tab_updated');
    return;
  }
  void maybeInjectOauthHelper(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'OFFSCREEN_HEARTBEAT') {
      const job = await getActiveJob();
      sendResponse({ ok: true, active: Boolean(job) });
      if (job) void resumeActiveJob('offscreen_heartbeat');
      return;
    }

    if (message?.type === 'GET_SETTINGS') {
      const state = await chrome.storage.local.get({ lastSyncState: null });
      sendResponse({
        ok: true,
        settings: await getSettings(),
        diagnostics: await getDiagnostics(),
        lastSyncState: state.lastSyncState,
        activeJob: await getActiveJob().then((job) => job ? ({ id: job.id, phase: job.phase, workspaceName: job.workspaceName, endpoint: job.endpoint }) : null),
      });
      return;
    }

    if (message?.type === 'SAVE_SETTINGS') {
      const next = { ...message.settings };
      if (next.executablePath) next.executablePath = cleanExecutablePath(next.executablePath);
      await chrome.storage.local.set(next);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'READ_LOCAL') {
      const snapshot = await readLocalSnapshot(message.workspaceId || '');
      sendResponse({ ok: true, snapshot });
      return;
    }

    if (message?.type === 'OPEN_EXTENSION_SETTINGS') {
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'OPEN_CHATGPT_APPS') {
      const tabId = await openPersonalPluginsTab();
      await waitForTabReady(tabId);
      sendResponse({ ok: true, url: CHATGPT_PERSONAL_PLUGINS_URL });
      return;
    }

    if (message?.type === 'START_SYNC_JOB') {
      // Guard against stacking: a second Sync while one is genuinely in flight would leave two
      // content scripts driving the same page's menus against each other.
      const running = await getActiveJob();
      if (blocksNewSync(running)) {
        sendResponse({ ok: false, error: `A sync is already running (${running.phase}). Wait for it to finish or time out before starting another.` });
        return;
      }
      const created = await createSyncJob(message);
      sendResponse({ ok: true, ...created });
      // Important: the popup can close as ChatGPT is activated. The job is already durable in
      // chrome.storage.session, and alarms/page events can resume it if this worker is suspended.
      void resumeActiveJob('user_start');
      return;
    }

    if (message?.type === 'RESUME_SYNC_JOB') {
      sendResponse({ ok: true });
      void resumeActiveJob('manual_resume');
      return;
    }

    if (message?.type === 'OAUTH_PAGE_READY') {
      sendResponse(await handleOauthReady(message.url || ''));
      return;
    }

    if (message?.type === 'OAUTH_SUBMITTED') {
      await handleOauthSubmitted(message.url || '');
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'CHATGPT_SYNC_RESULT') {
      await handleChatGptResult(message.result || {});
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: 'Unknown request.' });
  })().catch(async (error) => {
    await updateSyncState(error?.code || 'error', error?.message || String(error)).catch(() => {});
    sendResponse({ ok: false, error: error?.message || String(error), code: error?.code || '' });
  });
  return true;
});
