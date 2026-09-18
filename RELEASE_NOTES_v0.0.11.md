# v0.0.11 — Personal plugins page detection and list readiness

## English

Patch after v0.0.10. Fixes the pre-existing personal-plugins / plugins-DOM failures that still reproduced on `main` after PR #1. Does not reopen HUD, recovery, or Desktop AppData work.

Load unpacked from this folder. Reload ChatGPT tabs. Do not mix with `coding-tools-mcp-chrome-extension-v0.3.3`.

### What was wrong

- `isPersonalPluginsPage()` only accepted `/plugins`. Helpers that already classified renamed manager routes and rendered card evidence were never consulted, so `/settings/connectors` returned `wrong_page` even after the list painted.
- Grid-card search skipped `document.body` when `<main>` was missing, and name nodes inside a nested left column were discarded as "sidebar" before the walk could reach the sibling ⋯ button. Sync then took the Create path (`open_create`) for an app that was already on the page.
- List readiness required a clickable grid menu, so a name+link card that had already painted was reported as `cards` instead of `app`. Mutation wakeups could not recover that.
- An unrendered search-only shell waited 12s before fail-closed. v0.0.1 already specified 5s.

### Verify

```bash
node --test tests/personal-page.test.mjs tests/regression-v001.test.mjs
```

Those two files must pass. Leave HUD/recovery coverage (`tests/recovery.test.mjs`) and the already-green `tests/core.test.mjs` / `tests/workflow.test.mjs` unchanged.

## 繁體中文

v0.0.10 之後的修正版：修好 PR #1 之後 `main` 上仍失敗的個人插件頁偵測與列表就緒判斷。不含 HUD／恢復／Desktop 路徑變更。

請載入未封裝項目並重新載入 ChatGPT 分頁；不要與舊 v0.3.3 zip 混用。
