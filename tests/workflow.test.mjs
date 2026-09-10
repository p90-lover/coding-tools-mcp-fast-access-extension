import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const oauthContent = fs.readFileSync(path.join(root, 'oauth-content.js'), 'utf8');
const pageBridge = fs.readFileSync(path.join(root, 'page-bridge.js'), 'utf8');

assert.ok(background.includes(`const HELPER_VERSION = '${manifest.version}';`));
assert.ok(content.includes(`const HELPER_VERSION = '${manifest.version}';`));
assert.ok(manifest.permissions.includes('alarms'));
assert.ok(manifest.permissions.includes('offscreen'));
assert.ok(manifest.host_permissions.includes('https://*.trycloudflare.com/*'));
assert.ok(manifest.content_scripts.some((entry) => entry.matches?.includes('https://*.trycloudflare.com/*') && entry.js?.includes('oauth-content.js')));
assert.ok(manifest.content_scripts.some((entry) => entry.world === 'MAIN' && entry.js?.includes('page-bridge.js')));

assert.match(background, /CHATGPT_PERSONAL_PLUGINS_URL = 'https:\/\/chatgpt\.com\/plugins\?view=personal'/);
assert.match(background, /openPersonalPluginsTab\(job\.chatGptTabId\)/);
assert.match(background, /chrome\.storage\.session/);
assert.match(background, /chrome\.alarms\.onAlarm/);
assert.match(background, /chrome\.offscreen\.createDocument/);
assert.match(background, /OFFSCREEN_HEARTBEAT/);

assert.match(content, /isPersonalPluginsPage/);
assert.match(content, /inspectExistingApp/);
assert.match(content, /removeExistingStrict/);
assert.match(content, /openCreateFormStrict/);
assert.match(content, /existing_url_not_detected/);
assert.match(content, /canonicalAppIdentity/);
assert.match(content, /createControl/);
assert.match(content, /searchAssociatedPlus/);
assert.match(content, /ensurePersonalView/);
assert.match(content, /waitForPluginsPageReady/);
assert.match(background, /RECOVERABLE_PREPARE_STAGES/);
// A reused ChatGPT tab can restore its last conversation instead of loading /plugins; sync must
// detect that and retry in a clean tab rather than treating the empty list as "no existing app".
assert.match(background, /isBasePersonalPluginsUrl\(settled\.url\)/);
assert.match(background, /chrome\.tabs\.create\(\{ url: CHATGPT_PERSONAL_PLUGINS_URL/);
assert.match(background, /MAX_PREPARE_ATTEMPTS/);
assert.match(content, /mainWorldEndpointsForApp/);
assert.match(content, /openExactAppDetails/);
assert.match(content, /comparison_in_progress/);
assert.match(background, /prepared\?\.continue === 'wait'/);
assert.match(pageBridge, /__react/);
assert.doesNotMatch(content, /:has-text/);
assert.doesNotMatch(pageBridge, /:has-text/);
assert.doesNotMatch(content, /buttons\.at\(-1\)/);
assert.doesNotMatch(content, /create = buttons\.find\(\(el\) => \['\+', '＋'\]/);


assert.match(background, /driveInspectDetails/);
assert.match(background, /driveCreateReplacement/);
assert.match(background, /isBasePersonalPluginsUrl/);
assert.match(content, /SYNC_MCP_APP_INSPECT_DETAILS/);
assert.match(content, /SYNC_MCP_APP_CREATE_REPLACEMENT/);
assert.match(content, /detailUrl/);

assert.match(oauthContent, /OAUTH_PAGE_READY/);
assert.match(oauthContent, /OAUTH_SUBMITTED/);

// The worker and the page helper must agree on what the personal plugins page IS. When they
// disagreed, the content script accepted a page the worker read as a failed navigation, so
// openPersonalPluginsTab abandoned the correct tab and opened a fresh one on every pass.
{
  const workerMatches = (() => {
    const source = background.slice(background.indexOf('function isBasePersonalPluginsUrl'));
    const body = source.slice(0, source.indexOf('\n}') + 2);
    return new Function(`${body}; return isBasePersonalPluginsUrl;`)();
  })();

  const cases = [
    ['https://chatgpt.com/plugins?view=personal', true],
    ['https://chatgpt.com/plugins', true],
    ['https://chatgpt.com/plugins/', true],
    ['https://chatgpt.com/plugins?view=personal&ref=sidebar', true],
    ['https://chatgpt.com/plugins?utm_source=x', true],
    ['https://chat.openai.com/plugins?view=personal', true],
    ['https://chatgpt.com/plugins?view=store', false],
    ['https://chatgpt.com/plugins/plugin_asdk_app_x', false],
    ['https://chatgpt.com/c/abc', false],
  ];
  for (const [url, expected] of cases) {
    assert.equal(workerMatches(url), expected, `isBasePersonalPluginsUrl(${url})`);
  }
}

assert.match(background, /current\.freshTabRequired = false/);
// Renamed ChatGPT manager routes (for example /settings/connectors) must not be discarded by
// the service worker before content.js can validate their DOM. Conversation routes still fail fast.
assert.match(background, /function isPotentialPluginsManagerUrl/);
{
  const source = background.slice(background.indexOf('function isPotentialPluginsManagerUrl'));
  const body = source.slice(0, source.indexOf('\n}') + 2);
  const workerPotential = new Function(`${body}; return isPotentialPluginsManagerUrl;`)();
  assert.equal(workerPotential('https://chatgpt.com/settings/connectors'), true);
  assert.equal(workerPotential('https://chatgpt.com/settings/apps'), true);
  assert.equal(workerPotential('https://chatgpt.com/c/abc'), false);
}
assert.match(background, /!isBasePersonalPluginsUrl\(settled\.url\) && !isPotentialPluginsManagerUrl\(settled\.url\)/);


console.log('workflow.test.mjs: personal-plugin detect/delete/recreate + resumable OAuth checks passed');
