# 设计文档 - spec001.7-设置页模型快速切换与CC-SWITCH接入

状态：Draft

## 1. 概述

### 1.1 目标

- 在设置页提供一个正式的模型管理入口
- 第一阶段以 `cc-switch` 现有 provider 预设为基础，实现“模型预设快速切换”
- 统一展示 `codex`、`claude-code`、`gemini`、`opencode` 四个应用的当前状态
- 切换动作统一收口到 Host，不让前端直接碰本地 CLI
- 切换后尽快让现有 provider capability 和“跟随 CLI 默认模型”显示吃到变化

### 1.2 覆盖需求

- `requirements.md` 需求 1：设置页必须提供统一的模型管理入口
- `requirements.md` 需求 2：系统必须能读取每个应用当前预设和可切换项
- `requirements.md` 需求 3：模型切换动作必须通过 Host 调用 `cc-switch`
- `requirements.md` 需求 4：界面必须明确展示可用、不可用和失败状态
- `requirements.md` 需求 5：切换后必须尽快反映到现有“跟随 CLI 默认模型”链路
- `requirements.md` 需求 6：返回给前端的数据必须去敏感化

### 1.3 技术约束

- Host 继续使用 `Node.js 22 + Fastify`
- 前端继续使用 `apps/user-app` 现有设置页面板模式
- `cc-switch` 命令路径需要支持显式配置和常见本机回退路径
- 切换动作只通过 CLI 命令执行，不直接写 `cc-switch` sqlite
- 读取状态优先走结构化状态源，不解析 `provider list/current` 的漂亮表格
- 第一版只支持预设切换，不做任意模型编辑

### 1.4 当前实现判断

- 设置页已经有 `TailscalePanel`、`SkillManagementPanel` 这类独立面板，新增模型管理面板不用重写设置页结构
- 会话侧已经支持“跟随 CLI 默认模型”，说明系统里本来就有“默认模型”概念
- `codex`、`claude-code`、`opencode` 已有不同程度的默认模型读取链路
- `cc-switch` 本机已安装，但它当前暴露的稳定非交互命令是 provider 预设切换，不是通用的 `set-model`

### 1.5 本阶段核心判断

这里必须把边界钉死：

- 第一阶段做的是“模型预设切换”
- 不是“任意 provider 下自由编辑模型字段”
- 不是“把 `cc-switch` 直接当成万能模型 API”

如果后续要支持同一 provider 内直接改模型字段，那是下一阶段的新需求，不该把第一阶段写烂。

## 2. 架构

### 2.1 总体结构

这次链路分成三层：

1. **Host 侧 `cc-switch` 适配层**
   - 负责发现命令路径
   - 负责读取结构化状态
   - 负责执行切换命令
   - 负责把内部状态裁剪成前端能用的安全快照
2. **Host API**
   - 提供“读取模型管理快照”和“执行切换”两个最小接口
3. **设置页模型管理面板**
   - 负责展示四个应用的当前状态
   - 负责触发切换
   - 负责成功和失败提示

### 2.2 模块划分

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `cc-switch-adapter` | 读取本机 `cc-switch` 状态并执行切换 | CLI 路径、本地状态源 | 安全快照、切换结果 |
| `model-switch-service` | 统一四个应用的快照和切换流程 | 应用标识、预设 ID | 面板快照 |
| `model-switch-controller` | 对外提供 HTTP 接口 | 请求参数 | JSON 响应 |
| `model-switch-api` | 前端请求封装 | HTTP 响应 | 组件可用数据 |
| `ModelManagementPanel` | 设置页图形化入口 | 快照、切换动作 | 用户可读状态 |

### 2.3 关键原则

#### 2.3.1 切换只走 CLI，读取尽量走结构化状态

切换动作必须通过 `cc-switch` CLI 执行，因为这是最接近真实生效路径的入口。

但读取状态不要去解析：

- `cc-switch provider list`
- `cc-switch provider current`
- `cc-switch provider fetch-models`

这些输出是给人看的，不是稳定协议。

第一版读取建议：

- 由适配层读取 `cc-switch` 的结构化状态源
- 从中提取当前预设、预设列表和可显示的模型名
- 如果读取失败，就老实返回失败状态

#### 2.3.2 不把 `cc-switch` 的内部存储直接暴露给前端

适配层可以利用结构化状态源，但不能把内部字段原样往前端倒。

前端只需要：

- 当前有没有配置
- 当前预设是谁
- 当前模型是什么
- 能切到哪些项
- 为什么不可用

其余都不需要。

#### 2.3.3 一个应用失败，不拖死整个面板

四个应用必须按卡片独立展示。

如果 `gemini` 当前没配置，`codex` 也应该照样能切。
不要把模型管理页写成“只要一个失败，全页空白”。

#### 2.3.4 不破坏显式模型参数

当前系统里已经存在两类行为：

1. 跟随 CLI 默认模型
2. 会话显式传 `model`

第一阶段的全局切换只影响第一类。
第二类必须保持原样。

## 3. 组件和接口

### 3.1 应用标识映射

CodingNS 内部 provider 标识和 `cc-switch` 的应用标识不完全一致，必须通过一层映射统一。

| CodingNS 应用 | `cc-switch` CLI 应用参数 |
| --- | --- |
| `claude-code` | `claude` |
| `codex` | `codex` |
| `gemini` | `gemini` |
| `opencode` | `open-code` |

这层映射只允许存在于适配层，不要散到前端文案和路由里。

### 3.2 前端返回模型

覆盖需求：1、2、4、5、6

