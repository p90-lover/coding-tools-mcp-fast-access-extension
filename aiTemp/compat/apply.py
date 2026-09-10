"""Materialize reviewed compatibility changes; preserve originals and unrelated work."""
from pathlib import Path
import json, os, shutil, subprocess

def once(text, old, new):
    assert text.count(old) == 1, (old[:100], text.count(old))
    return text.replace(old, new, 1)

def save(name, text):
    p = Path(name)
    if p.read_text(encoding='utf-8') == text:
        return
    backup = Path('aiTemp/Trash/compat-before') / os.environ['GITHUB_RUN_ID'] / name
    backup.parent.mkdir(parents=True, exist_ok=True)
    assert not backup.exists() and not p.is_symlink()
    shutil.copy2(p, backup)
    p.write_text(text, encoding='utf-8')

p = Path('background.js'); s = p.read_text(encoding='utf-8')
if 'async function oauthSenderContext(' not in s:
    s = once(s, "const HELPER_VERSION = '0.0.6';", "const HELPER_VERSION = '0.0.7';")
    start = s.index('    // The OAuth form was submitted on the MCP host.')
    end = s.index("\n    if (['waiting_oauth_or_create'", start)
    s = s[:start] + '''    // A chrome-less OAuth popup leaves the original ChatGPT tab unchanged.
    // Submission/callback are progress only; wait for app-scoped connection evidence.
    if (['oauth_submitted', 'oauth_returned'].includes(job.phase)) {
      await nudgeChatGptFinalizer(job);
      return;
    }
''' + s[end:]
    s = once(s, "    await sendToChatGpt(tab.id, { type: 'SYNC_MCP_APP_RESUME', appName: job.appName, jobId: job.id, authType: job.authType });", '''    const result = await sendToChatGpt(tab.id, {
      type: 'SYNC_MCP_APP_RESUME', appName: job.appName, jobId: job.id,
      authType: job.authType, endpoint: job.endpoint,
      oauthSubmitted: ['oauth_submitted', 'oauth_returned'].includes(job.phase),
    });
    if (result?.connectionObserved === true) {
      await handleChatGptResult({ ...result, jobId: job.id }, {
        id: chrome.runtime.id, frameId: 0, url: tab.url, tab: { id: tab.id },
      });
    }''')
    start = s.index('async function handleOauthReady(')
    end = s.index('\nasync function maybeInjectOauthHelper', start)
    s = s[:start] + Path('aiTemp/compat/worker-block.js').read_text(encoding='utf-8') + s[end:]
    s = once(s, "chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {\n  if (changeInfo.status", "chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {\n  if (changeInfo.url) void observeOAuthNavigation(tabId, changeInfo.url);\n  if (changeInfo.status")
    s = once(s, "chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {\n  (async () => {", '''chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const pageMessages = new Set(['OAUTH_PAGE_READY', 'OAUTH_SUBMITTED', 'CHATGPT_SYNC_RESULT']);
    const ownUi = sender?.id === chrome.runtime.id && !sender.tab
      && [chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('offscreen.html')].includes(sender.url);
    if (!pageMessages.has(message?.type) && !ownUi) {
      sendResponse({ok:false, error:'This action is restricted to the extension interface.'});
      return;
    }''')
    s = once(s, "sendResponse(await handleOauthReady(message.url || ''));", "sendResponse(await handleOauthReady(message.url || '', sender));")
    s = once(s, "      await handleOauthSubmitted(message.url || '');\n      sendResponse({ ok: true });", "      sendResponse(await handleOauthSubmitted(message.url || '', sender));")
    s = once(s, "await handleChatGptResult(message.result || {});", "await handleChatGptResult(message.result || {}, sender);")
    save(p, s)

