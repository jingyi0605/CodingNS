# 设计文档 - spec001.5.1-OpenCLI接入与适配器裁剪运行时

状态：Draft

## 1. 概述

### 1.1 目标

- 把 `OpenCLI` 作为独立 provider 接进技能面板，而不是冒充普通 Skill
- 让用户在面板中手动启用或禁用 `OpenCLI`，并对新会话产生真实效果
- 让用户按适配器目录项选择性启用 `OpenCLI` 能力
- 基于面板勾选结果生成裁剪版 OpenCLI 运行时
- 让 CodingNS 管理会话只使用裁剪运行时，不碰用户全局安装
- 解决隔离会话里 `OpenCLI` 读取真实 `~/.opencli` 的问题

### 1.2 覆盖需求

- `requirements.md` 需求 1：OpenCLI 必须作为独立 provider 被识别和展示
- `requirements.md` 需求 2：面板里启用或禁用 OpenCLI 必须真正影响会话环境
- `requirements.md` 需求 3：面板必须能列出 OpenCLI 支持的适配器目录，并允许选择性启用
- `requirements.md` 需求 4：未启用的适配器在 CodingNS 管理的 CLI 环境里必须无法使用
- `requirements.md` 需求 5：系统必须生成裁剪版 OpenCLI 运行时，而不是直接污染用户全局安装
- `requirements.md` 需求 6：适配器目录的数据来源必须有稳定优先级
- `requirements.md` 需求 7：隔离会话里的 HOME 策略必须写死
- `requirements.md` 需求 8：健康状态必须能区分不同故障

### 1.3 已确认前提

基于当前机器的实际测试，已经确认：

- `npm install -g @jackwener/opencli` 可以成功安装
- 当前版本 `opencli --version` 返回 `1.7.7`
- 当前包根目录包含：
  - `package.json`
  - `dist/`
  - `cli-manifest.json`
  - `clis/`
- 当前包根目录不包含 `skills/`
- `opencli list -f json` 可返回完整命令目录
- 纯 HTTP 命令可以直接运行
- 浏览器型命令依赖 Browser Bridge 扩展和 daemon 健康状态

一句话：
OpenCLI 的“命令目录”和“Skill 包”不是同一个安装产物，不能混着管。

## 2. 架构

### 2.1 系统结构

这次只加六层，不再发明新宇宙：

1. `OpenCliProviderStore`
   - 保存 OpenCLI 安装状态、健康状态、策略和目录缓存
2. `OpenCliCatalogService`
   - 读取和归一化命令目录
3. `OpenCliRuntimeBuilder`
   - 根据启用结果生成裁剪运行时
4. `OpenCliRuntimeResolver`
   - 决定某个会话该用哪一份 OpenCLI 运行时
5. `OpenCliExecutionPolicy`
   - 决定会话里是否暴露 OpenCLI、暴露哪个入口、如何注入真实 HOME
6. `Settings OpenCLI Section`
   - 在技能面板下显示状态、目录和启用开关

数据流是：

1. 发现 OpenCLI 安装和包根目录
2. 读取命令目录并归一化成内部结构
3. 用户在面板里调整 provider 开关和适配器开关
4. 系统生成新的裁剪运行时
5. 新建会话时切换到这份运行时
6. OpenCLI 进程单独拿真实 HOME，其他会话进程继续用隔离 HOME

### 2.2 核心原则

#### 原则 1：不碰用户全局安装

用户全局安装目录只读，不在里面删文件、不改 manifest、不写配置。

#### 原则 2：真正生效靠运行时切换

面板里的启用结果不是 UI 状态，而是“新会话会用哪一份 OpenCLI 运行时”。

#### 原则 3：命令目录项是最小控制粒度

内部最小粒度定为 `site/name`，例如 `twitter/trending`。
前端按站点分组展示，但后端控制以 `commandId = site/name` 为准。

#### 原则 4：OpenCLI 进程单独拿真实 HOME

不要为了 OpenCLI 把整个 `Claude Code` / `Codex` 会话 HOME 切回真实 home。那是脏设计。

## 3. 模块职责

### 3.1 `OpenCliProviderStore`

职责：

- 持久化 OpenCLI provider 的总开关
- 持久化适配器目录项启用结果
- 保存最近一次目录缓存摘要
- 保存当前生效运行时配置档

### 3.2 `OpenCliCatalogService`

职责：

