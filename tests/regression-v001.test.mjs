import test from 'node:test';
import assert from 'node:assert/strict';
import { el, loadContentScript } from './dom-stub.mjs';

function pluginsPage({ url, children }) {
  return loadContentScript({ url, body: el('body', {}, children) });
}

function createButton(label = 'Create', extra = {}) {
  return el('button', { text: label, rect: { top: 40, left: 700, width: 90, height: 34 }, ...extra });
}

test('conversation sidebar plugin link is not plugins-page evidence', () => {
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/c/abc123',
    children: [
      el('nav', {}, [el('a', { href: '/plugins/g-sidebar-link', text: 'coding-tools-mcp' })]),
      el('main', {}, [el('div', { text: 'Regular conversation content' })]),
    ],
  });
  assert.equal(internals.isPersonalPluginsPage(), false);
});

test('plugin link inside conversation content is not a rendered manager card', () => {
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/c/abc123',
    children: [
      el('main', {}, [
        el('div', {}, [
          el('p', { text: 'Try this plugin:' }),
          el('a', { href: '/plugins/g-shared-in-chat', text: 'Open coding-tools-mcp' }),
        ]),
      ]),
    ],
  });
  assert.equal(internals.isPersonalPluginsPage(), false);
});

test('renamed plugins route waits for late-rendered page evidence', async () => {
  const URL_NOW = 'https://live-renamed-route.trycloudflare.com/mcp';
  const { internals, body } = pluginsPage({
    url: 'https://chatgpt.com/settings/connectors',
    children: [el('main', {}, [el('div', { text: 'Loading settings…' })])],
  });
  setTimeout(() => {
    body.append(el('main', {}, [
      el('input', { placeholder: 'Search connectors', 'aria-label': 'Search connectors' }),
      el('button', { 'aria-label': 'Create app' }),
      el('div', { rect: { top: 190, left: 100, width: 700, height: 80 } }, [
        el('a', { href: '/plugins/g-renamed-route', text: 'Open coding-tools-mcp' }),
        el('span', { text: 'coding-tools-mcp' }),
        el('div', { text: URL_NOW }),
      ]),
    ]));
  }, 40);
  const result = await internals.prepareSync({
    jobId: 'job-renamed-route-late-render',
    appName: 'coding-tools-mcp',
    endpoint: URL_NOW,
    authType: 'none',
    replaceExisting: true,
  });
  assert.equal(result.stage, 'remove');
});

test('readiness wakes on DOM mutation instead of next poll', async () => {
  const { internals, body } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [el('div', { text: 'Loading…' })],
  });
  setTimeout(() => {
    body.append(el('div', {}, [
      el('a', { href: '/plugins/g-fast-render', text: 'Open coding-tools-mcp' }),
      el('span', { text: 'coding-tools-mcp' }),
    ]));
  }, 40);
  const started = Date.now();
  assert.equal(await internals.waitForPluginsPageReady('coding-tools-mcp'), 'app');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 220, `elapsed=${elapsed}ms`);
});

test('explicit empty plugins page has immediate rendered-empty state', () => {
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins',
    children: [el('h1', { text: 'No apps yet' }), createButton('Create')],
  });
  assert.equal(internals.pluginsPageRenderState?.('coding-tools-mcp'), 'empty');
});

test('ambiguous create controls fail closed without a 12-second stall', async () => {
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins',
    children: [
      el('button', { text: '+', rect: { top: 40, left: 700, width: 32, height: 32 } }),
      el('button', { text: '+', rect: { top: 300, left: 700, width: 32, height: 32 } }),
    ],
  });
  const started = Date.now();
  assert.equal(await internals.openCreateFormStrict(), false);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 4000, `ambiguous create failure should be fast and safe (elapsed=${elapsed}ms)`);
});

test('unrendered plugin list fails closed without the old long stall', async () => {
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [
      el('input', { placeholder: 'Search plugins', 'aria-label': 'Search plugins' }),
      el('button', { 'aria-label': 'Create app' }),
    ],
  });
  const started = Date.now();
  assert.equal(await internals.waitForPluginsPageReady('coding-tools-mcp'), 'unknown');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 6000, `unrendered list should retry safely without an 8s stall (elapsed=${elapsed}ms)`);
});
