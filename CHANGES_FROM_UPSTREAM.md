# Changes From Upstream

Upstream repo: https://github.com/krishnakanthb13/antigravity_phone_chat

---

## 1. Multi-Target Support (Antigravity + Claude Code)

The biggest change — upstream chỉ hỗ trợ Antigravity. Phiên bản này thêm Claude Code VS Code extension làm target thứ hai.

### server.js

**CDP Discovery (`discoverCDP`)**
- Upstream: tìm duy nhất 1 target (Antigravity workbench), return sớm khi tìm thấy
- Thay đổi: tìm cả 2 targets (`antigravity` + `claude`), return object `{ antigravity, claude }`
- Claude target được detect qua `extensionId=Anthropic.claude-code` trong URL CDP
- Ưu tiên `purpose=webviewView` target; fallback sang target cuối cùng trong danh sách

**CDP Connection (`initCDP`)**
- Upstream: 1 biến `cdpConnection`
- Thay đổi: `cdpConnections = new Map()` lưu cả 2 connections, `currentTarget` track target hiện tại

**Snapshot (`captureSnapshot`)**
- Upstream: hardcode `#conversation / #chat / #cascade` selectors
- Thay đổi: khi target là Claude, dùng `document.body` làm root
- Thêm CSS normalization cho Claude snapshot (xóa `position:fixed`, `height:100vh`, `overflow:hidden`) để mobile có thể scroll được

**Inject Message (`injectMessage`)**
- Upstream: chỉ xử lý Antigravity (`#cascade [contenteditable="true"]`)
- Thay đổi cho Claude:
  - Truy cập `#active-frame` iframe (Claude Code render UI trong iframe đó)
  - Dùng `frame.contentDocument` thay vì `document` trực tiếp (same-origin, hợp lệ)
  - Selector `[contenteditable="plaintext-only"]` thay vì `[contenteditable="true"]` (Claude Code dùng `plaintext-only`)
  - Submit button tìm trong `#active-frame` doc, thêm nhiều selectors (`aria-label="Send"`, `lucide-arrow-up`, v.v.)
- Thêm TEXTAREA/INPUT handling qua native setter để bypass React controlled components
- Enter key fallback thêm `keypress` event và các thuộc tính `charCode/keyCode/which`

**API Endpoints mới**
- `GET /targets` — liệt kê targets và trạng thái kết nối
- `POST /switch-target` — đổi target hiện tại

**Logging**
- Thêm log cho `/send` endpoint: `📨 /send [target] contexts:N result:{...}`
- Startup log chi tiết hơn (URL, password, local IP)

### public/index.html

- Thêm `<div class="target-tabs">` với 2 tab buttons: **Antigravity** và **Claude Code**
- `<div class="chat-container">` → `<main id="chatContainer">`

### public/js/app.js

- Thêm `fetchTargets()` — sync trạng thái tab mỗi 5 giây
- Thêm `switchTarget(id)` — gọi `/switch-target` API và reload snapshot
- Tab click listeners: `tab-antigravity` / `tab-claude`
- CSS injection thêm rules reset layout cho Claude Code snapshot (fix scroll trên mobile)

---

## 2. Bug Fix: Claude Code `#active-frame` iframe

Chi tiết đầy đủ trong [BUGFIX_CLAUDE_SEND.md](./BUGFIX_CLAUDE_SEND.md).

**Tóm tắt:** Claude Code VS Code extension render UI trong `<iframe id="active-frame">` bên trong webview. Cần dùng `frame.contentDocument` để access đúng DOM, và selector `[contenteditable="plaintext-only"]` thay vì `[contenteditable="true"]`.

---

## 3. File mới (không có trong upstream)

| File | Mục đích |
|------|---------|
| `find_claude_editor.js` | Debug tool: tìm Claude CDP target và inspect DOM |
| `discovery_claude.js` | Debug tool: khám phá CDP endpoints cho Claude extension |
| `inspect_claude_webview.js` | Debug tool: inspect webview structure |
| `BUGFIX_CLAUDE_SEND.md` | Tài liệu bug fix chi tiết |
| `CHANGES_FROM_UPSTREAM.md` | File này |

---

## 4. Không thay đổi

- `public/css/style.css` — giữ nguyên
- `launcher.py` — giữ nguyên
- `generate_ssl.js` — giữ nguyên
- `*.bat` / `*.sh` scripts — giữ nguyên
- `package.json` — giữ nguyên
