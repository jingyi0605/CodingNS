<div align="center">

# CodingNS

**AI Coding Anytime, Anywhere**

**随时随地，AI编程不间断**

[![Node](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9.0.0-blue.svg)](https://pnpm.io/)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-orange.svg)](https://tauri.app/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](#)
[![QQ](https://img.shields.io/badge/QQ%E4%BA%A4%E6%B5%81%E7%BE%A4-1092985965-blue.svg)](#)

[English](#english) | [中文](#中文)

</div>

---

## English

### 🎯 Vision

CodingNS provides a complete closed-loop AI programming workflow, enabling you to code with AI anytime, anywhere, from any client. Whether you're on desktop, mobile, or web browser, seamlessly continue your AI coding sessions across all platforms.

![image-20260328T235904.webp](img/image-20260328T235904.webp)

Consistent experience across H5, Windows, and macOS.

![alt text](img/image.png)

The iOS app is now live on the App Store, and the Android app is already supported. Version `0.8.0` adds workspace-scoped assistant office capabilities, `office.browser` real-browser bridge support, static HTML presentation editing with layout tools, and a more stable packaging and runtime chain.

### ✨ Core Features

> Current status: the iOS app has been released on the App Store, the Android app is already supported, and version `0.8.0` adds workspace-scoped assistant office capabilities, `office.browser` real-browser bridge support, static HTML presentation editing with layout tools, and a more stable packaging and runtime chain.

#### 🔄 Multi-Provider Session Sync
- **Seamless CLI Session Continuation**: Support for Claude Code, Codex, OpenCode and other mainstream AI programming tools
- **Session Discovery & History**: Automatically discover and sync local CLI session history
- **Real-time Message Subscription**: Receive and display AI coding session message streams in real-time
- **Session State Awareness**: Consistent running, unread, and failure states with error codes and summaries
- **Session Event Notifications**: Toast notifications for permission requests, session completion, and failures with one-click navigation
- **Sub-Agent Recognition**: Correctly identify and classify CLI sub-Agent sessions separately from main sessions
- **Message Normalization**: Unified message format across different providers for consistent experience

#### 🌿 Session Forking
- **Create Sub-sessions from Any Message**: Fork new sessions from any point in conversation history
- **Cross-Provider Forking**: Fork sessions between different AI providers (Claude Code, Codex, OpenCode)
- **Branch Tree Visualization**: Visual branch tree showing parent-child relationships and session hierarchy
- **Branch Persistence**: Branch relationships are persisted and synced across all clients

#### 💬 Conversational Interface
- **Session as Workspace**: Each conversation is an independent workspace with unified context management
- **Real-time Message Rendering**: Support for Markdown, syntax highlighting, and tool call visualization
- **Unified Permission Handling**: Review command execution, file changes, permission grants, and user-input requests inside the conversation
- **Permission Mode Isolation**: Clear separation between "full permission" and "secondary approval hook" modes
- **Compound Input Panel**: Integrated file upload, context management, and quick commands
- **Demo Mode**: Start a controlled demo environment with `codingns start --demo`, including an auto-created demo account
- **Capability-Driven**: Dynamically adjust available features based on provider capabilities

#### 🧭 Workspace Assistant & Office Capabilities
- **Scoped Assistant Entry Points**: Workspace sessions can call controlled assistant capabilities for documents, browser tasks, terminals, and ops without turning into an unrestricted control plane
- **Office Browser Tasks**: Use a unified `office.browser` entry for DOM reading, screenshots, form actions, downloads, and task artifacts
- **Real Browser Bridge**: Add `opencli_bridge` as an explicit backend when you need a real Chrome or Edge profile and existing login state
- **Browser Profiles & Task Panel**: Manage browser profiles, task history, and bridge health from the settings area
- **Controlled Preview Flow**: Keep office screenshots and local images inside the same controlled preview pipeline

#### 📁 File Management
- **File Tree Browser**: Visualize project file structure
- **File Context Mounting**: Quickly add file contents to session context
- **File Search**: Quickly locate files in your project
- **Change-focused Views**: Git status badges, change filters, and diff preview
- **Path Linking & Cleaner Trees**: Jump from chat paths to files and hide system files by default when needed
- **Richer Preview & Editing**: Support text editing plus HTML/PDF preview, refresh, and fullscreen
- **Static HTML Presentation Editing**: Open slide-style HTML files in a presentation view, edit text and layout, and export while keeping the visual result stable

#### 🔀 Git Integration
- **Git Status Display**: Real-time view of file change status
- **Commit Workflow Integration**: Complete code commits directly within sessions
- **Version Drill-down**: View recent versions, full history, commit details, and explain changes inside the app
- **Quick Metadata Copy**: Copy commit hash, version labels, and other release-facing details in one click
- **Multi-remote Push**: Push to multiple remotes in one action
- **Rule Validation**: Support for custom commit rules

#### 💻 Terminal Capabilities
- **Real PTY Terminal**: Complete terminal experience based on node-pty
- **Multi-Terminal Support**: Manage multiple terminal sessions simultaneously
- **Terminal Persistence**: Terminal output caching and history playback
- **Replay Stability Improvements**: Fix timing and scrolling issues between history replay and live output
- **Windows Terminal Recovery**: Restore persisted terminals and choose the shell before creation
- **Reconnection**: Automatic terminal session recovery after network interruption

#### 🔧 Runtime & Delivery Stability
- **Windows Install Hardening**: Tighten native dependency checks and keep the Windows installation path more predictable
- **Package Runtime Fixes**: Fix `codingns` npm packaging and runtime dependency discovery
- **Session Runtime Corrections**: Fix workspace Codex runtime home scoping and reduce stale-session surprises
- **Refresh & File Tree Fixes**: Improve file tree recovery, session counters, and workspace refresh stability

#### ☁️ Account Preference Sync
- **Account-level Settings Sync**: Language, theme, and default permission mode follow your account across clients
- **Provider Defaults Sync**: Keep default model and reasoning level in sync
- **Local Preference Layering**: Device-specific UI preferences stay local instead of being forced onto every client

#### 🌐 Multi-Host & Remote Access
- **Multi-Host Switching**: Switch between multiple hosts on desktop and mobile without losing runtime context
- **Remote Entry Unification**: Keep login, workspace, and runtime entry behavior consistent after host switching
- **Built-in Tailscale Management**: Manage instance-level Tailscale status, install guidance, and remote access entry from settings

#### 🧩 Skill Management
- **Settings-based Skill Management**: Add, scan, import, and inspect Skills directly from the settings page
- **Unified Skill Sync**: Reuse the same Skill reconciliation flow for Butler and other execution targets
- **Target Binding Awareness**: Track which Skill is available to which runtime target, avoiding duplicate or stale bindings

#### 🎨 Minimalist Interface Design
- **Engineer-Centric Aesthetics**: Balance between functionality and beauty
- **Zero Distraction**: Remove redundant decorations, highlight core work areas
- **High Information Density**: Rational use of screen space, display more effective information
- **Efficient Interaction**: Keyboard-first, gesture-assisted interactions
- **Theme Customization**: Light/dark theme support for different working environments

#### ⚙️ Process Management
- **Dev Server Management**: Start, monitor, and stop development processes
- **Port Detection**: Automatic identification of process port usage
- **Log Tracking**: Real-time process output logging
- **Reverse Proxy**: Proxy dev apps through a single port with HTTP/WebSocket passthrough and file upload support

#### 🪟 Desktop Workbench
- **Multi-window Support**: Detach file, Git, and terminal-management panels into independent windows
- **Drag-to-detach Workflow**: Drag workbench tabs into their own windows for side-by-side work
- **Window State Management**: Keep detached window state, focus, and reopen behavior consistent

#### 📱 Multi-Platform Support
- **Desktop**: Native desktop applications (macOS, Windows, Linux) based on Tauri
- **Mobile**: iOS and Android native applications (Tauri Mobile)
- **Web**: Modern browser access
- **Platform Adaptation**: UI and interactions optimized for different platforms
- **Mobile Experience Fixes**: Updated splash assets and improved iPad orientation, safe-area, and attachment picker behavior

#### 🔌 Provider Extension Framework
- **Unified Extension Protocol**: Standardized provider integration specification
- **Capability Declaration**: Provider self-capability declaration and discovery
- **Compatibility Testing**: Built-in provider compatibility test samples

### 🏗️ Architecture

```
CodingNS/
├── apps/
│   ├── host/           # Backend service (Fastify + WebSocket)
│   ├── user-app/       # Frontend app (React + Tauri)
│   └── desktop/        # Desktop shell project
├── packages/
│   ├── session-sync-core/  # Session sync core library
│   └── codingns/       # Standalone NPM package (all-in-one)
├── specs/              # Feature specification documents
└── scripts/            # Build and deployment scripts
```

#### Core Components

| Component | Tech Stack | Description |
|-----------|------------|-------------|
| **Host** | Fastify + WebSocket + SQLite + node-pty | Backend service providing HTTP/WebSocket APIs, managing sessions, terminals, and processes |
| **User App** | React + TypeScript + Tauri | Cross-platform client application |
| **Session Sync Core** | TypeScript | Core SDK encapsulating session sync and provider adaptation logic |
| **CodingNS Package** | Node.js | Standalone NPM package with complete backend capabilities |

### 🚀 Quick Start

#### Requirements

- **Node.js** >= 22.0.0
- **npm** >= 10.0.0
- **pnpm** >= 9.0.0
- **Rust** >= 1.70 (required for desktop development)

#### Install From npm

`@jingyi0605/codingns` includes native dependencies such as `better-sqlite3` and `node-pty`, so platform handling matters.

On Linux, install the native build tools first:

```bash
apt-get update
apt-get install -y build-essential python3
```

On Windows, the recommended path is the one-click installer below. It uses a CodingNS-managed Node.js 22 runtime and managed Windows native packages for `node-pty` and `better-sqlite3`, so normal installation no longer requires you to manually install Visual Studio Build Tools or switch your system Node.js version.

If you bypass the installer and run `npm install -g` directly on Windows, use Node.js 22 on x64. Build tools are only needed for unsupported platforms or when npm is forced to fall back to local native compilation.

```bash
# Install globally
npm install -g @jingyi0605/codingns

# Start service
codingns start --port 3002
```

You can also run it without global install:

```bash
npx @jingyi0605/codingns start --port 3002
```

Common options:

- `--host`: listen host, default `0.0.0.0`
- `--port`: listen port, default `3002`
- `--data-dir`: data directory, default `~/.codingns`
- `--demo`: start in demo mode with an auto-created demo account and controlled demo sessions

#### One-click Install Script

If you want an interactive installer that handles dependency checks, npm install, service setup, and registry fallback automatically, run:

```bash
bash install.sh
```

The script will:

- Check Node.js, npm, and the required build tools first
- On supported macOS/Linux environments, offer to install missing prerequisites automatically
- On Windows, use a private Node.js 22 runtime and managed native packages, avoiding local `node-gyp` compilation in the normal path
- Ask for the service port, default `3002`
- Ask for the data directory, default `~/.codingns`
- Detect supported CLI tools and print a short summary
- Recommend `OpenCode` if no supported CLI is installed
- Automatically switch to `https://registry.npmmirror.com` when the official npm registry is unreachable
- Install or update `@jingyi0605/codingns`
- If you choose service mode, automatically install `pm2`, register the `codingns` service, and configure start on boot

#### Start On Boot With PM2

Install PM2:

```bash
npm install -g pm2
```

Run the service with a custom port and data directory:

```bash
pm2 start "$(which codingns)" --name codingns -- start --host 0.0.0.0 --port 3300 --data-dir ~/.codingns
```

Save the process list and generate startup configuration:

```bash
pm2 save
pm2 startup
```

After executing the system command printed by `pm2 startup`, run:

```bash
pm2 save
```

Common PM2 commands:

```bash
pm2 status
pm2 logs codingns
pm2 restart codingns
pm2 stop codingns
```

#### Develop From Source

```bash
# Clone repository
git clone https://git.jacksonz.cn:4443/jackson/CodingNS.git
cd codingns

# Install dependencies
pnpm install

# Rebuild native modules (if needed)
pnpm rebuild

# View development help
pnpm dev

# Start backend service
pnpm dev:backend

# Start frontend dev server
pnpm dev:frontend

# Start desktop development mode
pnpm dev:desktop
```

#### Build

```bash
# Build core library
pnpm build:session-sync-core

# Build backend service
pnpm build:host

# Build frontend app
pnpm build:user-app

# Build desktop app
pnpm build:desktop

# Build standalone NPM package
pnpm build:standalone
```

#### Test

```bash
# Test backend service
pnpm test:host

# Test frontend app
pnpm test:user-app
```

### 🛠️ Tech Stack

**Backend**
- [Fastify](https://fastify.dev/) - High-performance web framework
- [WebSocket (ws)](https://github.com/websockets/ws) - Real-time communication
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - SQLite database
- [node-pty](https://github.com/microsoft/node-pty) - Pseudo terminal support

**Frontend**
- [React 18](https://react.dev/) - UI framework
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Vite](https://vitejs.dev/) - Build tool
- [xterm.js](https://xtermjs.org/) - Terminal emulator
- [Tauri 2](https://tauri.app/) - Cross-platform desktop/mobile framework

**Testing**
- [Vitest](https://vitest.dev/) - Unit testing
- [Testing Library](https://testing-library.com/) - React component testing

### 📖 Documentation

Detailed feature specifications and design documents are located in the [`specs/`](./specs/) directory:

- **spec001** - Platform Foundation & Workspace Basics
- **spec001.1** - Account Preference Persistence & Cross-client Sync
- **spec002** - ClaudeCode & Codex Session Sync Core
- **spec003** - Conversational Interface & Message Runtime
- **spec003.1** - Native Session Realtime Conversation Runtime
- **spec003.2** - In-progress Message Appending & Native Onboarding
- **spec003.3** - Runtime Message Push & Stable Identifiers
- **spec003.4** - Session Activity Authority & Stable Display
- **spec004** - File Management Capabilities
- **spec005** - Git Context & Commit Rule Engine
- **spec006** - Terminal Core Capabilities
- **spec006.1** - Terminal Log Persistence & History Replay
- **spec007** - Process Management & Launcher
- **spec008** - Desktop & H5 Delivery Enhancements
- **spec009** - Mobile Experience & Notifications
- **spec009.1** - Mobile Workbench Navigation & Information Architecture
- **spec010** - Provider Extension Framework
- **spec010.1** - OpenCode Compatibility Integration
- **spec010.2** - Gemini CLI Compatibility Integration
- **spec010.3** - Kimi CLI Compatibility Integration
- **spec011** - Single-package Install & Unified Service Delivery
- **spec012** - Parallel Project Orchestration & Result Comparison
- **spec013** - Code Butler Platform & Cross-workspace Inspection Orchestration

### 🗺️ Roadmap

| Goal | Progress | Status |
|------|----------|--------|
| Session forking support with branch visualization | Completed | 🟢 Completed |
| Reverse proxy for process management — proxy dev apps through a single port | Completed | 🟢 Completed |
| iOS APP | Released on the App Store | 🟢 Completed |
| Demo mode and controlled demo environment | Completed | 🟢 Completed |
| Multi-window support on desktop | Completed | 🟢 Completed |
| Parallel dev mode — launch multiple CLI or model configs simultaneously for rapid dev validation on a single workspace | In development | 🟡 In Progress |
| Support more CLIs (Gemini CLI, Kimi CLI, etc.) | Completed  | 🟢 Completed  |
| CLI model quick switching with CC-SWITCH integration | Completed | 🟢 Completed |
| Support connecting to multiple hosts simultaneously | Completed | 🟢 Completed |
| Richer file preview and editor workflow | Completed | 🟢 Completed |
| Git commit drill-down, change explanation, and full history | Completed | 🟢 Completed |
| Settings-based Skill management and Butler Skill sync | Completed | 🟢 Completed |
| Built-in Tailscale for one-click NAT traversal | Completed | 🟢 Completed |
| Workspace-scoped assistant office capabilities | Completed | 🟢 Completed |
| `office.browser` real-browser bridge backend | Completed | 🟢 Completed |
| Static HTML presentation editing and layout tools | Completed | 🟢 Completed |
| Code Butler — manage multiple projects and sessions across workspaces, provide dev suggestions and act on behalf of the user | Completed  | 🟢 Completed  |
| Code Butler with real-time voice conversation | In development | 🟡 In Progress |

> Status legend: 🟢 Completed | 🟡 In Progress

### 🤝 Contributing

Contributions, bug reports, and suggestions are welcome!

### 📄 License

This project is licensed under the MIT License.

---

## 中文

### 🎯 项目愿景

CodingNS 致力于提供一整套闭环的 AI 编程工作流程，让你能够随时随地通过任何客户端进行 AI 编程。无论你使用桌面电脑、移动设备还是 Web 浏览器，都能无缝续接你的 AI 编程会话。

![image-20260328T235904.webp](img/image-20260328T235904.webp)

支持 H5、Windows、macOS，均保持一致体验；

![alt text](img/image.png)

iOS App 已经上架，Android App 也已支持。`0.8.0` 版本新增了工作区受控助手办公能力、`office.browser` 真实浏览器桥接、静态 HTML 演示文档编辑与布局调整，并补强了打包与运行时稳定性。

### ✨ 核心特性

> 当前状态：iOS App 已完成并已上架 App Store，Android App 也已支持。`0.8.0` 版本新增了工作区受控助手办公能力、`office.browser` 真实浏览器桥接、静态 HTML 演示文档编辑与布局调整，并补强了打包与运行时稳定性。

#### 🔄 多 Provider 会话同步
- **无缝续接原生 CLI 会话**：支持 Claude Code、Codex、OpenCode 等主流 AI 编程工具
- **会话发现与历史读取**：自动发现并同步本地 CLI 会话历史
- **实时消息订阅**：实时接收和展示 AI 编程会话的消息流
- **会话状态感知**：统一展示运行中、未读、失败等状态，并保留错误码与错误摘要
- **会话事件通知**：权限申请、会话完成与失败等事件的 Toast 通知，支持一键跳转
- **子会话识别**：正确识别并归类 CLI 的子 Agent 会话，避免与主会话混淆
- **消息归一化**：统一不同 Provider 的消息格式，提供一致的使用体验

#### 🌿 会话分叉
- **从任意消息创建子会话**：从对话历史的任意节点分叉创建新会话
- **跨供应商分叉**：支持在不同 AI 供应商（Claude Code、Codex、OpenCode）之间分叉会话
- **分支树可视化**：可视化分支树展示父子关系和会话层级结构
- **分支关系持久化**：分支关系在所有客户端之间同步保持

#### 💬 对话式主界面
- **会话即工作区**：每个对话都是一个独立的工作区，统一管理上下文
- **实时消息渲染**：支持 Markdown、代码高亮、工具调用展示
- **统一权限审批**：在会话内直接处理命令执行、文件变更、权限授权和用户输入请求
- **权限模式隔离**：「完全权限」与「二次审批 Hook」明确隔离，避免权限误判
- **复合输入面板**：集成文件上传、上下文管理、快捷命令等功能
- **演示模式**：支持通过 `codingns start --demo` 启动演示环境，自动创建 demo 账号并提供受控体验
- **Capability 驱动**：根据 Provider 能力动态调整可用功能

#### 🧭 工作区助手与办公能力
- **工作区受控助手入口**：普通工作区会话也能调用文档、浏览器、终端和运维等正式助手能力，但作用域会被严格收口
- **统一浏览器任务入口**：通过 `office.browser` 统一发起读 DOM、截图、表单操作、下载和任务产物查看
- **真实浏览器桥接**：需要复用真实 Chrome / Edge 登录态时，可以显式切到 `opencli_bridge` 后端
- **浏览器 Profile 与任务面板**：在设置页直接管理浏览器 Profile、任务历史和桥接状态
- **受控预览链路**：办公截图和本地图片走同一套受控预览链路，减少打开方式混乱

#### 📁 文件管理能力
- **文件树浏览**：可视化项目文件结构
- **文件上下文挂载**：将文件内容快速添加到会话上下文
- **文件搜索**：快速定位项目中的文件
- **变更视图增强**：支持 Git 状态标记、变更筛选与 Diff 预览
- **路径联动与清爽视图**：支持从聊天内容定位文件，并可默认隐藏系统文件
- **更完整的预览与编辑**：支持文本文件编辑，以及 HTML / PDF 预览、刷新与全屏
- **静态 HTML 演示编辑**：可把演示稿式 HTML 直接作为演示文档打开，支持文本与布局调整，并尽量稳定导出结果

#### 🔀 Git 集成
- **Git 状态展示**：实时查看文件变更状态
- **提交流程集成**：在会话中直接完成代码提交
- **版本详情下钻**：在应用内查看最近版本、全量历史、提交详情，并支持解释改动
- **关键信息一键复制**：支持快速复制 commit hash、版本标识等适合发布使用的信息
- **多远程推送**：支持一次推送多个远程仓库
- **规则校验**：支持自定义提交规则

#### 💻 终端能力
- **真实 PTY 终端**：基于 node-pty 的完整终端体验
- **多终端支持**：同时管理多个终端会话
- **终端持久化**：终端输出缓存与历史回放
- **回放体验优化**：修复历史回放与实时输出衔接时的滚动和时序问题
- **Windows 终端恢复**：支持终端持久化恢复，并在创建前选择 Shell
- **断线重连**：网络中断后自动恢复终端会话

#### 🔧 运行时与交付稳定性
- **Windows 安装链路补强**：补齐原生依赖检查，让 Windows 安装路径更可控
- **npm 包运行时修复**：修复 `codingns` npm 包打包与运行时依赖发现问题
- **会话运行时修正**：修复工作区 Codex 会话误用私有 runtime home，减少 stale session 引发的错乱
- **刷新与文件树修复**：改善文件树回退、会话计数和工作区刷新稳定性

#### ☁️ 账户偏好同步
- **账户级配置同步**：语言、主题、默认权限模式可在多客户端之间同步
- **Provider 默认项同步**：支持同步默认模型与默认推理强度
- **本地偏好分层**：界面类偏好保留本地，避免把设备相关设置硬同步到所有端

#### 🌐 多 Host 与远程访问
- **多 Host 切换**：桌面端和移动端都支持在多个 Host 之间切换，并保留运行时上下文
- **远程入口统一**：切换 Host 后，登录、工作区和运行时入口行为保持一致
- **内置 Tailscale 管理**：在设置页直接查看实例级 Tailscale 状态、安装引导和远程访问入口

#### 🧩 Skill 管理
- **设置页直接管理 Skill**：支持扫描、导入、添加和查看 Skill
- **统一 Skill 同步链路**：Butler 与其他执行目标复用同一套 Skill 对齐逻辑
- **目标绑定可见**：明确每个 Skill 绑定到哪个目标，减少重复绑定和脏状态

#### 🎨 极简界面设计
- **软件工程师审美**：专注于功能性与美感的平衡
- **零干扰体验**：去除冗余装饰，突出核心工作区域
- **高信息密度**：合理利用屏幕空间，展示更多有效信息
- **快捷操作优先**：键盘优先、手势辅助的高效交互
- **主题定制**：支持亮色/暗色主题，适应不同工作环境

#### ⚙️ 进程管理
- **开发服务器管理**：启动、监控、停止开发进程
- **端口识别**：自动识别进程端口占用
- **日志追踪**：实时查看进程输出日志
- **反向代理**：通过单一端口代理开发中的应用，支持 HTTP/WebSocket 双协议透传与文件上传

#### 🪟 桌面工作台能力
- **多窗口支持**：支持将文件、Git、终端管理等工具面板拆分为独立窗口
- **拖拽拆分体验**：支持从工作台直接拖拽标签页到独立窗口，减少来回切换
- **窗口状态管理**：统一维护独立窗口的打开状态、焦点和恢复逻辑

#### 📱 多平台支持
- **桌面端**：基于 Tauri 的原生桌面应用（macOS、Windows、Linux）
- **移动端**：iOS 和 Android 原生应用（Tauri Mobile）
- **Web 端**：现代浏览器访问
- **平台适配**：针对不同平台优化的 UI 和交互
- **移动端体验修复**：补齐启动图资源，优化 iPad 横竖屏、安全区以及聊天附件调用相机/相册的体验

#### 🔌 Provider 扩展框架
- **统一扩展协议**：标准化的 Provider 接入规范
- **能力声明**：Provider 自身能力的声明与发现
- **兼容性测试**：内置 Provider 兼容性测试样本

### 🏗️ 项目架构

```
CodingNS/
├── apps/
│   ├── host/           # 后端服务（Fastify + WebSocket）
│   ├── user-app/       # 前端应用（React + Tauri）
│   └── desktop/        # 桌面端壳工程
├── packages/
│   ├── session-sync-core/  # 会话同步核心库
│   └── codingns/       # 独立 NPM 包（all-in-one）
├── specs/              # 功能规格文档
└── scripts/            # 构建与部署脚本
```

#### 核心组件说明

| 组件 | 技术栈 | 说明 |
|------|--------|------|
| **Host** | Fastify + WebSocket + SQLite + node-pty | 后端服务，提供 HTTP/WebSocket API，管理会话、终端、进程 |
| **User App** | React + TypeScript + Tauri | 跨平台客户端应用 |
| **Session Sync Core** | TypeScript | 核心 SDK，封装会话同步、Provider 适配逻辑 |
| **CodingNS Package** | Node.js | 可独立安装的 NPM 包，包含完整后端能力 |

### 🚀 快速开始

#### 环境要求

- **npm** >= 10.0.0
- **Node.js** >= 22.0.0
- **pnpm** >= 9.0.0
- **Rust** >= 1.70（桌面端开发需要）

#### 通过 NPM 包快速安装

`@jingyi0605/codingns` 依赖 `better-sqlite3`、`node-pty` 这类原生模块，所以不同平台的安装链路不一样。

如果你在 Linux 上手工安装，先把编译工具准备好：

```bash
apt-get update
apt-get install -y build-essential python3
```

Windows 推荐使用下面的“一键安装脚本”。脚本会使用 CodingNS 私有 Node.js 22 运行时，并为 `node-pty`、`better-sqlite3` 使用受控的 Windows 原生依赖包。正常安装路径下，已经不再需要你手动安装 Visual Studio Build Tools，也不需要手动切换系统 Node.js 版本。

如果你绕过安装脚本，直接在 Windows 上执行 `npm install -g`，请使用 x64 的 Node.js 22。只有在不受支持的平台、架构或 npm 被迫回退到本机原生编译时，才需要额外准备 C++ 构建工具。

```bash
# 全局安装
npm install -g @jingyi0605/codingns

# 启动服务
codingns start --port 3002
```

也可以不全局安装，直接临时启动：

```bash
npx @jingyi0605/codingns start --port 3002
```

常用参数：

- `--host`：监听地址，默认 `0.0.0.0`
- `--port`：监听端口，默认 `3002`
- `--data-dir`：数据目录，默认 `~/.codingns`
- `--demo`：以演示模式启动，自动创建 demo 账号，并启用受控演示会话

#### 一键安装脚本

如果你想直接跑一个交互式安装脚本，把依赖检查、`npm` 安装、服务托管和 `npm` 源回退一次做完，可以执行：

```bash
bash install.sh
```

脚本会自动完成这些步骤：

- 先检查 Node.js、npm 和必需的编译工具
- 在支持的 macOS / Linux 环境下，缺什么就先询问是否自动安装
- 在 Windows 环境下，使用私有 Node.js 22 运行时和受控原生依赖，正常路径不会触发本机 `node-gyp` 编译
- 询问服务端口，默认 `3002`
- 询问数据目录，默认 `~/.codingns`
- 检测当前机器上已安装的受支持 CLI，并输出简报
- 如果没有检测到任何受支持 CLI，推荐优先安装 `OpenCode`
- 官方 `npm` 源不可用时，自动切换到 `https://registry.npmmirror.com`
- 自动安装或更新 `@jingyi0605/codingns`
- 如果你选择“安装为服务并开机自动启动”，脚本会自动安装 `pm2`、托管 `codingns`，并配置开机自启

#### 通过 PM2 开机启动和自定义端口

如果你在 Linux 上手工走这条路，也建议先装好编译工具，再执行下面的 `npm install -g`：

```bash
apt-get update
apt-get install -y build-essential python3
```

先安装 PM2：

```bash
npm install -g pm2
```

使用 PM2 托管，并自定义端口和数据目录：

```bash
pm2 start "$(which codingns)" --name codingns -- start --host 0.0.0.0 --port 3300 --data-dir ~/.codingns
```

保存当前进程列表并生成开机自启配置：

```bash
pm2 save
pm2 startup
```

执行 `pm2 startup` 输出的那条系统命令后，再执行一次：

```bash
pm2 save
```

常用 PM2 命令：

```bash
pm2 status
pm2 logs codingns
pm2 restart codingns
pm2 stop codingns
```

#### 从源码开发

```bash
# 克隆仓库
git clone https://git.jacksonz.cn:4443/jackson/CodingNS.git
cd codingns

# 安装依赖
pnpm install

# 重新编译原生模块（如果需要）
pnpm rebuild

# 查看开发帮助
pnpm dev

# 启动后端服务
pnpm dev:backend

# 启动前端开发服务器
pnpm dev:frontend

# 启动桌面端开发模式
pnpm dev:desktop
```

#### 构建

```bash
# 构建核心库
pnpm build:session-sync-core

# 构建后端服务
pnpm build:host

# 构建前端应用
pnpm build:user-app

# 构建桌面应用
pnpm build:desktop

# 构建独立 NPM 包
pnpm build:standalone
```

#### 测试

```bash
# 测试后端服务
pnpm test:host

# 测试前端应用
pnpm test:user-app
```

### 🛠️ 技术栈

**后端**
- [Fastify](https://fastify.dev/) - 高性能 Web 框架
- [WebSocket (ws)](https://github.com/websockets/ws) - 实时通信
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - SQLite 数据库
- [node-pty](https://github.com/microsoft/node-pty) - 伪终端支持

**前端**
- [React 18](https://react.dev/) - UI 框架
- [TypeScript](https://www.typescriptlang.org/) - 类型安全
- [Vite](https://vitejs.dev/) - 构建工具
- [xterm.js](https://xtermjs.org/) - 终端模拟器
- [Tauri 2](https://tauri.app/) - 跨平台桌面/移动应用框架

**测试**
- [Vitest](https://vitest.dev/) - 单元测试
- [Testing Library](https://testing-library.com/) - React 组件测试

### 📖 文档

详细的功能规格和设计文档位于 [`specs/`](./specs/) 目录：

- **spec001** - 平台底座与工作区基础
- **spec001.1** - 账户偏好入库与跨客户端同步
- **spec002** - ClaudeCode 与 Codex 会话同步核心
- **spec003** - 对话式主界面与消息运行时
- **spec003.1** - 原生会话实时对话运行时
- **spec003.2** - 运行中消息追加与原生引导
- **spec003.3** - 运行时消息直推与稳定标识
- **spec003.4** - 会话活动状态权威源与稳定显示
- **spec004** - 文件管理能力
- **spec005** - Git 上下文与提交规则引擎
- **spec006** - 终端核心能力
- **spec006.1** - 终端日志持久化与历史回放
- **spec007** - 进程管理与启动器
- **spec008** - 桌面端与 H5 交付增强
- **spec009** - 移动端体验与通知
- **spec009.1** - 移动端工作台导航与信息架构重构
- **spec010** - Provider 扩展框架
- **spec010.1** - OpenCode 兼容接入
- **spec010.2** - Gemini CLI 兼容接入
- **spec010.3** - Kimi CLI 兼容接入
- **spec011** - 单包安装与统一服务发布
- **spec012** - 并行项目编排与结果对比
- **spec013** - 代码助手平台与跨工作区巡检编排

### 🗺️ 路线图

| 开发目标 | 当前进度 | 完成情况 |
|----------|----------|----------|
| 会话分叉功能，支持分支树可视化 | 已完成 | 🟢 已完成 |
| 进程管理支持反向代理，单一端口代理开发中的应用 | 已完成 | 🟢 已完成 |
| iOS APP | 已上架 App Store | 🟢 已完成 |
| 演示模式与受控演示环境 | 已完成 | 🟢 已完成 |
| PC 端支持多窗口操作 | 已完成 | 🟢 已完成 |
| 并行开发模式，同时启动多个 CLI 或模型配置，并行针对单一工作区进行快速开发验证 | 开发中 | 🟡 开发中 |
| 支持更多 CLI（Gemini CLI、Kimi CLI 等） | 已完成 | 🟢 已完成 |
| CLI 模型快速切换（CC-SWITCH 集成） | 已完成 | 🟢 已完成 |
| 支持同时连接多个 HOST | 已完成 | 🟢 已完成 |
| 更完整的文件预览与编辑体验 | 已完成 | 🟢 已完成 |
| Git 版本详情、改动解释与全量历史查看 | 已完成 | 🟢 已完成 |
| 设置页 Skill 管理与 Butler Skill 同步 | 已完成 | 🟢 已完成 |
| 内置 Tailscale 支持一键穿透内网 | 已完成 | 🟢 已完成 |
| 工作区受控助手办公能力开放 | 已完成 | 🟢 已完成 |
| `office.browser` 真实浏览器桥接后端 | 已完成 | 🟢 已完成 |
| 静态 HTML 演示编辑与布局工具 | 已完成 | 🟢 已完成 |
| 代码助手功能，支持跨工作区管理多个项目及会话，并为用户提供项目开发的建议和代替用户进行项目开发的控制 | 已完成 | 🟢 已完成 |
| 代码助手支持实时语音对话 | 开发中 | 🟡 开发中 |

> 进度说明：🟢 已完成 | 🟡 开发中

### 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

### 📄 许可证

本项目采用 MIT 许可证。

---

<div align="center">

**Made with ❤️ by CodingNS Team**

</div>
