import assert from 'node:assert/strict';
import { el, loadContentScript } from './dom-stub.mjs';

function pluginsPage({ url, children }) {
  return loadContentScript({ url, body: el('body', {}, children) });
}

// A ChatGPT-style create control: a plain button whose innerText and textContent are equal.
function createButton(label = 'Create', extra = {}) {
  return el('button', { text: label, rect: { top: 40, left: 700, width: 90, height: 34 }, ...extra });
}

function revealCreateFormOnClick(button, body) {
  button.onClick = () => {
    body.append(el('div', {}, [
      el('label', { for: 'name', text: 'Name' }),
      el('input', { id: 'name' }),
      el('label', { for: 'url', text: 'MCP Server URL' }),
      el('input', { id: 'url' }),
    ]));
  };
}

// 1. Exact label matching must survive innerText/textContent both being present.
{
  const { internals, document } = pluginsPage({ children: [createButton('Create')] });
  assert.equal(internals.elementText(document.querySelector('button')), 'create',
    'elementText must not duplicate innerText and textContent');
  const found = internals.findClickablePreferExact(['create']);
  assert.ok(found, 'a plain <button>Create</button> must be found by exact label matching');
}

// 2. A button carrying both visible text and a longer aria-label still matches exactly.
{
  const { internals } = pluginsPage({
    children: [createButton('Create', { 'aria-label': 'Create new app' })],
  });
  assert.ok(internals.findClickablePreferExact(['create']),
    'exact matching must consider each label source separately');
}

// 3. ChatGPT drops ?view=personal when the personal list is empty; that page is still ours.
{
  const cases = [
    ['https://chatgpt.com/plugins?view=personal', true],
    ['https://chatgpt.com/plugins', true],
    ['https://chatgpt.com/plugins/', true],
    ['https://www.chatgpt.com/plugins', true],
    ['https://chatgpt.com/plugins?view=store', false],
    ['https://chatgpt.com/gpts', false],
  ];
  for (const [url, expected] of cases) {
    const { internals } = pluginsPage({ url, children: [] });
    assert.equal(internals.isPersonalPluginsPage(), expected, `isPersonalPluginsPage(${url})`);
  }
}

// 4. Empty personal list: no search field, no app rows, just a Create control.
{
  const button = createButton('Create');
  const { internals, body } = pluginsPage({
    url: 'https://chatgpt.com/plugins',
    children: [el('h1', { text: 'No apps yet' }), button],
  });
  revealCreateFormOnClick(button, body);
  assert.equal(await internals.openCreateFormStrict(), true,
    'the Create control must be found when the personal list is empty');
  assert.equal(button.clicks, 1);
}

// 5. Empty personal list rendered as a bare + next to the page heading (no search input).
{
  const plus = el('button', { text: '+', rect: { top: 40, left: 760, width: 32, height: 32 } });
  const { internals, body } = pluginsPage({
    url: 'https://chatgpt.com/plugins',
    children: [el('h1', { text: 'Apps' }), plus],
  });
  revealCreateFormOnClick(plus, body);
  assert.equal(await internals.openCreateFormStrict(), true,
    'a single unambiguous + must be usable when there is no search field');
  assert.equal(plus.clicks, 1);
}

// 6. The + inside an existing app row must never be the one clicked.
{
  const rowPlus = el('button', { text: '+', rect: { top: 200, left: 760, width: 32, height: 32 } });
  const appRow = el('div', { rect: { top: 190, left: 100, width: 700, height: 56 } }, [
    el('span', { text: 'coding-tools-mcp', rect: { top: 200, left: 110, width: 200, height: 20 } }),
    rowPlus,
  ]);
  const create = createButton('Create app');
  const { internals, body } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [appRow, create],
  });
  revealCreateFormOnClick(create, body);
  assert.equal(await internals.openCreateFormStrict(), true);
  assert.equal(rowPlus.clicks, 0, 'the app-row + must stay untouched');
  assert.equal(create.clicks, 1);
}

