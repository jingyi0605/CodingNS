# 需求文档 - spec011-单包安装与统一服务发布

状态：Draft

## 简介

现在这个项目还是标准开发态结构：

- 前端依赖 Vite 开发服务器
- 后端单独监听 API 和 WebSocket
- 根目录只是 workspace，不是可发布产物

这对开发没问题，但对部署很差。真正要交付给别人用的时候，用户不关心什么 workspace、什么 Vite 代理、什么先跑哪个命令。用户只关心三件事：

1. 能不能一条命令安装
2. 安装完能不能一条命令启动
3. 能不能交给 PM 工具长期托管

所以这个 Spec 要解决的事情很实际：把现在这套前后端拆开的开发结构，整理成一个可以通过 `npm` / `npx` 拿到、一个进程就能跑起来的服务包。

## 术语表

- **Standalone Build（独立构建）**：包含后端运行代码、前端静态资源和必要运行时文件的一套发布产物
- **Service Package（服务包）**：发布到 npm 的 `@jingyi0605/codingns` 包，安装后可直接运行
- **CLI Entry（命令行入口）**：用户执行的 `codingns` 命令
- **Static Hosting（静态托管）**：后端直接返回前端构建产物，而不是再依赖 Vite 开发服务器
- **Process Manager（进程管理器）**：如 `pm2` 这类负责守护、重启和开机启动的工具

## 范围说明

### In Scope

- 新增一个可发布的 `@jingyi0605/codingns` npm 服务包
- 定义统一构建输出，包含后端代码和前端静态资源
- 提供 `codingns start` CLI 入口，并支持端口等启动参数
- 让后端能够托管前端静态文件和 SPA 路由
- 提供通过 `pm2` 启动和托管的文档示例

### Out of Scope

- 桌面端 Tauri 安装包改造
- Android 或移动端打包链路
- systemd、Docker、Homebrew 等所有分发方式一次性全做
- 自动注册系统服务或安装完成后自动启动

## 需求

### 需求 1：系统必须提供一个可发布的 npm 服务包

**用户故事：** 作为部署者，我希望项目能以一个正式 npm 包发布，而不是只能拉源码再跑 workspace 命令，这样我才能稳定安装和升级。

#### 验收标准

1. WHEN 发布服务 THEN System SHALL 提供一个非 `private` 的 npm 包作为正式交付物。
2. WHEN 用户安装该包 THEN System SHALL 包含启动服务所需的后端代码、前端静态资源和必要运行时文件。
3. WHEN 服务包发布 THEN System SHALL 不要求用户额外拉取仓库源码或手工构建前端。

### 需求 2：系统必须支持一条命令直接启动完整服务

**用户故事：** 作为部署者，我希望安装完成后可以用一个命令直接启动完整服务，而不是分别启动前端和后端。

#### 验收标准

1. WHEN 用户执行 `codingns start` THEN System SHALL 启动完整服务，包括 API、WebSocket 和前端页面访问能力。
2. WHEN 服务启动完成 THEN System SHALL 在一个统一监听地址上对外提供前端页面和后端接口。
3. WHEN 服务运行在生产模式 THEN System SHALL 不依赖 Vite 开发服务器。

### 需求 3：CLI 必须支持显式传入启动参数

**用户故事：** 作为部署者，我希望启动时能直接指定端口和主机地址，这样我才能放进脚本、容器或 PM 配置里。

#### 验收标准

1. WHEN 用户执行 `codingns start --port 3002` THEN System SHALL 使用指定端口启动。
2. WHEN 用户执行 `codingns start --host 0.0.0.0` THEN System SHALL 使用指定主机地址启动。
3. WHEN CLI 参数未提供 THEN System SHALL 回退到环境变量或默认值。
4. WHEN 用户提供无效端口或无效参数 THEN System SHALL 返回明确错误，而不是静默忽略。

### 需求 4：后端必须托管前端静态资源和 SPA 路由

