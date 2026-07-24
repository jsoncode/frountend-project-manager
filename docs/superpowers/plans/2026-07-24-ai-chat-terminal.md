# AI 对话窗口与终端投喂 — 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为终端增加右键「复制 / 全选 / 投喂 AI」，并实现独立 Webview AI 对话窗口（历史、多模型设置、流式/思考/编程开关、OpenAI 兼容代理）。

**架构：** 主窗口负责终端右键与开窗；AI 窗口通过 `/#/ai` 渲染 `AiApp`。模型与会话落盘在应用配置目录的独立 JSON；聊天请求由 Rust `reqwest` 代理 OpenAI 兼容 API，SSE 经 Tauri 事件回传前端。

**技术栈：** Tauri 2、React 19、Zustand、Vitest、reqwest（Rust）、现有 Cyan HUD CSS

**规格：** [docs/superpowers/specs/2026-07-24-ai-chat-terminal-design.md](../specs/2026-07-24-ai-chat-terminal-design.md)

---

## 文件结构

| 路径 | 职责 |
|------|------|
| `src/lib/aiTypes.ts` | AI 领域 TS 类型（与 Rust camelCase 对齐） |
| `src/lib/aiChat.ts` | 纯函数：会话分组、消息组包、附件截断、标题默认值 |
| `src/lib/aiChat.test.ts` | 上述纯函数 Vitest |
| `src/stores/aiStore.ts` | AI 窗口 Zustand：模型/会话/消息/开关/附件/流式状态 |
| `src/ai/AiApp.tsx` | AI 窗口根布局 |
| `src/ai/AiSidebar.tsx` | 历史侧栏（分组、重命名、删除、新对话） |
| `src/ai/AiTopBar.tsx` | 模型下拉 + 设置按钮 |
| `src/ai/AiModelSettingsModal.tsx` | 模型 CRUD Modal |
| `src/ai/AiMessageList.tsx` | 消息流 + 思考折叠 + 错误条 |
| `src/ai/AiComposer.tsx` | 附件条、流式/思考/编程、输入、发送/停止 |
| `src/styles/ai.css` | AI 窗口样式（复用 tokens） |
| `src/main.tsx` | 按 hash 分流 `App` / `AiApp` |
| `src/components/XtermSession.tsx` | 终端右键菜单 |
| `src/i18n/messages.ts` | AI / 终端菜单文案 |
| `src-tauri/src/ai/mod.rs` | 模块导出 |
| `src-tauri/src/ai/store.rs` | `ai-config.json` / `ai-chats.json` 读写 |
| `src-tauri/src/ai/chat.rs` | OpenAI 兼容请求、SSE、取消 |
| `src-tauri/src/ai/window.rs` | 打开/聚焦 `ai-chat` 窗口并投喂 |
| `src-tauri/src/lib.rs` | 注册 commands |
| `src-tauri/permissions/app-commands.toml` | 允许新 commands |
| `src-tauri/capabilities/default.json` | 允许多窗口 / 事件 |
| `src-tauri/Cargo.toml` | 增加 `reqwest`、`futures-util`、`tokio`（按需） |

---

### 任务 1：纯函数与类型（TDD）

**文件：**
- 创建：`src/lib/aiTypes.ts`
- 创建：`src/lib/aiChat.ts`
- 创建：`src/lib/aiChat.test.ts`

- [ ] **步骤 1：编写失败的测试**

```typescript
// src/lib/aiChat.test.ts
import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_MAX_CHARS,
  buildUserContent,
  groupConversations,
  truncateAttachment,
} from './aiChat'

describe('truncateAttachment', () => {
  it('truncates over limit and appends marker', () => {
    const text = 'a'.repeat(ATTACHMENT_MAX_CHARS + 10)
    const out = truncateAttachment(text)
    expect(out.length).toBeLessThan(text.length)
    expect(out.endsWith('…[truncated]')).toBe(true)
  })
})

describe('groupConversations', () => {
  it('splits recent month vs older', () => {
    const now = Date.UTC(2026, 6, 24)
    const recent = { id: '1', title: 'a', createdAt: now, updatedAt: now - 5 * 86400000 }
    const older = { id: '2', title: 'b', createdAt: now, updatedAt: now - 40 * 86400000 }
    const g = groupConversations([older, recent], now)
    expect(g.recent.map((c) => c.id)).toEqual(['1'])
    expect(g.older.map((c) => c.id)).toEqual(['2'])
  })
})

describe('buildUserContent', () => {
  it('embeds terminal selection before user text', () => {
    const content = buildUserContent('帮我看报错', {
      kind: 'terminal-selection',
      text: 'Error: boom',
      createdAt: 1,
    })
    expect(content).toContain('[终端选区]')
    expect(content).toContain('Error: boom')
    expect(content).toContain('帮我看报错')
  })
})
```

