# Auto ChatGPT recovery — v0.0.8

## English

Open a saved ChatGPT conversation, then open the extension popup and enable **Auto ChatGPT → Watch this chat**. This is off by default and applies to one explicitly selected tab per conversation, not all your chats. After updating an unpacked extension, reload the extension and the ChatGPT tab before enabling it. Preserve any local changes when updating; this feature does not update your installed copy automatically.

With recovery enabled, a recognized visible response error plus a native **Try again / Retry / Regenerate** control can trigger one retry after the page has been quiet. A native **Continue generating** control can also be clicked. It never clicks the ordinary Regenerate control merely because a normal reply finished.

For the “ChatGPT replied, but my task is not finished; send keep going” workflow, also enable **Also send “continue” after replies**. This uses the native composer and Send button with the customizable continuation message. Simple completion and input-request cues suppress continuation, but semantic task completion cannot be determined reliably from the DOM. Keep the action budget bounded and supervise important work. Automatic ChatGPT messages use the account's normal message allowance; this feature does not invoke Codex or any separate model API.

Settings: a **30-second** quiet period by default (15–600 seconds), **3 automatic actions per manually originated user turn** by default (1–20), and a customizable continuation message (up to 1,000 characters). Cooldown grows exponentially after actions. Automatically sent continuation messages do not reset their own budget. A new manual user turn or an explicit Apply / re-arm resets the budget.

### Guards and persistence

Active generation, streaming, visible thinking/tool activity, drafts, attachments, recent input, dialogs, recognized rate/usage limits, login challenges and permission prompts block actions. Clicking **Stop generating** disables recovery for that chat. Turning the switch off also disables it. A native Send control must be available; otherwise an inserted continuation draft is left visible for review and recovery pauses. The extension never clears that draft, force-stops generation, refreshes the page, signs in, approves a permission, or changes the selected model.

One tab owns each watched conversation. The service worker serializes decisions and persists a one-use action reservation in `chrome.storage.session` before returning it to the content script. A second claim, worker restart, duplicate tab or stale conversation navigation cannot replay that reservation. If transport fails after reservation, recovery waits for observed progress rather than guessing whether a click occurred. It also pauses while the existing MCP sync/OAuth job is active.

Armed chats, hashes, counters and reservations are session metadata; raw conversation text and drafts are not stored or sent to a server. User-selected options and the continuation prompt are saved locally. Session storage is cleared when the browser session ends or the extension is disabled/reloaded/updated, so re-arm after those events. Worker suspension alone does not clear it. A 30-second Chrome alarm can wake coordination; normal content checks are about every 5 seconds while armed. These are not real-time deadlines: suspended/discarded tabs, sleeping computers and browser throttling can delay or prevent work.

### Scope and verification

Supported hosts are `chatgpt.com` and `chat.openai.com`, on saved `/c/<id>` conversation routes (including nested GPT/project routes). New unsaved chats must first receive a conversation URL. Recognition includes selected English and Chinese controls; unfamiliar UI variants fail closed. DOM selectors are not a supported ChatGPT API and may need maintenance when the website changes.

**A silent but still-active Thinking/Working spinner is deliberately not force-stopped.** The extension cannot prove that a long tool task has died merely because visible text stopped changing. This is not an unlimited background agent, an outage fix, or a way around account limits, disabled tools, approvals or browser restrictions.

Validation performed for this change: three focused Node test groups covering policy/cooldowns, continuation budgets, manifest wiring and real worker isolation; three Chromium DOM-fixture scenarios covering single retry and draft preservation, native contenteditable submission, and active-generation/manual-Stop handling. JavaScript syntax checks passed. Test scripts and evidence stayed under `aiTemp/` outside the published change. Chromium tested local fixtures with a test-only route shim because live ChatGPT navigation was policy-blocked. **No live ChatGPT account, installed Windows extension, OAuth regression flow or server-side recovery was verified.**