// 7. With only an app-row +, there is no safe create control: report failure, click nothing.
{
  const rowPlus = el('button', { text: '+', rect: { top: 200, left: 760, width: 32, height: 32 } });
  const appRow = el('div', { rect: { top: 190, left: 100, width: 700, height: 56 } }, [
    el('span', { text: 'coding-tools-mcp', rect: { top: 200, left: 110, width: 200, height: 20 } }),
    rowPlus,
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [appRow],
  });
  assert.equal(await internals.openCreateFormStrict(), false);
  assert.equal(rowPlus.clicks, 0, 'no unrelated control may be clicked');
}

// 8. Two ambiguous bare + controls: refuse rather than guess.
{
  const first = el('button', { text: '+', rect: { top: 40, left: 700, width: 32, height: 32 } });
  const second = el('button', { text: '+', rect: { top: 300, left: 700, width: 32, height: 32 } });
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins',
    children: [first, second],
  });
  assert.equal(await internals.openCreateFormStrict(), false);
  assert.equal(first.clicks + second.clicks, 0, 'ambiguous + controls must not be clicked');
}

// 9. ChatGPT's real create dialog, reproduced from the live DOM on 2026-08-16:
//    the endpoint field carries no label and no aria-label — only id/name and an https placeholder.
{
  const dialog = el('div', { role: 'dialog' }, [
    el('input', { type: 'file' }),
    el('input', { id: 'custom-connector-name', name: 'custom-connector-name', 'aria-label': 'Name', placeholder: 'Custom Tool' }),
    el('input', { id: 'custom-connector-description', name: 'custom-connector-description', 'aria-label': 'Description (optional)' }),
    el('input', { id: 'custom-connector-url', name: 'custom-connector-url', placeholder: 'https://example.com/sse' }),
  ]);
  const { internals, document } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [dialog],
  });

  const url = internals.findInput('url');
  assert.ok(url, 'the endpoint field must be found');
  assert.equal(url.getAttribute('name'), 'custom-connector-url',
    'findInput("url") must resolve the endpoint field, not the file input');

  const name = internals.findInput('name');
  assert.equal(name.getAttribute('name'), 'custom-connector-name');

  assert.equal(internals.createFormPresent(), true);

  // A file input can never receive a typed endpoint, so it must not be a candidate at all.
  assert.equal(internals.inputs(document).some((el2) => el2.getAttribute('type') === 'file'), false,
    'non-textual inputs must be excluded from field matching');
}

// 10. The plugins list itself must not be mistaken for an open create form.
{
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [
      el('input', { placeholder: 'Search plugins', 'aria-label': 'Search plugins' }),
      el('div', { text: 'coding-tools-mcp uses an mcp endpoint' }),
    ],
  });
  assert.equal(internals.createFormPresent(), false,
    'page text mentioning "mcp" must not count as an open create form');
}

// 11. ChatGPT gates Create behind a trust acknowledgement; without ticking it Create never enables.
{
  const box = el('input', { type: 'checkbox', id: 'trust-checkbox' });
  const dialog = el('div', { role: 'dialog' }, [
    el('input', { id: 'custom-connector-name', name: 'custom-connector-name', 'aria-label': 'Name' }),
    el('input', { id: 'custom-connector-url', name: 'custom-connector-url', placeholder: 'https://example.com/sse' }),
    el('div', {}, [
      el('span', { text: 'Custom MCP servers introduce risk. I understand and want to continue' }),
      box,
    ]),
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [dialog],
  });
  await internals.acknowledgeCustomServerTrust();
  assert.equal(box.clicks, 1, 'the trust acknowledgement must be ticked');
}

// 12. An already-ticked acknowledgement must not be toggled back off.
{
  const box = el('input', { type: 'checkbox', id: 'trust-checkbox', 'aria-checked': 'true' });
  const dialog = el('div', { role: 'dialog' }, [
    el('input', { id: 'custom-connector-url', name: 'custom-connector-url', placeholder: 'https://example.com/sse' }),
    el('div', {}, [el('span', { text: 'I understand and want to continue' }), box]),
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [dialog],
  });
  await internals.acknowledgeCustomServerTrust();
  assert.equal(box.clicks, 0, 'an already-acknowledged checkbox must be left alone');
}