p = Path('content.js'); s = p.read_text(encoding='utf-8')
if 'function observeAppConnection(' not in s:
    s = once(s, "const HELPER_VERSION = '0.0.6';", "const HELPER_VERSION = '0.0.7';")
    observer = '''  function observeAppConnection(appName) {
    const card = findGridArticle(appName);
    const scopes = card ? [card] : [];
    for (const dialog of visibleDialogs()) {
      const headings = [...dialog.querySelectorAll('h1,h2,h3,[role="heading"]')];
      if (headings.some((el) => sameAppIdentity(el.textContent, appName))) scopes.push(dialog);
    }
    for (const scope of scopes) {
      const controls = allClickable(scope).filter(visible);
      const pending = controls.some((el) => elementLabels(el).some((label) => /^(connect|sign in|log in|connection connect|連接|登入)$/.test(label)));
      if (pending) continue;
      const statuses = [...scope.querySelectorAll('[role="status"],[data-state="connected"],button,[role="button"]')].filter(visible);
      const positive = statuses.some((el) => elementLabels(el).some((label) => /^(connected|connection connected|disconnect|connection disconnect|已連線|已連接|已连接|中斷連線|斷開連接)$/.test(label)));
      if (positive) return {ok:true,stage:'connected',connectionObserved:true,
        message:`ChatGPT shows ${appName} as connected; actual tool execution is not verified.`};
    }
    return {ok:false,stage:'connection_verification_pending',connectionObserved:false,
      message:'Waiting for a Connected status on this exact app. No new authorization was started.'};
  }

'''
    marker = "  // Test seam. This lives in the extension's isolated world, so the page cannot reach it."
    s = once(s, marker, observer + marker)
    s = once(s, '  globalThis.__codingToolsMcpInternals = {', '  globalThis.__codingToolsMcpInternals = {\n    observeAppConnection,')
    s = once(s, "      const appName = message.appName || 'coding-tools-mcp';\n      if (!isPersonalPluginsUrl", '''      const appName = message.appName || 'coding-tools-mcp';
      if (message.oauthSubmitted) {
        stopFinalizer();
        sendResponse(observeAppConnection(appName));
        return false;
      }
      if (!isPersonalPluginsUrl''')
    save(p, s)

p = Path('oauth-content.js'); s = p.read_text(encoding='utf-8')
if 'const acknowledged =' not in s:
    s = once(s, "    if (!/\\/oauth\\/authorize\\/?$/i.test(location.pathname)) return;", "    if (location.protocol !== 'https:' || !/\\/oauth\\/authorize\\/?$/i.test(location.pathname)) return;")
    start = s.index('    setPassword(input, auth.password);')
    end = s.index('\n  }\n\n  void run();', start)
    s = s[:start] + '''    const form = input.form || input.closest('form');
    if (!form || form.method.toLowerCase() !== 'post' || typeof form.requestSubmit !== 'function') return;
    const action = new URL(form.action || location.href, location.href);
    if (action.origin !== location.origin || action.pathname.replace(/\\/$/, '') !== '/oauth/authorize') return;
    const expected = new URL(location.href).searchParams;
    const fields = new FormData(form);
    for (const name of ['client_id','redirect_uri','state','code_challenge','code_challenge_method']) {
      if (expected.getAll(name).length !== 1 || fields.getAll(name).length !== 1 || fields.get(name) !== expected.get(name)) return;
    }
    if (fields.getAll('consent_nonce').length !== 1 || !fields.get('consent_nonce')) return;
    if (!form.checkValidity()) {
      // An empty required password is expected before filling; other invalid fields fail later.
      setPassword(input, auth.password);
      if (!form.checkValidity()) return;
    } else setPassword(input, auth.password);
    try {
      const acknowledged = await chrome.runtime.sendMessage({type:'OAUTH_SUBMITTED',url:location.href});
      if (!acknowledged?.ok) return;
      form.requestSubmit();
    } catch { /* A disconnected worker must not submit an untracked authorization. */ }
''' + s[end:]
    save(p, s)

p = Path('manifest.json'); manifest = json.loads(p.read_text(encoding='utf-8'))
assert manifest['version'] in ('0.0.6', '0.0.7')
manifest['version'] = '0.0.7'
manifest['description'] = 'Sync Coding Tools MCP with sender-bound OAuth popup authorization and app-specific connection verification.'
save(p, json.dumps(manifest, indent=2) + '\n')

p = Path('tests/workflow.test.mjs'); s = p.read_text(encoding='utf-8')
if "assert.equal(manifest.version, '0.0.1');" in s:
    s = once(s, "assert.equal(manifest.version, '0.0.1');", "assert.ok(background.includes(`const HELPER_VERSION = '${manifest.version}';`));\nassert.ok(content.includes(`const HELPER_VERSION = '${manifest.version}';`));")
    save(p, s)
