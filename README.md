# Gitaur

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Gitaur" width="128">
</p>

<p align="center">一款基于 Tauri v2 的跨平台 Git 桌面客户端</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#gitflow-开发规范">GitFlow 开发规范</a> •
  <a href="#技术栈">技术栈</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#项目结构">项目结构</a>
</p>

---

## 简介

Gitaur 是一款轻量、高性能的 Git 桌面客户端，基于 Tauri v2（Rust + Web）构建。提供直观的图形界面来管理 Git 仓库，支持本地 Git 操作、分支管理、提交历史可视化，以及 GitLab 集成。

## 功能特性

### 仓库管理

- 打开 / 克隆 / 初始化 Git 仓库
- 多仓库管理，支持自定义别名、搜索过滤
- 自动打开上次使用的仓库

### Git 操作

- 提交、推送、拉取、获取远程更新
- 分支创建、切换、删除、重命名
- 合并（merge）与变基（rebase），支持冲突检测
- 暂存区管理（暂存 / 取消暂存 / 全部暂存）
- 文件差异对比（Diff View）

### 提交历史

- 图形化提交历史展示
- 提交详情查看（作者、时间、变更文件）
- 文件级 Diff 查看

### 流水线（Pipeline）

- 自定义工作流任务，串联开发 → 提交 → 同步 → 推送等步骤
- 任务状态跟踪（待执行 / 运行中 / 暂停 / 完成 / 已取消）
- 与分支关联，按仓库独立管理

### GitLab 集成

- 关联 GitLab 项目
- 合并请求管理：创建、查看、审批、合并
- 评论与讨论

### 设置

- Git 用户信息配置（用户名、邮箱）
- GitLab 连接配置（URL、Token）
- 主题切换（深色 / 浅色）

---

## GitFlow 开发规范

本项目采用 **GitFlow** 分支模型进行开发。

### 分支模型

```
main ──────────────────────────────────────→ 生产环境
 ↑
 ↑  hotfix/* ──→ 紧急修复，合回 main + develop
 ↑
develop ─────●───────●───────●────────────→ 集成分支
              ↑       ↑       ↑
              ↑       ↑       release/* ──→ 发版准备，合回 main + develop
              ↑       ↑
         feature/* feature/* ──→ 功能开发
```

### 分支类型

| 分支 | 来源 | 目标 | 用途 |
|------|------|------|------|
| `main` | — | — | 生产环境，始终可部署 |
| `develop` | — | — | 集成分支，功能汇合点 |
| `feature/*` | develop | develop | 新功能开发 |
| `bugfix/*` | develop | develop | 非紧急 bug 修复 |
| `hotfix/*` | main | main + develop | 生产环境紧急修复 |
| `release/*` | develop | main + develop | 发版准备（测试、版本号、changelog） |

### 分支命名规范

```
feature/用户登录功能
feature/订单列表优化
bugfix/修复登录超时
hotfix/修复支付接口异常
release/v1.2.0
```

### 开发流程

#### 1. 新功能开发（feature）

```bash
# 从 develop 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/新功能名

# 开发 → 提交 → 推送
git add .
git commit -m "feat: 新功能描述"
git push origin feature/新功能名

# 在 GitLab 创建 MR → 目标分支 develop
# 代码审查通过后合并到 develop
```

#### 2. Bug 修复（bugfix）

```bash
# 从 develop 创建修复分支
git checkout -b bugfix/修复描述 develop

# 修复 → 提交 → 推送 → 创建 MR → 合并到 develop
```

#### 3. 紧急修复（hotfix）

```bash
# 从 main 创建热修复分支
git checkout main
git pull origin main
git checkout -b hotfix/紧急修复描述

# 修复 → 提交 → 推送
# 创建 MR → 目标分支 main
# 同时 cherry-pick 或合并到 develop
```

#### 4. 发版准备（release）

```bash
# 从 develop 创建发版分支
git checkout -b release/v1.2.0 develop

# 测试、修 bug、改版本号、写 changelog
# 创建 MR → 目标分支 main
# 合并后在 main 打 tag
git tag v1.2.0
git push origin v1.2.0
# 同时合并回 develop
```