- [ ] **步骤 2：运行测试确认失败**

```bash
pnpm test -- src/lib/aiChat.test.ts
```

预期：FAIL（模块不存在）

- [ ] **步骤 3：实现类型与纯函数**

`aiTypes.ts` 定义：`AiModelType`、`AiModel`、`AiConversation`、`AiMessage`、`AiAttachment`。

`aiChat.ts` 实现：

```typescript
export const ATTACHMENT_MAX_CHARS = 100_000
export const PROGRAMMING_SYSTEM_PROMPT =
  '你是资深工程师助手。优先给出可执行的代码与排查步骤，使用简体中文回复。'

export function truncateAttachment(text: string): string {
  if (text.length <= ATTACHMENT_MAX_CHARS) return text
  return `${text.slice(0, ATTACHMENT_MAX_CHARS)}…[truncated]`
}

export function groupConversations(
  list: AiConversation[],
  nowMs = Date.now(),
): { recent: AiConversation[]; older: AiConversation[] } {
  const month = 30 * 86400000
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt)
  return {
    recent: sorted.filter((c) => nowMs - c.updatedAt <= month),
    older: sorted.filter((c) => nowMs - c.updatedAt > month),
  }
}

export function buildUserContent(
  userText: string,
  attachment?: AiAttachment | null,
): string {
  const q = userText.trim()
  if (!attachment?.text) return q
  const body = truncateAttachment(attachment.text)
  return `[终端选区]\n\`\`\`\n${body}\n\`\`\`\n\n---\n${q}`
}

export function defaultConversationTitle(seed?: string): string {
  const t = (seed ?? '').trim().replace(/\s+/g, ' ')
  if (!t) return '新对话'
  return t.length > 24 ? `${t.slice(0, 24)}…` : t
}
```

- [ ] **步骤 4：运行测试确认通过**

```bash
pnpm test -- src/lib/aiChat.test.ts
```

预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/lib/aiTypes.ts src/lib/aiChat.ts src/lib/aiChat.test.ts
git commit -m "feat(ai): add chat helpers and types"
```

---

### 任务 2：Rust AI 持久化

**文件：**
- 创建：`src-tauri/src/ai/mod.rs`
- 创建：`src-tauri/src/ai/store.rs`
- 修改：`src-tauri/src/lib.rs`（`mod ai;` + commands）
- 修改：`src-tauri/permissions/app-commands.toml`

- [ ] **步骤 1：实现 store 数据结构与 IO**

在 `store.rs`：

- `AiConfig { models: Vec<AiModel>, lastModelId: Option<String> }` → `ai-config.json`
- `AiChats { conversations: Vec<AiConversation>, messages: HashMap<String, Vec<AiMessage>> }` → `ai-chats.json`
- 路径：`app.path().app_config_dir()`
- 提供：`load/save` config与 chats；`upsert_model`、`delete_model`、`set_model_active`；`create_conversation`、`rename_conversation`、`delete_conversation`、`append_message`、`list_conversations`

字段 serde `camelCase`，与 TS 对齐。`AiModel.token` 存本地文件。

- [ ] **步骤 2：注册 commands**

