# Frontend Project Manager（FPM）全面审计报告

- **项目路径**：`D:\code\owner\frountend-project-manager`（Tauri 2 + React 19 + Vite 桌面应用，包版本 `0.4.5`）
- **审计方式**：只读审计，未改动任何源码。覆盖：结构地图 → 配置层（tauri.conf / capabilities / vite / package）→ Rust 后端逐模块（lib / git / pty / process / console_decode / bat_view / ide / jen_cli / scan / config / db / ai / fs_explorer / win_icon）→ 前端 TS/TSX（components / stores / ai / i18n / theme / styles / 入口）→ 脚本与发布管线（scripts / .github / README）
- **审计日期**：本次会话
- **总体结论**：安全基线良好（**无命令注入**），工程纪律值得肯定；但存在 **2 个严重（CRITICAL）任意文件读写漏洞、多个高危缺陷**，以及前端"上帝组件 + 零测试 + 裸字符串 IPC"的架构债。修复优先级与可行方案见文末。

---

## 目录

1. [严重程度总览](#1-严重程度总览)
2. [安全基线（已验证）](#2-安全基线已验证)
3. [严重（CRITICAL）](#3-严重critical)
4. [高危（HIGH）](#4-高危high)
5. [中危（MEDIUM）](#5-中危medium)
6. [低危（LOW）与提示（INFO）](#6-低危low与提示info)
7. [审计中排除的疑点](#7-审计中排除的疑点)
8. [工程亮点（务必保留）](#8-工程亮点务必保留)
9. [优化方案（按优先级 P0–P3）](#9-优化方案按优先级-p0p3)
10. [附录：文件级索引](#10-附录文件级索引)

---

## 1. 严重程度总览

| 级别 | 数量 | 主要分布 |
|---|---|---|
| **CRITICAL** | 2 | `fs_explorer.rs` 任意删除 / 任意写入 |
| **HIGH** | 8 | git 路径穿越、PTY 不杀进程树、GBK 拆对乱码、两处上帝组件、裸字符串 IPC、store 循环、零测试、AI 输入法回车误发 |
| **MEDIUM** | 15+ | 锁内阻塞、重复 exit 事件、bat_view 路径解析、IDE 参数引号、git 静默吞错、CSP 缺失、权限未按窗口拆分、i18n 缺口等 |
| **LOW / INFO** | 30+ | 缓存失效、HICON 泄漏、文档失真、死代码、重复基础设施等 |

---

## 2. 安全基线（已验证）

**最正面的结论：不存在命令注入。**

- 所有 git / jen-cli / ide 子进程均以 **argv 向量** 启动；分支名、提交信息、ref、路径等用户输入从不进入 shell 解释器。
- `jen_cli.rs` 本身**不拉起** vendor 二进制（审计中已纠正初判）：它只管理配置 / PATH / env；vendored `vendor\jen-cli\` 由用户终端经透传 shim（`%*` / `"$@"`）启动，Rust 侧无注入点。
- **唯一的 shell 字符串路径**是用户自己输入的终端命令（`cmd /S /C "chcp 65001>nul & {command}"`，见 `process.rs:277-289`）——这是产品功能本身，意味着 **WebView 是设计使然的 RCE 边界**：WebView 任一 XSS = 完全代码执行。因此 **CSP 缺失（M8）与 fs_explorer 任意文件操作（C1/C2）被放大为最高优先级**。

---

## 3. 严重（CRITICAL）

| # | 问题 | 位置 | 影响与修复方向 |
|---|---|---|---|
| **C1** | **delete_path：任意路径递归删除** | `src-tauri\src\fs_explorer.rs:450-461`（命令注册 `lib.rs:499`） | `remove_dir_all` / `remove_file` 直接作用于前端传入的 `path`，**无 canonicalize、无工作区包含校验、`..` 可穿越**。WebView 侧可删除任意目录/文件（含用户文档、配置）。**修复**：canonicalize 后校验必须位于允许的工作区根目录内，拒绝穿越与符号链接逃逸；删除前先入回收站（trash-first）。 |
| **C2** | **write_text_file：任意路径覆盖写入** | `src-tauri\src\fs_explorer.rs:500-517` | `create_dir_all` + `fs::write` 可覆盖任意文件、自动创建任意父目录，无包含校验。WebView 侧可篡改任意文件。**修复**：与 C1 共用同一"sanitize + contain"闸门，写入原子化（临时文件 + rename）。 |

> 二者暴露面：`capabilities/default.json:44-50` 将 `allow-delete-path / allow-write-text-file / allow-rename-path / allow-read-text-file / allow-create-directory` 同时授予主窗口与 ai-chat 窗口；配合 `security.csp: null`（M8），任一窗口 XSS 即可任意毁坏文件。

---

## 4. 高危（HIGH）

### 后端（3 项）

| # | 问题 | 位置 | 影响与修复方向 |
|---|---|---|---|
| **H1** | **Git merge/diff 文件参数路径穿越** | `src-tauri\src\git.rs:1620-1625, 1677-1683, 1735-1739`（命令注册 `capabilities/default.json:37-43`） | 前端 `file` 参数直接 `Path::join` 到仓库路径后 `fs::read` / `fs::write`，无包含校验：`git_merge_resolve_content` 可**写入仓库外任意文件**，diff/merge 读取可**外泄任意文件**。**修复**：canonicalize 两侧并 `starts_with(repo_root)` 后才允许 fs 操作。 |
| **H2** | **PTY kill 不杀进程树 → 孤儿进程** | `src-tauri\src\pty_term.rs:95-103, 283-298` | 关闭终端页/退出应用仅 `killer.kill()` 直接子进程（shell），孙进程（`npm run dev`、node 监听、构建服务）成为孤儿继续后台运行。`kill_tree` crate 已在 `Cargo.toml:27` 且 `process.rs:43` 已用——**只是 pty_term 没接**。**修复**：kill 前/后对 PTY 子进程 pid 执行 `kill_tree`。 |
| **H3** | **GBK/DBCS 双字节对跨读取边界拆散 → 乱码** | `src-tauri\src\console_decode.rs:52-60, 93-103`（同型：`src-tauri\src\ai\chat.rs:265` 用 `String::from_utf8_lossy` 解码 SSE 分块） | `ansi_incomplete_trail` 只检查末字节 ∈ `0x81..=0xFE`，而**该区间同时覆盖首/尾字节**：完整 GBK/Shift-JIS/Big5 码对若恰好在读取边界结束（尾字节落此区间）会被误留、与下一块错配；GB18030 4 字节序列在 `0x30-0x39` 处断开也不携带 → 中文 Windows 主用户高频看到 `�`（如"中文"→"中��"）。**修复**：按编码保存未完成尾字节跨读取（保留"完整对"判定），SSE 用增量解码。 |

### 前端（5 项）

| # | 问题 | 位置 |
|---|---|---|
| **H4** | `Explorer.tsx` 上帝组件：**1746 行 / 66KB**、15 处直接 invoke、读 7 个 store、内嵌 6 个弹窗 | `src\components\Explorer.tsx` |
| **H5** | `GitToolPanel.tsx` 二号上帝组件：**980 行**、11 处 invoke | `src\components\GitToolPanel.tsx` |
| **H6** | **IPC 全裸字符串**：92 命令 / 145 处 `invoke('cmd',…)`（组件 79 / store 58 / lib 7 / ai 1），无 codegen 层；**7 个死命令**仍注册（`run_command`、`kill_command`、`write_terminal_stdin`、`detect_ides`、`pick_image`、`preview_file`、`set_project_tags`） | `src-tauri\src\lib.rs` + 全 `src\` |
| **H7** | `settingsStore` ↔ `workspaceStore` **循环引用 + 跨 store 双重写 git 缓存**，靠强制重渲染补丁掩盖（`App.tsx:67-74`、`sessionStore:160-163`） | `src\stores\settingsStore.ts`、`workspaceStore.ts` |
| **H8** | **前端零测试**；后端仅 10 个单元测试（console_decode 4 / bat_view 3 / chat 3）；CI **无测试、无 lint** 步骤（oxlint ^1.77 已配置却未接入）；另有 AI 窗口输入法缺陷（见下） | 全仓库 + `.github\workflows\release.yml` |

**AI 窗口额外高危：**

| # | 问题 | 位置 |
|---|---|---|
| **H9** | **AiComposer Enter 发送无 IME 合成守卫**：`onKeyDown` 仅判 `key==='Enter' && !shiftKey`，未判 `isComposing`/keyCode 229。拼音输入法选字回车会**提前发送半截草稿**（本项目为中文优先、依赖 pinyin-pro） | `src\ai\AiComposer.tsx:42-47`（`AiMessageList.tsx:147-156` 编辑框需 Ctrl/Cmd，风险较低） |

---

## 5. 中危（MEDIUM）

### 后端（10 项）

| # | 问题 | 位置 |
|---|---|---|
| **M1** | `kill_session_locked` **持全局 SESSIONS 锁执行阻塞 kill/wait**（kill_tree + child.kill + child.wait，无超时）→ 一个卡住子进程拖垮所有终端操作 | `process.rs:56-71, 177-199, 218-227`（同型：`pty_term.rs:250-264`、`process.rs:203-214` stdin 写） |
| **M2** | **PTY write() 持全局锁执行阻塞 write_all/flush**——ConPTY 缓冲区满时阻塞所有终端的 spawn/resize/kill | `pty_term.rs:250-264` |
| **M3** | **重复 `pty://exit` 事件**：`kill()` 发一次（code None），wait 线程再发真实 code；spawn 预杀（124-126）可能对复用 id 误发 → 前端重复移除标签 | `pty_term.rs:238-244, 289-295` |
| **M4** | **bat_view 分词器把 `\` 当转义**：`cat "C:\foo\bar.txt"` → `C:foobar.txt`，Windows 首要平台功能破损 | `bat_view.rs:143-176` |
| **M5** | bat_view **无大小上限整读文件**（大/二进制文件 OOM 风险），且把 glob（`*.txt`）与设备名（`nul`）当字面路径 → 假"文件不存在" | `bat_view.rs:22-32, 99-131`（对照：`fs_explorer.rs:31` 已有 2MB 上限） |
| **M6** | **IDE args_template 用 `split_whitespace` 切分**：`--folder "{path}"` 把引号字面量塞进 argv，含空格路径无法表达 | `ide.rs:1207-1211`（改用单 argv 项/引号感知切分） |
| **M7** | **git 失败被 `.ok()` 吞掉**：分支/状态列出错显示"无分支/干净"，掩盖仓库损坏或 git 未安装 | `git.rs:202-215, 277-291, 355-413`（另有 ~9 处：202-215, 260-265, 277-291, 302-315, 419-424, 570-576, 960-968, 993-1001, 1356-1374） |
| **M8** | `security.csp: null` + `index.html`/`ai.html` 运行时拉取 **fonts.googleapis.com**（离线桌面应用的外网依赖，配合 I6 放大 RCE 影响） | `src-tauri\tauri.conf.json:27-37`、`index.html`、`ai.html` |
| **M9** | **单 capability 将 ~90 个 allow-* 权限同时授予主窗口与 ai-chat 窗口**，含破坏性 fs 权限（delete/write/rename/create/read-text-file） | `src-tauri\capabilities\default.json:5-6, 10, 44-50` |
| **M10** | `scan.rs` 每项目整读 README 无上限（`read_readme_display_name`），大工作区 `list_projects` 内存无界 | `scan.rs:63, 169-184` |

### 前端（5 项）

| # | 问题 | 位置 |
|---|---|---|
| **M11** | **EditorShell 保存竞态丢按键**：`save()` 捕获渲染闭包中的 `activeDoc.value`，写盘期间的新键入不会进捕获串，`markDocSaved` 又按新内存值重新基线 → 磁盘陈旧但脏标记被清，退出即静默丢数据 | `src\components\EditorShell.tsx:86-101` |
| **M12** | `closeTabsUnder` 直连 `editor.closeTab` **绕过脏确认**（其余关闭路径都走 `closeEditorFile.ts`）——重命名/删除含未保存编辑的目录静默丢弃改动 | `src\components\Explorer.tsx:330-339`（调用点 368/388/432/460） |
| **M13** | `onToggleProject` 对**每次**项目行点击（含折叠、重复点击已选中项）都 `selectProject` → 重置 git 状态 + 3~4 次 IPC 重扫；工作区点击同理 | `src\components\Explorer.tsx:573-600, 570` |
| **M14** | `scanAllProjectStatuses` 对每项目并发 `git_fetch+status+branches`（Promise.all **无并发上限**），100+ 仓库工作区瞬间数百并发 git 进程（fetch 联网） | `src\stores\workspaceStore.ts:340-383`（同型 219-224, 272-281） |
| **M15** | **aiStore 失败残留空助手气泡 / 状态不清理**：发送失败或首 token 前出错，`pending-*` 占位气泡永久留存；`chunk.error` 分支不清 `streamingAssistantId`；`stopGeneration` 只在后端成功时才复位（cancel 为静默 no-op 时按钮永久转圈） | `src\stores\aiStore.ts:551-564, 617-623, 659-725, 577-589`；`chat.rs:115-120, 311` |

### 配置 / 构建（4 项）

| # | 问题 | 位置 |
|---|---|---|
| **M16** | 主包 **4.4MB**（ts.worker 5.7MB）：无 `manualChunks`、monaco 静态整包引入 | `vite.config.ts`（加 vendor 分包 + monaco 动态导入；**monaco 0.52.2 钉死为刻意，勿动**） |
| **M17** | `workspaceStore.updateProjectStatus` 在 `set()` 更新器内调用 `persistStatuses`——快照计算中做副作用，StrictMode 双触发风险 | `src\stores\workspaceStore.ts` |
| **M18** | **sync-version.mjs 非原子**：先写 package.json / tauri.conf.json，后校验 Cargo.toml；失败时前两者已改、Cargo 未改 → 中间态 | `scripts\sync-version.mjs:31-49`（应：先校验/替换 Cargo，再写三个文件） |
| **M19** | **setup-nsis.mjs 与 tauri-bundler 版本漂移**：NSIS 3.11 + SHA1 硬编码；hash 不匹配仅告警照常部署，dll 不匹配则"构建时重新下载"——"永不触网"承诺被静默打破；缓存不完整时 `rmSync` 整个 NSIS 目录 | `scripts\setup-nsis.mjs:33-37, 83-112` |

### AI / i18n / 主题（4 项）

| # | 问题 | 位置 |
|---|---|---|
| **M20** | **apiStore 双挂载竞态**：`ai-main.tsx` 开启 StrictMode（主入口刻意关闭），dev 下 AiApp 双挂载 → 两次 `startAiListeners()` 并发 await `listen` 并写共享 `unlistenChunk/unlistenFeed` 模块变量 → chunk 监听器泄漏 / 流式文本双份追加 | `src\ai-main.tsx:17`、`src\stores\aiStore.ts:38-39, 591-604` |
| **M21** | i18n **单文件 48.8KB / 1119 行**、translate 变量无类型、无 ICU/复数 | `src\i18n\messages.ts` |
| **M22** | **i18n 覆盖缺口**：`lib\aiChat.ts` 硬编码 `'新对话'`、`PROGRAMMING_SYSTEM_PROMPT`、`'[终端选区]'`；`lib\ptyHost.ts` 硬编码 `'终端尚未就绪'`；大量 Rust 错误串（`process.rs:206/214`、`pty_term.rs:131/144/154/260/271/279`、`bat_view.rs:17/24/27/29/56`、`git.rs` 多处中文）直接跨 IPC 透传，EN 用户看到中文 | `src\lib\*`、`src-tauri\src\*.rs` |
| **M23** | **API 令牌明文落盘 + 全量回传**：AI 配置（含 token）以明文 JSON 存 SQLite kv；`setSelectedModelId` 每次选择变更都整包 `ai_save_config` 回传（含令牌） | `src\stores\aiStore.ts:216-225, 274, 312`；`db.rs:122-125`；`ai\store.rs:117-120` |

---

## 6. 低危（LOW）与提示（INFO）

### 低危（LOW）

**后端：**

- **L1** 遗留管道终端栈 `process.rs`（344 行）已被 pty_* 取代但仍注册——与 H6 的 3 个死命令同源，删除或显式废弃（`process.rs` vs `pty_term.rs` 双栈分叉也正是 H2 来源）
- **L2** 分支/ref 参数以裸 argv 传递且无 `--end-of-options`，以 `-` 开头时被 git 当选项解析（`--abort`/`--all` 混淆；无 shell 参与）— `git.rs:706, 763, 1564`（分支名校验仅拒 `..`/空格/`\`：`git.rs:816, 474-486, 903-906`）
- **L3** porcelain v1 解析脆弱：`rest.trim()` 剥掉文件名真实首尾空格（污染后续 `git add`）；`split_once(" -> ")` 误拆含 `" -> "` 的重命名目标；`core.quotePath` 转义的非 ASCII 文件名未反转义 → 错误路径进 UI — `git.rs:623-646`
- **L4** 假定 `.git` 是目录（`path/.git/MERGE_HEAD`），linked worktree / submodule 下合并检测静默失效 — `git.rs:356, 1348-1354`
- **L5** Stage/HEAD 读取错误折叠成空串（`unwrap_or_default` / `Ok(String::new())`），"文件不在 HEAD"与真实 git 错误混淆，UI 无感知 — `git.rs:1617-1619, 1664-1676`
- **L6** **HICON 句柄从不 DestroyIcon**：注释（`win_icon.rs:66`）声称 WM_SETICON 转移所有权——实际不转移，每次 `apply_window_icons` 泄漏 1–2 个句柄 — `win_icon.rs:14-41, 63-79`
- **L7** `NODE_PROBE` / `USER_PATH_CACHE` 进程级缓存永不刷新：装 node 或外部改 PATH 后新 PTY 感知不到，须重启 — `jen_cli.rs:40, 292-298, 466-469`；`STATUS_RELATIVE` 探测进程级缓存 — `git.rs:19-22, 51-69`
- **L8** `set_path_enabled` 无条件把用户 PATH 写成 `REG_EXPAND_SZ`（若原是 REG_SZ 会改类型）；Jenkins apiToken 明文 JSON 落盘 — `jen_cli.rs:274-279, 402-471`
- **L9** `preview_file` 命令把未净化路径 join 到 cwd（绝对路径经 `Path::join` 语义整体替换 base）→ 无约束读出口 — `lib.rs:615-627`（与 H1 同闸门修复）
- **L10** `resolve_import` `.await.ok().flatten()`、`detect_ides`/`list_installed_editors` `unwrap_or_default` 静默吞掉 spawn_blocking 错误 — `lib.rs:520-532, 629-641`
- **L11** `clear_all_project_cache` 先清 DB 缓存再存配置，保存失败留下不一致部分态 — `lib.rs:210-225`
- **L12** `list_projects` `entries.flatten()` 静默丢弃 read_dir 错误 — `scan.rs:175-181`
- **L13** `touch_list`：pinned 项超过 HISTORY_LIMIT(40) 时不裁剪 → 列表无界 — `config.rs:229-237`
- **L14** `read_text_file` TOCTOU（先 metadata 再整读，文件可超 2MB 上限）；`write_text_file` 非原子（崩溃截断目标）— `fs_explorer.rs:477-485, 511-516`
- **L15** `config.rs` 损坏/不可解码 kv 经 `?` 传播 → 所有配置命令硬失败无回退；`kv_get_json` 把解析失败当缺失 — `config.rs:172-190`、`db.rs:112-120`
- **L16** `db.rs` 无 schema 版本化：IF NOT EXISTS + 无条件吞 ALTER；无 `PRAGMA user_version` — `db.rs:29-60, 62-78`
- **L17** 全局单 `Mutex<Connection>` 串行化所有 DB 访问；`load/save_config`、`load/save_layout`、`load/save_session` 等同步命令在**主线程**等锁（背后有后台 AI/reqwest 工作）— `db.rs:11, 80-86`、`lib.rs:43-51, 134-142, 177-185`
- **L18** `run_command`/`pty_spawn` 是同步命令 → 子进程/PTY 在主线程 spawn — `lib.rs:534-542, 554-563`（改为 spawn_blocking）
- **L19** `ai\chat.rs:265` SSE 分块 `from_utf8_lossy` 断码点 → 流式 CJK 出现 `�`（H3 同型）
- **L20** `process.rs:339-371` watcher 线程每 80ms `try_wait` 轮询并反复重取全局锁
- **L21** `git.rs:1671-1676` `git show` 失败与"未跟踪→空"混淆，掩盖真实读错
- **L22** `config.rs:108, 154` 迁移期 `fs::copy` 错误 `let _` 忽略 → 部分数据丢失风险

**前端：**

- **L23** `MonacoDiffEditor` 创建后 `readOnly`/theme 变更不生效（无重挂载/重涂等效）；无调用方触发，潜在 — `MonacoDiffEditor.tsx:43-99`
- **L24** `XtermSession` 从**不可信终端输出**解析出的文件路径未校验即 `reveal_in_file_manager` / `openTab`（恶意日志行如 `C:\Windows\...`、UNC 路径可被打开）；`openFilePath` 用会话 cwd 当 `projectPath` 对项目外路径是错误的 — `XtermSession.tsx:237, 431, 439`
- **L25** `GitToolPanel.tsx:264` 用 `err.includes('已切换')/includes('已创建')` 匹配后端中文错误串决定关不关弹窗——后端改文案即坏，前后端耦合到 locale
- **L26** `Explorer.tsx:1265-1266` 查看日志用 `projGitCurrent ?? 'HEAD'`，无 `projGitInfo.path === menu.path` 守卫（异步竞态下对 B 项目用 A 的分支名）— 对照 1167 行有守卫
- **L27** `settingsStore.saveWorkspaces` 无 `isTauri()` 守卫（其余兄弟 setter 都有）+ `confirmRemove` await 无 try/catch → 浏览器预览模式 unhandled rejection — `settingsStore.ts:158-164`、`Explorer.tsx:287-297`
- **L28** 硬编码中文：`ErrorBoundary.tsx:31,37`、`FileDiffModal.tsx:56`（'文件不在项目范围内' 原样展示）、`aiStore.ts:288`（'新对话'）——未走 messages.ts
- **L29** `Explorer` `toggleTimerRef`（250ms 防抖）卸载时未清 → 卸载后 setState；且防抖故意吞双击（快速双击项目行是 no-op，验证意图）— `Explorer.tsx:156-171`
- **L30** 错误 UX 四套并存：`window.confirm` / `window.alert` / 可复制 `showErrorLog` 弹窗 / 行内 banner——同类错误展示不一致（保存错行内、git 错弹窗）
- **L31** `terminalStore` 模块级 `lastCommandMap` 仅在 git 命令完成时删除，会话中途关闭即泄漏（字符串，小）— `terminalStore.ts:55, 314-316, 145-165`
- **L32** `MonacoEditor` 模块级 `preloadedFiles: Set` 永不裁剪，长会话无界增长 — `MonacoEditor.tsx:45`
- **L33** `editorStore` 的 `dirtyPath`/`setDirtyPath` 是死状态（无外部读者，脏状态已由 docs 派生）— `editorStore.ts:32-34, 50-51, 165, 173-181`
- **L34** `Explorer` 的 `dirCache` 在 useState 与 ref 双写同步（仅为了触发渲染），双写类 bug 温床 — `Explorer.tsx:114-117, 205-241`
- **L35** 路径归一化三份拷贝：`normalizeProjectPath`（terminalStore:23-25）、`normPath`（workspaceStore:84-86）、内联 `norm`（TerminalPanel:53）；`localName` 两处重复 — 抽到 lib
- **L36** `Explorer` 安全网 effect 依赖 `dirCache`/`dirErrors` → 每次目录加载全量重扫所有展开目录 O(expanded)；依赖可收窄
- **L37** `AiModelSettingsModal.tsx:51,125,170` `void toggleActive/removeModel` 不 catch → `saveConfig` 失败成 unhandled rejection 且无可见错误
- **L38** 明文令牌编辑面：Jenkins apiToken（`JenCliSettingsModal.tsx:383-393`）与 JSON 模式 textarea（419-438）编辑时明文展示（设计使然，可考虑遮蔽）
- **L39** 前端**无任何 `isPathUnder(project)` 客户端校验**——破坏性 invoke 全凭后端路径（多数来自后端目录列表较可信，但终端/git 输出解析路径不可信，见 L24）

**脚本 / 配置：**

- **L40** `sync-version.mjs` 不同步 `Cargo.lock` 根 crate 版本 → `--locked` 构建失败 / lockfile 静默滞后
- **L41** `sync-version.mjs:41-47` Cargo.toml 正则未锚定 `[package]` 段（现恰好命中，未来首个行首 `version=` 会被误改）
- **L42** `setup-nsis.mjs:92-100, 117` 全新 clone 缺 `libs/` 直接 fail（即使有网）；依赖 bsdtar（Win10+ 才有）；CI 从不走此脚本，离线机制仅限本地构建
- **L43** `ui-preview.html`（1139 行）**死重量**：不在 vite rollup inputs（仅 index/ai），内嵌 `D:\code\owner` 硬编码路径 + 重复 Google Fonts 拉取——删除或移入 docs/
- **L44** `package.json:22` `tauri:preview` → `tauri preview` 不是 Tauri v2 CLI 子命令（应 `vite preview` 或删）
- **L45** `release-tag.mjs` 读 package.json 而 release.yml 从 tag/tauri.conf 取版本，双源真相（同步脚本保持一致时无害）
- **L46** `release-tag.mjs:85-90` `bump()` 对 `0.4.5-rc.1` 前缀版本产生 `NaN`
- **L47** `jen-cli.defaults.example.json` 含真实内部值（`system3_Front_docker1/2/3/4`、`uat5`、`txProd`）而非占位符，且首次运行会写入用户配置目录
- **L48** `public\icons.svg` 无引用死资产；`package.json` 缺 `packageManager` 字段（CI 钉 11.7.0，本地可能不一致）
- **L49** README 失实：声称用 **Zustand**（实为手写 `src\lib\createStore.ts`，无该依赖）；描述已删除 DetailPane 面板的 env 特性
- **L50** `createStore` 无 persist 中间件，5 个 store 手写防抖/持久化且策略不一（200ms / 500ms / fire-and-forget / await）

### 提示（INFO）

- **I1** PTY 读循环 pending 缓冲无上限（decode 持续返回 consumed=0 时无限增长）— `pty_term.rs:184-206`
- **I2** 进程树清理双重杀（`kill_tree` + `taskkill /T /F`）冗余，且都在全局锁内增加阻塞时间 — `process.rs:42-54`
- **I3** 死函数 `is_alive` 被 `#[allow(dead_code)]` 掩盖 — `pty_term.rs:301-304`
- **I4** `CREATE_NO_WINDOW` 常量 + `git_no_window` 助手在 4 个模块重复定义（git.rs:12,24-29 / process.rs:19 / ide.rs:10 / jen_cli.rs:17,204-210）——抽公共 spawn 工具
- **I5** 两套终端栈逻辑分叉（process.rs vs pty_term.rs）：重复的会话注册表/杀进程/写管道，且分叉正是 H2 来源
- **I6** WebView 是**设计使然**的 RCE 边界：`cmd /S /C "chcp 65001>nul & {command}"`（process.rs:277-289）——用户终端输入即 shell，这是产品功能；但任何 XSS = 全代码执行，故 M8/C1/C2 优先级最高
- **I7** `now_ms()` 双份（db.rs vs config.rs）、std Mutex vs parking_lot 不统一；`role_str→AiMessageRole` 匹配双份（未知角色静默变 User）
- **I8** `fs_explorer`：`.d.ts` 检查冗余（`.ts` 已覆盖）；`has_known_ext`/路径多处字符串拼接混 `/` 进 Windows `\` 路径（应 Path::join）
- **I9** `config.rs:198-200` tag_key `"workspace::folder"` 分隔符与含 `::` 的名称冲突
- **I10** `db.rs:480-534` `ai_delete_message` 按 created_at 排序，同毫秒时间戳可能错配下一条 assistant/夹层 user 消息（按 rowid 决胜）
- **I11** `lib.rs:777-786` `pick_file_in_directory` 把不可信目录串直接传给 dialog `set_directory`（先校验存在）
- **I12** `tauri_plugin_shell::init()` 已注册但范围内代码未用；`lib.rs:1030` 最终 `.expect` 属常规
- **I13** `config.rs:387-407` load/save_project_statuses 每次调用 info! 刷屏；存 schema-less JSON（降 debug! + 形状校验）
- **I14** `load/save_project_statuses`、`ai_save_config` 等命令走 DB 全局锁（见 L17），且保存格式无版本/形状约束
- **I15** 双入口壳重复：`main.tsx`（刻意关 StrictMode，文档化原因）/ `ai-main.tsx`（开 StrictMode）——提取共享 `bootstrapApp()` 让选择只写一处（顺带消 M20）
- **I16** `src\ai\AiApp.tsx:9` AI 窗口整包引入 3321 行 `app.css`（主窗口 topbar/explorer/terminal 样式）——AI 包死重 + 类名碰撞面（`.panel`/`.muted`/`.settings-*`）

---

## 7. 审计中排除的疑点

| 疑点 | 结论 |
|---|---|
| SQL 注入 | **无**——所有 rusqlite 语句用绑定参数，全 `src/` 未发现 `format!` 拼 SQL |
| 死锁 | **无**——无 db/config 调用嵌套在 `with_conn` 或 `CONFIG_IO` 闭包内 |
| 关键路径 unwrap/expect | **无**——仅应用级 `lib.rs:1030` 常规 `.expect` |
| `strip_readme_title_line` / `apply_alias` 字节切片 panic | **安全**——切片总落在已校验的 ASCII/字符边界 |
| 事件/监听泄漏 | **无**——范围内文件无 listen/emit 注册（前端 aiStore 监听竞态见 M20，为前端侧问题） |
| Windows 盘符根逃逸（join_relative 的 `..`） | 有界——`pop()` 停在盘符根，无法越过 `C:\`；仅剩相对 from_file 场景（已在 H1 同级覆盖） |
| FK/级联 | 正确——`ai_messages ON DELETE CASCADE` + `PRAGMA foreign_keys=ON`；显式消息删除冗余但安全 |
| 每调用新建 DB 连接 | 不存在——单共享连接（真正的关切是 L17 串行化，不是泄漏） |
| zustand 依赖 | **不存在**——手写 createStore（README 文档失真，L49）；tauri-specta/codegen 亦不存在（裸字符串 IPC 是现实架构，H6） |
| store 数量 | **11 个文件**（非 12）；settings↔workspace 循环今天**不崩溃**（跨 store 访问是惰性 `getState()`），定级"脆弱性"而非"故障" |

---

## 8. 工程亮点（务必保留）

- **`lib.rs` 纪律**：92 个命令全部一行委托 + `spawn_blocking`，IPC 面扁平可审（问题是缺类型，不是结构）
- **`db.rs`**：WAL + 外键 + JSON/localStorage 迁移 + ALTER 列回填，schema 演进规范
- **平台工程**：WebView2 异步建窗规避死锁（`ai\window.rs`）；主窗口关 StrictMode 防 pty 双挂载（`main.tsx:6-12` 文档化）；`chcp 65001` UTF-8 处理；git `--relative` 运行时探测 + 失败回退（`STATUS_RELATIVE_DENIED`）
- **git.rs 解析**：结构化输出（`--porcelain=v1`、`-z`、%x1e/%x1f 日志分隔）、`--relative` 特性探测、运行时回退
- **console_decode**：先保 UTF-8 前缀再 ACP 回退（避免经典 娓呯┖ 乱码）；EOF/flush 路径解码正确；**有单元测试**
- **jen_cli**：注册表访问避开 PowerShell（WM_SETTINGCHANGE 死锁）、生成的 PS 脚本转义单引号；`ide.rs` 用原始 `explorer /select,"…"` token 防路径误解析；资源解析三候选路径 + dev 回退
- **win_icon**：对齐 tao 的 alpha→AND-mask 反转、32bpp 图标使旧掩码失效
- **process.rs**：`try_wait` watcher + kill 全量收割、Windows 树杀完整——无僵尸累积（这点比 pty_term 强，见 H2）
- **AI 前端**：零 `dangerouslySetInnerHTML`（纯文本渲染）；所有 `t()` 键可解析、en 目录 TS 强制与 zh 逐键一致；窗口关闭中途取消流（Rust `lib.rs:915-924` + 前端 unmount `stopGeneration` 双保险）；令牌遮蔽输入 + `autoComplete="off"` + 从不打印、仅 Bearer HTTPS 发送、编辑模型保留未动令牌
- **发布管线**：离线 NSIS 部署、三处版本号同步（当前一致 0.4.5）、release.yml 矩阵 + 草稿 + pkgbuild + publish；`release-tag.mjs` 的脏树检查/标签冲突检查/注解标签
- **文档纪律**：docs/superpowers 每个功能有 spec+plan；关键风险处有解释"为什么"的内联注释；tsconfig 工程引用正确；oxlint 配置最小且合理
- **UI/UX 细节**：token 速率/TTFT 实时统计、`estimateTokens` 集中化、`ModalShell` 层级抬升 + `destroyOnHidden`、Monaco model 复用避免重复 TS 校验、preload 限流、minimap 按宽度切换

---

## 9. 优化方案（按优先级 P0–P3）

### P0 — 安全与数据完整性（先做；全部小改动、多无新依赖）

| 步骤 | 内容 | 工作量 |
|---|---|---|
| 1 | **C1/C2 + H1**：为 fs_explorer 全部 fs 命令（delete/write/rename/read/create/list）与 git merge/diff 文件参数建立统一 `sanitize + contain` 闸门（canonicalize 后 `starts_with(允许根)`，拒穿越/符号链接逃逸），写入原子化（临时文件 + rename），删除先入回收站 | 1–2 天 |
| 2 | **M8**：配置真实 CSP（自托管字体到 `public/` 后收紧 `default-src 'self'`；字体未自托管前至少显式白名单 fonts.googleapis/gstatic） | 0.5 天 |
| 3 | **H3（含 L19）**：`console_decode` 按编码保存未完成尾字节跨读取，补边界单元测试；SSE 改增量解码 | 0.5–1 天 |
| 4 | **H2 + M1/M2/M3 + I2**：PTY 栈接 `kill_tree`（依赖已在）；阻塞 kill/write 移出全局锁；`pty://exit` 单源（仅 wait 线程发一次）；顺带评估合并双终端栈（I5） | 1–2 天 |
| 5 | **M9**：capability 按窗口拆分（main / ai-chat 各自最小权限，ai-chat 仅 core 基础 + ai-* + 事件 + 窗口控制） | 0.5 天 |

### P1 — 可靠性与正确性

| 步骤 | 内容 | 工作量 |
|---|---|---|
| 6 | **M4/M5**：bat_view 反斜杠路径修正（引号外不剥 `\`）+ 2MB 大小上限（复用 `fs_explorer.rs:31` 模式）+ glob/设备名透传给 shell | 0.5–1 天 |
| 7 | **M7/L2–L5/L21**：git 错误经 `map_err` 上抛代替 `.ok()` 吞错（~10 处）；分支/ref 加 `--end-of-options`；porcelain 解析不 trim 文件名、`-z` 处理重命名、反转义 quotePath；兼容 `.git` 文件（worktree） | 1–2 天 |
| 8 | **H6 前半 + L1**：删除 7 个死命令 + 废弃/删除遗留管道终端栈 `process.rs`（连带清理 capabilities 与 lib.rs 注册） | 0.5 天 |
| 9 | **M6**：IDE args_template 引号感知切分（`{path}` 单 argv 项） | 0.5 天 |
| 10 | **M11/M12/M13/M14**：EditorShell 保存快照比对、closeTabsUnder 走脏确认、onToggleProject 守卫 `selectedProject?.path`、workspaceStore 并发限流（分块 worker 4–8） | 1 天 |
| 11 | **M15/M20**：aiStore 错误分支清理占位气泡与 `streamingAssistantId`、`stopGeneration` 乐观复位；ai-main 去 StrictMode（与主入口一致）或监听器代际令牌化 | 0.5–1 天 |
| 12 | **L6/L7/L8 前半**：HICON 缓存 + DestroyIcon；`NODE_PROBE`/`USER_PATH_CACHE` 失效钩子；PATH 注册表值类型保留 | 0.5–1 天 |

### P2 — 可维护性与质量门禁

| 步骤 | 内容 | 工作量 |
|---|---|---|
| 13 | **H4/H5**：拆分 Explorer.tsx（先抽 6 个内嵌弹窗，再抽树视图/预览面板）与 GitToolPanel.tsx | 2–3 天 |
| 14 | **H7**：新建独立 git 缓存 store 切断 settings↔workspace 循环；删除 App/sessionStore 重渲染补丁 | 1 天 |
| 15 | **H6 后半**：为 92 命令引入类型化 IPC 包装层（手写类型映射或 tauri-specta 类 codegen） | 2–3 天 |
| 16 | **H8**：CI 接入 oxlint + `tsc -b` + 首批 vitest（先覆盖 store 与纯函数：createStore/terminalStore/workspaceStore/console_decode 前端对应物）；后端测试补齐 git 路径校验用例 | 1 天 |
| 17 | **M16/M17/I15**：vite vendor 分包 + monaco 动态导入（**monaco 0.52.2 钉死勿动**）；persistStatuses 移出 set() 更新器；提取 `bootstrapApp()` | 1 天 |
| 18 | **M21/M22/L28/L49**：i18n 按域分文件 + 类型化变量 + 补硬编码缺口（含 Rust 错误串走错误码）；修正 README（Zustand 失实、DetailPane env） | 1 天 |
| 19 | **M23/L38**：令牌改 OS keyring/DPAPI（或至少独立加密存储）；选择变更只持久化 `{id,lastModelId}` | 1–2 天 |
| 20 | **M18/M19/L40–L42**：sync-version 原子化 + 锚定 [package] + 同步 Cargo.lock；setup-nsis 失败硬启/按文件清理 | 0.5–1 天 |

### P3 — 卫生与长期

| 步骤 | 内容 |
|---|---|
| 21 | L24 客户端路径校验（`isPathUnder`）；L25 后端结构化状态代替文案匹配；L26–L36 前端各低危清理 |
| 22 | L43 移除 ui-preview.html；L44 修正 tauri:preview；L45–L48 版本源统一、semver 解析、示例脱敏、icons.svg 清理、packageManager 字段 |
| 23 | I3/I4/I7–I14 死代码与常量去重、公共 spawn 工具、DB 锁细化（per-domain 连接或 async 访问）、watcher 事件化替代 80ms 轮询 |
| 24 | M10/L12/L13/L15–L18 后端低危批量清理（scan 读上限、config 回退、schema 版本化、主线程命令 spawn_blocking） |

**明确不建议**：升级 `monaco-editor` 脱离 0.52.2（该钉死是刻意的）；在未先完成 P0 的情况下对 `process.rs` 大改（其树杀逻辑是 pty_term 的参照实现）。

---

## 10. 附录：文件级索引

### 后端 Rust（src-tauri\src\）
| 文件 | 规模 | 关键发现 |
|---|---|---|
| `lib.rs` | 1031 行 | H6（92 命令）、L9/L10/L11/L17/L18、I12/I14 |
| `git.rs` | 1838 行 | **H1**、M7、L2–L5、L21、I4 |
| `pty_term.rs` | 304 行 | **H2**、M1/M2/M3、I1/I3 |
| `process.rs` | 374 行 | L1（遗留栈）、M1、I2/I5/I6 |
| `console_decode.rs` | 147 行 | **H3**（有 4 测试） |
| `bat_view.rs` | 204 行 | M4/M5（有 3 测试） |
| `ide.rs` | 1314 行 | M6 |
| `jen_cli.rs` | ~470 行 | L7/L8、I4 |
| `scan.rs` | ~180 行 | M10、L12 |
| `config.rs` | ~410 行 | L13/L15/L22、I9/I13 |
| `db.rs` | ~540 行 | L16/L17、I7/I10 |
| `fs_explorer.rs` | 517 行 | **C1/C2**、L9/L14、I8 |
| `win_icon.rs` | 80 行 | L6 |
| `ai\chat.rs` / `ai\store.rs` / `ai\window.rs` | — | L19（SSE 断码点）、M23（明文令牌） |
| `main.rs` | 183 行 | — |

### 前端（src\）
| 文件 | 规模 | 关键发现 |
|---|---|---|
| `components\Explorer.tsx` | 1746 行 | **H4**、M12/M13、L26/L27/L29/L34/L36 |
| `components\GitToolPanel.tsx` | 980 行 | **H5**、L25 |
| `components\EditorShell.tsx` | — | M11 |
| `stores\aiStore.ts` | ~750 行 | M15/M20/M23 |
| `stores\workspaceStore.ts` | ~410 行 | M14/M17、H7 |
| `stores\settingsStore.ts` | — | H7、L27 |
| `ai\AiComposer.tsx` | — | **H9**（输入法回车） |
| `i18n\messages.ts` | 1119 行 | M21/M22 |
| `lib\aiChat.ts` / `lib\ptyHost.ts` | — | M22 硬编码中文 |
| `ai-main.tsx` / `main.tsx` | 各 24 行 | M20/I15 |

### 配置 / 脚本
| 文件 | 关键发现 |
|---|---|
| `src-tauri\tauri.conf.json` | M8（csp:null）、资源/窗口设置正常 |
| `src-tauri\capabilities\default.json` | **M9**（~90 权限双窗口）、C1/C2 暴露面 |
| `vite.config.ts` | M16（无分包） |
| `scripts\sync-version.mjs` | M18、L40/L41 |
| `scripts\setup-nsis.mjs` | M19、L42 |
| `scripts\release-tag.mjs` | L45/L46 |
| `.github\workflows\release.yml` | H8（无测试/lint 步骤） |
| `README.md` | L49（Zustand 失实） |
| `ui-preview.html` | L43（死重量） |

---

*报告完。修复按第 9 节 P0→P3 顺序执行；每步以 cargo test / tsc -b / oxlint / 构建验证。*
