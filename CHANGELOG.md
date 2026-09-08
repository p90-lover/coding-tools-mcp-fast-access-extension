# Changelog

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