```rust
// lib.rs 示例签名
fn ai_load_config(app: AppHandle) -> Result<ai::AiConfig, String>;
fn ai_save_config(app: AppHandle, cfg: ai::AiConfig) -> Result<ai::AiConfig, String>;
fn ai_list_conversations(app: AppHandle) -> Result<Vec<ai::AiConversation>, String>;
fn ai_get_messages(app: AppHandle, conversation_id: String) -> Result<Vec<ai::AiMessage>, String>;
fn ai_create_conversation(app: AppHandle, title: Option<String>) -> Result<ai::AiConversation, String>;
fn ai_rename_conversation(app: AppHandle, id: String, title: String) -> Result<ai::AiConversation, String>;
fn ai_delete_conversation(app: AppHandle, id: String) -> Result<(), String>;
fn ai_append_message(app: AppHandle, msg: ai::AiMessage) -> Result<ai::AiMessage, String>;
```

- [ ] **步骤 3：更新 permissions**

在 `app-commands.toml` 为上述 command 各加 `[[permission]]` 段（沿用现有格式）。

- [ ] **步骤 4：编译验证**

```bash
cd src-tauri && cargo check
```

预期：无错误

- [ ] **步骤 5：Commit**

```bash
git add src-tauri/src/ai src-tauri/src/lib.rs src-tauri/permissions/app-commands.toml
git commit -m "feat(ai): persist models and conversations"
```

---

### 任务 3：开窗与投喂

**文件：**
- 创建：`src-tauri/src/ai/window.rs`
- 修改：`src-tauri/src/ai/mod.rs`
- 修改：`src-tauri/capabilities/default.json`（将 `"windows": ["main"]` 改为 `["main", "ai-chat"]`，并按需加入 `core:webview:allow-create-webview-window`、`core:window:allow-create`、`core:window:allow-set-focus` 等）
- 修改：`src-tauri/src/lib.rs`

- [ ] **步骤 1：实现 `open_ai_chat_window`**

```rust
pub fn open_or_focus_ai_chat(app: &AppHandle, feed_text: Option<String>) -> Result<(), String> {
    const LABEL: &str = "ai-chat";
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(text) = feed_text {
            let _ = w.emit("ai://feed", text);
        }
        return Ok(());
    }
    let url = tauri::WebviewUrl::App("index.html#/ai".into());
    let win = tauri::WebviewWindowBuilder::new(app, LABEL, url)
        .title("FPM — AI Chat")
        .inner_size(1100.0, 760.0)
        .min_inner_size(800.0, 560.0)
        .build()
        .map_err(|e| e.to_string())?;
    if let Some(text) = feed_text {
        // 窗口刚创建时前端可能尚未 listen：短延迟再 emit，或前端 mount 后 pull pending
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            if let Some(w) = app2.get_webview_window(LABEL) {
                let _ = w.emit("ai://feed", text);
            }
        });
    }
    let _ = win;
    Ok(())
}
```

同时提供内存 `PENDING_FEED: Mutex<Option<String>>`：开窗时写入；前端 `ai_take_pending_feed` 拉取，避免竞态。

- [ ] **步骤 2：注册 `ai_open_chat_window(feedText?: string)` 与 `ai_take_pending_feed`**

- [ ] **步骤 3：手动验证（dev）**

从任意临时 invoke 打开窗口，确认 hash `#/ai`（前端任务 5 接上前可先看到主 App，可接受）。

- [ ] **步骤 4：Commit**

```bash
git add src-tauri/src/ai src-tauri/src/lib.rs src-tauri/capabilities/default.json src-tauri/permissions/app-commands.toml
git commit -m "feat(ai): open dedicated chat webview window"
```

---

### 任务 4：Rust 聊天代理（流式 / 非流式 / 停止）

**文件：**
- 创建：`src-tauri/src/ai/chat.rs`
- 修改：`src-tauri/Cargo.toml`（`reqwest = { version = "0.12", default-features = false, features = ["json", "stream", "rustls-tls"] }`，`futures-util`，`tokio` 若尚未间接依赖）
- 修改：`src-tauri/src/lib.rs`

- [ ] **步骤 1：定义请求/事件载荷**

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: String,
    pub model_id: String,
    pub messages: Vec<ChatMessageDto>, // role + content
    pub stream: bool,
}

