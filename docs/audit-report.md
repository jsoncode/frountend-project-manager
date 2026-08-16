# FPM 前端稳定性审计报告（只读）

- 审计范围：`src/` 下全部 ~91 个 TS/TSX 文件（约 1.9 万行），Tauri 2 + React 19 + TypeScript 桌面应用（文件资源管理器、Git 工具面板、xterm 集成终端、Monaco 编辑器、AI 聊天）
- 审计方式：高风险大文件逐行精读；其余文件由并行子代理深审，所有关键行号均二次核对原文；monaco-editor 0.52.2 相关行为已对照 node_modules 源码实测核验
- 审计性质：只读，未修改任何业务代码；本报告为唯一交付物
- 严重度口径：P0（崩溃/数据丢失）｜P1（功能性 bug / 明显卡死与数据错乱）｜P2（轻微 / 体验 / 潜伏风险）

## 总体结论摘要

**P0：0 条 · P1：11 条 · P2：14 条 · 代码质量观察：6 条。**

代码整体质量中上：异步流程普遍有 `try/finally` 复位、全局事件监听基本成对注册/注销（`ModalShell`、`ContextMenuPortal`、`XtermSession` 的 cleanup 都很规范）、xterm/pty 生命周期（`unregisterPtyTerminal` 内 `term.dispose()`）与 `MonacoDiffEditor` 的模型释放是正确范本。未发现必然崩溃或确定性数据全量丢失的 P0 级问题。

系统性风险集中在三处：**① 异步状态机缺少统一的"过期响应 / 取消 / 超时"基建**——`projectStore.refreshGit` 漏守卫、`aiStore.sendMessage` 双提交、`stopGeneration` 无本地兜底、`EditorShell` 加载无超时、终端断开会话被无限复用，均属同类病根；**② Monaco 模型与模块级缓存只增不减**——`createModel` 永不 dispose + `setEagerModelSync` 双份内存 + `loadedModels/loadedExtraLibs` 死缓存，长会话内存持续增长；**③ 两个潜在地雷**——`workspaceStore ↔ settingsStore` 循环 import、`createStore` 无 selector 缓存且无条件通知，当前靠调用规约"恰好没踩"，任何新代码触碰即炸。

建议优先修复：P1-1（大文件 LCS OOM/冻结）、P1-2/P1-3（AI 流式终态与中止卡死）、P1-6（bundler 别名解析错误）、P1-11（终端死会话复用）；并尽快为 `createStore` 补 selector 缓存、消除两个 store 的循环依赖。

---

## P1（11 条）

### P1-1 大文件 LCS 全量 DP 无尺寸上限，合并编辑器 OOM/冻结
- 严重度：P1
- 文件：`src/lib/diffUtils.ts:35-48`；调用链 `src/components/MergeEditorModal.tsx:280,392-404,509-522,526-540`
- 证据：
```ts
35:  const dp: number[][] = Array(m + 1)
36:    .fill(null)
37:    .map(() => Array(n + 1).fill(0))
```
- 问题：`computeLineDiff` 分配完整 (m+1)×(n+1) DP 表，时间/内存均为 O(m·n)，无任何尺寸守卫。`MergeEditorModal` 的 `onDidChangeModelContent`（每次按键）与 `onDidChangeCursorPosition`（每次移动光标）都会经 `applySideDecorations → matchSideRanges → changedLineRanges`（133 行）对 base/ours、base/theirs 做两次全文件 LCS。
- 触发与影响：合并冲突常见于大文件（如 `package-lock.json` 可达上万行）；10,000×10,000 行即 ~10⁸ 个数字单元 ≈ 800MB+，WebView 直接 OOM/冻结；5,000 行也约 200MB，且每次按键都重算。
- 修复：入口加尺寸守卫（行数乘积超阈值时降级为逐行比对）；改用 Myers O(ND)；至少把装饰计算移出输入事件并防抖。

