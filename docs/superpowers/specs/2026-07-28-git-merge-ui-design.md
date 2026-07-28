# Git 合并冲突 UI（三栏 Diff）— 设计规格

日期：2026-07-28  
状态：已确认（实现中）  

## 1. 目标与非目标

### 目标

- 合并代码时提供接近 WebStorm 的体验：先弹框列出 from 分支带来的变更文件（**无冲突灰色 / 冲突红色**），再支持整文件采用本人/他人，或打开三栏 Diff 逐块合并。
- 合并使用 `git merge --no-commit --no-ff`，**不自动提交**；用户点「完成合并」才 commit，「取消合并」走 abort。
- 不把 git merge 的大段输出灌进交互终端（避免提示符错乱）。

### 非目标

- 不做完整 rebase / cherry-pick 冲突 UI（若日后需要可复用同一弹框骨架）。
- 不引入 libgit2 / nodegit；继续使用系统 `git` CLI。
- 三栏不做完整 LSP/类型检查（大文件以纯文本编辑为主）。

## 2. 方案结论

采用 **方案 A：Git 原生 merge + 自研文件列表弹框 + 三栏 Monaco 结果编辑**。

收尾：用户点击「完成合并」才 commit；取消走 `git merge --abort`。

Diff 形态：**三栏** — 本人（ours）| 他人（theirs）| 合并结果（可编辑）。

## 3. 触发与状态

### 3.1 进入合并中

| 入口 | 行为 |
|------|------|
| 右键「合并到当前分支」 | 调用 `git_merge_start`；无冲突则提示成功并刷新；有冲突则打开弹框 1 |
| 拉取冲突 | pull 命令返回冲突态时打开弹框 1（同一 `git_merge_status` 数据） |
| 打开/刷新项目且存在 `MERGE_HEAD` | 不强制弹框；分支旁显示「合并中」；右键「继续合并」打开弹框 1 |

### 3.2 UI 标记与菜单

- 当前分支名后徽章：**合并中**（`git_merge_status.inProgress === true`）。
- Git 分支右键（合适上下文）：**继续合并**；可选 **取消合并**。
- 原「合并到当前分支」改为走 `git_merge_start`，不再只 `runGit('git merge …')`。

### 3.3 取消

- 弹框或菜单「取消合并」→ `git_merge_abort` → 刷新 git/status → 关闭弹框。

## 4. 弹框 1 — 文件列表

- 标题：合并 `incoming` → `current`（继续合并时由 status 推断）。
- 列表：相对路径 + 状态。
  - 冲突（如 UU/AA/DD）：**红色**。
  - 已暂存解决 / 无冲突变更：普通样式。
- 选中冲突文件：
  - **使用本人（ours）** → resolve `ours`
  - **使用他人（theirs）** → resolve `theirs`
  - **打开 Diff 合并…** → 弹框 2
- 底部：
  - **取消合并**
  - **完成合并**（无未解决冲突时可点）→ 确认对话框 → `git_merge_commit`（默认 merge message，可允许编辑 message）

## 5. 弹框 2 — 三栏 Diff

| 栏 | 内容 | 可编辑 |
|----|------|--------|
| 左 | 本人 ours（`git show :2:path`） | 否 |
| 中 | 他人 theirs（`git show :3:path`） | 否 |
| 右 | 合并结果（初始为工作区文件，含冲突标记） | 是 |

### 交互

- 解析冲突块（`<<<<<<<` / `=======` / `>>>>>>>`），块级操作：**采用本人** / **采用他人** / **两者都保留**。
- 结果栏可手改。
- **保存并标记已解决**：写回工作区 + `git add` → 关闭弹框 2 → 刷新弹框 1。
- 关闭且未保存：提示丢弃或取消关闭。

### 实现要点

- 三个 Monaco `IStandaloneCodeEditor`，主题与现有编辑器一致。
- 大文件跳过重型语言服务，按扩展名设 language id 即可。

## 6. 后端命令

| 命令 | 说明 |
|------|------|
| `git_merge_start(path, ref)` | `git merge <ref>`；返回 `{ status: 'clean' \| 'conflicts', ...status }` |
| `git_merge_status(path)` | `inProgress`, `current`, `incoming?`, `files[]`（path, code, conflict） |
| `git_merge_file_sides(path, file)` | `{ ours, theirs, working }` 文本 |
| `git_merge_resolve_file(path, file, { mode: 'ours'\|'theirs' } \| { content: string })` | 整文件采用或写入 content 后 `git add` |
| `git_merge_abort(path)` | `git merge --abort` |
| `git_merge_commit(path, message?)` | 完成合并提交；无冲突时才允许 |

拉取：现有 `git_pull_branch` 在冲突时返回可识别错误/结构化结果，前端调用 `git_merge_status` 并打开 UI。

权限与 capabilities 同步注册上述命令。

## 7. 前端组件（建议）

- `MergeConflictModal` — 弹框 1 文件列表  
- `MergeDiffModal` — 弹框 2 三栏  
- `lib/mergeConflictParse.ts` — 冲突块解析  
- `GitToolPanel` / `projectStore` — 合并中徽章、菜单、拉取冲突挂钩  
- `refreshGit` / `git_status` — 打开项目时带上 `git_merge_status` 或把 merge 信息并入 status

## 8. 数据流

```
合并/拉取冲突/继续合并
  → git_merge_status
  → MergeConflictModal（列表）
       ├─ ours/theirs → git_merge_resolve_file
       ├─ Diff → MergeDiffModal → 保存 → resolve content
       ├─ 取消 → git_merge_abort
       └─ 完成 → 确认 → git_merge_commit → refreshGit
```

## 9. 错误处理

- `merge --abort` 失败（无 MERGE_HEAD）：提示并刷新。
- 二进制冲突：列表可标「二进制」；仅提供整文件 ours/theirs，不打开三栏文本 Diff。
- 完成合并时仍有未解决冲突：禁用按钮并提示剩余数量。

## 10. 测试要点

- 无冲突 merge：直接成功，不弹冲突框。
- 有冲突：列表标红；ours/theirs 后冲突数减少；abort 后工作区干净。
- Diff 保存后文件无冲突标记且已 staged。
- 打开含 MERGE_HEAD 的仓库：显示「合并中」；继续合并可恢复列表。
- 拉取冲突进入同一 UI。

## 11. 实现顺序（概要）

1. Rust：`git_merge_*` 命令 + permissions  
2. `git_merge_status` 接入 project 刷新与分支徽章  
3. MergeConflictModal + 接入右键合并 / 继续 / 取消  
4. MergeDiffModal 三栏 + 冲突块操作  
5. 拉取冲突挂钩  
6. i18n 与样式  

---

请审阅本规格。批准后进入实现计划并开工。
