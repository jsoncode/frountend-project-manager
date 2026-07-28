# jen-cli 内置集成 — 实现计划

> **面向 AI 代理的工作者：** 按任务顺序实现。步骤用复选框跟踪。用户要求「开始执行」，本会话直接实现；非经要求不自动 git commit。

**目标：** 将 jen-cli Vendoring 进 FPM，应用终端/可选系统 PATH 可调用，设置中管理服务器配置与 CLI/参数默认值（含可改 key）。

**架构：** `vendor/jen-cli` 打进 resources；`app_config_dir` 存 `jenkins.config.json`（仅服务器）与 `jen-cli.defaults.json`；`pty_spawn` 注入 PATH/环境变量；设置 UI 读写配置。

**技术栈：** Tauri 2 + React + Rust；Node 运行 vendored CLI。

**规格：** `docs/superpowers/specs/2026-07-28-jen-cli-integration-design.md`

---

## 文件结构

| 路径 | 职责 |
|------|------|
| `vendor/jen-cli/**` | Vendored CLI + example + Windows shim |
| `src-tauri/src/jen_cli.rs` | 配置路径、读写、PATH、ensure defaults |
| `src-tauri/src/pty_term.rs` | spawn 时注入 env |
| `src-tauri/tauri.conf.json` | bundle resources |
| `src/lib/types.ts` | `JenCliSettings` 类型 |
| `src/stores/jenCliStore.ts` 或扩展 settingsStore | 前后端同步 |
| `src/components/JenCliSettingsModal.tsx` | 设置 UI |
| `src/components/SettingsModal.tsx` | 入口 |
| `src/i18n/messages.ts` | 文案 |

### 任务 1：Vendoring + resources

- [ ] 复制 `bin/jen-cli.mjs`、`lib/*.mjs` 到 `vendor/jen-cli/`
- [ ] 写 example JSON（servers 对象 map）与 `jen-cli.cmd`
- [ ] `tauri.conf.json` resources 指向 vendor

### 任务 2：Rust 配置 API + PATH

- [ ] `jen_cli.rs`：路径解析、读写 jenkins/defaults、ensure 初始化、user PATH 增删、node 检测
- [ ] commands + permissions
- [ ] `pty_spawn` 注入

### 任务 3：改造 vendored CLI

- [ ] 配置路径：`--config` → `JENKINS_CONFIG_PATH`
- [ ] 读 `FPM_JEN_CLI_DEFAULTS`，`paramKeys` 驱动预设

### 任务 4：前端设置 UI

- [ ] 类型 + store/invoke
- [ ] `JenCliSettingsModal`（服务器 / CLI 文档与默认 / key 映射 / PATH）
- [ ] Settings 入口 + i18n

### 任务 5：验证

- [ ] `tsc` + `cargo check`
- [ ] 更新设计文档状态为已确认/实现中