### P1-2 aiStore.sendMessage 双提交竞态（generating 置位太晚）
- 严重度：P1
- 文件：`src/stores/aiStore.ts:451-474,516-526`
- 证据：
```ts
454:  if (!text || state.generating) return
471:  const conv = await get().createConversation()      // 一次完整 IPC 往返
518:  const savedUser = await invoke<AiMessage>('ai_append_message', …)
521:  set((s) => ({ …, generating: true, activeRequestId: requestId, … }))
```
- 问题：`generating: true` 在两个 await（含建会话）之后才置位；快速连按 Enter（keydown 重复触发）可让两次调用都读到 `generating === false` 通过守卫。
- 触发与影响：两个并发请求、两个 assistant 占位消息入列；chunk 处理器（613 行 `chunk.requestId !== activeRequestId` 校验）丢弃第一个请求的整条流 → 占位气泡永远为空；首轮对话还会创建两个会话、用户消息重复。
- 修复：在函数顶部（任何 await 之前）同步 `set({ generating: true, activeRequestId })` 占位，成功后只补 messages。

### P1-3 AI 流式终态处理缺陷：幽灵气泡 + 中止卡死
- 严重度：P1
- 文件：`src/stores/aiStore.ts:617-623,659-725,577-589`
- 证据：
```ts
617:  if (chunk.error) {
618:    set({ error: chunk.error, generating: false, activeRequestId: null })
619:  }
```
```ts
577:  stopGeneration: async () => {
585:    await invoke('ai_chat_cancel', { requestId })
```
- 问题：error 分支既不 `return`、也不删除 `pending-*` 占位消息、不复位 `streamingAssistantId`；done 分支在持久化失败（715-723 catch）或回复为空（708-714 else）时同样留下占位消息。`stopGeneration` 的 Tauri 分支只发 `ai_chat_cancel`，完全依赖后端补发终态事件，invoke 抛错时也不复位。
- 触发与影响：流中报错/网络断 → 空 assistant 气泡永久留在列表；若错误事件带 `done`，部分内容会被当完整回复持久化。后端取消后不补发终态（或事件晚到被 613 行守卫丢弃）→ `generating` 永久 true → `AiComposer` 输入框/开关与 `AiSidebar` 切换/新建/删除全部禁用（按钮永久卡死）。
- 修复：error/abort 统一删除占位消息并复位 `generating/activeRequestId/streamingAssistantId` 三字段；`stopGeneration` 加本地兜底复位（幂等，迟到的后端终态因 requestId 已清空被自然丢弃）。

### P1-4 projectStore.refreshGit 缺过期响应守卫
- 严重度：P1
- 文件：`src/stores/projectStore.ts:160-182`
- 证据：
```ts
167:  const git = await invoke<GitInfo | null>('git_branches', { path: selected.path })
170:  set({ git })
```
- 问题：`set({ git })` 在 await 后无条件写入，无 seq 守卫也无 `get().selected?.path === selected.path` 校验；同文件 `selectProject`（135 行）、`refreshGitStatus`（197-198 行）、`refreshMergeStatus`（267-268 行）均有守卫，唯独 `refreshGit` 漏掉。
- 触发与影响：点 fetch/refresh（`git_fetch` 较慢）后立刻切换项目 → 旧项目 A 的响应晚到，把 A 的分支列表渲染进 B 的分支面板；178 行还会连带刷新 B 的 status/merge。
- 修复：与 `refreshGitStatus` 一致，set 前校验 `get().selected?.path === selected.path`。

### P1-5 Monaco 模型永不 dispose，内存随会话持续增长
- 严重度：P1
- 文件：`src/components/MonacoEditor.tsx:176-181,287-289,259-271`、`src/lib/monacoNavigation.ts:345,500-501`、`src/lib/closeEditorFile.ts:35`
- 证据：
```ts
178:  model = monaco.editor.createModel(text, language, uri)
```
```ts
345:  const model = monacoApi.editor.createModel(content, modelLang, uri)
```
- 问题：主 effect 清理（259-271 行）只 `editor.dispose()` 不 `model.dispose()`；`closeEditorFile.ts:35` 只在关 tab 时释放**活动**模型；`monacoNavigation.ensureFileModel`（345 行）为每个被 import 的磁盘文件 `createModel`（递归预加载 357-427 行，单文件可达数十个模型），且 `setEagerModelSync(true)`（500-501 行）让每个模型双份进入 TS worker。`editorStore.closeTab`（87-88 行）只删 docs，Monaco 层无对应回收。
- 触发与影响：一次会话中每打开/预加载一个新文件就永久占用一份模型内存（含文件全文），长会话"越用越卡"，是用户可感知的主要内存增长源。
- 修复：卸载/关 tab 显式 `model.dispose()`（引用计数防止多编辑器共享模型误释放）；预加载模型设 LRU 上限；`closeTab` 通过回调通知 Monaco 层释放。