// 13. Structural fallback: the search/create toolbar row, when the button carries no usable label.
{
  const rowClasses = 'flex w-full min-w-0 flex-nowrap items-center gap-3 md:ms-auto md:w-auto';
  const iconButton = el('button', { rect: { top: 40, left: 760, width: 36, height: 36 } });
  const { internals, body } = pluginsPage({
    url: 'https://chatgpt.com/plugins',
    children: [
      el('div', { class: rowClasses }, [
        el('input', { placeholder: 'Search plugins', 'aria-label': 'Search plugins' }),
        iconButton,
      ]),
    ],
  });
  revealCreateFormOnClick(iconButton, body);
  assert.equal(internals.createControl(), iconButton,
    'the toolbar row\'s single button must be used when the label is unrecognisable');
  assert.equal(await internals.openCreateFormStrict(), true);
  assert.equal(iconButton.clicks, 1);
}

// 14. A matching row holding several buttons stays ambiguous and must not be guessed at.
{
  const rowClasses = 'flex w-full min-w-0 flex-nowrap items-center gap-3 md:ms-auto md:w-auto';
  const a = el('button', { rect: { top: 40, left: 700, width: 36, height: 36 } });
  const b = el('button', { rect: { top: 40, left: 760, width: 36, height: 36 } });
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins',
    children: [el('div', { class: rowClasses }, [a, b])],
  });
  assert.equal(internals.createControl(), null);
  assert.equal(a.clicks + b.clicks, 0);
}

// 15. The search field paints before the create control. Arriving mid-render must not be treated
//     as "no create control exists" — this is what actually broke the live 10:07 run.
{
  const { internals, body } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [el('input', { placeholder: 'Search plugins', 'aria-label': 'Search plugins' })],
  });

  assert.equal(internals.createControl(), null, 'nothing to click while the toolbar is unrendered');

  let late = null;
  setTimeout(() => {
    late = createButton('Create app');
    revealCreateFormOnClick(late, body);
    body.append(late);
  }, 700);

  assert.equal(await internals.openCreateFormStrict(), true,
    'openCreateFormStrict must wait for the create control to render');
  assert.equal(late.clicks, 1);
}

// 16. The OAuth advanced panel labels each field with an element ABOVE the input, and ChatGPT
//     discovers endpoints from the MCP server — which may still advertise a dead tunnel host.
{
  const LIVE = 'https://long-category-pete-promotion.trycloudflare.com/mcp';
  const STALE = 'https://happy-experience-expected-pregnant.trycloudflare.com';
  const field = (label, value) => {
    const input = el('input', { value });
    return { input, node: el('div', {}, [el('div', { text: label }), input]) };
  };
  const authUrl = field('Auth URL', `${STALE}/oauth/authorize`);
  const tokenUrl = field('Token URL', `${STALE}/oauth/token`);
  const serverBase = field('Authorization server base', STALE);
  const resource = field('Resource', STALE);

  const dialog = el('div', { role: 'dialog' }, [
    el('input', { id: 'custom-connector-name', name: 'custom-connector-name', 'aria-label': 'Name' }),
    el('input', { id: 'custom-connector-url', name: 'custom-connector-url', placeholder: 'https://example.com/sse', value: LIVE }),
    authUrl.node, tokenUrl.node, serverBase.node, resource.node,
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [dialog],
  });

  const repaired = await internals.repairDiscoveredOauthEndpoints(LIVE, {
    oauthAuthorizeUrl: 'https://long-category-pete-promotion.trycloudflare.com/oauth/authorize',
    oauthTokenUrl: 'https://long-category-pete-promotion.trycloudflare.com/oauth/token',
  });

  // Spread into this realm: values built inside the vm sandbox have a different Array.prototype.
  assert.deepEqual([...repaired].sort(), ['authServerBase', 'authorizeUrl', 'resource', 'tokenUrl'].sort(),
    'every endpoint left on the dead tunnel must be replaced');
  assert.equal(authUrl.input.value, 'https://long-category-pete-promotion.trycloudflare.com/oauth/authorize');
  assert.equal(tokenUrl.input.value, 'https://long-category-pete-promotion.trycloudflare.com/oauth/token');
  assert.equal(serverBase.input.value, 'https://long-category-pete-promotion.trycloudflare.com');
  // resource is the protected-resource origin, not the /mcp transport path.
  assert.equal(resource.input.value, 'https://long-category-pete-promotion.trycloudflare.com');
}