Implementation is isolated in `recovery-*.js`. `recovery-worker.js` imports the existing `background.js` unchanged and adds a dedicated port namespace. Existing OAuth handlers, credentials, permissions, tests and unrelated files are preserved; no project files are deleted.

Platform references:
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://help.openai.com/en/articles/7996703-troubleshooting-chatgpt-error-messages

## 繁體中文

開啟已有對話網址的 ChatGPT 對話，再在擴充功能彈出視窗啟用 **Auto ChatGPT → 監察目前對話**。預設關閉，每個對話只指定一個分頁執行，不會監察所有聊天。更新未封裝擴充功能後，先重新載入擴充功能及 ChatGPT 分頁，再啟用。更新時請保留本機修改；此功能不會自動更新已安裝的副本。

當頁面出現可辨識的回應錯誤，且有原生「重試／重新產生」按鈕時，會在頁面靜止一段時間後重試；亦支援「繼續生成」。不會因正常回應結束而自行點擊重新產生。

若要在回應結束後自動發送「繼續」，另外勾選 **回應結束後自動繼續**。系統會透過原生輸入框和傳送按鈕發送可自訂訊息。簡單的完成／提問語句會抑制繼續，但不能單靠頁面可靠判斷任務是否完成，因此重要工作仍需監督。自動訊息會使用帳戶的一般 ChatGPT 額度；本功能不會呼叫 Codex 或其他模型 API。

預設等待 **30 秒**，可調整至 15–600 秒；每次使用者自行發送的訊息，預設最多 **3 次自動操作**，可調整至 1–20 次。操作後等待時間會遞增。自動發出的「繼續」不會自行重設次數；新的手動訊息或按下「套用／重新啟用」才會重設。繼續訊息最多 1,000 個字元。

有生成／思考／工具活動、草稿、附件、近期輸入、對話框、已辨識的使用限制、登入驗證或權限提示時，不會操作。手動按「停止生成」會關閉該對話的恢復功能。找不到原生傳送按鈕時，已輸入的繼續草稿會保留供檢查，並暫停恢復；不會清除草稿、強行停止、刷新頁面、登入、批准權限或更換模型。

每個對話只允許一個分頁操作。動作在執行前寫入工作階段儲存區並只能領取一次，避免重複分頁、背景服務重啟或導覽變更造成重複操作。傳輸結果不明時不會猜測並重送；MCP 同步／OAuth 工作進行期間也會暫停。

只保留對話識別碼、雜湊、計數和操作記錄，不儲存或上傳原始對話及草稿。設定及自訂繼續訊息儲存在本機。關閉瀏覽器或停用、重新載入、更新擴充功能後需重新啟用；單純背景服務休眠不會清除狀態。正常約每 5 秒檢查，另有 30 秒喚醒機制；電腦休眠、分頁被暫停／捨棄及瀏覽器節流仍可能延遲或阻止執行。

支援 `chatgpt.com` 和 `chat.openai.com` 的已儲存 `/c/<id>` 對話，包括巢狀 GPT／專案路徑，以及部分英文和中文控制項。不能辨識的介面不會操作。**仍顯示 Thinking／Working 的靜止回應不會被強行停止**，因為沒有新文字不代表長時間工具工作已失效。本功能不能繞過帳戶限制、停用工具、批准要求或瀏覽器限制，也不保證無限期背景執行。

驗證結果：三組 Node 重點測試及三項 Chromium 測試頁情境通過，JavaScript 語法檢查通過。測試及證據保留於 `aiTemp/`，未加入這次 GitHub 修改。由於真實 ChatGPT 導覽被政策阻擋，瀏覽器使用本機測試頁及僅供測試的路徑替代。**尚未驗證真實帳戶、Windows 已安裝擴充功能、OAuth 回歸流程或伺服器端恢復。** 現有 OAuth 處理器、憑證、權限和不相關檔案均保留，沒有刪除專案檔案。