### P1-6 pathAliases bundler 别名被逗号截断成垃圾路径
- 严重度：P1
- 文件：`src/lib/pathAliases.ts:169,177,129-133,150-152,190`
- 证据：
```ts
169:  /['"](@[\w/-]*|~[\w/-]*)['"]\s*:\s*([^,}\n]+)/g
129:  const resolveMatch = replacement.match(/(?:path\.)?(?:resolve|join)\(\s*__dirname\s*,\s*['"]([^'"]+)['"]\s*\)/)
```
- 问题：值捕获 `[^,}\n]+` 在第一个逗号处截断。`'@': path.resolve(__dirname, 'src')` 只捕获到 `path.resolve(__dirname`；而 129-131 行的 `resolveMatch` 要求含闭括号的完整形式 → 该分支实际是不可达死代码（113 行注释却宣称支持）；截断串不含 `/`，落入 150-152 行 bare-name 分支 → 别名变成 `<root>/path.resolve(__dirname`。又因 `mergeAliases`（190 行）"后者覆盖前者"，vite/webpack 的垃圾值覆盖 tsconfig 里的正确同名别名。
- 触发与影响：任何使用 `path.resolve(__dirname, 'src')` / `join(__dirname, ...)` 的 vite/webpack 配置（最常见写法）解析失败 → 导入跳转失效、TS 持续报 2307。
- 修复：按括号配对扫描取值（逗号仅在括号深度 0 处才视为分隔），或先截断到 `)` 再匹配。

### P1-7 GitToolPanel dirtyConfirm 跨项目错误 checkout
- 严重度：P1
- 文件：`src/components/GitToolPanel.tsx:315-359`
- 证据：
```ts
332:  setDirtyConfirm({ branch: branchName, status: s })
...
345:  await invoke<string>('git_checkout', { path: selected.path, branch: dirtyConfirm.branch })
```
- 问题：`setDirtyConfirm` 只记录 branch/status 不记录项目路径；`doDirtySwitch` 用**当前渲染闭包**的 `selected.path` 执行旧项目的分支；`selected` 切换后 `dirtyConfirm` 也不会被清空。
- 触发与影响：双击分支 A → `git_status` invoke 在途 → 用户切换到项目 B → 弹窗展示 A 的脏文件列表 → 确认后**在 B 路径上 checkout A 的分支名**；新项目存在同名分支则静默切换其工作分支。
- 修复：`dirtyConfirm` 记录项目路径并在 `doDirtySwitch` 校验一致，不一致则关闭弹窗；`selected` 变化时清空该状态。

### P1-8 MergeEditorModal.save() 成功路径缺 setBusy(false)，onSaved 抛错误报保存失败
- 严重度：P1
- 文件：`src/components/MergeEditorModal.tsx:626-639`、`src/components/MergeConflictModal.tsx:290-293`
- 证据：
```ts
628:  try {
629:    await invoke('git_merge_resolve_content', …)
634:    setDirty(false)
635:    await onSaved()
636:  } catch (e) {
637:    setError(String(e))
638:    setBusy(false)
639:  }
```
- 问题：`setBusy(false)` 只在 catch；成功后 busy 永久 true，弹窗所有按钮禁用（659/665 行）且 `closeOnEsc={!busy}`（649 行）Esc 失效。当前被 `MergeConflictModal.tsx:290-293` 的 `onSaved`（`setDiffFile(null)` 卸载弹窗）掩盖；且 `onSaved` 内 `reload()` 抛错会被 catch 误报为"保存失败"（内容实际已落盘），错误语义混叠。
- 修复：成功路径复位 busy；`await onSaved()` 移出 try（保存本身失败才进错误分支）。

