# Frontend Project Manager (FPM)

Tauri 2 + React 19 + Vite 8 + Zustand 桌面端前端项目管理器。

## 功能

- 多 Workspace：扫描子目录中带 `package.json` 的项目
- 展示 pkg name/version、框架依赖、语言扩展、Git 分支、`.env*`
- 一键执行 scripts / 手动命令，底部流式终端
- 自定义标签 + 搜索筛选
- 用 VS Code / WebStorm / Cursor（或自定义 IDE）打开项目

## 开发

```bash
npm install
npm run tauri dev
```

仅前端：

```bash
npm run dev
```

## 设计文档

- [规格](docs/superpowers/specs/2026-07-21-frontend-project-manager-design.md)
- [实现计划](docs/superpowers/plans/2026-07-21-frontend-project-manager.md)
