# 设计文档 - spec001.10-Windows安装环境固化与原生依赖预编译发布

状态：Draft

## 1. 概述

### 1.1 目标

- 把 Windows 安装成功率从“依赖用户机器环境碰巧合适”改成“依赖我们自己控制的运行时和预编译发布”
- 为 CodingNS 准备私有 Node 22 LTS，不污染系统 Node
- 为 `node-pty` 做自维护的 Windows x64 + Node 22 预编译分发
- 保持现有 Host 终端能力和安装入口不被破坏

### 1.2 覆盖需求

- `requirements.md` 需求 1：Windows 安装链路必须优先使用受控的 Node 22 LTS 运行时
- `requirements.md` 需求 2：安装脚本必须明确检查受管原生包是否命中预编译支持
- `requirements.md` 需求 3：系统必须提供一个自维护的 `@codingns/node-pty` Windows 预编译包
- `requirements.md` 需求 4：CI 必须能稳定产出 `@codingns/node-pty` 的 Windows 预编译发布物
- `requirements.md` 需求 5：CodingNS 服务包必须切换到自维护的 `@codingns/node-pty`
- `requirements.md` 需求 6：安装和升级路径必须可回滚、可诊断

### 1.3 技术约束

- 服务端继续使用 `Node.js 22 + Fastify`
- Windows 安装脚本继续以 `install.sh` 为主入口
- 正式服务包继续通过 npm 发布
- 第一版只保证 `Windows x64 + Node 22 LTS`
- 不重写终端层业务逻辑，尽量保持 `node-pty` API 兼容

## 2. 架构

### 2.1 总体结构

这次要把 Windows 安装和运行环境拆成两层：

1. **系统环境层**  
   用户自己机器上的 Node、npm、Visual Studio、PATH。
2. **CodingNS 私有运行时层**  
   安装脚本自己准备的 Node 22、私有 npm 前缀、私有全局包、私有服务启动入口。

第一层不可信，第二层才是我们真正要依赖的。

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `install.sh` | Windows 安装总控 | 平台、Node、架构、用户输入 | 私有 Node、私有 npm 环境、服务安装结果 |
| `windows-runtime-resolver` | 判断是否命中受管依赖支持矩阵 | Node 版本、ABI、平台、架构 | 命中结果、原因、建议动作 |
| `private-node-runtime` | 下载、校验、解压、复用私有 Node 22 | Node 分发 URL、校验信息、运行时目录 | 可执行的私有 `node/npm/npx` |
| `@codingns/node-pty` | 提供兼容官方 `node-pty` 的 Windows 预编译包 | npm 安装环境 | 可直接加载的终端原生 binding |
| `node-pty-build-ci` | 产出 Windows x64 + Node 22 原生文件 | 源码、Windows Runner、Node 22 | npm 发布包 |
| `packages/codingns` | 正式服务包 | CLI 参数、依赖清单 | CodingNS 启动入口和运行依赖 |

### 2.3 关键流程

#### 2.3.0 Windows 运行时选择策略

第一版推荐策略很明确：

- Windows 下，CodingNS 正式运行时一律固定为私有 Node 22
- 系统 Node 只做诊断，不参与正式 npm 安装、PM2 启动和后续升级

这样做不是保守，而是为了消灭双运行时分支。

如果继续保留“命中就用系统 Node，不命中再切私有 Node”，后面会同时长出两套：

- 运行时路径
- npm prefix
- PM2 启动上下文
- 升级和回滚路径
- postinstall 排障路径

这堆复杂度没有业务价值，应该直接砍掉。

#### 2.3.1 Windows 安装流程

1. 安装脚本识别当前平台是否为 Windows
2. 读取系统 Node 版本、ABI、架构；如果存在，只作为诊断信息打印
3. 固定目标正式运行时为私有 Node 22
4. 下载、校验、解压或复用私有 Node 22 到运行时目录
5. 根据受管原生包支持矩阵检查“目标私有 Node 22 环境”是否受支持
6. 切换后续 npm 安装上下文到私有 Node + 私有 npm 前缀
7. 安装 `@jingyi0605/codingns`
8. 执行 `postinstall` 校验与修复链路
9. 输出当前实际使用的 Node、npm 前缀、数据目录和日志位置

