# Frontend Project Manager 设计规格

**日期：** 2026-07-21  
**状态：** 已确认（布局/视觉）+ 含 IDE 打开能力  
**栈：** Tauri 2 + React 19 + Vite 8 + Zustand + TypeScript

---

## 1. 产品目标

桌面端工具，统一管理多个前端工程目录（Workspace）：扫描项目、展示元信息（依赖框架、语言、分支、scripts、`.env`）、自定义标签筛选，并快捷执行命令；支持用已配置的 IDE（VS Code / WebStorm 等）打开项目目录。

---

## 2. 已确认 UI

| 决策项 | 选择 |
|--------|------|
| 主布局 | 三栏 IDE：Workspace \| 项目列表+标签筛选 \| 详情+底部终端 |
| 详情区 | 命令主区（左大）+ 侧边辅区（GIT / ENV / META） |
| 视觉 | Cyan HUD：深蓝渐变底、青色线框与高亮、等宽字体 |
| 品牌 | 顶栏 `◈ FPM` |

### 2.1 信息架构

```
┌─ TopBar: ◈ FPM | 当前 WS 路径 | 搜索框 | 设置(IDE) ─────────────┐
├─ WS 列表 ─┬─ 项目列表 ──────┬─ 项目 Header（name/pkg/框架/分支/Open IDE）─┤
│ + 添加 WS │  筛选标签        │  ┌─ COMMANDS ──────┬─ GIT / ENV / META ─┐  │
│           │  项目条目        │  │ scripts 按钮    │  分支列表           │  │
│           │                  │  │ 手动命令输入    │  .env 文件列表      │  │
│           │                  │  └────────────────┴─ 语言/标签 ────────┘  │
│           │                  ├─ Terminal（stdout/stderr 流式）────────────┤
└───────────┴──────────────────┴───────────────────────────────────────────┘
```

### 2.2 Open IDE 交互

- 项目 Header 右侧提供 **「在 IDE 中打开」** 下拉/按钮组。
- 列出已启用 IDE（内置预设 + 用户自定义）。
- 点击后由 Rust 侧 `Command::new(exe).args([...projectPath])` 启动（Windows 为主，路径可含空格）。
- 顶栏 **设置** 打开 IDE 管理面板：增删改、启用/禁用、浏览选择可执行文件、参数模板（默认 `{path}`）。

---

## 3. 功能需求

### 3.1 多 Workspace

- Workspace = 用户选择的根目录（如 `D:\workspace`）。
- 可添加多个；持久化到本地配置。
- 扫描规则：根目录下一层子目录，且存在 `package.json` 的视为项目；文件夹名作为显示名。

### 3.2 项目元信息（来自 package.json + 文件系统）

| 字段 | 来源 |
|------|------|
| 显示名 | 文件夹名 |
| pkg name / version | `package.json` 的 `name`、`version` |
| 框架依赖 | 扫描 `dependencies`/`devDependencies`，匹配 React/Vue/Next/Nuxt/Angular/Svelte/Solid 等，前端用图标+文案 |
| 可执行命令 | `package.json` 的 `scripts`；点击执行；另支持手动输入任意 shell 命令 |
| 语言/样式 | 抽样扫描项目内扩展名：`ts/js/jsx/tsx/less/css/scss`（忽略 `node_modules`、`.git`、`dist`、`build`） |
| 当前分支 / 全部分支 | `git`：`rev-parse --abbrev-ref HEAD`、`branch -a`（无 git 则显示不可用） |
| `.env*` | 列出根目录匹配 `.env`、`.env.*` 的文件名；点击展开键值（敏感值默认遮罩，可切换显示） |

### 3.3 自定义标签与筛选

- 每个项目可打多个标签（字符串）。
- 存储在应用本地配置（按 `workspacePath + relativeProjectPath` 为键），不写回项目仓库。
- 顶栏搜索：匹配文件夹名、pkg name、标签。
- 中栏标签芯片：多选过滤（AND）。

