# antd 6 重构约定（供并行任务使用）

目标：把 FPM 的自定义 UI 控件替换为 antd 6 组件，保持全部业务逻辑、store 调用、i18n key 不变。
antd 6.6.0 + @ant-design/icons 6.3.2 已安装，React 19 原生支持，无需补丁。

## 必须遵守

1. **只换 UI 原语，不动逻辑**：不改 store 调用、不改 i18n key、不改事件语义、不改组件 props 契约。
   删除的只有：被 antd 替代的自定义按钮/输入/下拉/菜单/弹窗的 JSX 与其专用 className（可保留容器 className）。

2. **不要改 CSS 文件**（src/styles/*.css）。antd 的观感由 src/theme/antdTheme.ts 的 ConfigProvider token 统一控制，
   全局 CSS 收敛由主代理集中处理。若某元素必须临时套样式，用 antd 的 `style={{}}` 内联或 `className`（保留旧类名即可，不要新增 CSS）。

3. **弹窗一律走 `ModalShell`**（src/components/ModalShell.tsx，已基于 antd Modal）：
   - 保持现有 props 用法：`title / onClose / className / wide / footer / elevated / nested / closeOnEsc`。
   - `footer` 里放 antd `Button`（多个按钮用 `<>...</>` 包裹，不要再用 `.modal-actions` 容器）。
   - 正文直接用 antd 组件；旧 `.input-block` / `.btn` 类不再需要。

4. **按钮**：普通 = `<Button>`；主操作 = `<Button type="primary">`；危险 = `<Button danger>`；
   紧凑条/工具条 = `size="small"` 或 `type="text"`。图标用 `@ant-design/icons`（icon 不传 `size`，用 `style={{ fontSize: n }}`）。

5. **Tooltip**：继续 import `Tooltip` from `./Tooltip`（或 `../components/Tooltip`，antd 薄封装，API 兼容旧版）。

6. **输入/选择**：`Input` / `Input.TextArea` / `Input.Search` / `Select` / `AutoComplete` / `Segmented` /
   `Switch` / `Slider` / `Checkbox` / `Radio` 等直接使用；`Select` 用 `options` 数组 + `value`/`onChange`。
   保留 placeholder、disabled 等语义。`window.confirm / window.alert` 一律保持原样（不要改成 antd modal/message）。

7. **下拉/右键菜单**：自定义 `ContextMenuPortal` + `SubMenuItem`（Explorer/OpenWithMenu 使用）保留不动
   （它们是 portaled 右键菜单基础设施）；仅把其中“按钮样式”换成 antd 会破坏结构，所以**这些文件里的菜单项按钮保持原样**，
   只换菜单之外的工具栏按钮/输入。普通悬浮下拉（如标题栏 File 菜单）用 antd `Dropdown`。

8. **Tabs**：面板内切换可用 antd `Tabs`（items 数组）或 `Segmented`；Explorer 顶部的 workspace 手风琴逻辑是 store 驱动，保留原实现。

9. **图标**：新代码优先 `@ant-design/icons`（如 `SearchOutlined`、`DeleteOutlined`、`PlusOutlined`、
   `CloseOutlined`、`SettingOutlined`、`PlayCircleOutlined`、`ReloadOutlined`、`FolderOpenOutlined`、
   `CopyOutlined`、`CheckCircleOutlined`、`LoadingOutlined` 等）；已有 `reicon-react` 图标可保留不换。

10. **验证**：改完运行 `pnpm exec tsc -b`（或 `pnpm build`）确保无 TS 错误；`pnpm lint` 通过（oxlint，规则较严：
    不要有 `any`、未使用变量等）。注意 `pnpm build` 的退出码在 PowerShell 管道里可能假阳性，直接看输出里的
    "error TS" 或 "✓ built"。

## 已完成的文件（不要动）

- src/main.tsx、src/ai-main.tsx（已包 AntdProvider）
- src/theme/antdTheme.ts、src/theme/AntdProvider.tsx（主题基础，勿改）
- src/components/ModalShell.tsx、Tooltip.tsx、TopBar.tsx、TitleFileMenu.tsx、SearchBox.tsx、
  ProjectHeader.tsx、NewWorkspaceModal.tsx、RenameModal.tsx、ErrorLogModal.tsx
