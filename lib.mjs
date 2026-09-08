export const APP_NAME = 'coding-tools-mcp';
export const DEFAULT_EXE_PATH = String.raw`C:\Users\simon\AppData\Local\Coding Tools MCP\coding-tools-mcp-desktop.exe`;

export function blocksNewSync(job, now = Date.now()) {
  return Boolean(job && job.phase !== 'review' && now - (job.updatedAt || job.createdAt || 0) < 60000);
}

export function cleanExecutablePath(value = '') {
  return String(value).trim().replace(/^\s*["']|["']\s*$/g, '');
}

export function deriveProfilesPath(executablePath = DEFAULT_EXE_PATH) {
  const clean = cleanExecutablePath(executablePath).replaceAll('/', '\\');
  const userMatch = clean.match(/^([A-Za-z]:\\Users\\[^\\]+)\\/i);
  if (!userMatch) return '';
  return `${userMatch[1]}\\AppData\\Roaming\\coding-tools-mcp-desktop\\data\\profiles.json`;
}

export function windowsPathToFileUrl(windowsPath) {
  const clean = String(windowsPath || '').trim().replaceAll('\\', '/');
  if (!/^[A-Za-z]:\//.test(clean)) throw new Error('Expected an absolute Windows path.');
  const drive = clean.slice(0, 2);
  const rest = clean.slice(2).split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `file:///${drive}/${rest}`;
}

export function normalizePublicMcpUrl(rawUrl = '') {
  const raw = String(rawUrl).trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }
  parsed.hash = '';
  parsed.search = '';
  const trimmedPath = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = /\/mcp$/i.test(trimmedPath) ? trimmedPath : `${trimmedPath}/mcp`.replace(/\/+/g, '/');
  return parsed.toString().replace(/\/$/, '');
}

export function isRemoteHttpsMcpUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    return /\/mcp\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function oauthBaseUrlFromMcpUrl(mcpUrl = '') {
  try {
    const parsed = new URL(mcpUrl);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/mcp\/?$/i, '').replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function oauthUrlsFromMcpUrl(mcpUrl = '') {
  const baseUrl = oauthBaseUrlFromMcpUrl(mcpUrl);
  if (!baseUrl) return { baseUrl: '', authorizationUrl: '', tokenUrl: '', metadataUrl: '' };
  return {
    baseUrl,
    authorizationUrl: `${baseUrl}/oauth/authorize`,
    tokenUrl: `${baseUrl}/oauth/token`,
    metadataUrl: `${baseUrl}/.well-known/oauth-authorization-server`,
  };
}

function workspaceSecret(data, profile, key) {
  const id = String(profile?.id || '');
  const useShared = Boolean(profile?.auth?.use_shared_secrets);
  if (useShared) return String(data?.shared_secrets?.[key] || '');
  return String(data?.workspace_secrets?.[id]?.[key] || '');
}

function oauthClientId(data, profile) {
  const useShared = Boolean(profile?.auth?.use_shared_secrets);
  if (useShared) return String(data?.shared_secrets?.oauth_client_id || '');
  return String(profile?.auth?.oauth_client_id || '');
}

export function listWorkspaceChoices(data) {
  const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
  return profiles.map((profile) => {
    const publicUrl = normalizePublicMcpUrl(profile?.tunnel?.public_url || '');
    return {
      id: String(profile?.id || ''),
      name: String(profile?.name || profile?.id || 'Unnamed workspace'),
      publicUrl,
      authType: String(profile?.auth?.type || profile?.auth?.auth_type || 'oauth'),
      usesSharedSecrets: Boolean(profile?.auth?.use_shared_secrets),
    };
  });
}

export function enrichWorkspace(data, workspace) {
  if (!workspace?.id) return workspace || null;
  const profile = (Array.isArray(data?.profiles) ? data.profiles : []).find((item) => String(item?.id || '') === workspace.id);
  if (!profile) return workspace;
  const oauth = oauthUrlsFromMcpUrl(workspace.publicUrl);
  return {
    ...workspace,
    oauthClientId: oauthClientId(data, profile),
    oauthClientSecret: workspaceSecret(data, profile, 'oauth_client_secret'),
    oauthPassword: workspaceSecret(data, profile, 'oauth_password'),
    oauthAuthorizeUrl: oauth.authorizationUrl,
    oauthTokenUrl: oauth.tokenUrl,
    oauthMetadataUrl: oauth.metadataUrl,
  };
}

export function selectWorkspaceSnapshot(data, preferredId = '') {
  const workspaces = listWorkspaceChoices(data);
  if (!workspaces.length) throw new Error('No Coding Tools MCP workspaces were found in profiles.json.');

  const requestedId = String(preferredId || data?.last_workspace_id || '');
  let selected = workspaces.find((item) => item.id === requestedId);
  if (!selected || !selected.publicUrl) {
    selected = workspaces.find((item) => item.publicUrl) || selected || workspaces[0];
  }

  return {
    selected: enrichWorkspace(data, selected),
    workspaces,
    lastWorkspaceId: String(data?.last_workspace_id || ''),
  };
}