### 3.4 命令执行

- 工作目录 = 项目根路径。
- 包管理器检测优先级：`pnpm-lock.yaml` → `yarn.lock` → `bun.lockb`/`bun.lock` → `package-lock.json` → 回退 `npm`。
- scripts 点击执行：`{pm} run {script}`。
- 手动命令：用户输入原样交给 shell（Windows：`cmd /C`）。
- 输出流式推到 UI 终端面板；支持停止当前进程；同一项目同时只跑一个前台任务（新任务前提示或自动停旧任务）。

### 3.5 IDE 配置

**内置预设（可禁用）：**

| id | 名称 | Windows 探测 |
|----|------|----------------|
| vscode | VS Code | `code.cmd` / 常见安装路径 |
| webstorm | WebStorm | `webstorm.bat` / JetBrains Toolbox 路径 |
| cursor | Cursor | `cursor.cmd` / 常见路径 |

**自定义 IDE 字段：**

```ts
type IdeConfig = {
  id: string;          // uuid
  name: string;        // 显示名
  executable: string;  // 绝对路径或 PATH 中的命令
  argsTemplate: string; // 默认 "{path}"，可 "{path}" 多段空格分隔
  enabled: boolean;
  builtin?: boolean;
};
```

打开命令：将 `{path}` 替换为项目绝对路径后拆分为 argv，spawn detach（不阻塞应用）。

---

## 4. 架构

```
React (UI + Zustand)
    │  invoke / listen
    ▼
Tauri Commands (Rust)
    ├─ workspace: list_projects, scan_project
    ├─ git: branches
    ├─ env: list_env_files, read_env_file
    ├─ process: run_command, kill_command, stdout events
    ├─ ide: list_ides, save_ides, open_in_ide, detect_ides
    └─ config: load/save app config (workspaces, tags, ides)
```

- **前端状态：** Zustand stores — `workspaceStore`、`projectStore`、`terminalStore`、`settingsStore`。
- **持久化：** `app_config_dir` 下 `config.json`（workspaces、tags、ides、ui prefs）。
- **扫描缓存：** 会话内缓存；提供「刷新」按钮强制重扫。

---

## 5. 技术选型

| 层 | 选择 |
|----|------|
| 壳 | Tauri 2（Windows 优先） |
| UI | React 19 + Vite 8 + TypeScript |
| 状态 | Zustand |
| 样式 | CSS Modules 或纯 CSS 变量（Cyan HUD token），不用厚重 UI 库 |
| 图标 | 简单 SVG（框架 logo 用简化色标或 `simple-icons` 风格内联 SVG） |
| 测试 | 纯 TS 解析逻辑用 Vitest；Rust 侧关键解析可单测 |

---

## 6. 非目标（YAGNI）

- 不编辑/保存 `.env` 写回磁盘（只读展示）。
- 不做 Git checkout/commit。
- 不做远程仓库/CI 集成。
- 不做多窗口多终端标签（MVP 单终端面板）。
- 不做 macOS/Linux 一等适配（路径探测以 Windows 为主，命令层保持可移植）。

---

## 7. 错误处理

- 无 `package.json`：跳过该目录。
- Git 失败：分支区显示「非 Git 仓库」。
- 命令失败：终端显示 exit code，不崩溃。
- IDE 可执行文件不存在：Toast/内联错误，引导去设置。
- 权限/路径无效：添加 Workspace 时校验并提示。

---

## 8. 成功标准

1. 可添加 ≥2 个 Workspace，正确列出含 `package.json` 的子项目。
2. 选中项目可看到 scripts、分支、语言、`.env` 列表、框架标签。
3. 一键跑 script + 手动命令，终端有输出；可停止。
4. 标签可增删、搜索与筛选生效。
5. 可用 VS Code/WebStorm（若本机有）打开项目；可添加自定义 IDE 并打开。
6. UI 符合 Cyan HUD 三栏定稿。