- 发现 OpenCLI 安装根目录
- 按优先级读取目录来源
- 把 `cli-manifest.json` 或 `opencli list -f json` 结果归一化
- 给前端提供按站点分组的数据

### 3.3 `OpenCliRuntimeBuilder`

职责：

- 根据启用目录项生成新的运行时根目录
- 复制或链接必要的基础运行文件
- 生成裁剪后的 `cli-manifest.json`
- 复制保留的 `clis/` 文件和必要辅助文件
- 生成可执行 shim

### 3.4 `OpenCliRuntimeResolver`

职责：

- 根据当前用户设置返回会话应使用的运行时
- 区分：
  - OpenCLI 未启用
  - OpenCLI 已启用但运行时失效
  - OpenCLI 已启用且运行时可用

### 3.5 `OpenCliExecutionPolicy`

职责：

- 会话启动前决定是否把 `opencli` 暴露到 PATH
- 当会话执行 `opencli` 时，决定调用哪一个 shim
- 只对 OpenCLI 子进程注入真实 HOME

### 3.6 `Settings OpenCLI Section`

职责：

- 展示 OpenCLI provider 卡片
- 展示总开关、健康状态、版本、目录刷新时间
- 展示适配器目录并支持勾选

## 4. 数据结构

### 4.1 `OpenCliProviderRecord`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `providerId` | string | 固定为 `opencli` |
| `enabled` | boolean | 总开关 |
| `installState` | string | `not_installed/installed/broken` |
| `healthState` | string | `unknown/binary_ready/bridge_missing/ready/runtime_build_failed` |
| `version` | string \| null | 当前安装版本 |
| `installPath` | string \| null | 包根目录 |
| `lastCheckedAt` | string \| null | 最近健康检查时间 |
| `activeRuntimeId` | string \| null | 当前生效运行时配置档 ID |
| `lastErrorCode` | string \| null | 最近错误码 |
| `lastErrorDetail` | string \| null | 最近错误详情 |

### 4.2 `OpenCliCatalogEntryRecord`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `commandId` | string | `site/name` |
| `site` | string | 站点分组 |
| `name` | string | 命令名 |
| `description` | string | 描述 |
| `strategy` | string | `public/cookie/header/intercept/ui/local` |
| `browser` | boolean | 是否依赖浏览器 |
| `modulePath` | string \| null | 来自 manifest 的模块路径 |
| `sourceFile` | string \| null | 原始源文件路径 |
| `enabled` | boolean | 当前是否启用 |
| `sortOrder` | number | 目录稳定排序 |

### 4.3 `OpenCliRuntimeProfileRecord`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 运行时配置档 ID |
| `version` | string | 对应 OpenCLI 版本 |
| `sourceInstallPath` | string | 源安装根目录 |
| `enabledCommandIdsJson` | string | 启用的 `site/name` 列表 |
| `runtimeRootPath` | string | 生成后的裁剪运行时目录 |
| `status` | string | `pending/ready/failed/stale` |
| `contentHash` | string | 当前配置内容哈希 |
| `createdAt` | string | 创建时间 |
| `updatedAt` | string | 更新时间 |
| `lastErrorCode` | string \| null | 构建失败错误码 |
| `lastErrorDetail` | string \| null | 构建失败详情 |

## 5. 关键流程

### 5.1 发现安装与目录

优先级固定如下：

1. 若 `opencli` binary 可执行，优先读取其安装根目录下的 `cli-manifest.json`
2. 若 binary 可执行但包根目录解析失败，退化执行 `opencli list -f json`
3. 若未安装但有用户指定或系统发现的本地 OpenCLI 仓库/包目录，则读取其中的 `cli-manifest.json`
4. 以上都失败，返回“目录不可读取”

这里故意把 `cli-manifest.json` 提到 `opencli list -f json` 前面，因为：

- 它更快
- 更稳定
- 不依赖命令启动是否完整成功

### 5.2 适配器启用结果保存

内部以 `commandId = site/name` 为准保存。

前端交互规则：

- 站点勾选：展开成该站点下全部 `commandId`
- 单命令勾选：只改一条
- 站点全部取消：站点视图显示为关闭

### 5.3 生成裁剪运行时

#### 5.3.1 为什么不能只改一个 manifest

如果直接调用用户全局安装的 `/opt/homebrew/bin/opencli`，它会永远读取自己安装目录里的 `cli-manifest.json` 和 `clis/`。

