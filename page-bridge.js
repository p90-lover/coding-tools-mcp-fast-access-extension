(() => {
  if (globalThis.__codingToolsMcpMainBridgeV033Loaded) return;
  globalThis.__codingToolsMcpMainBridgeV033Loaded = true;

  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const canonicalIdentity = (value) => normalize(value).replace(/[^\p{L}\p{N}]+/gu, '');

  function canonicalMcpEndpoint(rawValue) {
    let raw = String(rawValue || '').trim().replace(/[),.;]+$/, '');
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:') return '';
      parsed.hash = '';
      parsed.search = '';
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      if (!/\/mcp$/i.test(parsed.pathname)) return '';
      return `${parsed.origin.toLowerCase()}${parsed.pathname}`;
    } catch {
      return '';
    }
  }

  function exactNameNode(appName) {
    const wanted = canonicalIdentity(appName);
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const hits = [];
    let node;
    while ((node = walker.nextNode())) {
      if (canonicalIdentity(node.nodeValue) !== wanted) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const rect = parent.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      hits.push(parent);
    }
    return hits.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    })[0] || null;
  }

  function collectStrings(root, appName) {
    const endpoints = new Set();
    const wanted = canonicalIdentity(appName);
    const seen = new WeakSet();
    const queue = [{ value: root, depth: 0, related: false }];
    let visited = 0;

    while (queue.length && visited < 4500) {
      const { value, depth, related } = queue.shift();
      visited += 1;
      if (typeof value === 'string') {
        const endpoint = canonicalMcpEndpoint(value.replaceAll('\\/', '/'));
        if (endpoint) endpoints.add(endpoint);
        continue;
      }
      if (!value || (typeof value !== 'object' && typeof value !== 'function') || depth > 7) continue;
      if (seen.has(value)) continue;
      seen.add(value);

      let keys;
      try { keys = Object.keys(value); } catch { continue; }
      for (const key of keys.slice(0, 120)) {
        let child;
        try { child = value[key]; } catch { continue; }
        const keyRelated = related || canonicalIdentity(key).includes(wanted);
        if (typeof child === 'string') {
          const childIdentity = canonicalIdentity(child);
          const nextRelated = keyRelated || childIdentity.includes(wanted);
          const endpoint = canonicalMcpEndpoint(child.replaceAll('\\/', '/'));
          if (endpoint && (nextRelated || related || wanted)) endpoints.add(endpoint);
        } else if (child && (typeof child === 'object' || typeof child === 'function')) {
          queue.push({ value: child, depth: depth + 1, related: keyRelated });
        }
      }
    }
    return [...endpoints];
  }

  function inspect(appName) {
    const node = exactNameNode(appName);
    if (!node) return { found: false, endpoints: [] };
    const roots = [];
    let current = node;
    for (let i = 0; i < 7 && current; i += 1, current = current.parentElement) {
      for (const key of Object.keys(current)) {
        if (key.startsWith('__react') || key.startsWith('_react') || key.includes('reactProps')) {
          try { roots.push(current[key]); } catch {}
        }
      }
    }
    const endpoints = new Set();
    for (const root of roots) {
      for (const endpoint of collectStrings(root, appName)) endpoints.add(endpoint);
    }
    return { found: true, endpoints: [...endpoints] };
  }

  document.addEventListener('coding-tools-mcp:inspect-request', (event) => {
    let payload = {};
    try { payload = JSON.parse(String(event.detail || '{}')); } catch {}
    const requestId = String(payload.requestId || '');
    if (!requestId) return;
    let result;
    try { result = inspect(payload.appName || 'coding-tools-mcp'); }
    catch (error) { result = { found: false, endpoints: [], error: error?.message || String(error) }; }
    document.dispatchEvent(new CustomEvent('coding-tools-mcp:inspect-result', {
      detail: JSON.stringify({ requestId, ...result }),
    }));
  });

  // HUD network tap: method/path/status only. Never emit bodies, cookies, or Authorization.
  if (!globalThis.__ctmHudNetTap) {
    globalThis.__ctmHudNetTap = true;
    const emit = (entry) => {
      try { document.dispatchEvent(new CustomEvent('ctm-hud-http', { detail: entry })); } catch {}
    };
    const hostOk = (hostname) => {
      const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
      return host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'chat.openai.com';
    };
    const sanitize = (rawUrl) => {
      try {
        const url = new URL(rawUrl, location.href);
        if (!hostOk(url.hostname)) return null;
        const path = url.pathname.replace(/\/[0-9a-f]{8,}/gi, '/…');
        return { path, conversation: /\/(backend-api|api)\/.*conversation/i.test(url.pathname) };
      } catch { return null; }
    };
    const readModel = async (res, conversation) => {
      if (!conversation) return;
      const type = String(res.headers.get('content-type') || '');
      if (!/json|event-stream|text\/plain/i.test(type)) return;
      try {
        const clone = res.clone();
        const body = await clone.text();
        const snippet = body.slice(0, 20000);
        if (/\bFORBIDDEN\b|mcp.{0,24}disabled|tool.{0,24}disabled/i.test(snippet)) {
          emit({ mcpDisabled: true, method: 'HINT', path: '/mcp', status: 403, ms: 0 });
        }
        const model = snippet.match(/"(?:model|model_slug|default_model_slug)"\s*:\s*"([^"]{1,80})"/i)?.[1];
        const effort = snippet.match(/"(?:reasoning_effort|effort)"\s*:\s*"([^"]{1,40})"/i)?.[1];
        if (model || effort) emit({ model, effort, method: 'MODEL', path: '/conversation', status: res.status, ms: 0 });
      } catch { /* HUD must never fail the page request. */ }
    };
    const origFetch = window.fetch;
    window.fetch = async function tappedFetch(input, init) {
      const started = Date.now();
      const rawUrl = typeof input === 'string' ? input : input?.url;
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      const meta = sanitize(rawUrl);
      try {
        const res = origFetch.apply(this, arguments);
        const resolved = await res;
        if (meta) {
          emit({ method, path: meta.path, status: resolved.status, ms: Date.now() - started });
          void readModel(resolved, meta.conversation);
        }
        return resolved;
      } catch (error) {
        if (meta) emit({ method, path: meta.path, status: 0, ms: Date.now() - started });
        throw error;
      }
    };
  }
})();
