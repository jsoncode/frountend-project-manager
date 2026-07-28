# Git 合并冲突 UI — 实现计划

> **面向 AI 代理：** 按任务顺序实现。用户已确认规格；本会话直接实现，非经要求不自动 commit。

**目标：** WebStorm 式合并：文件列表 + 三栏 Diff；可取消/继续；拉取冲突与 MERGE_HEAD 共用 UI。

**规格：** `docs/superpowers/specs/2026-07-28-git-merge-ui-design.md`

**技术栈：** Tauri git CLI + React + Monaco 三栏编辑器

**状态：** 已实现（2026-07-28）

---

## 文件

| 路径 | 职责 |
|------|------|
| `src-tauri/src/git.rs` | `git_merge_*` 实现 |
| `src-tauri/src/lib.rs` + permissions + capabilities | 注册命令 |
| `src/lib/types.ts` | MergeStatus 类型 |
| `src/lib/mergeConflictParse.ts` | 冲突块解析 |
| `src/components/MergeConflictModal.tsx` | 弹框 1 |
| `src/components/MergeDiffModal.tsx` | 弹框 2 三栏 |
| `src/components/GitToolPanel.tsx` | 菜单/徽章入口 |
| `src/stores/projectStore.ts` | mergeStatus 刷新 |
| `src/i18n/messages.ts` | 文案 |
| `src/styles/app.css` | 样式 |

- [x] 任务 1：Rust merge API
- [x] 任务 2：类型 + store 刷新 merge 状态
- [x] 任务 3：MergeConflictModal + 接入合并/继续/取消
- [x] 任务 4：MergeDiffModal 三栏
- [x] 任务 5：拉取冲突挂钩 + i18n/样式 + 验证
