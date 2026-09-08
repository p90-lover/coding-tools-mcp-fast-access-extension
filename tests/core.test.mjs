import assert from 'node:assert/strict';
import {
  DEFAULT_EXE_PATH,
  blocksNewSync,
  deriveProfilesPath,
  normalizePublicMcpUrl,
  oauthUrlsFromMcpUrl,
  selectWorkspaceSnapshot,
} from '../lib.mjs';

assert.equal(
  deriveProfilesPath(DEFAULT_EXE_PATH),
  String.raw`C:\Users\simon\AppData\Roaming\coding-tools-mcp-desktop\data\profiles.json`,
);

assert.equal(normalizePublicMcpUrl('https://demo.example.com/'), 'https://demo.example.com/mcp');
assert.equal(blocksNewSync({ phase: 'queued', updatedAt: 950 }, 1000), true);
assert.equal(blocksNewSync({ phase: 'review', updatedAt: 950 }, 1000), false);
assert.equal(blocksNewSync({ phase: 'queued', updatedAt: 1 }, 70000), false);
assert.deepEqual(oauthUrlsFromMcpUrl('https://demo.example.com/mcp'), {
  baseUrl: 'https://demo.example.com',
  authorizationUrl: 'https://demo.example.com/oauth/authorize',
  tokenUrl: 'https://demo.example.com/oauth/token',
  metadataUrl: 'https://demo.example.com/.well-known/oauth-authorization-server',
});

const local = selectWorkspaceSnapshot({
  last_workspace_id: 'b',
  shared_secrets: { oauth_client_id: 'shared-id', oauth_client_secret: 'shared-secret', oauth_password: 'shared-password' },
  workspace_secrets: { b: { oauth_client_secret: 'local-secret', oauth_password: 'local-password' } },
  profiles: [
    { id: 'b', name: 'B', tunnel: { public_url: 'https://b.example.com/' }, auth: { type: 'oauth', oauth_client_id: 'local-id', use_shared_secrets: false } },
  ],
});
assert.equal(local.selected.oauthClientId, 'local-id');
assert.equal(local.selected.oauthClientSecret, 'local-secret');
assert.equal(local.selected.oauthPassword, 'local-password');

const shared = selectWorkspaceSnapshot({
  last_workspace_id: 's',
  shared_secrets: { oauth_client_id: 'shared-id', oauth_client_secret: 'shared-secret', oauth_password: 'shared-password' },
  profiles: [
    { id: 's', name: 'Shared', tunnel: { public_url: 'https://s.example.com' }, auth: { type: 'oauth', oauth_client_id: 'ignored-local-id', use_shared_secrets: true } },
  ],
});
assert.equal(shared.selected.oauthClientId, 'shared-id');
assert.equal(shared.selected.oauthClientSecret, 'shared-secret');
assert.equal(shared.selected.oauthPassword, 'shared-password');

console.log('core.test.mjs: focused capture/OAuth checks passed');
