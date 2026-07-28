# jen-cli 内置集成设计

日期：2026-07-28  
状态：已确认并实现（首版）  
范围：将 `jen-cli`（Jenkins CLI）Vendoring 进 Frontend Project Manager，支持应用内/系统终端调用，并在设置中管理服务器配置与 CLI/Job 参数默认值。

## 1. 目标与非目标

### 目标

- 安装本软件后，可在**本软件终端**直接执行 `jen-cli`。
- 在不麻烦的前提下，支持将 shim 目录注入**当前用户 PATH**，使**系统终端**也能执行 `jen-cli`。
- 设置界面可配置：
  - Jenkins **服务器**配置（结构对齐 `jenkins.config.example.json`，无私有凭据）。
  - CLI 各参数的默认值，以及每个参数的说明、用法、示例。
  - Job 参数逻辑角色的**可改名 key**与默认值（避免 Jenkins 参数名硬编码）。
- 配置路径与安装目录解耦：一律使用 Tauri 运行时 API，不写死安装盘符/用户目录假设。

### 非目标（本期不做）

- 不修改 NSIS / 安装位置 / `installMode`（用户后续会迁移安装目录，本期刻意避开）。
- 不把 Node.js 打进安装包（依赖本机 Node 18+）。
- 不集成 jen-cli 的 Web/Server 控制台。
- 不把任何真实 `jenkins.config.json`（含 Token）带入仓库或默认配置。

## 2. 方案结论

采用 **方案 A：内置打包 + 单一服务器配置文件 + FPM 旁路默认值配置 + PATH 注入**。

| 配置 | 存放 | 内容 |
|------|------|------|
| `jenkins.config.json` | 应用配置目录（`app_config_dir`） | **仅** `defaultServer` + `servers` |
| `jen-cli.defaults.json` | 同上 | CLI 默认值、`paramKeys`、`paramDefaults`、可选预设规则 |
| Vendored CLI | 安装包 resources（`resource_dir`） | `bin` + `lib` + Windows shim |

## 3. 打包与运行时布局

### 3.1 Vendoring

- 源码归属：拷贝进本仓库 `vendor/jen-cli/`（至少 `bin/jen-cli.mjs`、`lib/*.mjs`、精简 `package.json`）。
- 内置模板：`vendor/jen-cli/jenkins.config.example.json`（**对象 map** 格式的 `servers`，与现网 CLI `pickServer` 一致；不以 example 仓库里过时的数组格式为准）。
- 不拷贝：`web/`、`server/`、真实 `jenkins.config.json`、`node_modules/`、私有 Token。

### 3.2 安装包

- Tauri `bundle.resources` 包含 `vendor/jen-cli/**`。
- 运行时路径：`{resource_dir}/jen-cli/`（通过 Tauri `path::resource_dir`，不硬编码）。
- Windows：提供 `jen-cli.cmd`（调用本机 `node` 执行 `jen-cli.mjs`）。
- 若找不到 `node`：命令失败时输出明确提示；设置页可做 `node -v` 检测提示。

### 3.3 用户配置位置

- `{app_config_dir}/jenkins.config.json`
- `{app_config_dir}/jen-cli.defaults.json`
- 首次启动：若不存在服务器配置，从内置 example **生成占位结构**（无真实凭据）。
- 环境变量：
  - `JENKINS_CONFIG_PATH` → 服务器配置文件
  - `FPM_JEN_CLI_DEFAULTS`（或等价名）→ 默认值旁路文件
- CLI 仍支持 `--config` 覆盖服务器配置路径。

### 3.4 与安装目录的关系（刻意解耦）

- shim / PATH 目标 = **运行时 `resource_dir`**，不假设「装在用户目录」。
- 用户配置永远在 **`app_config_dir`**，与安装目录分离。
- **本期不改**安装器、安装路径、数据迁移策略。

## 4. 配置 Schema

### 4.1 `jenkins.config.json`（仅服务器）

```json
{
  "defaultServer": "tx",
  "servers": {
    "tx": {
      "baseUrl": "https://jenkins.example.com",
      "username": "your-user",
      "apiToken": "your-api-token"
    }
  }
}
```

- 与 Job、构建参数、预设规则**无关**。
- 设置 UI 展示 example 结构说明与示例（来自内置模板）。

### 4.2 `jen-cli.defaults.json` / `AppConfig.jenCli`（FPM 设置）

由设置 UI 维护，保存时同步写入旁路文件供 CLI 读取。逻辑结构示例：

```json
{
  "cliDefaults": {
    "server": "tx",
    "job": "",
    "intervalMs": 3000,
    "console": true
  },
  "paramKeys": {
    "branch": "branch",
    "nodeVersion": "NodeVersion",
    "installCommand": "INSTALL_COMMAND_ACTIVE",
    "buildCommand": "BUILD_COMMAND_ACTIVE",
    "project": "project"
  },
  "paramDefaults": {
    "branch": "uat5",
    "nodeVersion": "v24.12.0",
    "installCommand": "pnpm i",
    "buildCommand": "pnpm build:uat",
    "project": ""
  },
  "presets": {
    "rules": []
  }
}
```