// 17. Endpoints already pointing at the live tunnel must be left untouched.
{
  const LIVE = 'https://long-category-pete-promotion.trycloudflare.com/mcp';
  const input = el('input', { value: 'https://long-category-pete-promotion.trycloudflare.com/oauth/authorize' });
  const dialog = el('div', { role: 'dialog' }, [
    el('input', { id: 'custom-connector-url', name: 'custom-connector-url', placeholder: 'https://example.com/sse' }),
    el('div', {}, [el('div', { text: 'Auth URL' }), input]),
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [dialog],
  });
  const repaired = await internals.repairDiscoveredOauthEndpoints(LIVE, {
    oauthAuthorizeUrl: 'https://long-category-pete-promotion.trycloudflare.com/oauth/authorize',
    oauthTokenUrl: '',
  });
  assert.equal(repaired.includes('authorizeUrl'), false, 'a live endpoint must not be rewritten');
}

// 18. After creation the connector shows Sign in. It must be found within THIS app's card only —
//     every other connector on the page has a Connect control of its own.
{
  const ourSignIn = el('button', { text: 'Sign in', rect: { top: 210, left: 700, width: 90, height: 32 } });
  const otherSignIn = el('button', { text: 'Sign in', rect: { top: 310, left: 700, width: 90, height: 32 } });
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [
      el('div', { rect: { top: 300, left: 100, width: 700, height: 56 } }, [
        el('span', { text: 'some-other-app', rect: { top: 310, left: 110, width: 160, height: 20 } }),
        otherSignIn,
      ]),
      el('div', { rect: { top: 200, left: 100, width: 700, height: 56 } }, [
        el('span', { text: 'coding-tools-mcp', rect: { top: 210, left: 110, width: 200, height: 20 } }),
        ourSignIn,
      ]),
    ],
  });
  assert.equal(internals.signInControl('coding-tools-mcp'), ourSignIn,
    'must pick the Sign in belonging to coding-tools-mcp');
  assert.notEqual(internals.signInControl('coding-tools-mcp'), otherSignIn);
}

// 19. ChatGPT's Manage panel renders Connect as one row button reading "Connection Connect".
{
  const row = el('button', {}, [
    el('span', { text: 'Connection' }),
    el('div', { text: 'Connect' }),
  ]);
  const dialog = el('div', { role: 'dialog' }, [
    el('div', { text: 'coding-tools-mcp' }),
    row,
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins/plugin_asdk_app_abc',
    children: [dialog],
  });
  assert.equal(internals.connectControlIn(dialog), row,
    'the "Connection Connect" row button must be recognised');
}

// 20. A disabled or already-connected row must not be treated as a connect action.
{
  const connected = el('button', {}, [
    el('span', { text: 'Connection' }),
    el('div', { text: 'Connected' }),
  ]);
  const dialog = el('div', { role: 'dialog' }, [connected]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins/plugin_asdk_app_abc',
    children: [dialog],
  });
  assert.equal(internals.connectControlIn(dialog), null,
    '"Connection Connected" is a status, not an action');
}

// 21. The consent step reads "Sign in with <app>", so an exact "sign in" match misses it.
{
  const signIn = el('button', { text: 'Sign in with coding-tools-mcp' });
  const dialog = el('div', { role: 'dialog' }, [
    el('div', { text: 'Add coding-tools-mcp to ChatGPT' }),
    signIn,
    el('a', { text: 'Learn more' }),
    el('a', { text: 'Learn more on how to stay safe' }),
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins/plugin_asdk_app_abc',
    children: [dialog],
  });
  assert.equal(internals.consentSignInControl('coding-tools-mcp'), signIn,
    '"Sign in with <app>" must be recognised as the consent action');
}