所以“只写一份新 manifest，不换执行入口”是假的。

真正方案必须是：

1. 生成一份独立的运行时根目录
2. 让会话调用这份运行时里的 `opencli` shim

#### 5.3.2 裁剪运行时目录结构

最小结构：

```text
<runtimeRoot>/
  package.json
  cli-manifest.json
  dist/
  clis/
  node_modules/   # 优先软链接或复用
  bin/
    opencli
```

实现策略：

- `package.json`：复制
- `dist/`：优先软链接到源安装目录，避免重复拷贝
- `node_modules/`：优先软链接到源安装目录
- `cli-manifest.json`：重写为过滤后的结果
- `clis/`：只复制保留命令需要的站点目录和共享辅助目录
- `bin/opencli`：自建 shim，内部执行 `<runtimeRoot>/dist/src/main.js`

#### 5.3.3 为什么 `clis/` 不能只拷命令文件

`OpenCLI` 的站点目录里经常有：

- `utils.js`
- `shared.js`
- `index.js`
- `_shared/`

这些是运行时依赖。

所以裁剪策略不是“只拷 manifest 命中的单个 js 文件”，而是：

1. 先根据 `enabledCommandIds` 计算保留的 `site`
2. 复制这些 `site` 的整站目录
3. 额外保留 `_shared/` 之类公共目录

这会比只拷单文件略大，但不会出现一运行就缺依赖的蠢问题。

### 5.4 会话运行时切换

对 CodingNS 管理会话的处理规则：

1. 若 OpenCLI provider 总开关关闭：
   - 不向会话 PATH 注入 OpenCLI shim
2. 若总开关打开但运行时状态不是 `ready`：
   - 不注入
   - 会话能力里显示不可用原因
3. 若总开关打开且运行时 `ready`：
   - 在 PATH 前部注入 `<runtimeRoot>/bin`

这样新会话里执行 `opencli` 时，命中的就是裁剪版入口。

### 5.5 真实 HOME 注入

这里不能偷懒。

方案固定为：

1. 会话本身继续使用隔离 HOME
2. `opencli` shim 在启动真实 OpenCLI 进程前：
   - 把 `HOME`、`USERPROFILE` 临时切到用户真实 home
   - 只对这个子进程生效
3. OpenCLI 退出后，会话主环境不变

这样可以同时满足：

- OpenCLI 读到用户真实 `~/.opencli`
- `Codex` / `Claude Code` 会话本体仍然隔离

## 6. 接口契约

### 6.1 `GET /api/opencli/overview`

返回：

- provider 基础状态
- 当前目录统计
- 当前生效运行时配置档
- 最近检查时间

### 6.2 `POST /api/opencli/check`

动作：

- 重新发现安装状态
- 重新跑健康检查
- 刷新命令目录缓存

### 6.3 `POST /api/opencli/config`

输入：

- `enabled`
- `enabledCommandIds`

输出：

- 新配置
- 运行时重建结果

### 6.4 `GET /api/opencli/catalog`

返回：

- 全量目录项
- 按站点分组后的结构
- 每项当前启用状态

## 7. 风险与处理

### 7.1 用户全局 opencli 更新后，裁剪运行时过期

处理：

- 记录 `sourceInstallPath + version + contentHash`
- 版本或安装根目录变化时，把旧配置档标记为 `stale`
- 下次进入面板或新建会话前触发重建

### 7.2 浏览器桥未连接

处理：

- provider 级健康状态显示 `bridge_missing`
- 目录项继续展示，但 `browser=true` 的项标记为“当前不可运行”
- 不阻止纯 HTTP 目录项继续使用

### 7.3 旧会话仍在用老运行时

处理：

- 明确不强切
- 面板显示“变更对新会话生效”
- 若后续需要热切换，另开子规格，不在这次硬加

## 8. 验证策略

### 8.1 目录读取验证

- 已安装时能读到 manifest
- 未安装时能返回明确缺失状态
- 目录缓存可回放

### 8.2 运行时构建验证

- 禁用一条目录项后，裁剪 manifest 中不再出现该命令
- 使用裁剪版 shim 执行时，该命令无法调用
- 保留命令仍可执行

### 8.3 HOME 注入验证

- 隔离会话中运行 `opencli doctor` 时，OpenCLI 可读到真实 `~/.opencli`
- 同一会话里的其他命令仍使用隔离 HOME
