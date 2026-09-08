import { DEFAULT_EXE_PATH, deriveProfilesPath } from './lib.mjs';

const $ = (id) => document.getElementById(id);
const pathMode = $('pathMode');
const exePath = $('exePath');
const recentPaths = $('recentPaths');
const profilesPath = $('profilesPath');
const derivedPath = $('derivedPath');
const workspace = $('workspace');
const mcpUrl = $('mcpUrl');
const oauthClientId = $('oauthClientId');
const oauthClientSecret = $('oauthClientSecret');
const oauthAuthorizeUrl = $('oauthAuthorizeUrl');
const oauthTokenUrl = $('oauthTokenUrl');
const oauthPasswordState = $('oauthPasswordState');
const toggleClientSecret = $('toggleClientSecret');
const replaceExisting = $('replaceExisting');
const autoAuthorize = $('autoAuthorize');
const captureBtn = $('captureBtn');
const syncBtn = $('syncBtn');
const status = $('status');
const stateBadge = $('stateBadge');
const fileAccessWarning = $('fileAccessWarning');
const oauthPermissionWarning = $('oauthPermissionWarning');
const extensionSettingsBtn = $('extensionSettingsBtn');
const grantOauthHostBtn = $('grantOauthHostBtn');
const openAppsBtn = $('openAppsBtn');
const diagnostics = $('diagnostics');

let latestSnapshot = null;
let recentExecutablePaths = [];
let latestDiagnostics = null;

function setStatus(text, kind = 'Ready') {
  status.textContent = text;
  stateBadge.textContent = kind;
}

function setBusy(busy) {
  captureBtn.disabled = busy;
  syncBtn.disabled = busy;
}

function updateDerivedPath() {
  const value = profilesPath.value.trim() || deriveProfilesPath(exePath.value);
  derivedPath.textContent = value ? `Reading: ${value}` : 'Could not derive profiles.json from this executable path.';
}

function renderRecentPaths() {
  recentPaths.innerHTML = '';
  for (const path of recentExecutablePaths) {
    const option = document.createElement('option');
    option.value = path;
    recentPaths.append(option);
  }
}

async function send(message) {
  return await chrome.runtime.sendMessage(message);
}

async function saveSettings() {
  const path = exePath.value.trim();
  if (path && !recentExecutablePaths.includes(path)) {
    recentExecutablePaths = [path, ...recentExecutablePaths].slice(0, 6);
    renderRecentPaths();
  }
  await send({
    type: 'SAVE_SETTINGS',
    settings: {
      executablePath: path,
      profilesPathOverride: profilesPath.value.trim(),
      selectedWorkspaceId: workspace.value,
      replaceExisting: true,
      autoAuthorize: autoAuthorize.checked,
      recentExecutablePaths,
    },
  });
}

function renderDiagnostics(value) {
  latestDiagnostics = value || latestDiagnostics || {};
  const file = latestDiagnostics.fileAccessAllowed ? 'file ✓' : 'file ✕';
  const chatgpt = latestDiagnostics.chatGptAccessAllowed ? 'ChatGPT ✓' : 'ChatGPT ✕';
  const cloudflare = latestDiagnostics.tryCloudflareAccessAllowed ? '*.trycloudflare.com ✓' : '*.trycloudflare.com ✕';
  diagnostics.textContent = `Access: ${file} · ${chatgpt} · ${cloudflare}`;
  fileAccessWarning.classList.toggle('hidden', Boolean(latestDiagnostics.fileAccessAllowed));
}

function selectedSnapshot() {
  return latestSnapshot?.selected || null;
}

function isTryCloudflare(urlString) {
  try {
    const host = new URL(urlString).hostname.toLowerCase();
    return host === 'trycloudflare.com' || host.endsWith('.trycloudflare.com');
  } catch {
    return false;
  }
}

async function customOauthPermissionMissing(snapshot = latestSnapshot) {
  const selected = snapshot?.selected;
  if (!autoAuthorize.checked || selected?.authType !== 'oauth' || !selected?.oauthAuthorizeUrl) return false;
  if (isTryCloudflare(selected.oauthAuthorizeUrl)) return false;
  const pattern = `${new URL(selected.oauthAuthorizeUrl).origin}/*`;
  return !(await chrome.permissions.contains({ origins: [pattern] }));
}

async function updateOauthPermissionWarning() {
  const missing = await customOauthPermissionMissing().catch(() => false);
  oauthPermissionWarning.classList.toggle('hidden', !missing);
}

