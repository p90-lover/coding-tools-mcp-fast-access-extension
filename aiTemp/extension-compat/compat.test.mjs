import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as lib from '../../lib.mjs';
import { el, loadContentScript } from '../../tests/dom-stub.mjs';

const APP = 'coding-tools-mcp';
const ENDPOINT = 'https://current-fixture.trycloudflare.com/mcp';
const AUTH = new URL('/oauth/authorize', ENDPOINT).href;
const QUERY = new URLSearchParams({response_type: 'code', client_id: 'fixture-client', redirect_uri: 'https://chatgpt.com/connector/oauth/fixture_id', state: 'fixture-state', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43)});

function worker(initialJob) {
  const session = {activeSyncJob: structuredClone(initialJob)};
  const local = {};
  const messages = [];
  const listeners = [];
  let verification = {ok: true, connectionVerified: false, stage: 'authorization_pending'};
  const version = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../manifest.json', import.meta.url)), 'utf8')).version;
  const storage = (data) => ({
    get: async (defaults) => typeof defaults === 'string' ? {[defaults]: structuredClone(data[defaults])} : structuredClone({...defaults, ...data}),
    set: async (values) => Object.assign(data, structuredClone(values)),
    remove: async (key) => { delete data[key]; },
  });
  const noopEvent = {addListener() {}};
  const chrome = {
    runtime: {id: 'fixture-extension', getURL: (p) => `chrome-extension://fixture-extension/${p}`, getContexts: async () => [], onInstalled: noopEvent, onStartup: noopEvent, onMessage: {addListener: (f) => listeners.push(f)}},
    storage: {local: storage(local), session: storage(session)},
    alarms: {onAlarm: noopEvent, create: async () => {}, clear: async () => {}},
    offscreen: {createDocument: async () => {}, closeDocument: async () => {}},
    permissions: {contains: async () => true},
    tabs: {onUpdated: noopEvent, get: async (id) => ({id, status: 'complete', url: id === 301 ? 'https://chatgpt.com/plugins?view=personal' : `${AUTH}?${QUERY}`}), sendMessage: async (_id, m) => {messages.push(m); return m.type === 'CODING_TOOLS_MCP_PING' ? {ok: true, version} : verification;}},
  };
  const context = vm.createContext({...lib, chrome, URL, URLSearchParams, crypto: crypto.webcrypto, Date, console, setTimeout, clearTimeout, setInterval, clearInterval, structuredClone});
  const source = fs.readFileSync(fileURLToPath(new URL('../../background.js', import.meta.url)), 'utf8').replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/lib\.mjs['"];\s*/, '');
  vm.runInContext(source + '\nglobalThis.testWorker = {resumeActiveJob, getActiveJob};', context, {filename: 'background.js'});
  async function send(message, sender) {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker response timeout')), 2000);
      const result = listeners[0](message, sender, (value) => {clearTimeout(timer); resolve(value);});
      if (result === false) {clearTimeout(timer); resolve(undefined);}
    });
  }
  return {session, local, messages, api: context.testWorker, send, setVerification: (value) => {verification = value;}};
}

function fixtureJob() {
  return {id: 'fixture-job', appName: APP, workspaceId: 'selected', workspaceName: 'Selected', endpoint: ENDPOINT, authType: 'oauth', oauthClientId: 'fixture-client', oauthPassword: 'fixture-not-a-real-password', oauthAuthorizeUrl: AUTH, autoAuthorize: true, phase: 'oauth_submitted', chatGptTabId: 301, createdAt: Date.now(), updatedAt: Date.now()};
}

test('desktop profile contract preserves selected workspace, shared secrets and FRP endpoint', () => {
  const data = {last_workspace_id: 'stopped', shared_secrets: {oauth_client_id: 'shared-client', oauth_client_secret: 'shared-secret', oauth_password: 'shared-password'}, workspace_secrets: {active: {oauth_client_secret: 'own-secret', oauth_password: 'own-password'}}, frp_profiles: [{id: 'frp-server', server: 'frp.example.com'}], profiles: [
    {id: 'stopped', name: 'Stopped', auth: {type: 'oauth', oauth_client_id: 'stopped-client'}, tunnel: {type: 'cloudflare', public_url: ''}},
    {id: 'active', name: 'Active', auth: {type: 'oauth', oauth_client_id: 'own-client'}, tunnel: {type: 'cloudflare', public_url: ENDPOINT}},
    {id: 'frp', name: 'FRP', auth: {type: 'oauth', use_shared_secrets: true}, tunnel: {type: 'frp', frp_profile_id: 'frp-server', frp_server: 'old.example.com', frp_subdomain: 'workspace', public_url: 'https://stale.example.com'}},
  ]};
  assert.equal(lib.selectWorkspaceSnapshot(data, 'stopped').selected.id, 'stopped', 'Never authorize another workspace because the selected tunnel is stopped');
  assert.throws(() => lib.selectWorkspaceSnapshot(data, 'missing'), /workspace.*not found/i);
  const own = lib.selectWorkspaceSnapshot(data, 'active').selected;
  assert.equal(own.oauthClientId, 'own-client'); assert.equal(own.oauthPassword, 'own-password');
  const shared = lib.selectWorkspaceSnapshot(data, 'frp').selected;
  assert.equal(shared.publicUrl, 'https://workspace.frp.example.com/mcp');
  assert.equal(shared.oauthClientId, 'shared-client'); assert.equal(shared.oauthPassword, 'shared-password');
  assert.equal(lib.isRemoteHttpsMcpUrl('https://user:password@host.example/mcp'), false);
  const safe = lib.validatedOAuthEndpoints(ENDPOINT, {authorization_endpoint: AUTH, token_endpoint: 'https://attacker.invalid/oauth/token'});
  assert.equal(safe.tokenUrl, 'https://current-fixture.trycloudflare.com/oauth/token');
  assert.equal(safe.metadataStale, true);
  assert.equal(lib.isChatGptOAuthRedirect('https://chatgpt.com/oauth/callback/connector/oauth/opaque_id'), true);
  assert.equal(lib.isChatGptOAuthRedirect('https://chatgpt.com/connector/oauth/opaque_id/extra'), false);
});