### P1-9 IdeSettingsModal setDraft 快照覆盖写，扫描/异步期间用户编辑静默丢失
- 严重度：P1
- 文件：`src/components/IdeSettingsModal.tsx:79,92-94,115-147`
- 证据：
```ts
92:  const update = (id, patch) => { setDraft(ides.map(...)) }   // ides 是渲染期快照
141:  setDraft(next)                                              // 扫描结束时整体覆盖
```
- 问题：`update`、`scanAndAddInstalled`（121 行 `const next = [...ides]`）、`addFromEditor`、`addManualExe` 全部基于闭包捕获的渲染快照 `ides` 写整个数组，而非函数式 `setDraft(prev => …)`。
- 触发与影响：`scanAndAddInstalled` 逐个 `await extractIcon`（129 行，串行 invoke 可达数秒）期间卡片输入框未禁用，用户输入名称 → 扫描结束 `setDraft(next)` 用旧快照整体覆盖 → 输入丢失；两个"从 exe 提取图标"并发时后完成的 `update` 抹掉先完成的图标结果。
- 修复：全部改为函数式更新 `setDraft(prev => …)`；扫描期间禁用卡片编辑入口。

### P1-10 EditorShell 加载无超时，invoke 挂起则永久 loading（loadingRef 毒化）
- 严重度：P1
- 文件：`src/components/EditorShell.tsx:56-58,77-79,172-176`
- 证据：
```ts
56:  if (loadingRef.current.has(key)) return
57:  loadingRef.current.add(key)
```
- 问题：`readTextFile` 永不 settle 时 `.finally`（78 行）不执行 → `loadingRef` 永久占用该 key，切回同一文件被 56 行拦截不再加载；loading overlay（172-176 行）无重试按钮（重试按钮只在 error 分支，184-190 行）。
- 触发与影响：后端文件读取挂起（Rust panic/死锁/IO 卡死）→ 该文件永久"加载中"，无任何恢复途径。
- 修复：加载加超时兜底（超时置 error 并删除 loadingRef key）。

### P1-11 终端 pty://exit 后死会话被无限复用，命令被吞、tab 假死无自愈
- 严重度：P1
- 文件：`src/stores/terminalStore.ts:222-244,333-342`（另核验 Rust 侧 `src-tauri/src/pty_term.rs:250-254`）
- 证据：
```ts
240:  const pending = sessions.find((s) => same(s) && !s.connected)  // 把死会话当"启动中"复用
333:  const unExit = await listen<PtyExitEvent>('pty://exit', (event) => {
335:    get().markConnected(id, false)   // 只标记不清理，会话永久留在 sessions
```
- 问题：shell 进程退出（pty://exit）只 `markConnected(id, false)`，不关闭/标记会话；`ensureRunTarget`（222-244 行）把 `!connected` 一律视为"仍在启动"而复用。此后 `runInSession` 经 `waitPtyReady`（ready gate 已 resolve）放行后 `pty_write` 被后端以"终端未连接"拒绝 → 命令静默失败。
- 触发与影响：shell 崩溃/用户输入 `exit`/进程被杀后，该 tab 上所有快捷键命令（Explorer/Git 面板的 `runRaw`/`runScript`）全部失效且无任何报错，tab 假死，不自动重建、不提示关闭。
- 修复：exit 事件中对该会话打 dead 标记或直接 `closeSession(id)`；`ensureRunTarget` 跳过 dead 会话并自动新建。

---

## P2（14 条）

### P2-1 workspaceStore ↔ settingsStore 循环 import（潜伏）
- 严重度：P2
- 文件：`src/stores/workspaceStore.ts:5`、`src/stores/settingsStore.ts:5`
- 证据：两文件第 5 行顶层互相 import 对方。
- 问题：ESM 循环依赖，当前能跑通仅因所有跨 store 访问都推迟到 action 执行期（如 `workspaceStore.ts:212 useSettingsStore.getState()...`、`settingsStore.ts:264 useWorkspaceStore.setState(...)`），模块求值期无顶层解引用。
- 触发与影响：任一 store 将来在模块顶层（creator 函数体、常量初始化）访问对方即 TDZ `ReferenceError`/`undefined`，且只在特定 import 顺序下复现，极难排查。
- 修复：消除环（参数/回调注入或抽无依赖共享模块）；至少加注释声明"禁止顶层解引用"。

