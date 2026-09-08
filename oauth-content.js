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
    if (!/\/oauth\/authorize\/?$/i.test(location.pathname)) return;

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

    setPassword(input, auth.password);
    try {
      await chrome.runtime.sendMessage({ type: 'OAUTH_SUBMITTED', url: location.href });
    } catch {}

    const form = input.form || input.closest('form');
    if (form) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
      return;
    }

    const button = [...document.querySelectorAll('button,input[type="submit"]')]
      .find((el) => /authorize|授權|授权/i.test((el.textContent || el.value || '').trim()));
    if (button) button.click();
  }

  void run();
})();