// 22. The informational links in that dialog must never be mistaken for the action.
{
  const dialog = el('div', { role: 'dialog' }, [
    el('div', { text: 'Add coding-tools-mcp to ChatGPT' }),
    el('a', { text: 'Learn more' }),
    el('a', { text: 'Learn more on how to stay safe' }),
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins/plugin_asdk_app_abc',
    children: [dialog],
  });
  assert.equal(internals.consentSignInControl('coding-tools-mcp'), null,
    'a dialog with only Learn more links has no consent action');
}

// 23. Delete and Uninstall are different actions: an owned app survives Uninstall, so the remove
//     matcher must resolve Delete and never settle for Uninstall.
{
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [
      el('div', { role: 'menu' }, [
        el('div', { role: 'menuitem', text: 'View plugin detail' }),
        el('div', { role: 'menuitem', text: 'Edit name' }),
        el('div', { role: 'menuitem', text: 'Uninstall' }),
        el('div', { role: 'menuitem', text: 'Delete' }),
      ]),
    ],
  });
  const picked = internals.findClickablePreferExact(['delete', '刪除', '删除']);
  assert.equal((picked.innerText || '').toLowerCase(), 'delete',
    'Delete must be selected, not Uninstall');
}

// 24. The card's menu button is unlabelled until hovered — it is the card's only textless button.
{
  const iconBtn = el('button', { rect: { top: 200, left: 760, width: 32, height: 32 } });
  const card = el('div', { rect: { top: 190, left: 100, width: 700, height: 56 } }, [
    el('a', { text: 'Open coding-tools-mcp', 'aria-label': 'Open coding-tools-mcp', href: '/plugins/x' }),
    el('span', { text: 'coding-tools-mcp' }),
    iconBtn,
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [card],
  });
  assert.equal(internals.menuButtonForAppCard(card), iconBtn,
    'an unlabelled icon-only button must still be found as the card menu');
}

// 24b. Current ChatGPT layout: the app link is nested in a left column while the actions button
//      is its sibling. Card detection must climb past the link-only column to reach that button.
{
  const URL_NOW = 'https://live.trycloudflare.com/mcp';
  const iconBtn = el('button', { rect: { top: 200, left: 760, width: 32, height: 32 } });
  const linkColumn = el('div', {}, [
    el('a', { href: '/plugins/plugin_asdk_app_nested?view=personal', text: 'Open coding-tools-mcp' }),
    el('span', { text: 'coding-tools-mcp' }),
    el('div', { text: URL_NOW }),
  ]);
  const card = el('article', { rect: { top: 190, left: 100, width: 700, height: 80 } }, [
    linkColumn,
    iconBtn,
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [card],
  });

  const result = await internals.prepareSync({
    jobId: 'job-nested-card-menu',
    appName: 'coding-tools-mcp',
    endpoint: URL_NOW,
    authType: 'none',
    replaceExisting: true,
  });

  assert.equal(result.stage, 'remove');
  assert.match(result.message, /remove_not_available/,
    'nested-card actions must be reached instead of failing with app_menu_not_found');
}

// 25. The toolbar (search + create) paints before the plugin cards. Treating it as "ready" made the
//     existing-app check run against an empty list and create a duplicate.
{
  const rowClasses = 'flex w-full min-w-0 flex-nowrap items-center gap-3 md:ms-auto md:w-auto';
  const { internals, body } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [
      el('div', { class: rowClasses }, [
        el('input', { placeholder: 'Search plugins', 'aria-label': 'Search plugins' }),
        el('button', { 'aria-label': 'Create app' }),
      ]),
    ],
  });

  // Toolbar alone: a create control exists, but the app must NOT yet be declared absent.
  assert.ok(internals.createControl(), 'the toolbar create control is present');
  assert.equal(internals.findExactAppNode('coding-tools-mcp'), null);

  let appeared = false;
  setTimeout(() => {
    appeared = true;
    body.append(el('div', {}, [
      el('a', { href: '/plugins/plugin_asdk_app_x?view=personal', text: 'Open coding-tools-mcp' }),
      el('span', { text: 'coding-tools-mcp' }),
    ]));
  }, 900);

  const ready = await internals.waitForPluginsPageReady('coding-tools-mcp');
  assert.equal(ready, 'app');
  assert.equal(appeared, true, 'readiness must wait for the card, not settle for the toolbar');
  assert.ok(internals.findExactAppNode('coding-tools-mcp'), 'the existing app is now detectable');
}