### P2-2 createStore 无 selector 结果缓存 + 无条件通知（潜伏无限渲染）
- 严重度：P2
- 文件：`src/lib/createStore.ts:33-38,51-58`
- 证据：
```ts
36:  state = { ...state, ...nextPartial }; listeners.forEach((l) => l())
54:  const getSnapshot = useCallback(() => {
56:    return selectorRef.current ? selectorRef.current(s) : s
57:  }, [])
```
- 问题：setState 无条件通知、无 `Object.is` 相等跳过；`getSnapshot` 每次重跑 selector 不做结果缓存（zustand 用 `useSyncExternalStoreWithSelector` 做缓存）。
- 触发与影响：任何写成 `useStore((s) => s.x.filter(...))` 的调用点都会因快照引用变化触发无限重渲染直至 React 抛错页面冻结。已核实当前 99 处调用点均为 `(s) => s.x` 稳定引用，未触发，属地雷。
- 修复：给 selector 结果加 useRef + Object.is 缓存；setState 值相等时跳过通知。

### P2-3 单层 ErrorBoundary 覆盖整树，任一子树崩溃整 UI 降级
- 严重度：P2
- 文件：`src/main.tsx:18-23`、`src/ai-main.tsx:17-23`、`src/components/ErrorBoundary.tsx:24-39`
- 问题：全应用仅根节点一层 ErrorBoundary，无任何嵌套边界；fallback 在 AntdProvider 之外使用 antd Button 与 App CSS，崩溃源在 antd 层时 fallback 自身可能失败 → 真白屏；fallback 无错误详情，且"恢复"按钮对确定性渲染错误无效。
- 触发与影响：Editor/Monaco/终端/弹窗任一子树渲染抛错 → 整个应用 UI 被 fallback 替换，终端 pty 会话与未保存文档随之丢失。
- 修复：按面板加嵌套 ErrorBoundary（Explorer/终端/编辑器/弹窗各一层），fallback 内移或改用无依赖实现并展示错误详情。

### P2-4 GitToolPanel autoMergeShownRef 永不重置 + effect 依赖缺字段
- 严重度：P2
- 文件：`src/components/GitToolPanel.tsx:118-126`
- 证据：
```ts
122:  const key = `${selected.path}:${mergeStatus.current ?? ''}:${mergeStatus.incoming ?? ''}`
126:  }, [mergeStatus?.inProgress, mergeStatus?.conflictCount, selected?.path])
```
- 问题：ref 在任何分支都不清除；key 用了 `current/incoming` 但依赖数组没有这两个字段。
- 触发与影响：同一分支 abort 合并后再 pull 产生冲突，key 与上次完全相同 → 冲突弹窗不再自动弹出，用户只能手动打开；`current/incoming` 变化本身也不触发 effect。
- 修复：`inProgress` 为 false 时重置 ref；补全依赖字段。

### P2-5 MergeEditorModal 加载 effect 缺 editorTheme 依赖（stale closure）
- 严重度：P2
- 文件：`src/components/MergeEditorModal.tsx:455-586`
- 证据：effect 内 494/503/507 行用 `editorTheme` 创建三个编辑器，依赖只有 `[projectPath, file]`（586 行）。
- 触发与影响：三个编辑器用首次渲染的主题创建，弹窗打开期间切换编辑器主题完全不生效（需关闭重开）。
- 修复：补依赖并在 effect 内对已建编辑器 `monaco.editor.setTheme(editorTheme)`，或另设 `[editorTheme]` effect。

### P2-6 Explorer fetchProjGitInfo 无请求序号，快速右键两个项目时旧请求覆盖新菜单
- 严重度：P2
- 文件：`src/components/Explorer.tsx:475-499`
- 证据：
```ts
484:  const info = await invoke<GitInfo | null>('git_branches', { path: projectPath }).catch(() => null)
485:  setProjGitInfo({ path: projectPath, info })   // 后返回者覆盖
```
- 问题：`projGitInfo`/`gitLoading` 是单一状态，两个并发 `git_branches` 乱序返回；先返回方的 `finally`（496-498 行）提前把 `gitLoading` 置 false。
- 触发与影响：右键项目 A（fetch 在途）→ 250ms 内右键项目 B → A 的慢返回覆盖 B 的菜单数据；渲染守卫（465 行 `projGitInfo.path === menu?.path`）失配 → B 的"切换分支"子菜单显示"无其他分支"错误态且不自愈，用户只能再右键一次。
- 修复：`projGitInfo` 改为 `Map<path, {info, loading}>` 或加请求序号，仅在 `projGitInfo.path === menu.path` 时应用。