function populateWorkspaces(snapshot) {
  const current = workspace.value;
  workspace.innerHTML = '<option value="">Auto / last workspace</option>';
  for (const item of snapshot.workspaces || []) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.name}${item.publicUrl ? '' : ' — no public URL'}`;
    workspace.append(option);
  }
  workspace.value = snapshot.selected?.id || current || '';
  const selected = snapshot.selected || {};
  mcpUrl.value = selected.publicUrl || '';
  oauthClientId.value = selected.oauthClientId || '';
  oauthClientSecret.value = selected.oauthClientSecret || '';
  oauthAuthorizeUrl.value = selected.oauthAuthorizeUrl || '';
  oauthTokenUrl.value = selected.oauthTokenUrl || '';
  oauthPasswordState.textContent = selected.authType === 'oauth'
    ? `Authorization password: ${selected.oauthPassword ? 'captured ✓' : 'not found'}`
    : `Authentication mode: ${selected.authType || 'unknown'}`;
  void updateOauthPermissionWarning();
}

async function readLocal() {
  await saveSettings();
  const response = await send({ type: 'READ_LOCAL', workspaceId: workspace.value });
  if (!response?.ok) throw Object.assign(new Error(response?.error || 'Capture failed.'), { code: response?.code });
  latestSnapshot = response.snapshot;
  populateWorkspaces(response.snapshot);
  return response.snapshot;
}

async function capture() {
  setBusy(true);
  setStatus('Reading Coding Tools MCP local state…', 'Reading');
  try {
    const snapshot = await readLocal();
    fileAccessWarning.classList.add('hidden');
    const selected = snapshot.selected || {};
    setStatus(`Captured ${selected.name || 'workspace'}: MCP URL + ${selected.authType === 'oauth' ? 'OAuth Client ID/Secret + authorization data' : selected.authType || 'auth'}.`, 'Captured');
    return snapshot;
  } catch (error) {
    if (error.code === 'FILE_ACCESS_DISABLED') fileAccessWarning.classList.remove('hidden');
    setStatus(error.message, 'Needs setup');
    throw error;
  } finally {
    setBusy(false);
  }
}

async function sync() {
  setBusy(true);
  setStatus('Checking local MCP/OAuth values…', 'Syncing');
  try {
    await saveSettings();
    const snapshot = latestSnapshot && (!workspace.value || latestSnapshot.selected?.id === workspace.value)
      ? latestSnapshot
      : await readLocal();

    if (await customOauthPermissionMissing(snapshot)) {
      oauthPermissionWarning.classList.remove('hidden');
      setStatus('This is a custom OAuth hostname. Click “Grant current OAuth host” once, then press Sync + OAuth again.', 'Permission');
      return;
    }

    const response = await send({
      type: 'START_SYNC_JOB',
      workspaceId: workspace.value,
      replaceExisting: true,
      autoAuthorize: autoAuthorize.checked,
    });
    if (!response?.ok) throw Object.assign(new Error(response?.error || 'Could not start sync.'), { code: response?.code });
    latestSnapshot = response.snapshot;
    populateWorkspaces(response.snapshot);
    setStatus('Sync job queued. ChatGPT will open now. The popup can close safely; v0.3 resumes from page/OAuth/alarm events if the service worker sleeps.', 'Running');
  } catch (error) {
    if (error.code === 'FILE_ACCESS_DISABLED') fileAccessWarning.classList.remove('hidden');
    setStatus(error.message, 'Error');
  } finally {
    setBusy(false);
  }
}

async function init() {
  const response = await send({ type: 'GET_SETTINGS' });
  if (!response?.ok) return setStatus(response?.error || 'Could not load settings.', 'Error');
  const settings = response.settings;
  exePath.value = settings.executablePath || DEFAULT_EXE_PATH;
  profilesPath.value = settings.profilesPathOverride || '';
  replaceExisting.checked = true;
  autoAuthorize.checked = settings.autoAuthorize !== false;
  recentExecutablePaths = Array.isArray(settings.recentExecutablePaths) && settings.recentExecutablePaths.length
    ? settings.recentExecutablePaths
    : [DEFAULT_EXE_PATH];
  renderRecentPaths();
  pathMode.value = exePath.value === DEFAULT_EXE_PATH ? 'default' : 'custom';
  updateDerivedPath();
  renderDiagnostics(response.diagnostics);

  try { await capture(); } catch { /* status already shown */ }

  if (response.activeJob?.phase === 'review' && response.lastSyncState?.message) {
    setStatus(response.lastSyncState.message, 'Review');
  } else if (response.activeJob) {
    setStatus(`Active sync: ${response.activeJob.workspaceName || 'workspace'} · ${response.activeJob.phase}. It will resume automatically.`, 'Running');
  } else if (response.lastSyncState?.message) {
    const done = response.lastSyncState.stage === 'done';
    setStatus(response.lastSyncState.message, done ? 'Done' : 'Ready');
  }
}

pathMode.addEventListener('change', () => {
  if (pathMode.value === 'default') exePath.value = DEFAULT_EXE_PATH;
  else if (exePath.value === DEFAULT_EXE_PATH) exePath.value = '';
  updateDerivedPath();
  exePath.focus();
});
exePath.addEventListener('input', () => {
  pathMode.value = exePath.value.trim() === DEFAULT_EXE_PATH ? 'default' : 'custom';
  updateDerivedPath();
});
profilesPath.addEventListener('input', updateDerivedPath);
workspace.addEventListener('change', async () => {
  await saveSettings();
  try { await capture(); } catch { /* status already shown */ }
});
replaceExisting.addEventListener('change', saveSettings);
autoAuthorize.addEventListener('change', () => {
  void saveSettings();
  void updateOauthPermissionWarning();
});
toggleClientSecret.addEventListener('click', () => {
  const showing = oauthClientSecret.type === 'text';
  oauthClientSecret.type = showing ? 'password' : 'text';
  toggleClientSecret.textContent = showing ? 'Show' : 'Hide';
});
captureBtn.addEventListener('click', () => capture().catch(() => {}));
syncBtn.addEventListener('click', sync);
extensionSettingsBtn.addEventListener('click', () => send({ type: 'OPEN_EXTENSION_SETTINGS' }));
openAppsBtn.addEventListener('click', () => send({ type: 'OPEN_CHATGPT_APPS' }));
grantOauthHostBtn.addEventListener('click', () => {
  const authorizeUrl = selectedSnapshot()?.oauthAuthorizeUrl;
  if (!authorizeUrl) return setStatus('Capture the workspace first.', 'Capture');
  const pattern = `${new URL(authorizeUrl).origin}/*`;
  // Keep permissions.request directly inside this click handler so Chrome preserves the user gesture.
  chrome.permissions.request({ origins: [pattern] }).then((granted) => {
    setStatus(granted ? `Granted OAuth access for ${new URL(authorizeUrl).hostname}.` : 'OAuth host permission was not granted.', granted ? 'Ready' : 'Permission');
    void updateOauthPermissionWarning();
  });
});

init();