// 26a. THE bug: ChatGPT's sidebar carries data-state="open". Treating that as a dialog made
//      activeSurface() the sidebar, so the app card — which lives outside it — was never found,
//      and sync concluded no app existed and created another.
{
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [
      el('div', { 'data-state': 'open' }, [el('span', { text: 'Chat history New chat Library' })]),
      el('div', {}, [
        el('a', { href: '/plugins/plugin_asdk_app_x?view=personal', text: 'Open coding-tools-mcp' }),
        el('span', { text: 'coding-tools-mcp' }),
      ]),
    ],
  });
  assert.ok(internals.findExactAppNode('coding-tools-mcp'),
    'an open sidebar must not hide the app card from detection');
}

// 26b. A real dialog still scopes correctly, and the app is still found when only it is open.
{
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [
      el('div', { role: 'dialog' }, [el('span', { text: 'Some unrelated dialog' })]),
      el('span', { text: 'coding-tools-mcp' }),
    ],
  });
  assert.ok(internals.findExactAppNode('coding-tools-mcp'),
    'detection must fall back to the page when the app is not inside the open dialog');
}

// 26. A list that never renders must report 'unknown', never "the app is absent".
{
  const rowClasses = 'flex w-full min-w-0 flex-nowrap items-center gap-3 md:ms-auto md:w-auto';
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [
      el('div', { class: rowClasses }, [
        el('input', { placeholder: 'Search plugins', 'aria-label': 'Search plugins' }),
        el('button', { 'aria-label': 'Create app' }),
      ]),
    ],
  });
  assert.equal(await internals.waitForPluginsPageReady('coding-tools-mcp'), 'unknown',
    'a toolbar-only page must not be reported as a rendered, empty list');
}

// 27. A rendered list without our app reports 'cards' — that IS evidence of absence.
{
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [
      el('a', { href: '/plugins/plugin_asdk_app_other?view=personal', text: 'Open some-other-app' }),
    ],
  });
  assert.equal(await internals.waitForPluginsPageReady('coding-tools-mcp'), 'cards');
}

// 28. The page predicate must accept the URLs ChatGPT actually serves. Extra query parameters are
//     ChatGPT's own; demanding that "view" be the only one rejected the real personal list.
{
  const cases = [
    ['https://chatgpt.com/plugins?view=personal', true],
    ['https://chatgpt.com/plugins', true],
    ['https://chatgpt.com/plugins/', true],
    ['https://chatgpt.com/plugins?view=personal&ref=sidebar', true],
    ['https://chatgpt.com/plugins?utm_source=x', true],
    ['https://chat.openai.com/plugins?view=personal', true],
    ['https://chatgpt.com/plugins?view=store', false],
    ['https://chatgpt.com/plugins/plugin_asdk_app_x', false],
    ['https://evil.example.com/plugins', false],
  ];
  const { internals } = pluginsPage({ children: [] });
  for (const [url, expected] of cases) {
    assert.equal(internals.isPersonalPluginsUrl(url), expected, `isPersonalPluginsUrl(${url})`);
  }
}

// 29. Route rename: a fully rendered plugins list must not be reported as wrong_page just because
//     its path changed. A page serving real plugin cards is the list.
{
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/settings/connectors',
    children: [
      el('a', { href: '/plugins/plugin_asdk_app_x?view=personal', text: 'Open coding-tools-mcp' }),
      el('span', { text: 'coding-tools-mcp' }),
    ],
  });
  assert.equal(internals.isPersonalPluginsPage(), true,
    'a rendered plugin list must be accepted even on an unexpected path');
}

// 30. That fallback must not swallow an app DETAIL page, which carries plugin links of its own.
{
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins/plugin_asdk_app_x',
    children: [el('a', { href: '/plugins/plugin_asdk_app_x', text: 'coding-tools-mcp' })],
  });
  assert.equal(internals.isPersonalPluginsPage(), false, 'a detail page is not the list page');
}

