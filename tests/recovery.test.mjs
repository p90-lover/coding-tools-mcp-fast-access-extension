import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { deriveProfilesPath, listProfilesPathCandidates, DEFAULT_EXE_PATH } from '../lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = { globalThis: {}, URL };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(here, '../recovery-policy.js'), 'utf8'), ctx);
const P = ctx.CTMChatRecovery;

const now = 1_000_000;
const baseSample = {
  hasUser: true,
  userKey: 'aaaaaaaa',
  userTextHash: 'bbbbbbbb',
  fingerprint: 'cccccccc',
  busy: false, blocked: false, draft: false, editing: false, manualStop: false,
  error: false, retry: false, continueButton: false, finished: true,
  thinkingFailed: false, mcpDisabled: false, branchButton: false,
};

function primed(extra = {}) {
  return {
    ...P.initial(0),
    userKey: baseSample.userKey,
    fingerprint: extra.fingerprint || baseSample.fingerprint,
    changedAt: 0,
    lastActionAt: 0,
    waiting: false,
    ...extra,
  };
}

function observe(sample, config = {}, previous = primed(), t = now) {
  return P.observe(previous, { ...baseSample, ...sample }, {
    autoContinue: true, doNotSpam: true, longTask: false, idleSeconds: 15, maxActions: 3, ...config,
  }, t);
}

assert.equal(
  P.conversationKey('https://www.chatgpt.com/c/abc12345-def'),
  'abc12345-def',
  'www.chatgpt.com must normalize to a conversation id',
);
assert.equal(
  P.conversationKey('https://chatgpt.com/c/abc12345-def/branch'),
  'abc12345-def',
  '/branch SPA paths must still yield the chat id',
);
assert.equal(
  P.conversationKey('https://chatgpt.com/g/g-xyz/c/abc12345-def'),
  'abc12345-def',
);
assert.equal(
  P.resolveConversationKey({
    pageUrl: 'https://chatgpt.com/c/newpageid1',
    tabUrl: 'https://chatgpt.com/c/oldpageid1',
  }),
  'newpageid1',
  'Apply/Watch must prefer the page URL after /branch/SPA, not the stale tab URL',
);
assert.equal(
  P.resolveConversationKey({
    tabUrl: 'https://chatgpt.com/',
    chatId: 'fallbackid123',
  }),
  'fallbackid123',
  'chatId is the fallback when tab.url is not a saved conversation',
);

assert.equal(P.normalizePrompt(''), '@coding-tools-mcp keep going');
assert.equal(P.normalizePrompt('keep going'), '@coding-tools-mcp keep going');
assert.equal(P.normalizePrompt('Keep going!'), '@coding-tools-mcp keep going');
assert.equal(P.options({}).prompt, '@coding-tools-mcp keep going');
assert.equal(P.options({}).doNotSpam, true);
assert.equal(P.options({}).longTask, false);
assert.equal(P.options({ doNotSpam: false }).doNotSpam, false);
assert.equal(P.options({ prompt: 'keep going' }).prompt, '@coding-tools-mcp keep going');

const thinking = observe({ thinkingFailed: true, finished: false, error: true, retry: true });
assert.equal(thinking.action, 'send_continue', 'Thinking failed must send_continue, not retry-icon spam');

const mcp = observe({ mcpDisabled: true, branchButton: true, finished: true });
assert.equal(mcp.action, 'send_branch');
const mcpKeep = observe({ mcpDisabled: true, branchButton: false, finished: true });
assert.equal(mcpKeep.action, null);
assert.match(mcpKeep.state.status, /MCP disabled/);

const snap = P.snapshot({
  ...baseSample,
  mcpDisabled: true,
  thinkingFailed: true,
  branchButton: true,
});
assert.equal(snap.mcpDisabled, true, 'mcpDisabled must survive snapshot() boolean list');
assert.equal(snap.thinkingFailed, true);
assert.equal(snap.branchButton, true);
assert.ok(P.SAMPLE_BOOLS.includes('mcpDisabled'));

const firstContinue = observe({ finished: true });
assert.equal(firstContinue.action, 'send_continue');
const held = primed({ sentContinue: firstContinue.state.sentContinue, fingerprint: 'dddddddd' });
const secondContinue = observe({ finished: true, fingerprint: 'dddddddd' }, {}, held);
assert.equal(secondContinue.action, null, 'do-not-spam must stop repeat keep-going');
assert.match(secondContinue.state.status, /do-not-spam/);

const longTask = observe({ finished: true, fingerprint: 'eeeeeeee' }, { longTask: true, doNotSpam: true }, primed({ sentContinue: 1, fingerprint: 'eeeeeeee' }));
assert.equal(longTask.action, 'send_continue', 'Long task may send another keep-going within maxActions');

assert.equal(P.isPlausibleModel('Recents'), '');
assert.equal(P.isPlausibleModel('image/png'), '');
assert.equal(P.isPlausibleModel('application/json'), '');
assert.equal(P.isPlausibleModel('Extra High'), '');
assert.equal(P.isPlausibleModel('gpt-5'), 'gpt-5');
assert.equal(P.isEffortLabel('Extra High'), 'Extra High');
assert.equal(P.isEffortLabel('xhigh'), 'Extra High');

const candidates = listProfilesPathCandidates(DEFAULT_EXE_PATH);
assert.equal(candidates[0], deriveProfilesPath(DEFAULT_EXE_PATH));
assert.ok(candidates.some((p) => p.includes(String.raw`AppData\Roaming\coding-tools-mcp-desktop`)));
assert.ok(candidates.some((p) => p.includes(String.raw`AppData\Local\Coding Tools MCP\data\profiles.json`)));
assert.ok(!candidates.some((p) => p.endsWith(String.raw`Coding Tools MCP\profiles.json`)),
  'must not use profiles.json beside the EXE as a capture candidate');

const hud = fs.readFileSync(path.join(here, '../recovery-hud.js'), 'utf8');
assert.match(hud, /id="watch"/);
assert.match(hud, /id="longTask"/);
assert.match(hud, /id="doNotSpam"/);
assert.match(hud, /type: 'set'/);
assert.match(hud, /type: 'prefs'/);
assert.match(hud, /HTTP \(collapsed\)/);
assert.doesNotMatch(hud, /id="watch"[^>]*disabled/);

const worker = fs.readFileSync(path.join(here, '../recovery-background.js'), 'utf8');
assert.match(worker, /rememberPage/);
assert.match(worker, /resolveConversationKey/);
assert.match(worker, /message\.type === 'prefs'/);
assert.match(worker, /rearm/);
assert.match(worker, /arm_followup/);
assert.match(worker, /Off: watch disabled/);

console.log('recovery.test.mjs: URL, prompt, thinking-failed, MCP branch, snapshot, spam, model, path and HUD wiring checks passed');