// 事件 ai://chat-chunk { requestId, delta?, reasoningDelta?, done?, error? }
```

从 `ai-config` 按 `model_id` 取 `baseUrl`/`modelName`/`token`/`type`。若 type 不是 `text`/`multimodal`，直接返回 Err。

URL：`{baseUrl.trim_end_matches('/')}/chat/completions`（若 baseUrl 已含 `/v1` 则不要重复）。

- [ ] **步骤 2：实现非流式**

POST JSON `{ model, messages, stream: false }`，解析 `choices[0].message.content` 与可选 `reasoning_content`，emit 一次 chunk + done。

- [ ] **步骤 3：实现流式 SSE**

读取 `text/event-stream`，解析 `data: {json}`，累计 `delta.content` / `delta.reasoning_content`，逐条 emit；`[DONE]` 时 done。

用 `HashMap<String, CancellationFlag>`（`AtomicBool`）实现 `ai_chat_cancel(request_id)`。

- [ ] **步骤 4：注册 `ai_chat_start`、`ai_chat_cancel`**

`ai_chat_start` 内 `tauri::async_runtime::spawn` 跑请求，立即返回 Ok(())。

- [ ] **步骤 5：`cargo check` 通过后 Commit**

```bash
git commit -m "feat(ai): proxy OpenAI-compatible chat with SSE"
```

---

### 任务 5：前端入口分流 + AI 壳

**文件：**
- 修改：`src/main.tsx`
- 创建：`src/ai/AiApp.tsx`
- 创建：`src/styles/ai.css`
- 修改：`src/App.tsx` 或 `main` 仅按 hash 选择根组件
- 修改：`src/i18n/messages.ts`（先加关键 key 骨架）

- [ ] **步骤 1：分流**

```tsx
// main.tsx
const isAi = window.location.hash.startsWith('#/ai')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{isAi ? <AiApp /> : <App />}</ErrorBoundary>
  </StrictMode>,
)
```

监听 `hashchange` 一般不需要（窗口 URL 固定）。

- [ ] **步骤 2：AiApp 三栏空壳**

左栏 / 顶栏 / 消息区 / 底栏占位，引入 `ai.css`，复用 `tokens.css`。

- [ ] **步骤 3：`pnpm tauri:dev` 用 Rust 开窗，确认只渲染 AI 壳**

- [ ] **步骤 4：Commit**

```bash
git commit -m "feat(ai): route AiApp on #/ai hash"
```

---

### 任务 6：aiStore + 模型设置 UI

**文件：**
- 创建：`src/stores/aiStore.ts`
- 创建：`src/ai/AiTopBar.tsx`
- 创建：`src/ai/AiModelSettingsModal.tsx`
- 修改：`src/ai/AiApp.tsx`、`src/i18n/messages.ts`

- [ ] **步骤 1：实现 store**

```typescript
// 关键 API
loadConfig / saveModels
selectedModelId / setSelectedModelId（仅 active）
streamEnabled / thinkEnabled / codeEnabled
pendingAttachment / setAttachment / clearAttachment
conversations / messages / activeConversationId
createConversation / rename / delete / select
sendMessage / stopGeneration
listenChatEvents / listenFeed
```

`load` 时 invoke `ai_load_config` + `ai_list_conversations`；选中会话时 `ai_get_messages`。

- [ ] **步骤 2：设置 Modal**

表单字段：备注、接口地址、模型名称、token（password 输入）、类型 select、启用 checkbox；列表增删改；保存调用 `ai_save_config`。

- [ ] **步骤 3：顶栏下拉**

只显示 `active` 模型；标签用 `remark || modelName`。

- [ ] **步骤 4：Commit**

```bash
git commit -m "feat(ai): model settings and selection store"
```

---

### 任务 7：历史侧栏 + 消息列表 + 发送组包

**文件：**
- 创建：`src/ai/AiSidebar.tsx`
- 创建：`src/ai/AiMessageList.tsx`
- 创建：`src/ai/AiComposer.tsx`
- 修改：`src/stores/aiStore.ts`、`src/styles/ai.css`、`src/i18n/messages.ts`

- [ ] **步骤 1：侧栏**

用 `groupConversations` 渲染「最近一个月」「更早」；新对话；双击重命名（prompt 或 inline）；删除确认（可用现有 `ModalShell`）。

- [ ] **步骤 2：消息列表**

渲染 user/assistant；`reasoning` 可折叠；错误条；自动滚到底。

- [ ] **步骤 3：Composer + send**

- 无 active 文本模型：禁用发送并提示。
- 发送流程：
  1. 若无会话则 `createConversation(defaultConversationTitle(userText))`
  2. `buildUserContent` + 可选 programming system
  3. `ai_append_message` user（及 system 若需要只放请求不落盘 system 也可——**规格：programming system 仅进请求，不写入历史**）
  4. 追加空 assistant 消息占位
  5. `ai_chat_start`；listen `ai://chat-chunk` 追加 delta；done 时 `ai_append_message` 更新落盘
  6. 清除 pendingAttachment
