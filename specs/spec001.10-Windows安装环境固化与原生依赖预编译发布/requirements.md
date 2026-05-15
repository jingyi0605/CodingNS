# 需求文档 - spec001.10-Windows安装环境固化与原生依赖预编译发布

状态：Draft

## 简介

现在 Windows 安装链路有两个根问题：

1. 运行时环境不受控。用户系统里的 Node 版本可能太新、太乱，或者正好命不中原生模块预编译包。
2. 原生模块发布方式不受控。`better-sqlite3` 还能赌预编译命中，`node-pty` 这条链路现在基本还得看本机编译。

这两个问题叠在一起，就会把本来应该是一条 `npm install` 的安装路径，变成：

- 拉 npm 包
- 拉 GitHub Release
- 试图本机编译
- 缺 Visual Studio
- 再让用户自己补环境

这不是安装方案，这是甩锅。

所以这个 Spec 要把 Windows 安装路径改成一个更可控的模型：

- CodingNS 自己带一套私有 Node 22 LTS 运行时，不再强依赖系统 Node
- CodingNS 自己维护 `node-pty` 的 Windows x64 + Node 22 预编译分发

## 术语表

- **System**：CodingNS Host 服务包与安装脚本
- **Private Node Runtime（私有 Node 运行时）**：安装脚本为 CodingNS 单独准备的一份 Node 22 LTS，不覆盖系统 Node
- **Runtime Home（运行时目录）**：CodingNS 在数据目录下为私有 Node、npm 全局目录和运行辅助文件预留的子目录
- **Managed Native Package（受管原生包）**：由 CodingNS 明确知道其 ABI、平台和发布策略的原生依赖，例如 `better-sqlite3`、`@codingns/node-pty`
- **Prebuilt Package（预编译包）**：提前在 CI 里编译好的二进制产物，用户安装时直接解压或下载使用

## 范围说明

### In Scope

- Windows 安装脚本诊断当前系统 Node/平台/架构，并检查目标私有运行时是否命中支持矩阵
- 为 CodingNS 下载并使用私有 Node 22 LTS，不修改系统 Node 默认版本
- 安装脚本切换到私有 npm 前缀和私有运行时目录
- fork 一个 `@codingns/node-pty`，先覆盖 Windows x64 + Node 22
- 在 CI 中构建并随 npm 包发布 `@codingns/node-pty` 的预编译产物
- 明确安装、升级、回滚和故障排查文档

### Out of Scope

- 一次性覆盖 macOS、Linux、Windows arm64 全平台原生预编译
- 一次性改造 `better-sqlite3` 的发布策略
- 改写终端架构，移除 PTY 或改用降级终端方案
- 修改桌面端、Android 客户端自身打包链路
- 把所有第三方原生依赖都变成自维护 fork

## 需求

### 需求 1：Windows 安装链路必须优先使用受控的 Node 22 LTS 运行时

**用户故事：** 作为 Windows 部署者，我希望 CodingNS 自己使用一份稳定兼容的 Node 运行时，而不是依赖我系统里碰巧合适的 Node 版本，这样安装成功率才不会靠运气。

#### 验收标准

1. WHEN 安装脚本进入 Windows 正式安装流程 THEN System SHALL 不修改系统 Node，而是为 CodingNS 准备并使用私有 Node 22 LTS 作为正式运行时。
2. WHEN 私有 Node 22 LTS 已准备完成 THEN System SHALL 用这份 Node 和 npm 完成后续 CodingNS 安装、postinstall、启动和升级，而不是继续使用系统 Node。
3. WHEN 用户机器上已有满足要求的私有 Node 22 运行时 THEN System SHALL 复用现有运行时，不重复下载。
4. WHEN 私有 Node 下载失败、校验失败或解压失败 THEN System SHALL 明确报出失败原因和运行时目录，而不是回退到不受控的系统 Node 静默继续。
5. WHEN 系统中存在其他项目依赖不同 Node 版本 THEN System SHALL 不修改系统默认 Node，也不要求用户先切换系统 Node 再安装 CodingNS。

### 需求 2：安装脚本必须明确检查受管原生包是否命中预编译支持

**用户故事：** 作为维护者，我希望安装脚本在真正执行 npm 安装前就知道当前环境是否命中 `better-sqlite3`、`node-pty` 的预编译支持，这样才能提前切换方案，而不是安装到一半才炸。

#### 验收标准

1. WHEN 安装脚本开始 Windows 安装流程 THEN System SHALL 先检查平台、架构、目标 Node 主版本和目标 ABI 是否命中受管原生包支持矩阵。
2. WHEN 系统 Node 存在 THEN System SHALL 输出当前系统 Node 版本与 ABI 作为诊断信息，但不得把它当作正式运行时选择依据。
3. WHEN 检查结果显示目标环境无法命中预编译支持 THEN System SHALL 在安装前明确输出原因，并停止继续安装或按设计切换到受支持目标环境。
4. WHEN 检查结果显示目标环境仍可能落回本机编译 THEN System SHALL 明确告诉用户是哪一个包还没有被预编译覆盖。

