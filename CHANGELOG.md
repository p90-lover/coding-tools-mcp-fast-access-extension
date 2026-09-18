# Changelog

## v0.0.10 - 2026-09-18

- Add an on-page ChatGPT HUD that matches the popup chrome and wires Watch, Long task, Do not spam, continue message, and Re-arm as real controls.
- Apply/Watch uses the page URL first, then a Chat ID fallback, and normalizes `www.chatgpt.com` / `/c/{id}/branch` SPA routes so a visible Chat ID no longer fails the worker.
- Default continue prompt is `@coding-tools-mcp keep going`; a bare `keep going` is normalized to that tagged form.
- Thinking failed sends `send_continue` instead of clicking the Thinking-failed retry icon.
- MCP disabled/FORBIDDEN sends `send_branch` and arms Watch on the new `/c/{id}`; keep-going is never sent on the disabled source chat.
- Model line ignores Recents/MIME and treats Extra High as effort-only; network model wins over a stale mini label.
- `snapshot()` copies `mcpDisabled` (and related booleans) instead of dropping them.
- Autosave Watch / Long task / Do not spam / continue message without Apply. Do not spam defaults on; Long task defaults off. Turning Watch OFF does not auto-rearm. Repeat keep-going is held unless Long task is on.
- Capture/sync tries Desktop 0.7 AppData paths (`Roaming\coding-tools-mcp-desktop` and `Local\Coding Tools MCP\data`), not `profiles.json` beside the EXE.
- HTTP log in the HUD is collapsed by default. Popup and HUD prefs stay in sync.

## v0.0.3 - 2026-09-10

- After a successful delete, always return to the personal plugins page and create the replacement.
- Clear leftover Manage dialogs and the plugins search field so stale name text cannot block recreate.
- Block create only when a real grid card remains, not leftover sidebar/search/toast text.

## v0.0.2 - 2026-09-09

- Reuse an already-open ChatGPT personal plugins tab instead of opening extra tabs on slow list renders.
- Delete only through the exact `coding-tools-mcp` grid card: ⋯ → Manage → ⋯ → Delete.
- Block create while that card is still present, so Sync cannot skip delete and spawn a duplicate.
- Reject wrong ⋯ targets such as conversation, project, and Pets menus; Escape and stop if Manage is missing.
- Tighten plugin-grid detection so the right-aligned search field no longer hides cards to its left.

## v0.0.1 - 2026-09-08

- Rebased the supplied Chrome extension into the `coding-tools-mcp-extension` release line.
- Hardened ChatGPT manager-page classification against sidebar/navigation and conversation-link false positives.
- Added renamed manager-route tolerance with DOM evidence before accepting the page.
- Switched generic page waits to DOM-mutation wakeups with bounded polling fallbacks.
- Added explicit rendered-empty Personal Plugins detection.
- Reduced ambiguous Create-control failure timeout from 12s to 3s.
- Reduced unrendered-list fail-closed timeout from 8s to 5s.
- Aligned service-worker routing with content-script page classification.
- Added regression coverage for page classification and latency-sensitive waits.
