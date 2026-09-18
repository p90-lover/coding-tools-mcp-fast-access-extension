# Auto ChatGPT recovery — v0.0.10

## English

### Install and enable

Extract `coding-tools-mcp-extension-v0.0.10` (or load this repository folder) as an unpacked Chrome extension. Do not overwrite a locally modified copy and do not mix with `coding-tools-mcp-chrome-extension-v0.3.3`. Disable the previous copy before enabling the new one. If you use MCP capture, keep **Allow access to file URLs**. Recovery itself does not read Desktop files.

Reload the ChatGPT conversation tab. Use the **on-page HUD** or the popup:

1. Enable **Watch this chat**.
2. Optionally enable **Also send “continue” after replies**.
3. **Do not spam** is on by default; **Long task** is off.
4. Watch / Long task / Do not spam / continue message **save immediately**. Use **Re-arm** only after a safety-limit pause.

The default continue prompt is `@coding-tools-mcp keep going`. A stored bare `keep going` is rewritten to that tagged form.

### Behavior

- Chat identity prefers the page URL (including `www.chatgpt.com` and `/c/{id}/branch` after SPA), then a Chat ID fallback, then `tab.url`.
- Visible errors with a native Retry control can retry. Continue generating can be clicked. Thinking failed sends the continue prompt instead of the Thinking-failed retry icon.
- If MCP/tools are disabled or FORBIDDEN, recovery clicks native **Branch** and arms Watch on the new `/c/{id}`. It never sends keep-going on the disabled source chat.
- Turning Watch OFF does not auto-rearm. Repeat keep-going is held while Do not spam is on unless Long task is enabled.
- Active generation, drafts, Stop, approvals, and recognized limits still block automation. MCP Sync/OAuth jobs also block recovery.

### HUD

The HUD matches the popup chrome: Chat ID, Watch status, model/effort from network (never Recents/MIME as Running; Extra High is effort-only), and a **collapsed** HTTP method/path/status log. Popup and HUD prefs stay in sync.

### Desktop capture paths

Coding Tools Desktop 0.7.0-rc.x stores `profiles.json` under AppData (`Roaming\coding-tools-mcp-desktop` / `Local\Coding Tools MCP\data`), not beside the EXE. Capture tries those candidates automatically.

## 繁體中文

將此資料夾以 Chrome「載入未封裝項目」安裝，不要覆蓋本機修改版，也不要與 `coding-tools-mcp-chrome-extension-v0.3.3` 混用。重新載入 ChatGPT 分頁後，用頁面 HUD 或彈出視窗啟用「監察目前對話」。Watch／長任務／不要洗版／繼續訊息會立即儲存；「重新啟用」只重設每次訊息的操作額度。預設繼續訊息為 `@coding-tools-mcp keep going`。Thinking failed 會發送繼續訊息；MCP 停用／FORBIDDEN 會分支到新對話並在新 `/c/{id}` 啟用監察，不會在已停用的來源對話 keep going。