**用户故事：** 作为最终用户，我希望访问服务地址时可以直接看到页面，而不是还要再跑一个前端开发服务。

#### 验收标准

1. WHEN 执行独立构建 THEN System SHALL 产出可由后端直接托管的前端静态资源。
2. WHEN 浏览器访问服务根路径 THEN System SHALL 返回前端入口页面。
3. WHEN 浏览器刷新前端路由页面 THEN System SHALL 正确回退到 SPA 入口，而不是返回 404。
4. WHEN 请求 `/api/*` 或 `/ws/*` THEN System SHALL 继续走后端原有接口和实时链路，不被静态托管覆盖。

### 需求 5：系统必须提供统一的独立构建命令

**用户故事：** 作为维护者，我希望有一个固定的构建命令把可发布产物一次性打出来，这样 CI 和发布流程才不会拼来拼去。

#### 验收标准

1. WHEN 执行 `build:standalone` THEN System SHALL 先后构建共享依赖、前端和后端。
2. WHEN 构建完成 THEN System SHALL 输出一套可直接发布的目录结构。
3. WHEN 构建发布产物 THEN System SHALL 包含前端静态文件、后端运行代码和必要资源文件。

### 需求 6：服务包必须适合交给进程管理器托管

**用户故事：** 作为运维或部署者，我希望服务能稳定交给 `pm2` 之类的工具托管，而不是每次重启都靠手工。

#### 验收标准

1. WHEN 服务通过 CLI 启动 THEN System SHALL 保持前台运行，适合被 `pm2` 之类工具接管。
2. WHEN 进程管理器传入启动参数 THEN System SHALL 正常识别并启动。
3. WHEN 服务收到终止信号 THEN System SHALL 执行有序关闭，不留下明显的悬挂进程。
4. WHEN 文档提供托管示例 THEN System SHALL 给出可直接照抄的 `pm2` 命令。

### 需求 7：默认访问地址必须对浏览器可用

**用户故事：** 作为 Web 用户，我希望页面默认能用当前访问地址工作，而不是返回一个浏览器根本打不开的内部监听地址。

#### 验收标准

1. WHEN 服务监听地址为 `0.0.0.0` THEN System SHALL 不把 `0.0.0.0` 当作前端默认访问地址回传给浏览器。
2. WHEN Web 前端与后端同源部署 THEN System SHALL 优先使用同源地址访问 API 和 WebSocket。
3. WHEN 用户未手工修改服务地址 THEN System SHALL 仍然可以正常打开工作台和调用接口。

## 非功能需求

### 非功能需求 1：可维护性

1. WHEN 新增服务包 THEN System SHALL 尽量复用现有 `host` 和 `user-app` 代码，不重写第二套服务。
2. WHEN 发布结构落地 THEN System SHALL 让开发态和发布态边界清楚，避免继续混用开发服务器逻辑。

### 非功能需求 2：可靠性

1. WHEN 前端构建资源缺失 THEN System SHALL 在构建或启动阶段尽早报错。
2. WHEN 独立构建完成 THEN System SHALL 能在无 Vite 的环境中稳定启动。

### 非功能需求 3：兼容性

1. WHEN 保持现有开发流程 THEN System SHALL 不破坏现有 `dev:backend`、`dev:frontend`、`dev:desktop` 这类开发命令。
2. WHEN 新增发布包后 THEN System SHALL 不要求桌面端和开发态立即迁移到新启动方式。

## 成功定义

- 用户可以通过 `npm install -g @jingyi0605/codingns` 或 `npx @jingyi0605/codingns start --port <port>` 运行完整服务
- 不需要单独启动前端开发服务器也能访问页面
- `build:standalone` 可以稳定产出可发布内容
- `pm2` 可以直接托管 `codingns start` 命令
- 默认 Web 访问路径不再依赖 `127.0.0.1:3002` 这类写死地址