### P2-7 ansi.tsx SGR `0` 提前 return，丢弃后续参数
- 严重度：P2
- 文件：`src/lib/ansi.tsx:103-104`
- 证据：`case 0: return {}`。
- 问题：SGR 参数按从左到右处理，`\x1b[0;31m` 应先复位再置红，此处 `case 0` 直接返回导致后续 `31` 全部丢弃。另有 `color256`（92 行）对 `38;5;999` 等畸形输入产出非法 rgb 值（浏览器忽略，不崩溃）。
- 修复：`case 0` 复位后 `break` 继续处理后续参数；`color256` 入口对 n 做 0-255 钳制。

### P2-8 MonacoEditor remasureWhenFontsReady 定时器不清理，卸载后对已 dispose editor 调 layout()
- 严重度：P2
- 文件：`src/components/MonacoEditor.tsx:73-84,256-257,259-271`
- 证据（monaco-editor 0.52.2 实测核验）：
```ts
82:  window.setTimeout(run, 50)
83:  window.setTimeout(run, 250)
```
- 问题：50/250ms 两个 setTimeout 与 `document.fonts.ready.then(run)`（80 行）在 cleanup 中不取消（cleanup 只清 `preloadTimer`）；window resize（257 行）每次再排 2 个。已核实 monaco-editor 0.52.2 `CodeEditorWidget.layout()`（codeEditorWidget.js:988-993）无 disposed 守卫，dispose 后调用属未定义行为。
- 触发与影响：编辑器挂载后 250ms 内卸载（打开文件后立刻关最后一个 tab）→ 对已 dispose 的 editor 调 `layout()`/`remeasureFonts()`，轻则空跑、重则抛错；resize 导致定时器堆积。
- 修复：定时器 id 存 ref 并在 cleanup 清除；用 `alive` 标志或 `editor.onWillDispose` 守卫 `run()`；resize 直接 `editor.layout()`。

### P2-9 editorStore 每击键重建整个 docs + dirtyPath 规范化不一致
- 严重度：P2
- 文件：`src/stores/editorStore.ts:163-166`
- 证据：
```ts
163:  docs: { ...get().docs, [key]: { ...prev, value } },
165:  dirtyPath: dirty ? path : get().dirtyPath === path ? null : get().dirtyPath,
```
- 问题：每次按键 spread 整个 docs 对象（订阅 docs 的组件每键全量重渲）；`dirtyPath` 用原始 `path` 比较，而 `closeTab`（104 行）/`isTabDirty`（109 行）用 `editorPathKey`（`normalizeFsPath`）——路径大小写/分隔符不一致时 `dirtyPath` 清不掉。
- 修复：dirtyPath 统一用 `editorPathKey`；docs 更新按 key 增量或对该 deprecated 字段直接删除。

### P2-10 settingsStore 持久化竞态：saveWorkspaces 读-改-写 + setEditorTheme 先持久化后应用
- 严重度：P2
- 文件：`src/stores/settingsStore.ts:158-164,295-305`
- 证据：
```ts
159:  const current = get().config
161:  const next = { ...current, workspaces }
162:  await invoke('save_config', { cfg: next })
163:  set({ config: next })
```
```ts
302:  await invoke('save_config', { cfg: next })
304:  set({ config: next })
```
- 问题：`saveWorkspaces` 基于调用时刻快照生成 `next`、await 后整包 set——连续保存或与 touch*/setEditorTheme/load 并发时旧快照覆盖期间更新的字段（DB 同步写入旧值）；`setEditorTheme` 先 `await invoke` 再 `set`——invoke 抛错时主题不生效且异常冒泡产生 unhandled rejection（调用方无 catch），浏览器预览分支行为不一致。
- 修复：saveWorkspaces 在 await 后基于最新 state 重新合并；setEditorTheme 先乐观 set 再后台 `void invoke(...).catch()`。

### P2-11 UpdateAllProjectsModal 运行中无超时/取消，后端挂起则弹窗永久锁死
- 严重度：P2
- 文件：`src/components/UpdateAllProjectsModal.tsx:129-221`
- 证据：`runUpdates`（129-221 行）逐项目 `await invoke('git_pull_all', ...)` 串行执行，无超时/取消；`close()`（216-221 行）运行中（`runningRef.current`）拒绝关闭，`closeOnEsc={!running}`（297 行）Esc 也失效。
- 触发与影响：任一仓库的 `git_pull_all` 挂起（网络 hang、后端死锁）→ 弹窗永久锁死，用户无法关闭、无法中断。
- 修复：加超时/取消（AbortController 风格或 per-project 超时后标 error 继续）；提供强制关闭入口。