- **`paramKeys`**：逻辑角色 → 实际 Jenkins 参数名（可改，避免硬编码）。
- **`paramDefaults`**：按逻辑角色存默认值；写入 Job 参数时经 `paramKeys` 映射。
- **`presets.rules`**（可选，后期可演进）：按 server/job 条件应用默认值；同样经 `paramKeys` 解析真实 key。**不写入** `jenkins.config.json`。

## 5. 设置 UI

设置主面板增加 **jen-cli** 入口，打开专用子面板（模式对齐 IDE / AI 设置）。

### 5.1 块一：Jenkins 服务器

- 编辑 `defaultServer`、servers 列表（alias / baseUrl / username / apiToken；Token 可遮罩）。
- 增删改后保存到 `{app_config_dir}/jenkins.config.json`。
- 旁侧或折叠区：example 说明 + 示例 JSON。

### 5.2 块二：CLI 与 Job 参数默认

- **CLI 参数文档表**：`--config`、`--server`、`--job`、`--params`、`--param`、`--key`、`--no-console`、`--interval`，以及快捷命令 `run` / `list` / `lp` / `ln`；每项含说明、用法、示例。
- 对可设默认值的项提供编辑（server / job / interval / console 等）。
- **参数 Key 映射** + **参数默认值**编辑。
- 保存写入 `AppConfig.jenCli` 并写出 `jen-cli.defaults.json`。

### 5.3 系统 PATH 开关

- 「将 jen-cli 加入用户 PATH」开关；说明需重开外部终端后生效。
- Node 未安装时的提示条。

## 6. PATH 注入

### 6.1 应用内终端（必做）

- `pty_spawn` 时：
  - 将 `{resource_dir}/jen-cli`（shim 所在目录）**前置**到进程 `PATH`；
  - 设置 `JENKINS_CONFIG_PATH`、`FPM_JEN_CLI_DEFAULTS`（或等价）指向应用配置目录文件。
- 用户在应用终端可直接：`jen-cli --help`、`jen-cli run ...`。

### 6.2 系统终端（Windows 为主，一并做）

- 将同一 shim 目录写入**当前用户** PATH（`HKCU\Environment\Path`），不改机器级 PATH。
- 设置中可开关；关闭则移除该条目。
- UI 提示：已打开的外部终端需重新打开。

## 7. Vendored CLI 行为变更

1. 服务器配置解析顺序：`--config` → `JENKINS_CONFIG_PATH` →（可选）回退提示，不再默认绑定仓库根目录私有文件。
2. 服务器配置仍只认 `defaultServer` + `servers`。
3. 读取 `FPM_JEN_CLI_DEFAULTS`（旁路 JSON）：
   - 未显式传入的 CLI 默认（server/job/interval/console）可从此补齐；
   - 预设/默认 Job 参数通过 `paramKeys` 映射真实字段名，**删除**对 `branch` / `NodeVersion` 等的硬编码字面量依赖。
4. 保持现有命令面：`run`、`list`/`ls`/`l`、`lp`、`ln`。

## 8. 数据流（简图）

```
设置 UI
  ├─ 保存服务器 ──► app_config_dir/jenkins.config.json
  └─ 保存 CLI/参数默认 ──► AppConfig.jenCli
                         └─► app_config_dir/jen-cli.defaults.json

pty_spawn / 系统 PATH
  └─ PATH += resource_dir/jen-cli
  └─ env: JENKINS_CONFIG_PATH, FPM_JEN_CLI_DEFAULTS

jen-cli
  ├─ 读 jenkins.config.json（仅服务器）
  └─ 读 jen-cli.defaults.json（默认值 + 可改 key）
```

## 9. 错误处理

- 缺少 Node：shim / 设置页明确提示安装 Node 18+。
- 缺少或损坏的配置文件：可读错误信息；设置页可「从示例重置服务器配置（清空 Token 占位）」。
- PATH 写入失败：设置开关显示错误，不影响应用内终端（应用内仍靠 `pty_spawn` 注入）。
- Token 仅存本地 app config，不进 git、不进日志明文（日志可遮罩）。

## 10. 测试要点

- 资源目录存在 `jen-cli.mjs` / `jen-cli.cmd`；应用终端 `jen-cli --help` 成功（有 Node 时）。
- 保存服务器配置后，文件落在 `app_config_dir`，内容无私有示例 Token。
- 修改 `paramKeys` 后，CLI 使用新 key 名拼参数（可用假配置单测/集成测）。
- PATH 开关：开启后用户 PATH 含 shim 目录；关闭后移除。
- 不依赖硬编码的安装路径字符串。

## 11. 实现顺序（概要）

1. Vendoring `vendor/jen-cli` + example 模板 + Windows shim  
2. 配置读写 API（服务器文件 + defaults 文件）与类型  
3. 设置 UI（服务器块 + CLI/参数块 + PATH 开关）  
4. `pty_spawn` 环境注入  
5. 用户 PATH 注入/移除  
6. 改造 vendored 预设逻辑为配置驱动  

---

审查清单：确认 schema 拆分、UI 分块、PATH 行为、以及「不碰安装目录」约束是否与预期一致。批准后进入实现计划。