#### 2.3.2 `@codingns/node-pty` 发布流程

1. fork 官方 `node-pty@1.0.0`
2. 保持 JS/TS API 与 Host 现有用法兼容
3. 在 Windows x64 + Node 22 runner 上执行编译
4. 收集 `build/Release` 下的运行必需文件
5. 将这些文件随 npm 发布包一起发布
6. 安装时如果命中目标环境，直接使用随包二进制，不再本机编译

#### 2.3.3 CodingNS 正式包接入流程

1. `packages/codingns` 依赖从官方 `node-pty` 切换到 `@codingns/node-pty`
2. Host 代码层不改 import 语义或只做最小包名替换
3. 安装脚本优先保证使用私有 Node 22 环境
4. 终端主链路继续跑现有 `spawn/write/resize/kill/onData/onExit`

## 3. 组件和接口

### 3.1 私有 Node 运行时目录

覆盖需求：1、2、6

建议运行时总根目录固定为：

- `<dataDir>/runtime/`

建议子目录放在：

- `<dataDir>/runtime/node-22/`
- `<dataDir>/runtime/npm-global/`
- `<dataDir>/runtime/cache/`
- `<dataDir>/runtime/logs/`
- `<dataDir>/runtime/pm2/`
- `<dataDir>/runtime/service/`

这里的关键点不是路径名字，而是：

- 目录归 CodingNS 自己管
- 不改系统全局 npm prefix
- 可复用、可清理、可打印给用户看
- PM2 HOME 也要跟系统环境隔离

#### 3.1.1 目录职责细化

| 路径 | 职责 | 备注 |
| --- | --- | --- |
| `<dataDir>/runtime/node-22/versions/` | 存放真实 Node 22 版本目录 | 例如 `node-v22.16.0-win-x64` |
| `<dataDir>/runtime/node-22/active.json` | 当前活动 Node 元数据 | 第一版不依赖 symlink |
| `<dataDir>/runtime/npm-global/` | CodingNS 私有 npm prefix | 放 `codingns`、`pm2` 等私有全局包 |
| `<dataDir>/runtime/cache/downloads/` | 下载缓存 | 放 Node 压缩包、校验文件 |
| `<dataDir>/runtime/cache/npm/` | npm cache | 仅供私有运行时使用 |
| `<dataDir>/runtime/logs/install/` | 安装与升级日志 | 用于诊断失败阶段 |
| `<dataDir>/runtime/logs/runtime/` | 运行期辅助日志 | 可选 |
| `<dataDir>/runtime/pm2/` | PM2 HOME | 禁止复用系统 PM2 HOME |
| `<dataDir>/runtime/service/` | 服务状态元数据 | 放安装状态和启动环境快照 |

#### 3.1.2 活动 Node 元数据

`active.json` 建议至少记录：

- `version`
- `platform`
- `arch`
- `nodeDir`
- `nodeExe`
- `npmCmd`
- `npxCmd`
- `installedAt`
- `sourceUrl`
- `sha256`

脚本后续只认这份元数据，不靠扫目录猜当前活动版本。

#### 3.1.3 服务状态元数据

`runtime/service/` 第一版建议至少保留：

- `install-state.json`
- `install-state.previous.json`
- `launch-env.json`

它们分别用于：

- 记录当前安装状态
- 记录上一版状态，便于回滚
- 记录服务真正启动时依赖的关键环境变量

### 3.2 受管依赖支持矩阵

覆盖需求：1、2、3、5

第一版受管清单只管两个包：

#### 3.2.1 `ManagedNativePackageSupport`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `packageName` | string | 是 | 包名 | 唯一 |
| `kind` | `"upstream"` \| `"fork"` | 是 | 官方包还是自维护包 | 固定枚举 |
| `platform` | string | 是 | 目标平台 | 如 `win32` |
| `arch` | string | 是 | 目标架构 | 如 `x64` |
| `nodeMajor` | number | 是 | 支持的 Node 主版本 | 第一版固定 `22` |
| `abi` | string | 否 | 需要时可记录 ABI | 如 `node-v127` |
| `prebuiltStrategy` | `"embedded"` \| `"remote"` \| `"unknown"` | 是 | 预编译来源策略 | 第一版以 `embedded` 为主 |
| `fallbackPolicy` | `"allow-build"` \| `"reject-build"` | 是 | 未命中时是否允许编译 | `@codingns/node-pty` 第一版建议 `reject-build` |
| `note` | string | 否 | 给日志和提示的人话说明 | 可选 |