### 合并策略

本项目使用 **Squash Merge**，将功能分支的多个提交压缩为一个提交合入目标分支，保持主线历史清晰。

### 冲突处理

当 rebase 产生冲突时：

1. 在编辑器中打开冲突文件，手动解决冲突
2. 删除冲突标记（`<<<<<<<` `=======` `>>>>>>>`），保留正确内容
3. 保存文件
4. 在应用中点击 **"已解决，继续"**

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| UI 组件 | Ant Design 5 |
| 代码编辑器 | Monaco Editor |
| 状态管理 | Zustand |
| 构建工具 | Vite 8 |
| 桌面框架 | Tauri v2 |
| 后端 | Rust |
| 代码检查 | OxLint |
| 包管理 | pnpm |

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8
- [Rust](https://www.rust-lang.org/) >= 1.70
- [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/your-username/gitaur.git
cd gitaur

# 安装依赖
pnpm install

# 启动开发模式
pnpm dev
```

### 构建发布版本

```bash
pnpm build
pnpm tauri build
```

## 开发指南

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发模式（前端 + Tauri 热重载） |
| `pnpm vite` | 仅启动前端开发服务器 |
| `pnpm build` | 构建前端（TypeScript 编译 + Vite 打包） |
| `pnpm lint` | 运行 OxLint 代码检查 |
| `pnpm preview` | 预览前端构建产物 |
| `pnpm tauri build` | 构建桌面应用安装包 |

### 调试

- **前端**：开发模式下按 `F12` 打开开发者工具
- **Rust 后端**：查看终端输出，或使用 `dbg!()` 宏
- **日志**：Debug 模式下自动记录日志

## 项目结构

```
gitaur/
├── src/                          # 前端源码
│   ├── components/
│   │   ├── Layout/               # 布局（AppLayout、Titlebar、BranchPanel）
│   │   ├── Toolbar/              # 工具栏弹窗（打开仓库、克隆、新建分支）
│   │   ├── Graph/                # 提交历史图形化（HistoryView、CommitDetailPanel）
│   │   ├── DiffView/             # 文件差异对比（Monaco Editor）
│   │   ├── FileTree/             # 文件树（虚拟滚动）
│   │   ├── Pipeline/             # 流水线面板（状态机驱动）
│   │   ├── MergeRequest/         # GitLab 合并请求
│   │   ├── Settings/             # 设置页
│   │   └── ErrorBoundary.tsx     # 错误边界
│   ├── stores/                   # Zustand 状态管理
│   │   ├── repoStore.ts          # 仓库状态（文件监听、状态刷新）
│   │   ├── repoManagerStore.ts   # 多仓库管理
│   │   ├── pipelineStore.ts      # 流水线状态（任务 CRUD、MR 轮询）
│   │   ├── gitlabStore.ts        # GitLab 集成（项目搜索、MR 管理）
│   │   ├── branchTagStore.ts     # 分支标签
│   │   ├── settingsStore.ts      # 全局设置
│   │   └── viewStore.ts          # 视图状态
│   ├── hooks/                    # 自定义 Hooks
│   │   ├── useMrPolling.ts       # MR 状态轮询（指数退避）
│   │   └── useFileWatcher.ts     # 文件监听（防抖）
│   ├── services/                 # 服务层（GitLab API）
│   ├── types/                    # TypeScript 类型定义
│   ├── App.tsx                   # 应用主组件（懒加载页面）
│   └── main.tsx                  # 入口文件
├── src-tauri/                    # Tauri 后端源码
│   ├── src/
│   │   ├── commands/             # Tauri 命令（git、repo、gitlab）
│   │   ├── git/                  # Git 操作封装（executor、parser）
│   │   ├── watcher.rs            # 文件监听（自动刷新）
│   │   └── lib.rs                # 应用入口
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 配置
├── public/                       # 静态资源
├── package.json                  # 前端依赖
├── vite.config.ts                # Vite 配置
└── tsconfig.json                 # TypeScript 配置
```

## 许可证

[MIT](LICENSE)