### 需求 3：系统必须提供一个自维护的 `@codingns/node-pty` Windows 预编译包

**用户故事：** 作为维护者，我希望 `node-pty` 在 Windows x64 + Node 22 环境下不再依赖用户本机编译，这样才能把最脆弱的安装环节收回来。

#### 验收标准

1. WHEN 发布 `@codingns/node-pty` THEN System SHALL 提供与现有 `node-pty@1.0.0` 兼容的 API 入口。
2. WHEN 在 Windows x64 + Node 22 环境安装 `@codingns/node-pty` THEN System SHALL 直接使用随包发布的预编译产物，而不是执行本机编译。
3. WHEN 当前环境不在 `@codingns/node-pty` 第一版覆盖矩阵内 THEN System SHALL 明确失败或按设计回退，而不是假装支持。

### 需求 4：CI 必须能稳定产出 `@codingns/node-pty` 的 Windows 预编译发布物

**用户故事：** 作为维护者，我希望原生二进制不是手工在某台 Windows 机器上编出来的，而是通过 CI 稳定产出，这样版本升级和回滚才可追踪。

#### 验收标准

1. WHEN `@codingns/node-pty` 发布流水线执行 THEN System SHALL 在 Windows x64 + Node 22 环境构建原生产物。
2. WHEN 构建完成 THEN System SHALL 把运行必需的原生文件包含进 npm 发布包。
3. WHEN 发布包生成 THEN System SHALL 能通过 `npm pack` 验证包含预期原生文件。

### 需求 5：CodingNS 服务包必须切换到自维护的 `@codingns/node-pty`

**用户故事：** 作为部署者，我希望正式安装的 CodingNS 使用受控的终端原生依赖，而不是继续从第三方包安装路径上碰运气。

#### 验收标准

1. WHEN 发布新的 `@jingyi0605/codingns` THEN System SHALL 依赖 `@codingns/node-pty`，而不是直接依赖官方 `node-pty`。
2. WHEN CodingNS 在 Windows x64 + Node 22 环境中安装 THEN System SHALL 不再因为 `node-pty` 触发本机编译失败。
3. WHEN 终端功能运行 THEN System SHALL 保持现有 `spawn/write/resize/kill/onData/onExit` 行为兼容。

### 需求 6：安装和升级路径必须可回滚、可诊断

**用户故事：** 作为维护者，我希望这套新安装链路出问题时能知道坏在哪，也能回退到旧方案或旧版本，而不是变成新的黑盒。

#### 验收标准

1. WHEN 私有 Node 运行时准备、CodingNS 安装或 `@codingns/node-pty` 安装失败 THEN System SHALL 保留明确日志位置和失败阶段。
2. WHEN 维护者需要回滚 THEN System SHALL 能明确切回上一个服务包版本和上一个 `@codingns/node-pty` 版本。
3. WHEN 用户安装完成 THEN System SHALL 能输出当前实际使用的是哪份 Node、哪份 npm 前缀和哪版 `@codingns/node-pty`。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN Windows 用户重复执行安装脚本 THEN System SHALL 优先复用已有私有 Node 运行时和已下载资源，避免重复下载。
2. WHEN 发布包命中受支持矩阵 THEN System SHALL 不依赖本机 Visual Studio Build Tools 才能完成安装。

### 非功能需求 2：兼容性

1. WHEN 系统中存在其他项目依赖不同 Node 版本 THEN System SHALL 不修改系统默认 Node 或全局 npm 配置。
2. WHEN 现有 CodingNS 非 Windows 安装路径运行 THEN System SHALL 不被这次 Windows 特化方案破坏。

### 非功能需求 3：可维护性

1. WHEN 后续要扩展到 Windows arm64、macOS 或 Linux THEN System SHALL 允许在现有支持矩阵上增量扩展，而不是重写安装架构。
2. WHEN 原生依赖支持矩阵变化 THEN System SHALL 只需要改一处受管依赖清单和发布配置，而不是散落在多个脚本里手工同步。

## 成功定义

- Windows 用户在未安装 Visual Studio Build Tools 的前提下，能通过受控路径完成 CodingNS 安装
- CodingNS 实际运行在私有 Node 22 LTS 上，且不影响系统其他 npm 包
- `@codingns/node-pty` 可通过 CI 稳定产出 Windows x64 + Node 22 的预编译发布包
- 正式服务包切换到 `@codingns/node-pty` 后，终端主链路保持兼容
