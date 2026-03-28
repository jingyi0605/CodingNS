# 设计文档 - spec011-单包安装与统一服务发布

状态：Draft

## 1. 概述

### 1.1 目标

- 把当前项目整理成一个可发布的 `codingns` 服务包
- 把前端静态资源并入后端发布物，由后端统一托管
- 提供统一 CLI：`codingns start --port`
- 增加 `build:standalone`，把发布产物一次性构建出来
- 保证服务适合被 `pm2` 托管

### 1.2 覆盖需求

- `requirements.md` 需求 1：系统必须提供一个可发布的 npm 服务包
- `requirements.md` 需求 2：系统必须支持一条命令直接启动完整服务
- `requirements.md` 需求 3：CLI 必须支持显式传入启动参数
- `requirements.md` 需求 4：后端必须托管前端静态资源和 SPA 路由
- `requirements.md` 需求 5：系统必须提供统一的独立构建命令
- `requirements.md` 需求 6：服务包必须适合交给进程管理器托管
- `requirements.md` 需求 7：默认访问地址必须对浏览器可用

### 1.3 技术约束

- 继续使用 `pnpm workspace`
- 后端保持 `Node.js 22 + TypeScript + Fastify`
- 前端继续使用 `Vite + React`，但生产部署不再依赖 Vite 进程
- 现有开发命令不破坏，新增发布态构建链路
- 不修改桌面端分发链路

## 2. 架构

### 2.1 总体结构

第一版采用“一个发布包，一个服务进程”的结构。

#### 发布时

1. 构建 `packages/session-sync-core`
2. 构建 `apps/user-app`
3. 构建 `apps/host`
4. 复制前端 `dist` 到服务包发布目录
5. 复制 sqlite schema 和其他运行时资源
6. 由 `codingns` 包统一发布到 npm

#### 运行时

1. 用户执行 `codingns start --port 3002`
2. CLI 解析参数并生成启动配置
3. Host 启动 Fastify HTTP 服务和 WebSocket 服务
4. Fastify 提供 `/api/*`、`/ws/*` 和前端静态页面
5. 浏览器通过同一个地址访问页面和接口

### 2.2 模块划分

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `packages/codingns` | npm 服务包与 CLI 入口 | CLI 参数、环境变量 | 可执行命令与发布文件 |
| `apps/host` | 后端主服务 | Host 配置 | API、WS、静态资源托管 |
| `apps/user-app` | 前端页面 | Vite 构建输入 | 静态资源 |
| `scripts/build-standalone` | 独立构建编排 | workspace 构建命令 | 发布目录内容 |

### 2.3 关键思路

- 发布态只认一个入口，不再让用户分别处理前端和后端
- 构建态把前端 `dist` 并进服务包，不允许线上再跑 Vite
- 配置优先走 CLI 参数，其次环境变量，最后默认值
- Web 部署默认优先同源访问，避免再回传 `0.0.0.0`

## 3. 组件和接口

### 3.1 服务包目录

覆盖需求：1、2、5、6

计划新增目录：

- `packages/codingns/package.json`
- `packages/codingns/bin/codingns.mjs`
- `packages/codingns/scripts/build.mjs`
- `packages/codingns/dist/` 或等价发布目录

职责：

- 声明 npm 包元信息
- 声明 `bin` 入口
- 在 `prepack` 或构建脚本中准备发布文件
- 作为 `npm install -g` 和 `npx` 的直接入口

### 3.2 CLI 接口

覆盖需求：2、3、6

第一版 CLI 只做必要命令，不搞花架子。

#### 3.2.1 `codingns start`

- 类型：CLI Command
- 输入：`--host`、`--port`、`--data-dir`、`--help`
- 输出：启动服务并持续占用前台进程
- 行为：
  1. 解析参数
  2. 计算最终启动配置
  3. 调用 Host 启动逻辑
  4. 打印实际监听地址和数据目录

#### 3.2.2 参数优先级

1. CLI 参数
2. 通用环境变量：`HOST`、`PORT`
3. 项目环境变量：`CODINGNS_HOST`、`CODINGNS_PORT`、`CODINGNS_DB_PATH`
4. 默认值

#### 3.2.3 失败策略

- 参数非法：立即退出并返回非零状态码
- 静态资源缺失：立即退出并提示重新构建或重新安装
- 端口占用：输出明确错误

### 3.3 后端静态托管

覆盖需求：2、4、7

#### 3.3.1 新增能力

后端新增一个静态托管模块，负责：

- 托管前端构建产物目录
- 将根路径 `/` 映射到 `index.html`
- 对非 `/api/*`、非 `/ws/*` 的前端路由做 SPA fallback

