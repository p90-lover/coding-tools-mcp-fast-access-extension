# coding-tools-mcp-extension v0.0.1

Chrome Manifest V3 helper for syncing the current Coding Tools MCP workspace into a ChatGPT custom MCP app named `coding-tools-mcp`.

> Repository/release identity: `coding-tools-mcp-extension` v0.0.1. Load the `coding-tools-mcp-extension-v0.0.1` folder directly as an unpacked Chrome extension.

## What changed in v0.0.1

### Page detection + action latency hardening

- Rejects sidebar/navigation and conversation-posted `/plugins/<id>` links as page identity evidence.
- Accepts renamed ChatGPT manager routes only after strong DOM evidence (manager toolbar or rendered app-card structure).
- Uses DOM-mutation wakeups with timer fallbacks, so successful actions react as soon as ChatGPT renders the relevant control instead of waiting for the next polling tick.
- Recognizes explicit empty Personal Plugins states immediately instead of waiting through a long "unknown list" cycle.
- Reduces ambiguous/missing Create-control failure time from 12 seconds to 3 seconds, while still clicking nothing when the control is unsafe to identify.
- Reduces unrendered-list fail-closed timeout from 8 seconds to 5 seconds before retry.
- Keeps service-worker route handling consistent with the content-script classifier so renamed manager routes are not discarded prematurely.

The focused DOM regression test measures a card rendered 40 ms after page load being detected in roughly 40–50 ms instead of the previous ~300 ms polling step. This is a deterministic test-harness measurement, not a claim about network latency on live ChatGPT.


### Every sync creates a clean replacement

Sync detects every exact-name `coding-tools-mcp` app, deletes it through its owned-app Manage flow,
verifies that no same-name app remains, and only then creates a new app with the current MCP endpoint.
This also applies when the endpoint is unchanged and when the existing app could be reauthorized.

### The plugins page is now recognised

`content.js` and `background.js` each carried their own copy of "is this the personal plugins
page", and they disagreed:

| | `content.js` | `background.js` (old) |
|---|---|---|
| `chat.openai.com` | accepted | **rejected** |
| `?view=personal&ref=…` | accepted | **rejected** — `view` had to be the *only* parameter |

ChatGPT adds query parameters of its own. When it did, the content script accepted the page while
the worker read the very same URL as a failed navigation — so `openPersonalPluginsTab()` abandoned
the correct tab and opened a fresh one on every pass, discarding the one-shot post-creation connect
prompt with it. Both now apply the same rule, and `tests/workflow.test.mjs` executes the worker's
predicate against a shared URL table so they cannot silently drift apart again.

Two further detection faults:

- **Cards were only counted when the plugin id contained the word "plugin".**
  `pluginCardLinks()` tested `/plugins/[a-z_]*plugin`, which matches `/plugins/plugin_asdk_app_x`
  but not other id shapes. A fully populated list then read as "nothing rendered", the job spent its
  retries, and an existing app could be treated as absent — the duplicate-creation path. Any
  `/plugins/<id>` link now counts, with the list's own routes (`discover`, `store`, …) excluded.
- **A renamed route reported `wrong_page` for a list rendered in front of us.** Detection was
  URL-only. The URL is still the primary signal, but a ChatGPT page actually serving plugin cards is
  now accepted as the list. App *detail* pages are excluded — they carry plugin links of their own.

Also fixed: `freshTabRequired` was set on failure and never cleared, so once a retry escalated to a
clean tab, every later attempt and every watchdog tick opened yet another ChatGPT tab. It is now
cleared once consumed.

## What changed in v0.3.4

Three defects stopped the sync before it ever reached Create:

- **Empty personal list.** ChatGPT redirects `/plugins?view=personal` to a bare `/plugins` when you
  have no personal plugins yet. `isPersonalPluginsPage()` demanded `view=personal`, so the redirect
  was reported as `wrong_page` and the job stopped. Both spellings are now accepted, on
  `chatgpt.com`, its subdomains, and `chat.openai.com`.
- **Exact label matching never matched anything.** `elementText()` joined `innerText` *and*
  `textContent`, so a plain `<button>Create</button>` read as `"create create"` and compared unequal
  to `"create"`. Every exact-match path was dead, including the one that opens the create form —
  which is why no app was ever created. Label sources are now compared separately.
- **No create control on an empty page.** The `+` fallback required a "Search plugins" field, which
  does not exist when the list is empty. Detection now also accepts `Create` / `Create app` /
  `New app` / `Add connector`-style labels, and, on the personal page, a single unambiguous bare `+`.
  Two or more candidate `+` controls are still refused rather than guessed, and the `+` inside an
  existing app row is still never clicked.

Verified against the live ChatGPT create dialog on 2026-08-16, which exposed three further blockers:

- **The endpoint field was never found.** ChatGPT renders it as
  `<input id="custom-connector-url" name="custom-connector-url" placeholder="https://example.com/sse">`
  with no `<label>` and no `aria-label`. None of the old `inputKeys('url')` terms matched it, and
  `findInput('url')` instead resolved the dialog's `input[type=file]` — so `setInputValue` wrote the
  MCP URL nowhere. Field matching now ignores non-textual inputs and falls back to matching an
  `id`/`name` containing `url` or an `https://` placeholder.
- **Create is gated behind a trust checkbox.** `input#trust-checkbox` ("Custom MCP servers introduce
  risk… I understand and want to continue") must be ticked or the submit button stays permanently
  disabled. Measured directly: `create.disabled` stayed `true` with the form fully filled, and
  flipped to `false` only after ticking. Sync now ticks it — it is acknowledging the endpoint you
  explicitly chose to publish.
- **Auth selection could click the wrong control.** `chooseAuth('oauth')` matched the *disabled*
  "Advanced OAuth settings" button by substring before ever reaching
  `<select id="custom-connector-auth">`. The select is now tried first, and clickable fallbacks must
  match a label exactly and be enabled.

This build has no "Scan Tools" step at all — the dialog goes straight to Create — which is why the
scan step is now non-fatal.

A later live run surfaced two more, both in the OAuth advanced panel:

- **The client ID was never filled.** "Advanced OAuth settings" stays *disabled* until ChatGPT has
  fetched the MCP URL and discovered the server's OAuth configuration. The old code clicked it
  immediately after typing the URL, so the click did nothing, the panel never opened, and the field
  never existed to fill — leaving ChatGPT's "Enter a client ID to use a user-defined OAuth client"
  error. Sync now waits for the control to become enabled, selects the **User-Defined OAuth Client**
  registration method, then fills the ID and optional secret.
- **Discovered OAuth endpoints can point at a dead tunnel.** ChatGPT reads Auth URL, Token URL,
  Authorization server base and Resource from the MCP server itself. If the server still advertises
  a previous Quick Tunnel hostname, all four point somewhere unreachable and authorization can never
  complete. Sync now replaces any of those whose origin is not the current `/mcp` origin.

> The endpoint rewrite treats the symptom. The underlying problem is that Coding Tools MCP keeps
> serving a stale hostname in `/.well-known/oauth-authorization-server` after the Quick Tunnel
> rotates. Fixing it at the server means every future tunnel works without the rewrite.

The OAuth panel's fields are named by an element rendered *above* the input rather than a
`<label for>`, so `findInput` gained a lower-priority pass over preceding-sibling text. It runs only
after the strict match fails, so it cannot loosen existing matching.

**Authorization happens after creation, and the job used to die before it.** ChatGPT only offers a
Sign in control once the connector exists. `startFinalizer` reported `stage: created`, and
`handleChatGptResult` responded by calling `clearActiveJob()` — so by the time the OAuth page opened
there was no active job, `handleOauthReady` answered `no_active_oauth_job`, `oauth-content.js` was
never injected, and the captured authorization password was never submitted. Now:

- the finalizer clicks Sign in for the newly created app and reports `awaitingOauth`
- `handleChatGptResult` keeps the job alive on `awaitingOauth` instead of clearing it
- the job completes once the browser returns to `chatgpt.com` after `oauth_submitted`
- `JOB_TIMEOUT_MS` is 8 minutes, since a job now spans a full OAuth round trip

Sign in is searched **only inside this app's own card**. Once the create dialog closes the whole
plugins page is the active surface, and every other connector there has a Connect control — a
page-wide search would authorize somebody else's app.

**The connect prompt shown right after creation is one-shot.** It does not return on reload, so
relying on catching it is fragile. The durable route, confirmed on the live connector page, is:

```text
Plugin actions (⋯) → Manage → Connection → Connect
```

`openConnectFlow()` tries the immediate prompt first and falls back to that menu path. Two details
make it work:

- The menu is a Radix popover that opens on `pointerdown`; a bare `.click()` does nothing, so the
  existing `pointerActivate()` pointer-event sequence is used.
- Connect is a single row button whose rendered text is `"Connection Connect"` — a "Connection"
  label beside a "Connect" value, with no inner button and no `aria-label`. Matching the row's whole
  text is the only way to reach it. `"Connection Connected"` is a status and is deliberately
  not matched.

Also in this release:

- A failed prepare caused by page state (`wrong_page`) retries up to 3 times through the watchdog
  instead of ending the job as `review`.
- Sync waits for the plugins list to actually render before concluding the app is missing, so a slow
  page no longer causes a duplicate app.
- A ChatGPT build with no separate **Scan Tools** step no longer fails; the finalizer presses
  **Create** once it becomes enabled.
- `tests/personal-page.test.mjs` runs `content.js` against a stub DOM and covers all of the above.

## What changed in v0.3.3

- Cloudflare Quick Tunnel access is declared as `https://*.trycloudflare.com/*`, so a new random `*.trycloudflare.com` hostname does not need a new permission each time.
- While a Sync/OAuth job is active, the extension creates a `chrome.offscreen` document with a small worker heartbeat. The offscreen page sends a runtime message every 20 seconds so Chrome keeps the Manifest V3 service worker awake through navigation/OAuth transitions. It closes automatically when the job finishes or times out.
- `Sync + OAuth` now creates a durable job and returns immediately before ChatGPT is activated, so closing the popup cannot kill the workflow.
- The ChatGPT helper is injected on demand if the static content script is missing or the ChatGPT tab was already open before the extension was reloaded.
- OAuth on `*.trycloudflare.com` is handled by a dedicated page helper. It requests the authorization password from the service worker only for the currently active matching OAuth job, fills it, and submits the normal Coding Tools MCP authorization form.
- OAuth Client Secret and authorization password remain in session-only job state while a sync is active; they are not written into persistent Chrome local storage by the extension.
- The popup shows permission diagnostics for local files, ChatGPT, and the trycloudflare wildcard.

## Important Chrome behavior

Manifest V3 service workers are normally non-persistent. The extension uses `chrome.offscreen` only during an active Sync/OAuth job to keep the coordinator awake; when no sync is running, Chrome may correctly show the service worker as inactive. Job state still lives in `chrome.storage.session`, and alarms/page events remain a fallback.

## Install

1. Extract the ZIP.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `coding-tools-mcp-extension-v0.0.1` folder.
5. Open **Details** for the extension and enable **Allow access to file URLs**. Chrome requires this user-controlled toggle; an extension cannot enable it for itself.
6. Confirm site access includes ChatGPT and `https://*.trycloudflare.com/*`.

The default executable path is:

```text
C:\Users\simon\AppData\Local\Coding Tools MCP\coding-tools-mcp-desktop.exe
```

The extension derives the Coding Tools MCP data file as:

```text
C:\Users\simon\AppData\Roaming\coding-tools-mcp-desktop\data\profiles.json
```

You can replace the executable path from the popup dropdown/input or set an advanced `profiles.json` override.

## Sync flow

```text
profiles.json
   ↓
last/current workspace
   ↓
public /mcp URL + OAuth Client ID + Client Secret + authorization password
   ↓
START_SYNC_JOB
   ↓
store active job in chrome.storage.session
   ↓
start offscreen WORKERS heartbeat (20s)
   ↓
open https://chatgpt.com/plugins?view=personal
   ↓
Settings → Apps → Create
   ↓
remove old exact-name coding-tools-mcp draft when available
   ↓
fill endpoint + OAuth fields
   ↓
Scan Tools
   ↓
ChatGPT opens https://<current-host>/oauth/authorize?...PKCE...
   ↓
*.trycloudflare.com OAuth helper wakes service worker
   ↓
retrieve current job authorization password → submit OAuth form
   ↓
ChatGPT scan finishes
   ↓
page-side finalizer clicks enabled Create
   ↓
job marked done and session secrets cleared
```

## Why the old Sync button could fail

v0.2.0 performed most of the workflow inside one long request originating from the popup. Activating the ChatGPT tab closes the popup, while a Manifest V3 service worker can also be suspended when idle. The old code additionally polled for the OAuth tab for up to 45 seconds. v0.3.3 removes that long polling model.

The old build also requested the exact random Quick Tunnel origin at runtime. The v0.3.3 manifest instead grants the stable wildcard `https://*.trycloudflare.com/*`.

## If Sync still stops

Reopen the extension popup. The last stage is persisted without OAuth secrets. Common stages include `preparing_retry`, `wrong_page`, `existing_url_not_detected`, `remove`, `open_create`, `awaiting_create`, `oauth_permission_missing`, `waiting_oauth`, and `done`. Sync starts at `https://chatgpt.com/plugins?view=personal` and follows ChatGPT's redirect to `/plugins` when the personal list is empty; if endpoint detection cannot be done safely, it stops rather than clicking unrelated controls.


## v0.3.3 deterministic personal-plugin sync

Sync now navigates to `https://chatgpt.com/plugins?view=personal` first. It treats `coding-tools-mcp`, `coding tools mcp`, underscore variants, and capitalization variants as the same app identity. It opens the exact app name/card (never its row `+`), reads its current `/mcp` endpoint, and compares it with the locally captured endpoint. If they match, it stops without changing the app. If they differ, it removes only that exact app and opens the exact Create/New App flow. Generic last-button fallbacks are removed. For creation, the only bare `+` accepted is the one geometrically attached to the Search plugins field; the `+` inside the existing app row is explicitly excluded.


## v0.3.3 inspection hardening

- Uses exact text-node matching for `coding-tools-mcp` / `coding tools mcp`.
- Never uses Playwright-only selectors such as `:has-text()` in the browser DOM.
- Adds a MAIN-world bridge that can read the exact app's React-owned data for a hidden `/mcp` endpoint before clicking anything.
- App-detail activation is restricted to the exact app name/row and excludes all `+` controls.
- Duplicate offscreen/service-worker retries stay in the compare phase instead of advancing early to OAuth.