#### 3.2.1 `ModelManagementSnapshot`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `items` | `ModelManagementAppSnapshot[]` | 是 | 四个应用的状态列表 |
| `scannedAt` | string | 是 | 最近一次扫描时间 |

#### 3.2.2 `ModelManagementAppSnapshot`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `app` | string | 是 | `claude-code/codex/gemini/opencode` |
| `displayName` | string | 是 | 前端展示名 |
| `cliAvailable` | boolean | 是 | 本机是否找到 `cc-switch` |
| `status` | `ready/unconfigured/unavailable/error` | 是 | 当前状态 |
| `statusText` | string | 否 | 人话说明 |
| `currentPresetId` | string | 否 | 当前预设 ID |
| `currentPresetName` | string | 否 | 当前预设名称 |
| `currentModel` | string | 否 | 当前模型，读不到就为空 |
| `options` | `ModelPresetOption[]` | 是 | 可切换项 |

#### 3.2.3 `ModelPresetOption`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 预设 ID |
| `name` | string | 是 | 预设名称 |
| `model` | string | 否 | 从预设里提取出的模型名 |
| `summary` | string | 否 | 精简描述，比如 provider 名称或 endpoint 提示 |
| `isCurrent` | boolean | 是 | 是否当前已生效 |

### 3.3 Host 接口

#### 3.3.1 `GET /api/system/model-switch`

- 类型：HTTP
- 输入：无
- 输出：`ModelManagementSnapshot`
- 说明：
  - 返回四个应用的完整快照
  - 单个应用失败不影响其他应用

#### 3.3.2 `POST /api/system/model-switch`

- 类型：HTTP
- 输入：`{ app: string, presetId: string }`
- 输出：`ModelManagementAppSnapshot`
- 说明：
  - 只接受受支持应用
  - 成功后返回该应用切换后的最新快照
  - 失败时返回明确错误码和错误说明

### 3.4 读取策略

覆盖需求：2、4、6

第一阶段读取策略分两步：

1. **命令可用性判断**
   - 从配置项或常见路径中找到 `cc-switch`
   - 找不到就把四个应用统一标记为 `unavailable`
2. **结构化状态读取**
   - 由适配层读取 `cc-switch` 的结构化状态源
   - 对每个应用抽取：
     - 当前预设
     - 全部预设列表
     - 当前模型和候选项模型

模型提取规则要务实：

- 能可靠提取就返回
- 不能可靠提取就返回空
- UI 显示“未标记模型”或等价文案

不要为了把格子填满去猜。

### 3.5 切换流程

覆盖需求：3、4、5

#### 3.5.1 切换执行

Host 接到切换请求后：

1. 校验 `app` 和 `presetId`
2. 映射到 `cc-switch` 的应用参数
3. 执行：

```bash
cc-switch provider switch -a <mapped-app> <presetId>
```

4. 命令成功后重新读取该应用快照
5. 返回新的快照给前端

#### 3.5.2 切换后的状态刷新

切换成功后需要做两件事：

1. 设置页立即使用接口返回的新快照更新当前卡片
2. 会话相关页面在下次读取 provider capabilities 时，尽快拿到新的默认模型信息

第一版允许通过主动重新拉取 capabilities 解决。
如果现有缓存导致切换后长时间仍显示旧值，就要补最小缓存失效处理。

## 4. 前端交互

### 4.1 桌面端设置页

桌面端沿用现有设置页面板结构，新增一个独立 section：

- 标题：模型管理
- 内容：`ModelManagementPanel`

每个应用一张卡片，至少显示：

- 应用名
- 当前模型
- 当前预设
- 状态提示
- 切换按钮或下拉

### 4.2 移动端设置页

移动端沿用现有 settings section 入口，在列表中新增“模型管理”。

进入后显示独立页面区块，不和 Skill、Tailscale 混在一起。

### 4.3 状态表现

| 状态 | 表现 |
| --- | --- |
| `ready` | 显示当前模型、预设和可切换项 |
| `unconfigured` | 显示“未配置”说明和空列表 |
| `unavailable` | 显示命令不可用或本机未安装 |
| `error` | 显示失败摘要和重试入口 |

## 5. 安全和兼容性

### 5.1 去敏感化

返回给前端的数据里禁止出现：

- API key
- token
- 完整 `settings_config`
- 任何能直接复用认证的头和地址组合

### 5.2 与现有运行时兼容

- 当前会话显式传了 `model` 的，不受全局切换影响
- 当前会话选“跟随 CLI 默认模型”的，会在后续能力刷新中看到新值
- 新会话默认行为继续走现有 provider runtime，不在这次重写

### 5.3 与手工 CLI 操作兼容

用户继续在终端里手敲 `cc-switch` 完全允许。

设置页刷新时读取的就是当前真实状态，不需要和前端本地缓存打一架。

## 6. 测试与验证

### 6.1 Host 侧

- 命令路径发现测试
- 单个应用快照解析测试
- 单个应用切换成功测试
- 单个应用切换失败测试
- 单个应用失败不影响其他应用测试
- 去敏感化输出测试

### 6.2 前端侧

- 设置页桌面端面板渲染测试
- 移动端 section 入口测试
- 加载、不可用、未配置、失败状态测试
- 切换成功后的状态更新测试

### 6.3 手工验收

至少验证下面这些场景：

1. `codex` 已配置多个预设，切换成功
2. `claude-code` 已配置多个预设，切换成功
3. `gemini` 未配置，界面显示未配置
4. `opencode` 未配置或读取失败，不影响其他卡片
5. 切换后会话页“跟随 CLI 默认模型”的显示能在合理时间内更新