#### 3.3.2 路由顺序

路由顺序必须固定，否则很容易把接口吞掉：

1. 先注册 `/api/*`
2. 再注册 `/ws/*`
3. 最后注册静态文件和 SPA fallback

这样可以保证静态托管不会覆盖原有接口。

### 3.4 运行时配置调整

覆盖需求：3、7

当前 Web 端默认地址倾向于开发态写死值，这会让发布态很别扭。第一版要做两个调整：

1. Host 对 Web 端返回运行时配置时，不再把 `0.0.0.0` 直接拼成浏览器访问地址
2. Web 前端在同源部署时，优先把当前页面来源当作默认服务地址

推荐策略：

- `desktop` 平台继续保留明确的 `hostBaseUrl`
- `web` 平台默认优先使用 `window.location.origin`
- 后端 `runtime-config` 接口对 `web` 场景返回可访问地址，必要时允许返回空值或显式同源标记

### 3.5 独立构建命令

覆盖需求：1、4、5

新增根脚本：

- `build:standalone`

执行流程：

1. 构建 `packages/session-sync-core`
2. 构建 `apps/user-app`
3. 构建 `apps/host`
4. 调用服务包构建脚本，把 `user-app/dist`、`host/.build` 和运行时资源复制到服务包发布目录

目标不是“把一堆散文件编出来”，而是“编完就能拿去打 npm 包”。

## 4. 数据与状态模型

### 4.1 发布目录模型

覆盖需求：1、4、5

建议发布目录形态如下：

| 路径 | 内容 | 说明 |
| --- | --- | --- |
| `dist/server/` | Host 构建产物 | Node 运行入口 |
| `dist/public/` | User App 构建产物 | 静态页面与资源 |
| `dist/resources/` | schema 等运行时资源 | 启动时必需 |
| `bin/` | CLI 启动脚本 | npm / npx 入口 |

### 4.2 启动配置模型

覆盖需求：3、6、7

#### 4.2.1 `StandaloneServerConfig`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `host` | string | 是 | 监听主机 | 默认 `0.0.0.0` |
| `port` | number | 是 | 监听端口 | 1-65535 |
| `publicDir` | string | 是 | 前端静态目录 | 必须存在 |
| `databasePath` | string | 是 | SQLite 路径 | 可写 |
| `releaseManifestRoot` | string | 是 | 发布清单目录 | 可读 |

## 5. 错误处理

### 5.1 错误类型

- `CLI 参数错误`：端口非法、未知参数
- `构建产物错误`：前端静态目录不存在、后端入口缺失
- `监听错误`：端口占用、地址无效
- `运行时配置错误`：路径不可写、资源缺失

### 5.2 错误响应格式

CLI 和服务日志尽量保持直接可读，例如：

```text
[codingns] 启动失败：未找到前端静态资源目录 dist/public
```

```text
[codingns] 启动失败：端口 3002 非法，允许范围为 1-65535
```

### 5.3 处理策略

1. 构建阶段发现缺文件：立即失败
2. 启动阶段发现静态资源缺失：立即退出，避免起半套服务
3. CLI 参数错误：打印帮助并返回非零退出码
4. 接收到 `SIGINT` / `SIGTERM`：沿用 Host 现有有序关闭逻辑

## 6. 兼容性与迁移

### 6.1 对现有开发流程的影响

- 保留现有 `pnpm dev:*` 和 `pnpm build:*` 命令
- 新增发布态专用命令，不替代开发态命令
- 桌面端仍可继续依赖已有前端构建产物

### 6.2 对现有 Web 行为的影响

- 生产模式从“前后端分离进程”变为“后端统一托管前端”
- Web 默认服务地址从开发态写死值调整为同源优先
- 不修改 `/api/*` 和 `/ws/*` 的协议边界

## 7. 验证方案

### 7.1 构建验证

1. 运行 `pnpm build:standalone`
2. 检查服务包发布目录是否包含：
   - 后端入口
   - 前端静态文件
   - schema 等运行时资源

### 7.2 CLI 验证

1. 运行 `node bin/codingns.mjs start --port 3300`
2. 确认服务能正常监听
3. 确认访问 `http://127.0.0.1:3300/` 可返回页面
4. 确认 `/api/*` 和 `/ws/*` 正常

### 7.3 PM2 验证

1. 使用 `pm2 start <codingns command> -- start --port 3300`
2. 检查服务可被守护
3. 检查重启后仍能正常访问页面和接口

## 8. 补充说明

第一版先解决“能安装、能启动、能托管”这三个真正的问题。

至于 Docker、systemd、安装后初始化向导、自动生成服务文件，这些都可以后续继续做，但不该在第一版里把范围做炸。