// 31. A rendered card must be recognised whatever shape ChatGPT's plugin ids take. Requiring the
//     literal word "plugin" in the id made a populated list read as "nothing rendered".
{
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [
      el('a', { href: '/plugins/g-6f9a2b41', text: 'Open coding-tools-mcp' }),
      el('a', { href: '/plugins/discover', text: 'Discover' }),
    ],
  });
  const hrefs = internals.pluginCardLinks().map((link) => link.getAttribute('href'));
  assert.deepEqual([...hrefs], ['/plugins/g-6f9a2b41'],
    'any /plugins/<id> link is a card; the list\'s own nav routes are not');
}

// 32. Every sync is a clean replacement: even a matching MCP URL must enter the delete path.
{
  const URL_NOW = 'https://long-category-pete-promotion.trycloudflare.com/mcp';
  const menu = el('button', { rect: { top: 200, left: 760, width: 32, height: 32 } });
  const card = el('div', { rect: { top: 190, left: 100, width: 700, height: 80 } }, [
    el('a', { href: '/plugins/plugin_asdk_app_x?view=personal', text: 'Open coding-tools-mcp' }),
    el('span', { text: 'coding-tools-mcp' }),
    el('div', { text: URL_NOW }),
    menu,
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [card],
  });

  const result = await internals.prepareSync({
    jobId: 'job-same-url',
    appName: 'coding-tools-mcp',
    endpoint: URL_NOW,
    authType: 'none',
    replaceExisting: true,
  });

  assert.equal(result.stage, 'remove', 'a matching MCP must still enter the delete path');
  assert.equal(result.existingEndpoint, URL_NOW);
}

// 32b. OAuth readiness must not bypass the required delete-first replacement.
{
  const URL_NOW = 'https://live.trycloudflare.com/mcp';
  const connect = el('button', {}, [
    el('span', { text: 'Connection' }),
    el('div', { text: 'Connect' }),
  ]);
  const card = el('div', { rect: { top: 190, left: 100, width: 700, height: 80 } }, [
    el('a', { href: '/plugins/plugin_asdk_app_oauth?view=personal', text: 'Open coding-tools-mcp' }),
    el('span', { text: 'coding-tools-mcp' }),
    el('div', { text: URL_NOW }),
    connect,
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [card],
  });

  const result = await internals.prepareSync({
    jobId: 'job-oauth-replace',
    appName: 'coding-tools-mcp',
    endpoint: URL_NOW,
    authType: 'oauth',
    replaceExisting: true,
  });

  assert.equal(result.stage, 'remove', 'OAuth MCP must be deleted before recreation');
  assert.equal(connect.clicks, 0, 'the old MCP must not be reconnected in place');
}

// 34. A genuinely different URL must still take the replace path, not be reported as up to date.
{
  const card = el('div', { rect: { top: 190, left: 100, width: 700, height: 80 } }, [
    el('a', { href: '/plugins/plugin_asdk_app_x?view=personal', text: 'Open coding-tools-mcp' }),
    el('span', { text: 'coding-tools-mcp' }),
    el('div', { text: 'https://stale-tunnel.trycloudflare.com/mcp' }),
  ]);
  const { internals } = pluginsPage({
    url: 'https://chatgpt.com/plugins?view=personal',
    children: [card],
  });

  const result = await internals.prepareSync({
    jobId: 'job-different-url',
    appName: 'coding-tools-mcp',
    endpoint: 'https://fresh-tunnel.trycloudflare.com/mcp',
    authType: 'none',
    replaceExisting: true,
  });

  assert.notEqual(result.stage, 'up_to_date', 'a mismatched URL must not be treated as current');
  assert.equal(result.stage, 'remove', 'a mismatched app goes down the replace path');
}

console.log('personal-page.test.mjs: page detection + create-control + create-form + trust-gate + late-render + oauth-endpoint-repair + connect-flow + consent + delete-first replacement + list-readiness + url-detection checks passed');
