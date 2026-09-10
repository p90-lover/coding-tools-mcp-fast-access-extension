# v0.0.7 — Desktop v0.4.3-rc.3 compatibility / 相容性修正

## English

Keeps create-before-Connect, existing page detection, local configuration capture and site permissions. OAuth submission no longer succeeds merely because the unchanged parent ChatGPT tab is open. Password delivery is bound to Chrome's actual sender, top-level frame, matching client/S256/callback parameters and the popup opener. Unlinked/noopener popups require manual password entry. Only the correct popup/state callback is tracked, and completion requires an explicit Connected/Disconnect state on this exact app; actual MCP tool execution is not inferred. Waiting no longer starts repeated Connect flows. Content scripts cannot request local credentials through extension-only UI messages. The helper retains the server form's nonce/state/PKCE fields and same-origin POST/cookie flow.

Reload the extension and existing ChatGPT tabs once after upgrading. Preserve settings/site access and restart Desktop. profiles.json is in the app configuration data directory, not necessarily beside the EXE; use the existing path override when required. No new public credential endpoint is added. Focused worker and exact-app DOM checks use synthetic Chrome boundaries; the paired Desktop pipeline replays its actual HTTP form in Chromium before publishing. This is not live-account verification. No Codex, model or inference request is invoked. Existing files/releases remain; temporary data stays in aiTemp.

## 繁體中文

保留先建立再 Connect、頁面辨識、本機設定讀取及網站權限。OAuth 送出後不再因原本 ChatGPT 分頁仍開啟而宣告成功。密碼傳送會核對 Chrome 真正來源、頂層畫面、Client／S256／回呼參數及彈窗開啟者；無法驗證開啟者的彈窗改用手動輸入。只追蹤正確彈窗及 State 回呼，並須在指定應用程式觀察到已連線／中斷連線狀態才完成，不會推斷工具已執行。等待期間不再重複 Connect；內容腳本不能透過擴充功能介面訊息索取本機密鑰。助手保留服务端表單的 Nonce／State／PKCE、同來源 POST 及 Cookie 流程。

升級後重新載入擴充功能及已開啟的 ChatGPT 分頁一次，保留設定／網站權限並重啟 Desktop。profiles.json 在應用程式設定資料目錄，不一定在 EXE 旁；有需要時使用既有路徑覆寫，不會新增公開密鑰端點。工作狀態及指定應用程式的 DOM 測試使用已標示的模擬 Chrome 邊界；配對 Desktop 流程會在發佈前使用真正 HTTP 表單於 Chromium 重播。並非真實帳戶驗證。沒有呼叫 Codex、模型或推論服務；保留現有檔案及 Release，暫存資料放在 aiTemp。

## Earlier release documentation / 過往版本文件

﻿# coding-tools-mcp-extension v0.0.3

Delete now always continues into recreate.

After Sync deletes `coding-tools-mcp`, it closes leftover Manage UI, clears the plugins search box, returns to the personal plugins page, and opens Create. Stale name text in search/sidebar/toast no longer blocks that step.

Reload the unpacked extension (or install the zip), then run Sync + OAuth once.
