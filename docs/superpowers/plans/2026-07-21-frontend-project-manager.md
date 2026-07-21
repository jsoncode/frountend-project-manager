# Frontend Project Manager 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 用 Tauri 2 + React 19 + Vite 8 + Zustand 实现 Cyan HUD 风格的多 Workspace 前端项目管理器，支持扫描项目、执行命令、标签筛选、以及用可配置 IDE 打开项目。

**架构：** Rust 侧负责目录扫描、读 package.json/env、git、进程 spawn、IDE 启动与 config 持久化；React 侧三栏布局 + Zustand；命令输出经 Tauri event 流式推到终端面板。

**技术栈：** Tauri 2、React 19、Vite 8、TypeScript、Zustand、Vitest、CSS 变量（Cyan HUD）

**规格：** [docs/superpowers/specs/2026-07-21-frontend-project-manager-design.md](../specs/2026-07-21-frontend-project-manager-design.md)

---

## 文件结构

| 路径 | 职责 |
|------|------|
| `package.json` / `vite.config.ts` / `tsconfig*.json` | 前端工程与 Vite 8 |
| `src-tauri/` | Tauri 2 Rust 工程 |
| `src-tauri/src/main.rs` / `lib.rs` | 入口与 command 注册 |
| `src-tauri/src/config.rs` | 读写 `config.json` |
| `src-tauri/src/scan.rs` | Workspace 扫描、语言扩展、框架检测 |
| `src-tauri/src/git.rs` | 分支查询 |
| `src-tauri/src/env_files.rs` | `.env*` 列表与解析 |
| `src-tauri/src/process.rs` | 运行/停止命令 + stdout 事件 |
| `src-tauri/src/ide.rs` | IDE 探测、保存、打开 |
| `src/styles/tokens.css` | Cyan HUD 设计 token |
| `src/styles/app.css` | 全局布局与组件样式 |
| `src/stores/*.ts` | Zustand stores |
| `src/lib/types.ts` | 前后端共享类型（TS） |
| `src/lib/frameworks.ts` | 框架 id → 图标/颜色 |
| `src/App.tsx` | 壳布局 |
| `src/components/TopBar.tsx` | 品牌、搜索、设置入口 |
| `src/components/WorkspaceRail.tsx` | Workspace 列表 |
| `src/components/ProjectList.tsx` | 项目列表 + 标签过滤 |
| `src/components/ProjectHeader.tsx` | 标题、pkg、框架、Open IDE |
| `src/components/CommandPanel.tsx` | scripts + 手动命令 |
| `src/components/MetaPanel.tsx` | Git / Env / Lang / Tags |
| `src/components/TerminalPanel.tsx` | 终端输出 |
| `src/components/IdeSettingsModal.tsx` | IDE 增删改 |
| `src/components/AddWorkspaceDialog.tsx` | 选目录添加 WS |
| `src/lib/parsePackage.test.ts` 等 | Vitest：框架检测、env 解析（若逻辑在 TS）；Rust 逻辑以集成验证为主 |

---

### 任务 1：脚手架

**文件：**
- 创建：整个 Vite + Tauri 工程根目录文件

- [ ] **步骤 1：创建 Vite React-TS 项目并安装依赖**

```bash
cd /d/cxa-back/frountend-project-manager
npm create vite@latest . -- --template react-ts
npm install
npm install zustand @tauri-apps/api @tauri-apps/plugin-dialog @tauri-apps/plugin-shell
npm install -D @tauri-apps/cli vitest
```

确保 `package.json` 中 `vite` 为 8.x、`react`/`react-dom` 为 19.x（若模板版本不符则手动改 version 再 `npm install`）。

- [ ] **步骤 2：初始化 Tauri 2**

```bash
npx tauri init --app-name "Frontend Project Manager" --window-title "FPM" --dev-url http://localhost:5173 --before-dev-command "npm run dev" --before-build-command "npm run build" --ci
```

- [ ] **步骤 3：启用插件与权限**

在 `src-tauri/Cargo.toml` 加入 `tauri-plugin-dialog`、`serde`、`serde_json`、`walkdir`、`regex`（按需）。  
在 `src-tauri/capabilities/default.json` 允许 `dialog`、`core:event`、自定义 commands。

- [ ] **步骤 4：验证空壳可跑**

```bash
npm run tauri dev
```