建议第一版策略：

- `better-sqlite3`：`kind=upstream`，`fallbackPolicy=allow-build`
- `@codingns/node-pty`：`kind=fork`，`fallbackPolicy=reject-build`

这样做的原因很实际：

- `better-sqlite3` 先继续复用上游能力
- `node-pty` 先把最脆的这根链收回来

### 3.3 安装脚本决策接口

覆盖需求：1、2、6

#### 3.3.1 `resolveWindowsInstallRuntime()`

- 类型：Shell 内部函数或子脚本
- 输入：
  - 系统 Node 版本（可选，仅诊断）
  - 系统 `process.versions.modules`（可选，仅诊断）
  - 平台
  - 架构
  - 受管支持矩阵
- 输出：
  - `usePrivateNode`
  - `systemNodeSummary`
  - `targetRuntimeSummary`
  - `unsupportedPackages[]`
  - `decisionReason`

行为要求：

1. Windows 第一版始终选择私有 Node 22 作为正式运行时
2. 系统 Node 信息只用于提示当前机器环境，不参与最终运行时选择
3. 受管支持矩阵检查针对目标私有 Node 22 环境执行
4. 如果目标环境仍有包未覆盖，必须在真正执行 npm 安装前明确打印是哪一个包

#### 3.3.2 `ensurePrivateNodeRuntime()`

- 类型：Shell 内部函数
- 输入：
  - 目标 Node 版本
  - 下载地址
  - 校验值
  - 运行时目录
- 输出：
  - `nodePath`
  - `npmPath`
  - `npxPath`

行为要求：

1. 已有可复用目录时直接复用
2. 下载后必须校验
3. 解压失败或校验失败必须停止安装

#### 3.3.3 `buildPrivateInstallEnv()`

- 类型：Shell 内部函数
- 输入：
  - `dataDir`
  - `activeNodeMeta`
  - `registryUrl`
- 输出：
  - `PATH`
  - `PM2_HOME`
  - `npm_config_prefix`
  - `npm_config_cache`
  - `npm_config_userconfig`
  - `CODINGNS_RUNTIME_ROOT`
  - `CODINGNS_DATA_DIR`

行为要求：

1. 只通过进程级环境变量切换安装上下文，不修改系统级 npm 配置
2. `PATH` 顺序必须是“私有 Node -> 私有 npm prefix -> 系统 PATH”
3. `PM2_HOME` 必须固定到私有运行时目录
4. 所有后续 npm、pm2、codingns 命令都复用同一套环境

#### 3.3.4 Windows 安装决策表

| 场景 | 系统 Node 情况 | 目标运行时 | 安装动作 |
| --- | --- | --- | --- |
| A | 未安装系统 Node | 私有 Node 22 | 直接准备私有运行时并继续 |
| B | 系统 Node 是 22，且看起来可用 | 私有 Node 22 | 仍然使用私有运行时，系统 Node 只打印诊断 |
| C | 系统 Node 是 24+ | 私有 Node 22 | 打印“系统 Node 不参与正式运行时”，然后继续私有运行时 |
| D | 私有 Node 22 已存在 | 私有 Node 22 | 复用，不重复下载 |
| E | 私有 Node 22 已准备好，但 `@codingns/node-pty` 不在支持矩阵内 | 私有 Node 22 | 安装前直接失败，明确报出不支持 |

#### 3.3.5 私有命令入口约定

Windows 正式安装完成后，脚本应优先解析并使用这些路径：

- 私有 `node`：`active.json` 中的 `nodeExe`
- 私有 `npm`：`active.json` 中的 `npmCmd`
- 私有 `pm2`：`<dataDir>/runtime/npm-global/pm2.cmd`
- 私有 `codingns`：`<dataDir>/runtime/npm-global/codingns.cmd`

不要再从系统 PATH 里兜底找正式命令入口。

### 3.4 `@codingns/node-pty` 包结构

覆盖需求：3、4、5

