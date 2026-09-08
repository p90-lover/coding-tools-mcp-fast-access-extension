# coding-tools-mcp-extension v0.0.1

This release focuses on faster and more accurate ChatGPT page actions.

The extension now requires stronger evidence before treating a page as the Plugins/Apps manager, ignoring plugin links found in navigation or ordinary conversation content. Renamed manager routes are allowed to finish rendering and are validated using DOM structure instead of URL alone. DOM mutations wake pending actions immediately, while bounded timers remain as a fallback. Explicit empty-list states are recognized immediately, and unsafe missing/ambiguous controls continue to fail closed without being clicked.

Regression coverage includes sidebar false positives, conversation-link false positives, late-rendered renamed routes, mutation-driven readiness, empty-list readiness, and bounded negative-path timeouts.
