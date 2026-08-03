# 操作栏布局重构 — 实现计划

> 规格：`docs/superpowers/specs/2026-08-03-action-bar-layout-design.md`

**目标：** 将右侧工具窗迁到文件目录右侧为「操作栏」，Tab + 当前 Tab 内搜索。

## 已完成

- [x] `layoutStore`：去掉 meta / stack；`setActiveTool` 始终一个 Tab
- [x] 新建 `ActionBar.tsx`；`App.tsx` 网格：`目录 | 操作栏 | 主区`
- [x] `DetailPane` 移除 `ToolWindow`；删除 `ToolWindow.tsx`
- [x] `CommandPanel` / `GitToolPanel` / IDE·环境：支持 `filterQuery`
- [x] i18n + `.action-bar*` 样式