test('OAuth popup cannot complete from unchanged opener or release password to a different sender/client', async () => {
  const w = worker(fixtureJob());
  await w.api.resumeActiveJob('fixture-opener-still-open');
  assert.ok(w.session.activeSyncJob, 'Unchanged ChatGPT opener is NOT successful OAuth evidence');
  assert.equal(w.local.lastSyncState?.stage, 'verification_pending');
  assert.ok(w.messages.some((message) => message.type === 'SYNC_MCP_APP_VERIFY_CONNECTION'));
  await w.send({type: 'CHATGPT_SYNC_RESULT', result: {ok: true, awaitingOauth: true, jobId: 'fixture-job'}}, {id: 'fixture-extension', frameId: 0, url: 'https://chatgpt.com/plugins?view=personal', tab: {id: 301}});
  assert.equal(w.session.activeSyncJob.phase, 'oauth_submitted', 'Late creation acknowledgement must not restart submitted OAuth');
  const url = `${AUTH}?${QUERY}`;
  const wrongSender = {id: 'fixture-extension', frameId: 0, url: 'https://attacker.invalid/', tab: {id: 302, url: 'https://attacker.invalid/'}};
  const denied = await w.send({type: 'OAUTH_PAGE_READY', url}, wrongSender);
  assert.equal(denied?.ok, false); assert.equal(denied?.password, undefined);
  const sender = {id: 'fixture-extension', frameId: 0, url, tab: {id: 302, url, openerTabId: 301}};
  const allowed = await w.send({type: 'OAUTH_PAGE_READY', url}, sender);
  assert.equal(allowed?.ok, true); assert.equal(allowed.password, 'fixture-not-a-real-password');
  const bad = new URL(url); bad.searchParams.set('client_id', 'another-client');
  const wrongClient = await w.send({type: 'OAUTH_PAGE_READY', url: bad.href}, {...sender, url: bad.href, tab: {...sender.tab, url: bad.href}});
  assert.equal(wrongClient?.ok, false); assert.equal(wrongClient?.password, undefined);
  const child = await w.send({type: 'OAUTH_PAGE_READY', url}, {...sender, frameId: 1});
  assert.equal(child?.ok, false);
  w.setVerification({ok: true, connectionVerified: true, jobId: 'fixture-job', appName: APP, endpoint: ENDPOINT, evidence: 'scoped_dom_connection'});
  await w.api.resumeActiveJob('fixture-connected-evidence');
  assert.equal(w.session.activeSyncJob, undefined);
  assert.equal(w.local.lastSyncState.stage, 'done');
});

test('completion evidence belongs to the exact app and endpoint, not another connected card', () => {
  const target = el('article', {rect: {width: 350, height: 170}}, [el('h3', {text: APP}), el('div', {text: ENDPOINT}), el('button', {text: 'Connection Connect'}), el('button', {'aria-label': `Actions for ${APP}`})]);
  const other = el('article', {rect: {width: 350, height: 170}}, [el('h3', {text: 'another-app'}), el('div', {text: ENDPOINT}), el('button', {text: 'Connection Connected'})]);
  const {internals} = loadContentScript({body: el('body', {}, [el('main', {}, [target, other])])});
  assert.equal(typeof internals.connectionEvidence, 'function');
  assert.equal(internals.connectionEvidence(APP, ENDPOINT).connectionVerified, false);
  target.children[2].childNodes[0].nodeValue = 'Connection Connected';
  assert.equal(internals.connectionEvidence(APP, ENDPOINT).connectionVerified, true);
  assert.equal(internals.connectionEvidence(APP, 'https://wrong.example.com/mcp').connectionVerified, false);
});
