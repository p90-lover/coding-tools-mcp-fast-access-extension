"""Exercise shipped helper JS in Chromium with synthetic Chrome IPC, no account/network.
This is not a Chrome-store install or a live ChatGPT authorization test.
"""
from pathlib import Path
from urllib.parse import parse_qs, urlencode
from playwright.sync_api import sync_playwright, expect
import json, shutil

password = 'fixture-not-real'
base = 'https://current-fixture.trycloudflare.com'
callback = 'https://chatgpt.com/connector/oauth/fixture_id?code=fixture-code&state=fixture-state'
query = urlencode(dict(response_type='code', client_id='fixture-client', redirect_uri=callback.split('?')[0], state='fixture-state', code_challenge='a'*43, code_challenge_method='S256'))
authorize = base + '/oauth/authorize?' + query
source = Path('oauth-content.js').read_text(encoding='utf-8')
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('google-chrome'), headless=True, args=['--no-sandbox'])
    for case in ['valid_form', 'wrong_origin', 'wrong_method']:
        context = browser.new_context()
        calls = []
        action = base + '/oauth/authorize' if case != 'wrong_origin' else 'https://attacker.invalid/oauth/authorize'
        method = 'post' if case != 'wrong_method' else 'get'
        html = f'<h1>Authorize Coding Tools MCP</h1><form method="{method}" action="{action}"><input type="hidden" name="request_nonce" value="fixture-bound-nonce"><input type="hidden" name="state" value="fixture-state"><label>Password<input type="password" name="password"></label><button type="submit">Authorize</button></form>'
        def route_handler(route):
            req = route.request
            if req.url == 'https://chatgpt.com/test-initiator':
                route.fulfill(status=200, content_type='text/html', body='<button id="connect">Connect</button><script>document.querySelector("button").onclick=()=>window.open('+json.dumps(authorize)+',"oauth","popup=yes,width=560,height=720");</script>')
            elif req.url == authorize and req.method == 'GET':
                route.fulfill(status=200, headers={'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'", 'Set-Cookie': 'fixture=bound; HttpOnly; Secure; SameSite=Lax; Path=/oauth'}, body=html)
            elif req.url == base+'/oauth/authorize' and req.method == 'POST':
                form = parse_qs(req.post_data or '')
                assert form == {'password':[password], 'request_nonce':['fixture-bound-nonce'], 'state':['fixture-state']}
                assert 'fixture=bound' in req.all_headers().get('cookie','')
                assert req.all_headers().get('origin') == base
                calls.append('bound_form_post')
                route.fulfill(status=303, headers={'Location': callback}, body='')
            elif req.url == callback:
                assert req.method == 'GET' and not req.post_data
                calls.append('callback_get_without_password')
                route.fulfill(status=200, content_type='text/html', body='CALLBACK_REACHED')
            else:
                calls.append('unexpected_request')
                route.abort('blockedbyclient')
        context.route('**/*', route_handler)
        opener = context.new_page()
        opener.goto('https://chatgpt.com/test-initiator')
        with opener.expect_popup() as created:
            opener.get_by_role('button', name='Connect', exact=True).click()
        popup = created.value
        expect(popup.get_by_label('Password', exact=True)).to_be_visible()
        popup.evaluate('(password) => {globalThis.chrome={runtime:{sendMessage:async m=>{if(m.type==="OAUTH_PAGE_READY")return {ok:true,password}; return {ok:true};}}};}', password)
        popup.evaluate(source)
        if case == 'valid_form':
            expect(popup.get_by_text('CALLBACK_REACHED', exact=True)).to_be_visible()
            assert calls == ['bound_form_post', 'callback_get_without_password'], calls
        else:
            # Flush the helper's promise continuation; denied forms are not submitted.
            popup.evaluate('() => new Promise(resolve => setTimeout(resolve, 100))')
            assert popup.get_by_label('Password', exact=True).input_value() == ''
            assert not calls, calls
        results.append({'case': case, 'requests': calls, 'passed': True})
        context.close()
    context = browser.new_context()
    context.route('**/*', lambda r: r.fulfill(status=200, content_type='text/html', body='<main><article style="width:350px;height:170px"><h3>coding-tools-mcp</h3><div>'+base+'/mcp</div><button id="status">Connection Connect</button><button aria-label="Actions for coding-tools-mcp">Actions</button></article></main>'))
    page = context.new_page(); page.goto('https://chatgpt.com/plugins?view=personal')
    page.evaluate('globalThis.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async()=>({ok:true})}}')
    page.evaluate(Path('content.js').read_text(encoding='utf-8'))
    check = '(endpoint)=>globalThis.__codingToolsMcpInternals.connectionEvidence("coding-tools-mcp",endpoint).connectionVerified'
    assert not page.evaluate(check, base+'/mcp')
    page.locator('#status').evaluate('el=>el.textContent="Connection Connected"')
    assert page.evaluate(check, base+'/mcp')
    assert not page.evaluate(check, 'https://other.example/mcp')
    results.append({'case':'rendered_exact_app_endpoint_connection','passed':True})
    context.close()
    proof = {'browser': browser.version, 'passed': True, 'cases': results, 'synthetic_chrome_ipc': True, 'live_chatgpt_account': False, 'model_requests': 0, 'screenshots_written': 0}
    browser.close()
Path('aiTemp/evidence/browser.json').write_text(json.dumps(proof, indent=2)+'\n', encoding='utf-8')
print('PASS: Chromium helper POST/cookie/nonce preservation, callback GET, wrong-origin/method refusal and exact rendered connection evidence')
