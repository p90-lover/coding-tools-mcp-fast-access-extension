# Changelog

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