第一版不搞多平台花活，包结构优先简单可控。

建议结构：

| 路径 | 内容 | 说明 |
| --- | --- | --- |
| `lib/` | JS 入口 | 尽量贴近官方 `node-pty` |
| `src/` | TS/原始源码 | 继续跟上游 |
| `build/Release/` | Windows x64 + Node 22 原生文件 | 预编译产物 |
| `scripts/` | 发布或校验脚本 | 构建辅助 |
| `package.json` | fork 包元信息 | 明确版本和安装策略 |

第一版建议安装策略：

- `install` 阶段先检查当前是否为 `win32 + x64 + Node 22`
- 命中则直接通过
- 未命中则：
  - 要么明确失败
  - 要么按后续扩展策略再支持回退编译

第一版更推荐**明确失败**，不要假装支持。

#### 3.4.1 包名与版本边界

第一版建议固定为：

- 包名：`@codingns/node-pty`
- 上游基线：`node-pty@1.0.0`
- fork 版本：`1.0.0-cns.x`

设计要求：

1. 包名必须和官方包明确区分
2. 版本必须一眼能看出是 fork，不伪装成官方原版
3. 第一版正式支持矩阵只写 `win32 + x64 + Node 22`

#### 3.4.2 兼容性目标

第一版要优先保证这些能力兼容：

- `spawn`
- `write`
- `resize`
- `kill`
- `onData`
- `onExit`

也就是说，目标不是“替代上游所有发布形态”，而是保证当前 Host 实际依赖的接口不回归。

#### 3.4.3 Tarball 必需内容

第一版 npm 发布包至少应包含：

- JS 入口文件
- 类型声明
- `build/Release` 下的运行必需原生文件
- 最小发布校验脚本
- 基础说明和许可证文件

如果 tarball 里缺少运行必需二进制，则该版本不得发布。

### 3.5 CI 发布接口

覆盖需求：4、6

#### 3.5.1 `node-pty-build-ci`

- 类型：CI Workflow
- 输入：
  - fork 源码
  - Windows Runner
  - Node 22.x
- 输出：
  - `npm pack` 可验证的发布包
  - 可选 GitHub Release 产物

最小流程：

1. checkout
2. setup node 22
3. install dependencies
4. build native artifacts
5. 校验 `build/Release` 必需文件存在
6. `npm pack`
7. 检查 tarball 内容
8. 通过后再 publish

#### 3.5.2 CI 验收职责拆分

建议至少拆两个校验脚本：

- `verify-runtime`：检查 workspace 内构建产物是否齐全
- `verify-tarball`：检查 `npm pack` 后 tarball 内容是否齐全

这样做的好处：

- 构建失败和打包失败不会混在一起
- 后续排障时能更快知道问题出在“没编出来”还是“没打进去”

#### 3.5.3 阻断发布条件

只要出现下面任一情况，CI 就必须阻断发布：

1. `build/Release` 必需文件缺失
2. `npm pack` 失败
3. tarball 缺少运行必需文件
4. 安装验证仍触发本机编译
5. 安装验证后入口无法加载

#### 3.5.4 最小安装验证

第一版建议在 CI 中增加最小 smoke test：

1. 安装 tarball 到临时目录
2. 确认安装过程没有触发 `node-gyp rebuild`
3. 用 Node 22 执行最小入口加载验证
4. 校验导出里至少存在 `spawn`

## 4. 数据与状态模型

### 4.1 运行时状态模型

说明安装脚本当前处在哪个阶段，失败时才知道卡哪。

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `probe_system_node` | 检查系统环境 | 启动 Windows 安装 | 得出环境判断 |
| `prepare_private_node` | 下载/校验私有 Node | 决定切换私有 Node | Node 可用或失败 |
| `prepare_private_env` | 组装私有安装上下文 | 私有 Node 可用 | prefix/cache/pm2 环境可用或失败 |
| `install_service_package` | 安装 CodingNS 包 | 已准备安装环境 | 安装成功或失败 |
| `configure_service` | 配置 PM2/启动项 | 服务包已安装 | 配置完成或跳过 |
| `done` | 安装完成 | 全流程成功 | 结束 |
| `failed` | 安装失败 | 任一阶段不可恢复失败 | 结束 |

### 4.2 私有运行时状态文件模型