- 停止：`ai_chat_cancel`

- [ ] **步骤 4：手动点一次发送（需用户自备 API）或 mock**

若无真实 key，可用临时 mock command 验证 UI；合并前保持真实代理。

- [ ] **步骤 5：Commit**

```bash
git commit -m "feat(ai): conversations UI and streaming composer"
```

---

### 任务 8：终端右键 + 投喂接通

**文件：**
- 修改：`src/components/XtermSession.tsx`
- 修改：`src/i18n/messages.ts`
- 可选：复用 `ContextMenuPortal`

- [ ] **步骤 1：在 xterm 容器上 `onContextMenu`**

```tsx
const hasSel = term.hasSelection()
const sel = hasSel ? term.getSelection() : ''
// 菜单：复制 / 全选 / 投喂 AI
```

- 复制：`navigator.clipboard.writeText(sel)`
- 全选：`term.selectAll()`（xterm API）
- 投喂：`invoke('ai_open_chat_window', { feedText: sel })`

无选区：复制、投喂 `disabled`。

- [ ] **步骤 2：AiApp mount 时**

```typescript
await listen('ai://feed', (e) => setAttachment({ kind: 'terminal-selection', text: truncateAttachment(String(e.payload)), createdAt: Date.now() }))
const pending = await invoke<string | null>('ai_take_pending_feed')
if (pending) setAttachment(...)
```

- [ ] **步骤 3：手动验证右键三项与投喂附件芯片**

- [ ] **步骤 4：Commit**

```bash
git commit -m "feat(term): context menu copy select-all feed AI"
```

---

### 任务 9：文案、样式打磨与回归

**文件：**
- 修改：`src/i18n/messages.ts`、`src/styles/ai.css`、必要时 `app.css`（菜单类名）

- [ ] **步骤 1：补齐中英文 key**（终端菜单、AI 侧栏/设置/发送/停止/空状态/错误）

- [ ] **步骤 2：对齐现有控件视觉**（`.btn`、`.modal`、边框、滚动条）

- [ ] **步骤 3：跑测试与 check**

```bash
pnpm test
cd src-tauri && cargo check
```

- [ ] **步骤 4：按规格测试清单手工过一遍**

- [ ] **步骤 5：Commit**

```bash
git commit -m "feat(ai): polish i18n and chat UI"
```

---

## 规格覆盖自检

| 规格项 | 任务 |
|--------|------|
| 独立 Webview `#/ai` | 3, 5 |
| 模型 CRUD / 激活 / 下拉 | 2, 6 |
| 历史一个月/更早、重命名、删除 | 1, 7 |
| 流式/思考/编程开关 | 4, 7 |
| 附件投喂格式与截断 | 1, 7, 8 |
| Rust 代理 + SSE + 停止 | 4, 7 |
| 终端复制/全选/投喂 | 8 |
| 非文本暂不支持 | 4, 7 |
| token 不进前端日志 | 4（Rust 读 token） |
| 已开窗口再投喂聚焦替换附件 | 3, 8 |

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-07-24-ai-chat-terminal.md`。两种执行方式：

**1. 子代理驱动（推荐）** — 每个任务调度一个新的子代理，任务间进行审查，快速迭代  

**2. 内联执行** — 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点  

选哪种方式？
