# Auto ChatGPT recovery — v0.0.9

## English

### Install and enable

Extract `coding-tools-mcp-extension-v0.0.9.zip` into a NEW folder. Do not overwrite your locally modified extension folder. Open `chrome://extensions`, enable Developer mode, and use **Load unpacked** to select the extracted folder containing `manifest.json`. Disable the previous copy before enabling the new one; do not run both. Keep the old folder for rollback. If you use MCP local-value capture, retain/grant its existing site access and **Allow access to file URLs**. Recovery itself does not require reading your local MCP configuration.

Reload the saved ChatGPT conversation tab. In the extension popup, enable **Auto ChatGPT → Watch this chat**. To send a continuation when a reply finishes, also select **Also send “continue” after replies**, then click **Apply / re-arm**. The checkbox is off by default; it is not activated across every chat automatically. The extension cannot update your installed copy or grant Chrome site/file permissions by itself.

### Behavior and controls

A recognized visible response error plus a native Retry/Try again/Regenerate control can trigger a retry. A native Continue generating control can also be clicked. An ordinary successful reply does not trigger Regenerate. Optional automatic continuation uses the native composer and Send button, with a customizable prompt. Simple completion and input-request cues suppress continuation, but DOM heuristics cannot reliably determine semantic task completion.

The default quiet wait is 30 seconds (adjustable 15–600). The default budget is 3 automatic actions per manually originated user turn (adjustable 1–20). The prompt is limited to 1,000 characters. Cooldowns grow after actions. An automatically sent continuation does not reset its own budget. A new manual user message or Apply / re-arm resets it. These are per-turn safety budgets, not a promised uptime or runtime duration.

Active generation, visible thinking/tool activity, drafts, attachments, recent input, dialogs, recognized login/usage limits and approval requests block automation. Manual Stop disables recovery. The existing MCP sync/OAuth job also blocks recovery. No force-stop, forced refresh, permission approval, model switching, login, draft clearing or separate model/API request is performed. Automatic ChatGPT messages use the normal account allowance.

### v0.0.9 corrections

Latest-turn selection now includes a failed final response that follows an interim assistant message, without reusing historical errors. Native Stop controls outside the transcript's `main` element are recognized. Action reservations are bound to Chrome's originating document and expire after 15 seconds. Native Send requires a second one-use authorization after composer preparation; disabling/re-arming, a new page state, expired reservation or an active MCP sync revokes that send. The visible draft is retained when safe sending cannot be confirmed.

### Persistence and limitations

One tab owns each enabled conversation. The worker serializes decisions and reserves actions in `chrome.storage.session` before delivery; ambiguous transport failures are not blindly replayed. This memory-backed session state survives worker suspension, but clears when the browser restarts or the extension is disabled/reloaded/updated. Re-arm after those events. Settings and your continuation prompt are stored locally. Raw conversation text and drafts are not persisted or uploaded by recovery.

Checks normally occur about every five seconds, with a 30-second alarm for coordination. Browser throttling, discarded tabs and sleeping computers can delay or stop them. Supported hosts are `chatgpt.com` and `chat.openai.com` on saved `/c/<id>` routes, including nested GPT/project routes. Selected English/Chinese UI labels are supported; unrecognized layouts fail closed. DOM selectors are not a supported ChatGPT API.

A silent but still-active Thinking/Working response is deliberately not force-stopped: a lack of visible text does not prove a long MCP tool task has failed. This feature does not bypass disabled tools, account limits, approvals or browser restrictions and does not guarantee unlimited background execution.

### Verification scope

Two local focused suites were run against the exact candidate bytes: a Node worker/policy suite with synthetic Chrome APIs, and Chromium 144 DOM fixtures with test-only closure hooks and synthetic RPC replies. They reproduced the v0.0.8 failures before the fix, then passed the corrected cases, including normal one-use sends and draft preservation after disabling. JavaScript syntax checks passed. Test scripts/evidence remain under `aiTemp/` outside the published change. Release CI verifies the tested source hashes, syntax, an existing capture/OAuth smoke test and archive wiring.

No live ChatGPT account, Windows installation, full OAuth browser flow or server-side recovery has been verified in this update. The current turn had no usable MCP host-control connection. Existing MCP/OAuth runtime files, permissions and old releases are preserved. No files were deleted.

Platform references:
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/reference/api/alarms
- https://help.openai.com/en/articles/7996703-troubleshooting-chatgpt-error-messages