建议安装状态文件至少记录这些字段：

| 字段 | 说明 |
| --- | --- |
| `packageName` | 当前服务包名 |
| `packageVersion` | 当前已装版本 |
| `packageSpec` | 安装时使用的 npm 规格 |
| `nodeVersion` | 当前私有 Node 版本 |
| `nodeExe` | 当前私有 Node 可执行路径 |
| `npmPrefix` | 当前私有 npm prefix |
| `pm2Home` | 当前私有 PM2 HOME |
| `registry` | 安装时使用的 npm 源 |
| `installedAt` | 安装时间 |
| `dataDir` | 当前服务数据目录 |

#### 4.2.1 状态文件职责

- `install-state.json`：当前正式生效状态
- `install-state.previous.json`：上一版正式状态，用于回滚
- `launch-env.json`：最近一次正式启动使用的关键环境快照

设计要求：

1. `install-state.json` 是正式运行状态的单一真相来源
2. 写入新正式状态前，必须先保留上一版状态
3. 正式状态切换失败时，只允许回滚到 `install-state.previous.json`，不允许猜测历史目录

#### 4.2.2 状态切换顺序

第一版建议顺序：

1. 准备私有 Node
2. 组装私有安装环境
3. 完成 npm 安装和 postinstall 校验
4. 备份旧 `install-state.json`
5. 写入新 `install-state.json`
6. 写入 `launch-env.json`
7. 再执行 PM2 启动、重启或回滚动作

不要把“写正式状态”和“尝试安装”混在一起做。

### 4.3 `@codingns/node-pty` 版本模型

建议版本策略：

- 上游基线：`1.0.0`
- fork 版本：`1.0.0-cns.1`
- 后续修补：`1.0.0-cns.2`

不要伪装成官方包原版。你是 fork，就要让版本一眼能看出来。

### 4.4 `@codingns/node-pty` 发布状态模型

建议把 fork 包发布过程至少看成这几个状态：

| 状态 | 含义 |
| --- | --- |
| `build_runtime` | 编译 workspace 内原生产物 |
| `verify_runtime` | 校验构建产物是否齐全 |
| `pack_tarball` | 生成 npm tarball |
| `verify_tarball` | 校验 tarball 内容 |
| `install_smoke_test` | 安装并做最小入口验证 |
| `publish_ready` | 可进入正式发布 |
| `publish_failed` | 任一阶段失败，阻断发布 |

## 5. 错误处理

### 5.1 错误类型

- `系统 Node 不命中支持矩阵`
- `私有 Node 下载失败`
- `私有 Node 校验失败`
- `私有 Node 解压失败`
- `@codingns/node-pty` 目标环境未命中`
- `@codingns/node-pty` 发布包缺失原生文件`
- `@codingns/node-pty` tarball 验证失败`
- `@codingns/node-pty` 安装验证仍触发本机编译`
- `终端运行时兼容回归`

### 5.2 错误响应格式

安装脚本和 CI 日志都应尽量保持这种可读格式：

```text
[codingns-install] Windows 安装失败：当前系统 Node 24.15.0 未命中受管原生依赖支持矩阵，已切换私有 Node 22 仍无法安装 @codingns/node-pty。
```

```text
[codingns-node-pty] 发布失败：缺少 build/Release/conpty.node，当前 tarball 不是可运行的 Windows 预编译包。
```

### 5.3 处理策略

1. 系统 Node 不匹配：切私有 Node，不改系统 Node
2. 私有 Node 准备失败：立即退出，不静默回退系统 Node
3. 私有安装上下文组装失败：立即退出，不回退到系统 prefix 或系统 PM2
4. `@codingns/node-pty` 环境未命中：第一版明确失败
5. CI 原生文件缺失：阻断发布
6. tarball 验证失败或 smoke test 触发本机编译：阻断发布

### 5.4 升级与回滚策略

1. 如果失败发生在写入新 `install-state.json` 前：直接退出，不污染当前正式状态
2. 如果失败发生在写入新状态后但服务未成功拉起：使用 `install-state.previous.json` 自动回滚
3. 如果自动回滚也失败：必须输出状态文件路径、私有 Node 路径、私有 prefix 路径和 PM2 HOME，交给人工接手

