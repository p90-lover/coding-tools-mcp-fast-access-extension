// Minimal dependency-free DOM stub good enough to run content.js in node:vm.
// It intentionally mirrors the browser behaviour that matters here: innerText and
// textContent both resolve to the same visible label, elements report layout boxes,
// and querySelectorAll understands the simple selector lists content.js uses.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const TEXT_NODE = 3;
const mutationObservers = new Set();

function notifyMutationObservers(target) {
  for (const observer of [...mutationObservers]) {
    if (!observer.active) continue;
    queueMicrotask(() => observer.callback([{ type: 'childList', target }], observer));
  }
}

class TextNode {
  constructor(value) {
    this.nodeType = TEXT_NODE;
    this.nodeValue = String(value);
    this.parentElement = null;
  }
}

function parseSelectorPart(part) {
  const trimmed = part.trim();
  const match = trimmed.match(/^([a-zA-Z][\w-]*)?(?:\[([\w-]+)(?:([*^]?=)(?:"([^"]*)"|'([^']*)'))?\])?$/);
  if (!match) throw new Error(`dom-stub: unsupported selector "${trimmed}"`);
  return { tag: match[1] || '', attr: match[2] || '', operator: match[3] || '', value: match[4] ?? match[5] ?? null };
}

function parseSelector(selector) {
  return String(selector).split(',').map(parseSelectorPart);
}

class StubElement {
  constructor(tag, props = {}, children = []) {
    const { text, rect, cursor, hidden, disabled, ...attrs } = props;
    this.tagName = String(tag).toUpperCase();
    this.attributes = new Map(Object.entries(attrs).map(([key, value]) => [key, String(value)]));
    this.childNodes = [];
    this.parentElement = null;
    this.disabled = Boolean(disabled);
    this.cursor = cursor || 'default';
    this.hidden = Boolean(hidden);
    this.rect = hidden
      ? { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }
      : { top: 0, left: 0, width: 120, height: 32, ...(rect || {}) };
    this.rect.right = this.rect.left + this.rect.width;
    this.rect.bottom = this.rect.top + this.rect.height;
    this.clicks = 0;
    this.events = [];
    if (text !== undefined) this.append(new TextNode(text));
    for (const child of children) this.append(child);
  }

  append(node) {
    node.parentElement = this;
    this.childNodes.push(node);
    notifyMutationObservers(this);
    return this;
  }

  get id() { return this.attributes.get('id') || ''; }
  get name() { return this.attributes.get('name') || ''; }
  get type() { return this.attributes.get('type') || ''; }
  set type(value) { this.attributes.set('type', String(value)); }
  get href() { return this.attributes.get('href') || ''; }
  get placeholder() { return this.attributes.get('placeholder') || ''; }
  get tabIndex() {
    const raw = this.attributes.get('tabindex');
    return raw === undefined ? -1 : Number(raw);
  }

  get className() { return this.attributes.get('class') || ''; }

  get classList() {
    const items = this.className.split(/\s+/).filter(Boolean);
    return { contains: (value) => items.includes(value), length: items.length };
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    notifyMutationObservers(this);
  }

  get textContent() {
    return this.childNodes
      .map((node) => (node.nodeType === TEXT_NODE ? node.nodeValue : node.textContent))
      .join('');
  }

  // innerText is the *rendered* text: browsers insert whitespace between block-level children, so
  // <button><span>Connection</span><div>Connect</div></button> reads "Connection Connect", not
  // "ConnectionConnect". textContent stays raw. For a single text child the two are identical —
  // which is exactly the condition that used to break exact label matching.
  get innerText() {
    return this.childNodes
      .map((node) => (node.nodeType === TEXT_NODE ? node.nodeValue : node.innerText))
      .filter((part) => String(part).length)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  get children() { return this.childNodes.filter((node) => node.nodeType !== TEXT_NODE); }

  get previousElementSibling() {
    const siblings = this.parentElement?.children || [];
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }

  get nextElementSibling() {
    const siblings = this.parentElement?.children || [];
    const index = siblings.indexOf(this);
    return index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  }

  descendants() {
    const out = [];
    for (const child of this.children) {
      out.push(child, ...child.descendants());
    }
    return out;
  }

  matchesPart(part) {
    if (part.tag && part.tag.toUpperCase() !== this.tagName) return false;
    if (!part.attr) return Boolean(part.tag);
    if (part.attr === 'href' && !this.attributes.has('href')) return false;
    if (!this.attributes.has(part.attr)) return false;
    if (part.value === null) return true;
    const value = this.attributes.get(part.attr);
    if (part.operator === '^=') return value.startsWith(part.value);
    if (part.operator === '*=') return value.includes(part.value);
    return value === part.value;
  }

  matches(selector) {
    return parseSelector(selector).some((part) => this.matchesPart(part));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  querySelectorAll(selector) {
    const parts = parseSelector(selector);
    return this.descendants().filter((el) => parts.some((part) => el.matchesPart(part)));
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  getBoundingClientRect() { return { ...this.rect }; }
  getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
  get offsetWidth() { return this.rect.width; }
  get offsetHeight() { return this.rect.height; }

  click() { this.clicks += 1; this.onClick?.(this); }
  dispatchEvent(event) { this.events.push(event?.type || String(event)); return true; }
  focus() {}
  scrollIntoView() {}
}

class StubInput extends StubElement {
  constructor(tag, props = {}, children = []) {
    const { value, ...rest } = props;
    super(tag, rest, children);
    this._value = value === undefined ? '' : String(value);
  }
}
Object.defineProperty(StubInput.prototype, 'value', {
  configurable: true,
  get() { return this._value; },
  set(next) { this._value = String(next); },
});

class StubTextArea extends StubInput {}

export function el(tag, props = {}, children = []) {
  const lower = String(tag).toLowerCase();
  if (lower === 'input') return new StubInput('input', props, children);
  if (lower === 'textarea') return new StubTextArea('textarea', props, children);
  return new StubElement(tag, props, children);
}

export function text(value) { return new TextNode(value); }

function makeDocument(body) {
  const documentElement = new StubElement('html', {}, [body]);
  const doc = {
    body,
    documentElement,
    scripts: [],
    listeners: new Map(),
    querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
    querySelector: (selector) => documentElement.querySelector(selector),
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); },
    dispatchEvent(event) {
      for (const fn of this.listeners.get(event?.type) || []) fn(event);
      return true;
    },
    createTreeWalker(walkRoot) {
      const collect = (node) => {
        const out = [];
        for (const child of node.childNodes || []) {
          if (child.nodeType === TEXT_NODE) out.push(child);
          else out.push(...collect(child));
        }
        return out;
      };
      const nodes = collect(walkRoot || body);
      let index = -1;
      return { nextNode: () => (++index < nodes.length ? nodes[index] : null) };
    },
  };
  return doc;
}

/**
 * Runs content.js against a stub DOM and returns its internal helpers.
 * @param {{ url?: string, body?: StubElement }} options
 */
export function loadContentScript({ url = 'https://chatgpt.com/plugins?view=personal', body } = {}) {
  const pageBody = body || el('body');
  const document = makeDocument(pageBody);
  const messageListeners = [];
  const sandbox = {
    document,
    location: new URL(url),
    URL, // vm contexts do not inherit node's URL global
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Node: { TEXT_NODE },
    NodeFilter: { SHOW_TEXT: 4 },
    CSS: { escape: (value) => String(value) },
    HTMLInputElement: StubInput,
    HTMLTextAreaElement: StubTextArea,
    getComputedStyle: (element) => ({ cursor: element?.cursor || 'default' }),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.active = false; }
      observe() { this.active = true; mutationObservers.add(this); }
      disconnect() { this.active = false; mutationObservers.delete(this); }
    },
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    MouseEvent: class { constructor(type) { this.type = type; } },
    PointerEvent: class { constructor(type) { this.type = type; } },
    chrome: {
      runtime: {
        onMessage: { addListener: (fn) => messageListeners.push(fn) },
        sendMessage: async () => ({ ok: true }),
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'content.js'), 'utf8'), sandbox, { filename: 'content.js' });

  const internals = sandbox.__codingToolsMcpInternals;
  if (!internals) throw new Error('content.js did not expose __codingToolsMcpInternals for tests.');
  return { internals, document, body: pageBody, sandbox, messageListeners };
}