## 繁體中文

### 安裝及啟用

將 ZIP 解壓到**新的資料夾**，不要覆蓋已有本機修改的擴充功能。開啟 `chrome://extensions`，啟用開發人員模式，再用「載入未封裝項目」選取含有 `manifest.json` 的資料夾。先停用舊副本再啟用新版，不要同時執行兩份；保留舊資料夾供復原。若需要讀取 MCP 本機設定，保留／授予原有網站存取及「允許存取檔案網址」權限。自動恢復本身不需要讀取 MCP 本機設定。

重新載入已有對話網址的 ChatGPT 分頁，在彈出視窗啟用 **Auto ChatGPT → 監察目前對話**。需要自動發送「繼續」時，勾選 **回應結束後自動繼續**，再按 **套用／重新啟用**。功能預設關閉，不會自動監察所有對話，也不能自行更新已安裝副本或授予 Chrome 權限。

### 功能及保護

辨識到回應錯誤及原生重試按鈕時會重試，亦支援「繼續生成」。不會因正常回應完成而點擊重新產生。可選的自動繼續透過原生輸入框及傳送按鈕發送可自訂訊息；簡單的完成／提問線索會抑制繼續，但不能可靠判定所有任務是否真正完成。

預設等待 30 秒，可調整為 15–600 秒；每次手動訊息預設最多 3 次自動操作，可調整為 1–20 次。繼續訊息最多 1,000 字元，操作後等待時間會遞增。自動訊息不會重設自己的操作額度；新的手動訊息或重新啟用才會重設。這是每次訊息的安全額度，不是保證運作時間。

有生成／思考／工具活動、草稿、附件、近期輸入、對話框、已辨識的登入／使用限制或批准要求時不會操作。手動停止會關閉恢復；MCP 同步／OAuth 工作進行時也會暫停。不會强行停止、刷新、批准權限、切換模型、登入或清除草稿，也不會呼叫其他模型／API。自動 ChatGPT 訊息使用一般帳戶額度。

### v0.0.9 修正

修正中途助理訊息之後出現失敗回應時漏判最新重試按鈕，且不會重用歷史錯誤。現在會辨識位於對話 `main` 區塊以外的原生停止按鈕。操作預約綁定 Chrome 的原始頁面文件，並於 15 秒後失效。準備好輸入框後，傳送前還須取得第二次一次性授權；關閉／重新啟用、頁面狀態改變、預約過期或 MCP 同步進行中，都會阻止傳送。無法確認安全傳送時保留可見草稿。

### 狀態保存及限制

每個對話只由一個分頁操作。工作狀態及一次性預約保存在記憶體形式的 `chrome.storage.session`，可跨背景服務休眠，但關閉瀏覽器或停用／重新載入／更新擴充功能後會清除，屆時需重新啟用。設定和繼續訊息儲存在本機；恢復功能不保存或上傳原始對話及草稿。傳輸結果不明時不會盲目重送。

通常約每 5 秒檢查，另有 30 秒協調鬧鐘；瀏覽器節流、捨棄分頁及電腦休眠仍可延遲或停止運作。支援 `chatgpt.com`、`chat.openai.com` 已儲存的 `/c/<id>` 對話，包括巢狀 GPT／專案路徑，及部分英文／中文按鈕。無法辨識的介面不會操作。DOM 選擇器並非官方 ChatGPT API。

仍顯示 Thinking／Working 的靜止回應不會被強行停止，因為沒有新文字不等於長時間 MCP 工作已失敗。此功能不能繞過停用工具、帳戶限制、批准要求或瀏覽器限制，也不保證無限期背景執行。

### 驗證範圍

已執行兩組本機重點測試：使用模擬 Chrome API 的 Node 工作程序／策略測試，以及使用僅供測試的函式存取點和模擬 RPC 的 Chromium 144 測試頁。先重現 v0.0.8 問題，再確認修正、正常一次性傳送及關閉後保留草稿。JavaScript 語法檢查通過。測試及證據留在 `aiTemp/`，未加入這次 GitHub 修改。發佈流程會核對已測試原始碼雜湊、語法、原有設定／OAuth 重點測試及 ZIP 內容連結。

本次尚未驗證真實 ChatGPT 帳戶、Windows 安裝、完整 OAuth 瀏覽器流程或伺服器恢復；本輪沒有可用的 MCP 主機控制連線。保留既有 MCP／OAuth 程式、權限及舊 Release，沒有刪除檔案。