预期：窗口打开，默认 Vite 页。

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri2 + React19 + Vite8"
```

---

### 任务 2：Config 与类型

**文件：**
- 创建：`src-tauri/src/config.rs`、`src/lib/types.ts`、`src/stores/settingsStore.ts`

- [ ] **步骤 1：定义 `AppConfig`（Rust + TS 对齐）**

```rust
// workspaces: Vec<String>
// tags: HashMap<String, Vec<String>>  // key = "wsPath::projectRel"
// ides: Vec<IdeConfig>
```

- [ ] **步骤 2：实现 `load_config` / `save_config` Tauri commands**

配置路径：`app_config_dir()/config.json`。不存在则写入默认（内置 vscode/webstorm/cursor 预设，enabled 视探测结果）。

- [ ] **步骤 3：前端 `settingsStore` 启动时 `invoke('load_config')`**

- [ ] **步骤 4：Commit**

```bash
git commit -m "feat: app config load/save and shared types"
```

---

### 任务 3：扫描项目

**文件：**
- 创建：`src-tauri/src/scan.rs`、`src/stores/workspaceStore.ts`、`src/stores/projectStore.ts`

- [ ] **步骤 1：实现 `list_projects(workspace: String) -> Vec<ProjectSummary>`**

子目录 + 有 `package.json` → `{ folderName, path, pkgName, pkgVersion, frameworks[], scripts{} }`。

- [ ] **步骤 2：实现 `scan_project_details(path) -> ProjectDetails`**

含 frameworks、scripts、languages（扩展名集合）、当前不扫 git/env（下任务）。

- [ ] **步骤 3：框架检测表**

匹配依赖名：`react`、`vue`、`next`、`nuxt`、`@angular/core`、`svelte`、`solid-js`。

- [ ] **步骤 4：前端选中 WS 后拉列表，选中项目后拉详情**

- [ ] **步骤 5：Commit**

```bash
git commit -m "feat: scan workspaces and package.json metadata"
```

---

### 任务 4：Git + Env

**文件：**
- 创建：`src-tauri/src/git.rs`、`src-tauri/src/env_files.rs`、`src/components/MetaPanel.tsx`

- [ ] **步骤 1：`git_branches(path)` → `{ current, branches[] }`**

无 `.git` 返回 `null` 或错误码由前端显示「非 Git 仓库」。

- [ ] **步骤 2：`list_env_files` / `read_env_file`**

只读；解析 `KEY=VALUE`；前端默认遮罩 value。

- [ ] **步骤 3：MetaPanel 展示分支、env、语言、标签编辑**

- [ ] **步骤 4：Commit**

```bash
git commit -m "feat: git branches and env file viewer"
```

---

### 任务 5：命令执行与终端

**文件：**
- 创建：`src-tauri/src/process.rs`、`src/stores/terminalStore.ts`、`src/components/CommandPanel.tsx`、`src/components/TerminalPanel.tsx`

- [ ] **步骤 1：检测包管理器 + `run_script` / `run_raw`**

- [ ] **步骤 2：stdout/stderr 通过 `app.emit("terminal://line", { projectId, stream, line })`**

- [ ] **步骤 3：`kill_running` 停止当前进程**

- [ ] **步骤 4：UI 绑定 scripts 按钮、手动输入、终端滚动**

- [ ] **步骤 5：Commit**

```bash
git commit -m "feat: run scripts with streaming terminal"
```

---

### 任务 6：标签与筛选

**文件：**
- 修改：`config.rs`、`ProjectList.tsx`、`TopBar.tsx`、`MetaPanel.tsx`

- [ ] **步骤 1：`set_project_tags` 写入 config**

- [ ] **步骤 2：搜索框 + 标签 AND 过滤**

- [ ] **步骤 3：Commit**

```bash
git commit -m "feat: custom tags search and filter"
```

---

### 任务 7：IDE 打开与设置

**文件：**
- 创建：`src-tauri/src/ide.rs`、`src/components/IdeSettingsModal.tsx`、`src/components/ProjectHeader.tsx`

- [ ] **步骤 1：`detect_ides` / `open_in_ide(ideId, path)` / `save_ides`**

- [ ] **步骤 2：Header 下拉打开；设置 Modal 增删改自定义 IDE（dialog 选 exe）**

- [ ] **步骤 3：Commit**

```bash
git commit -m "feat: open project in configurable IDEs"
```

---

### 任务 8：Cyan HUD UI 定稿

**文件：**
- 创建：`src/styles/tokens.css`、`src/styles/app.css`、`src/App.tsx` 及各组件样式

- [ ] **步骤 1：落地三栏布局与 token（`--bg`、`--cyan`、`--panel` 等）**

- [ ] **步骤 2：Workspace 添加（dialog open）、空状态、刷新按钮**

- [ ] **步骤 3：对照规格成功标准手工验收**

- [ ] **步骤 4：Commit**

```bash
git commit -m "feat: cyan HUD shell layout and polish"
```

---

## 验收清单

- [ ] 多 Workspace 添加/切换/持久化
- [ ] 项目列表显示文件夹名 + pkg name/version + 框架
- [ ] scripts 点击与手动命令 + 终端输出/停止
- [ ] 分支、语言、.env（遮罩）
- [ ] 标签增删与搜索筛选
- [ ] VS Code/WebStorm/自定义 IDE 打开
- [ ] UI 为 Cyan HUD 三栏 + 命令主区