### P2-12 terminalStore.waitUntilIdle 对断开会话空转满 180s + XtermSession.boot() catch 无 disposed 守卫
- 严重度：P2
- 文件：`src/stores/terminalStore.ts:279-289`、`src/components/XtermSession.tsx:306-310`
- 证据：
```ts
286:  if (session.connected && !session.running) return   // 断开会话永不满足
```
- 问题：`waitUntilIdle` 只在 `connected && !running` 时返回，断开会话（connected=false）会轮询满默认 180,000ms；调用方未传短超时则行 spinner/等待态卡 3 分钟（GitToolPanel/Explorer 传了 10s 兜底，其余裸用默认值）。另 `boot()` 的 catch 分支（306-310 行）对已 dispose 的 Terminal 调 `writeln`（成功路径 295-298 行有 `disposed` 守卫，catch 路径没有）——spawn 失败与卸载竞态时对无 disposed 守卫的 xterm `write` 触发未捕获异步错误。
- 修复：`!session.connected` 视为可返回；boot() catch 内补 `if (disposed) return`。

### P2-13 AiMessageList 流式渲染 O(n²)：每 chunk smooth scrollIntoView + 全量 map + 全量 token 估算
- 严重度：P2
- 文件：`src/ai/AiMessageList.tsx:44-48`、`src/stores/aiStore.ts:636-656,73-75`
- 证据：
```ts
45:  bottomRef.current?.scrollIntoView({ behavior: generating ? 'smooth' : 'auto' })
```
- 问题：每个 chunk 触发一次 `scrollIntoView(smooth)`（44-48 行，依赖 `[messages, generating, error]` 每 chunk 变化）+ aiStore 每 chunk 全量 `messages.map` 重建数组 + `buildLiveStats` 内 `estimateTokens` 对已累计完整输出逐字符重扫；另 `copyMessage`（59-61 行）的 setTimeout 未在卸载时清理（React 18 下为无害 no-op）。
- 触发与影响：万 token 级长回复流式过程中 UI 明显掉帧；`openReasoning` 状态随消息 id 只增不减。
- 修复：增量维护 token 计数（`outputTokens += estimateTokens(delta)`）；流式期间用 `scrollTop = scrollHeight` 替代逐 chunk smooth scroll；copyMessage 定时器存 ref 清理。

### P2-14 sessionStore.initSessionAutoSave 丢弃 unsubscribe 且未订阅 projectStore
- 严重度：P2
- 文件：`src/stores/sessionStore.ts:172-178,103-113`
- 证据：
```ts
173:  useLayoutStore.subscribe(() => scheduleSave())
177:  useTerminalStore.subscribe(() => scheduleSave())
```
- 问题：5 个 subscribe 的退订函数全部丢弃（HMR/重复调用会累积监听器）；list 缺 projectStore——快照含 `selectedProjectPath`（49 行），选中变化只在 `selectProject` 成功后经 `updateProjectStatus`（projectStore.ts:144）间接触发 workspaceStore 通知落盘，`scan_project`/git 拉取失败走 catch（151-154 行）时本次选择永不入库。另 `hydrate` 恢复选中项目用严格 `===`（109 行），路径大小写/分隔符漂移时静默丢失（对照 workspaceStore 的 `normPath` 84-86 行）。
- 修复：保存退订函数以便清理；显式订阅 projectStore；恢复匹配改用 normPath 归一比较。

---

## 代码质量观察（6 条）

**QO-1 巨型组件与内联 async handler 泛滥**：`Explorer.tsx` 1746 行（约 60 个 useState + 数十个内联 async handler）、`GitToolPanel.tsx` 980 行、`MergeEditorModal.tsx` 786 行——建议按"树/菜单/弹窗"拆分 hook 与子组件。`Explorer` 的 `debouncedToggle`（159-171 行）250ms 内跨行点击会吞掉前一个点击（单双击判定的副作用），定时器也未在卸载时清理；`Explorer.tsx:287-297` `confirmRemove` 无 try/catch（`saveWorkspaces` reject 时弹窗卡死 + unhandled rejection，`closeOnEsc={false}`）；`Explorer.tsx:1288` `git_fetch` 失败被 `catch { /* ignore */ }` 完全吞掉无用户反馈；`Explorer.tsx:455-459` `deleteEntry` 清理 expanded 但不清理 `dirCache` 中已删目录的子树缓存（僵尸缓存）。