## 6. 正确性属性

### 6.1 属性 1：Windows 安装环境隔离

*对于任何* Windows 安装场景，系统都应该满足：CodingNS 的运行环境不依赖系统全局 Node 被修改。

**验证需求：** 需求 1、需求 6

### 6.2 属性 2：Node-PTY 预编译可重复安装

*对于任何* `Windows x64 + Node 22` 的正式支持环境，系统都应该满足：安装 `@codingns/node-pty` 时不要求用户本机编译。

**验证需求：** 需求 3、需求 4、需求 5

## 7. 测试策略

### 7.1 单元测试

- 受管支持矩阵判断逻辑
- 私有 Node 路径和前缀计算逻辑
- 私有安装环境变量组装逻辑
- `@codingns/node-pty` 安装命中判断逻辑
- `@codingns/node-pty` tarball 校验逻辑

### 7.2 集成测试

- Windows 安装脚本在命中/不命中系统 Node 时的分支行为
- 私有 npm prefix / PM2 HOME / PATH 组装结果检查
- 安装状态文件与回滚状态文件写入顺序检查
- `npm pack` 后 `@codingns/node-pty` tarball 内容检查
- `@codingns/node-pty` tarball 安装 smoke test
- CodingNS 切换到 `@codingns/node-pty` 后终端创建与输出主链路

### 7.3 端到端测试

- Windows 真机或 Runner 上从零安装 CodingNS
- 不安装 Visual Studio Build Tools 的环境中完成安装
- 终端创建、输入、输出、resize、关闭的回归验证

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.3.1、§3.3、§4.1 | Windows 安装脚本分支测试 + 真机安装 |
| `requirements.md` 需求 2 | `design.md` §3.2、§3.3 | 支持矩阵判断测试 |
| `requirements.md` 需求 3 | `design.md` §3.4、§4.2 | `npm pack` 内容检查 + 安装验证 |
| `requirements.md` 需求 4 | `design.md` §3.5、§5.3 | CI 构建验证 |
| `requirements.md` 需求 5 | `design.md` §2.3.3、§3.4 | Host 终端回归测试 |
| `requirements.md` 需求 6 | `design.md` §4.1、§5 | 安装失败诊断与回滚演练 |

## 8. 风险与待确认项

### 8.1 风险

- `node-pty` fork 后需要跟上游安全修复和兼容修复
- Windows 杀软可能拦截随包发布的终端相关二进制
- `better-sqlite3` 仍可能在极端情况下落回本机编译，第一版没有彻底收口它
- 私有 Node 运行时如果目录管理不当，容易出现旧版本残留和升级污染
- 私有 prefix 和私有 PM2 如果没有一起切换，会形成“私有 Node + 系统命令”的混搭脏状态
- 状态文件如果写入时机不对，会把“安装失败”放大成“正式状态损坏”
- fork 包如果只编译不验 tarball，很容易出现“CI 绿了，但发布包不能跑”的假成功

### 8.2 待确认项

- 私有 Node 分发地址和校验清单放在什么位置
- `@codingns/node-pty` 是否第一版就允许非支持矩阵回退编译
- 后续是否把 `better-sqlite3` 也纳入自维护预编译范围

### 8.3 第一阶段现实边界确认

这一段不是装样子，是防止范围继续发散。

- 第一版正式支持矩阵只写 `Windows x64 + Node 22 LTS`，不要假装已经支持别的平台。
- 第一版目标是让 CodingNS 脱离系统 Node 和官方 `node-pty` 的本机编译链，不是一次性接管所有原生依赖。
- `better-sqlite3` 先继续使用上游预编译分发，短期内不 fork；如果它因为网络或上游覆盖问题仍然回退编译，安装脚本必须明确告诉用户卡在哪。
- Windows 侧第一版不把“自动安装 Visual Studio Build Tools”当主方案。真正要做的是尽量避免用户走到本机编译，而不是把编译器安装流程包一层壳。
- `packages/codingns/scripts/postinstall.mjs` 仍然属于正式安装链路，后续验收必须把它算进去，不能只验证 npm 原生依赖安装通过。
- 第二阶段优先采用“Windows 一律使用私有 Node 22”的策略，避免维护系统/私有两套正式运行时分支。
