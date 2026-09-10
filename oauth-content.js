(() => {
  if (globalThis.__codingToolsMcpOauthHelperV03Loaded) return;
  globalThis.__codingToolsMcpOauthHelperV03Loaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function requestAuthorizationData() {
    try {
      return await chrome.runtime.sendMessage({ type: 'OAUTH_PAGE_READY', url: location.href });
    } catch {
      return null;
    }
  }

  function setPassword(input, password) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, password);
    else input.value = password;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function run() {
    if (location.protocol !== 'https:' || !/\/oauth\/authorize\/?$/i.test(location.pathname)) return;

    let auth = null;
    for (let attempt = 0; attempt < 20 && !auth?.ok; attempt += 1) {
      auth = await requestAuthorizationData();
      if (!auth?.ok) await sleep(200);
    }
    if (!auth?.ok || !auth.password) return;

    let input = null;
    for (let attempt = 0; attempt < 30 && !input; attempt += 1) {
      input = document.querySelector('input[name="password"], input[type="password"]');
      if (!input) await sleep(100);
    }
    if (!input) return;

    const form = input.form || input.closest('form');
    if (!form || form.method.toLowerCase() !== 'post' || typeof form.requestSubmit !== 'function') return;
    const action = new URL(form.action || location.href, location.href);
    if (action.origin !== location.origin || action.pathname.replace(/\/$/, '') !== '/oauth/authorize') return;
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

  }

  void run();
})();