**QO-2 竞态守卫风格不统一**：projectStore 用 seq 计数器但 `refreshGit` 漏掉（已入 P1-4）；部分组件用 `cancelled` 标志（MergeEditorModal、AiSettingsModal、IdeSettingsModal picker），部分裸 `void async` 无任何 mounted 守卫（GitToolPanel 全部 git handler、JenCliSettingsModal.reload、Explorer 多处 await 后 setState）；建议抽象统一的"当前 token"工具并全库套用。

**QO-3 模块级可变单例与死缓存**：`monacoNavigation` 的 `ctx/aliasCache/bareModulePaths`（含 `clearMonacoNavContext` 定义后全仓无人调用、项目切换瞬间旧 aliases 写入 ctx 的窗口）、`loadedModels/loadedExtraLibs`（只 add 从不读取——`registerBarePackageInMonaco` 对每个 import 同一裸包的文件完整重跑 `loadSiblingDtsIntoVirtual`：读目录 + 至多 40 个 .d.ts 逐个读盘 + 重复 `publishExtraLib`）、`MonacoEditor` 的 `preloadedFiles`（定时器触发即永久标记，失败不重试）、`explorerStore.explorerRowEls`、`terminalStore` 的 `issueCaptureTimers/lastCommandMap`（关闭会话不清 lastCommandMap）、`aiStore` 的 `unlistenChunk`——HMR/双窗口/测试场景易残留，建议迁入 store 或提供 reset。

**QO-4 重复 IO 与无效 memo**：`pathAliases.fileExists`（246-253 行）读完整文件内容判存在，`expandLocalCandidate` 对每个候选都做；`loadProjectAliases` 每次全扫 13 个配置文件；`SettingsModal.tsx:68` 每次渲染执行 `registerEditorThemes(monaco)`；`setupMonacoEnvironment()`/`registerEditorThemes()` 在 `MonacoEditor.tsx:169-170` 与 `MonacoDiffEditor.tsx:47-48` 双处调用；`MonacoEditor` 三重 resize 观测（`automaticLayout` 自带 observer + 手动 ResizeObserver + window resize，已实测 monaco 0.52.2 `editorConfiguration.js:51-53` 自带 ElementSizeObserver）。

**QO-5 异步监听注册/取消纪律不统一**：`unlisten` 在 `await` 之后才赋值的模式三处——`aiStore.ts:591-607`（`startAiListeners` 先 `cleanup()` 再 `await listen`，重叠调用泄漏前一次监听）、`App.tsx:43-51`、`WindowControls.tsx:16-27`；`initSessionAutoSave` 丢弃 subscribe 退订（见 P2-14）；`AiMessageList` copyMessage setTimeout 不清理、`Explorer` debouncedToggle/搜索滚动 setTimeout 不清理；`MonacoDiffEditor.tsx:79-89` 的 `onDidChangeModelContent` disposable 未保存、`onReady` rAF 未取消。

**QO-6 细节与性能热点**：`GitToolPanel.tsx:264` 用硬编码中文 `err.includes('已切换')` 判断后端错误语义（文案一改即失效，建议后端返回结构化错误码）；`monacoThemes.ts:18` 拼写 `EDITOR_THEMS`（对外导出名，改名需同步引用处）；`MonacoEditor.tsx:110-114` 与 `XtermSession.tsx:126-127` 渲染期写 ref（React 19 并发特性下有陈旧写入风险）；`monacoNavigation.ts:189-191` `modelAbsPath` 的 `decodeURIComponent` 对畸形 URI 可抛 `URIError`（被 `collectImportLinks` 每条 link 调用，建议安全解码）；`editorLanguage.ts:9-10` 返回 monaco basic-languages 未内置的 `'makefile'`/`'cmake'` id（0.52.2 实测无此二者）导致无高亮 + 控制台告警；`MergeEditorModal` 每按键全量 `parseConflictHunks` + 重建全部 content widget。

---

*审计声明：全程只读，未修改任何业务代码；行号以审计时工作区快照为准；P1/P2 均基于实际读到的代码行与（如适用）monaco-editor 0.52.2 / xterm 6.0 / Rust pty 实现核验。*
