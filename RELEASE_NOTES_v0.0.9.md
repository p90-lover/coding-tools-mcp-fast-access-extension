# v0.0.9 — ChatGPT recovery fixes / 自動恢復修正

## English

Includes opt-in per-chat error retry, Continue generating and optional automatic continuation from v0.0.8, with these verified corrections:

- Recognize the latest failed response after an interim assistant message; do not reuse historical errors.
- Honor active Stop controls even when the composer is outside the transcript.
- Bind reservations to the originating Chrome document and expire them after 15 seconds.
- Require a second one-use authorization immediately before Send; disabling recovery or starting MCP sync prevents sending and retains the draft.

Two local focused suites passed: Node worker/policy tests and Chromium 144 DOM fixtures. Boundaries are simulated; no live ChatGPT account, Windows installation, full OAuth flow or server-side recovery was verified. Test files were kept under aiTemp and are not added to this source change or the ZIP. No Codex/model API was invoked.

Extract the ZIP into a NEW folder; do not overwrite your modified local copy. Disable the previous extension, then load the new folder using Chrome Developer mode → Load unpacked. Reload the ChatGPT tab. Enable Auto ChatGPT → Watch this chat. For automatic keep-going, also enable Also send “continue” after replies and click Apply / re-arm. Keep the previous folder for rollback. See CHATGPT_RECOVERY.md inside the ZIP for details.

Default: 30-second quiet wait, 3 automatic actions per manual user turn; adjustable in the popup. Active thinking/tools are never force-stopped. Drafts, manual Stop, approvals, recognized limits and login prompts block automation. Automatic messages use the normal ChatGPT allowance. Existing OAuth handlers, site permissions, files and releases are preserved.

This is a prerelease pending live-account validation. The release supplies an extension ZIP, not a Windows desktop EXE.

## 繁體中文

包含 v0.0.8 的個別對話自動重試、繼續生成，以及可選的自動繼續，並修正以下問題：

- 能辨識中途助理訊息之後的最新失敗回應，不會重用歷史錯誤。
- 輸入框位於對話區塊外時，仍會識別停止控制項。
- 操作預約綁定原始 Chrome 頁面文件，並於 15 秒後失效。
- 傳送前須取得第二次一次性授權；關閉恢復或開始 MCP 同步會阻止傳送並保留草稿。

兩組本機重點測試已通過：Node 工作程序／策略及 Chromium 144 測試頁。測試邊界使用模擬，尚未驗證真實帳戶、Windows 安裝、完整 OAuth 流程或伺服器恢復。測試保存在 aiTemp，未加入這次原始碼修改或 ZIP，亦沒有呼叫 Codex／模型 API。

將 ZIP 解壓到**新的資料夾**，不要覆蓋已修改的本機副本。先停用舊擴充功能，再透過 Chrome 開發人員模式 → 載入未封裝項目載入新版。重新載入 ChatGPT 分頁，啟用「Auto ChatGPT → 監察目前對話」。需要自動 keep going，再勾選「回應結束後自動繼續」，並按「套用／重新啟用」。保留舊資料夾供復原，詳細說明位於 ZIP 內的 CHATGPT_RECOVERY.md。

預設等待 30 秒，每次手動訊息最多 3 次自動操作，可在彈出視窗調整。不會強行停止仍在思考／執行工具的回應；草稿、手動停止、批准要求、已辨識的限制或登入提示都會阻止自動操作。自動訊息使用一般 ChatGPT 額度。既有 OAuth 程式、權限、檔案及 Release 均保留。

此為待真實帳戶驗證的預覽版，提供擴充功能 ZIP，而非 Windows 桌面 EXE。