p = Path('tests/dom-stub.mjs'); s = p.read_text(encoding='utf-8')
if "part.operator === '^='" not in s:
    s = once(s, '(?:=(?:"([^\"]*)"|\'([^\']*)\'))?', '(?:([*^]?=)(?:"([^\"]*)"|\'([^\']*)\'))?')
    s = once(s, 'value: match[3] ?? match[4] ?? null', "operator: match[3] || '', value: match[4] ?? match[5] ?? null")
    s = once(s, '    return this.attributes.get(part.attr) === part.value;', "    const value = this.attributes.get(part.attr);\n    if (part.operator === '^=') return value.startsWith(part.value);\n    if (part.operator === '*=') return value.includes(part.value);\n    return value === part.value;")
    save(p, s)

notes = '''# v0.0.7 — Desktop v0.4.3-rc.3 compatibility / 相容性修正

## English

Keeps create-before-Connect, existing page detection, local configuration capture and site permissions. OAuth submission no longer succeeds merely because the unchanged parent ChatGPT tab is open. Password delivery is bound to Chrome's actual sender, top-level frame, matching client/S256/callback parameters and the popup opener. Unlinked/noopener popups require manual password entry. Only the correct popup/state callback is tracked, and completion requires an explicit Connected/Disconnect state on this exact app; actual MCP tool execution is not inferred. Waiting no longer starts repeated Connect flows. Content scripts cannot request local credentials through extension-only UI messages. The helper retains the server form's nonce/state/PKCE fields and same-origin POST/cookie flow.

Reload the extension and existing ChatGPT tabs once after upgrading. Preserve settings/site access and restart Desktop. profiles.json is in the app configuration data directory, not necessarily beside the EXE; use the existing path override when required. No new public credential endpoint is added. Focused worker and exact-app DOM checks use synthetic Chrome boundaries; the paired Desktop pipeline replays its actual HTTP form in Chromium before publishing. This is not live-account verification. No Codex, model or inference request is invoked. Existing files/releases remain; temporary data stays in aiTemp.

## 繁體中文

保留先建立再 Connect、頁面辨識、本機設定讀取及網站權限。OAuth 送出後不再因原本 ChatGPT 分頁仍開啟而宣告成功。密碼傳送會核對 Chrome 真正來源、頂層畫面、Client／S256／回呼參數及彈窗開啟者；無法驗證開啟者的彈窗改用手動輸入。只追蹤正確彈窗及 State 回呼，並須在指定應用程式觀察到已連線／中斷連線狀態才完成，不會推斷工具已執行。等待期間不再重複 Connect；內容腳本不能透過擴充功能介面訊息索取本機密鑰。助手保留服务端表單的 Nonce／State／PKCE、同來源 POST 及 Cookie 流程。

升級後重新載入擴充功能及已開啟的 ChatGPT 分頁一次，保留設定／網站權限並重啟 Desktop。profiles.json 在應用程式設定資料目錄，不一定在 EXE 旁；有需要時使用既有路徑覆寫，不會新增公開密鑰端點。工作狀態及指定應用程式的 DOM 測試使用已標示的模擬 Chrome 邊界；配對 Desktop 流程會在發佈前使用真正 HTTP 表單於 Chromium 重播。並非真實帳戶驗證。沒有呼叫 Codex、模型或推論服務；保留現有檔案及 Release，暫存資料放在 aiTemp。

## Earlier release documentation / 過往版本文件

'''
for name in ['README.md', 'RELEASE_NOTES.md']:
    s = Path(name).read_text(encoding='utf-8')
    if not s.startswith('# v0.0.7'):
        save(name, notes + s)
paths = ['background.js','content.js','oauth-content.js','manifest.json','tests/workflow.test.mjs','tests/dom-stub.mjs','README.md','RELEASE_NOTES.md']
subprocess.run(['git','add','--',*paths], check=True)
subprocess.run(['git','diff','--cached','--check'], check=True)
assert not subprocess.check_output(['git','diff','--cached','--diff-filter=D','--name-only']).strip()
