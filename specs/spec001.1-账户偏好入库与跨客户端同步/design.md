# 设计文档 - spec001.1 账户偏好入库与跨客户端同步

状态：Draft

## 1. 概述

### 1.1 目标

- 把账户级偏好从 `ClientRuntimeConfig` 和零散的 `localStorage` 键里拆出来
- 让 `defaultPermissionMode`、`language`、`theme`、provider 默认模型和推理等级具备跨客户端一致性
- 保留设备级配置和临时界面状态的本地存储边界，不把数据库变成垃圾桶
- 让旧本地配置可以平滑迁移，不要求用户手工重配

### 1.2 覆盖需求

- `requirements.md` 需求 1：默认会话权限账户化
- `requirements.md` 需求 2：账户偏好与设备配置分层
- `requirements.md` 需求 3：首批跨端同步偏好
- `requirements.md` 需求 4：旧本地配置迁移
- `requirements.md` 需求 5：本地保留清单

### 1.3 技术约束

- 后端继续使用 `apps/host` 现有 Fastify + SQLite 架构
- 偏好接口继续挂在受保护的 `/api/preferences/*` 路由组下，与快捷短语偏好保持同一风格
- 前端不能继续把账户偏好和设备配置塞进同一个 `ClientRuntimeConfig`
- 首屏仍然需要本地回退，不允许因为网络慢把语言和主题闪成默认值
- 桌面端本地 `client-runtime-config.json` 仍保留，但只负责设备级配置

### 1.4 当前实现诊断

当前问题已经非常明确：

1. `defaultPermissionMode` 虽然会透传到会话创建和消息发送链路，但它的保存位置只是本地 `codingns.client.runtime-config`
2. `language` 通过 `clientConfigStore` 持久化，`theme` 单独存在 `codingns-theme`，provider 默认项又是另一组键，数据结构散得很难看
3. 桌面端会再写一次 `client-runtime-config.json`，但这依然只是“本机本地文件”，不是账户同步
4. 登录前后的启动顺序只初始化了本地配置，没有一套正式的“账户偏好预取 + 回退”链路

一句人话：
现状不是不能存，而是存乱了。

## 2. 架构

### 2.1 系统结构

新的结构拆成三层：

1. **设备级配置层**
   - 继续保留本地存储
   - 负责 `hostBaseUrl`、`releaseChannel`、`autoReconnect`、`autoCheckUpdate`
2. **账户级偏好层**
   - 以数据库为真相源
   - 负责 `defaultPermissionMode`、`language`、`theme`、provider 默认偏好
3. **本地 shadow cache**
   - 只保存账户偏好的最近一次已知值
   - 解决冷启动、接口失败和离线时的首屏回退

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `user-preference-store` | 前端账户偏好内存状态与读取优先级 | 远端 profile、shadow cache、会话显式值 | 当前有效账户偏好 |
| `device-config-store` | 前端设备级配置状态 | 本地配置、桌面端本地文件 | 当前设备配置 |
| `PreferenceProfileController` | 暴露账户偏好读写接口 | 已登录请求、偏好 patch | 偏好 profile DTO |
| `PreferenceProfileService` | 组装 profile、做字段校验和默认合并 | repo 结果、patch | 规范化 profile |
| `UserPreferenceRepository` | 读写账户级通用偏好 | `user_id`、字段 patch | 偏好记录 |
| `UserProviderPreferenceRepository` | 读写按 provider 的默认项 | `user_id`、`provider`、字段 patch | provider 偏好记录 |
| `LegacyPreferenceMigrator` | 把旧本地偏好一次性回填到远端 | 本地旧键、远端空 profile | 幂等回填结果 |

### 2.3 关键流程

#### 2.3.1 已登录用户冷启动

1. 应用启动时先读取设备级配置和账户偏好 shadow cache
2. 如果本地已有登录 session，则在 React 首屏前预取一次账户偏好
3. 预取成功则用远端结果覆盖 shadow cache 和内存 store
4. 预取失败则保留 shadow cache 作为当前账户偏好
5. 会话创建、消息发送、主题渲染、语言渲染都从账户偏好 store 读取

#### 2.3.2 匿名状态登录

1. 登录页仍依赖设备级 `hostBaseUrl` 发起认证
2. 登录成功后立即请求账户偏好 profile
3. 若远端 profile 为空且本地存在可迁移旧键，则执行一次回填
4. 回填成功后重新拉取 profile，作为当前账户偏好真相

#### 2.3.3 设置页保存

1. 设置页修改账户级偏好时先更新内存 store，保证 UI 即时生效
2. 随后调用 `/api/preferences/profile` 写远端
3. 写成功后更新 shadow cache
4. 写失败时保留当前 UI 值并提示错误，同时根据失败类型决定是否回滚

#### 2.3.4 Legacy LocalStorage 一次性迁移

1. 客户端收集旧键：
   - `codingns.client.runtime-config.defaultPermissionMode`
   - `codingns.client.runtime-config.language`
   - `codingns-theme`
   - `composer-selected-model:*`
   - `composer-reasoning-level:*`
2. 如果远端 profile 对应字段仍为空，则把本地值作为首个账户级偏好回填
3. 如果远端已有值，则只更新 shadow cache，不反向覆盖数据库
4. 回填完成后，旧键暂不立刻删除，先进入兼容期

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5

- `apps/host/src/modules/preferences/preference-profile-controller.ts`：处理账户偏好读取和保存
- `apps/host/src/modules/preferences/preference-profile-service.ts`：做枚举校验、默认合并和 DTO 组装
- `apps/host/src/storage/repositories/user-preference-repository.ts`：读写通用账户偏好
- `apps/host/src/storage/repositories/user-provider-preference-repository.ts`：读写 provider 默认项
- `apps/user-app/src/preferences/user-preference-store.ts`：前端账户偏好 store
- `apps/user-app/src/preferences/user-preference-service.ts`：前端 profile 拉取、保存、迁移、shadow cache 逻辑
- `apps/user-app/src/config/device-config-store.ts`：保留设备级配置，不再承载账户偏好

### 3.2 数据结构

覆盖需求：1、2、3、4

#### 3.2.1 `UserPreferenceProfile`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `userId` | string | 是 | 用户 ID | 外键到 `auth_users.id` |
| `language` | string | 否 | 界面语言 | `zh-CN` / `en-US` |
| `theme` | string | 否 | 主题 | `light` / `dark` / `sky-blue` / `eye-green` |
| `defaultPermissionMode` | string | 否 | 默认会话权限 | `default` / `acceptEdits` / `bypassPermissions` |
| `createdAt` | string | 是 | 创建时间 | ISO 时间 |
| `updatedAt` | string | 是 | 更新时间 | ISO 时间 |

#### 3.2.2 `UserProviderPreference`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `userId` | string | 是 | 用户 ID | 外键到 `auth_users.id` |
| `provider` | string | 是 | provider 标识 | 当前支持 `claude-code` / `codex` / `opencode` |
| `defaultModel` | string | 否 | 默认模型 ID | 允许为空，表示走 provider 默认值 |
| `defaultReasoningLevel` | string | 否 | 默认推理等级 | `low` / `medium` / `high` / `xhigh` |
| `updatedAt` | string | 是 | 更新时间 | ISO 时间 |

#### 3.2.3 `UserPreferenceShadow`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `profile` | object | 否 | 最近一次成功加载的账户偏好 | 本地只作回退，不是真相源 |
| `providers` | object | 否 | 最近一次成功加载的 provider 偏好 | 按 provider 键组织 |
| `savedAt` | number | 是 | 本地保存时间 | 毫秒时间戳 |

### 3.3 接口契约

覆盖需求：1、3、4、5

#### 3.3.1 `GET /api/preferences/profile`

- 类型：HTTP
- 输入：已登录请求
- 输出：

```json
{
  "profile": {
    "language": "zh-CN",
    "theme": "light",
    "defaultPermissionMode": "default"
  },
  "providers": {
    "codex": {
      "defaultModel": "provider-default",
      "defaultReasoningLevel": "medium"
    },
    "claude-code": {
      "defaultModel": null,
      "defaultReasoningLevel": null
    },
    "opencode": {
      "defaultModel": null,
      "defaultReasoningLevel": null
    }
  },
  "updatedAt": "2026-03-30T09:00:00.000Z"
}
```

- 校验：必须已登录；缺失记录时返回规范化默认结构，不返回裸 `null`
- 错误：`401 UNAUTHORIZED`

#### 3.3.2 `PUT /api/preferences/profile`

- 类型：HTTP
- 输入：

```json
{
  "profile": {
    "language": "en-US",
    "theme": "dark",
    "defaultPermissionMode": "acceptEdits"
  },
  "providers": {
    "codex": {
      "defaultModel": "gpt-5.2",
      "defaultReasoningLevel": "high"
    }
  }
}
```

- 输出：最新规范化 profile，与 `GET` 返回结构一致
- 校验：
  - 仅接受定义过的字段
  - `defaultPermissionMode` 必须是合法枚举
  - `defaultReasoningLevel` 必须是合法枚举或 `null`
  - `providers` 键必须在支持的 provider 集合内
- 错误：
  - `400 INVALID_INPUT`
  - `401 UNAUTHORIZED`

## 4. 数据与状态模型

### 4.1 数据关系

- 设备级配置与账户级偏好完全分离
- `UserPreferenceProfile` 是每个用户一条记录
- `UserProviderPreference` 是每个用户、每个 provider 最多一条记录
- `UserPreferenceShadow` 只是客户端回退缓存，不参与服务端判真

### 4.2 读取优先级

| 场景 | 优先级 |
| --- | --- |
| 会话发送时的权限、模型、推理等级 | 会话显式值 > 账户偏好 store > shadow cache > provider / CLI 默认值 |
| App 渲染时的语言和主题 | 远端预取值 > shadow cache > 现有本地安全回退 |
| 设备配置读取 | 设备本地配置 > 平台默认值 |

### 4.3 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `LOCAL_FALLBACK` | 只拿到了 shadow cache 或本地回退值 | 启动时无远端结果 | 远端 profile 加载成功 |
| `REMOTE_READY` | 已拿到数据库偏好 | profile 请求成功 | 用户修改偏好或重新登录 |
| `MIGRATING` | 正在把旧本地偏好回填到远端 | 发现远端为空且本地有旧值 | 回填成功或失败 |
| `SAVE_PENDING` | 正在保存账户偏好 | 用户在设置页提交修改 | 请求成功或失败 |

## 5. 错误处理

### 5.1 错误类型

- `UNAUTHORIZED`：用户未登录或登录状态失效
- `INVALID_INPUT`：偏好字段不合法
- `PREFERENCE_FETCH_FAILED`：前端拉取账户偏好失败
- `PREFERENCE_SAVE_FAILED`：前端保存账户偏好失败
- `LEGACY_MIGRATION_FAILED`：一次性回填失败

### 5.2 错误响应格式

```json
{
  "detail": "用户可读的错误消息",
  "error_code": "INVALID_INPUT",
  "field": "defaultPermissionMode",
  "timestamp": "2026-03-30T09:00:00.000Z"
}
```

### 5.3 处理策略

1. 远端拉取失败：保留 shadow cache，不阻塞界面进入
2. 保存失败：提示用户失败原因，保留当前内存值并根据调用点决定是否回滚
3. 迁移失败：记录日志并跳过，不清空旧本地值
4. 非法字段：后端直接拒绝，前端不得把任意字符串写成高权限默认值

## 6. 正确性属性

### 6.1 属性 1：账户偏好和设备配置不再混存

*对于任何* 设置项，系统都应该满足：只有账户级偏好会进入偏好接口和偏好表，设备级配置仍留在本地配置链路。

**验证需求：** 需求 2、需求 5

### 6.2 属性 2：会话显式值永远压过账户默认值

*对于任何* 新建会话、继续会话或队列消息发送，系统都应该满足：本次调用显式传入的权限、模型、推理等级优先于账户默认值。

**验证需求：** 需求 1、需求 3

### 6.3 属性 3：数据库是账户偏好的真相源

*对于任何* 已登录客户端，系统都应该满足：远端 profile 一旦成功读取，后续使用数据库值，不再让旧本地值反向覆盖远端。

**验证需求：** 需求 4

### 6.4 属性 4：本地回退不应造成危险默认值漂移

*对于任何* 远端不可达、离线、启动异常场景，系统都应该满足：默认会话权限只会回退到 shadow cache 或安全默认值，不会突然漂移成 `bypassPermissions`。

**验证需求：** 需求 1、需求 4

## 7. 测试策略

### 7.1 单元测试

- 偏好字段规范化与枚举校验
- 读取优先级函数
- Legacy LocalStorage 到迁移输入的映射
- shadow cache 读写和过期策略

### 7.2 集成测试

- `GET/PUT /api/preferences/profile`
- 用户级 profile 默认结构返回
- provider 默认偏好写入与读取
- 非法字段和未授权访问拒绝

### 7.3 端到端测试

- 桌面端修改 `defaultPermissionMode` 后，Web 端登录可见
- 桌面端修改主题和语言后，另一客户端登录可见
- 旧本地偏好首次升级后回填远端成功
- 网络失败时回退到 shadow cache，界面和发送链路仍可工作

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` 2.3、3.2、3.3、4.2 | 集成测试 + 多客户端回归 |
| `requirements.md` 需求 2 | `design.md` 2.1、2.2、4.1 | 代码审查 + 单元测试 |
| `requirements.md` 需求 3 | `design.md` 3.2、3.3、4.2 | 集成测试 + 端到端测试 |
| `requirements.md` 需求 4 | `design.md` 2.3.4、4.3、5.3 | 单元测试 + 端到端测试 |
| `requirements.md` 需求 5 | `design.md` 1.3、4.1、6.1 | 文档走查 + 代码审查 |

## 8. 风险与待确认项

### 8.1 风险

- 主题和语言如果只在登录后再拉远端，首屏会闪，必须保留 shadow cache 或预取
- 旧 `client-runtime-config.json` 与新结构并存期间，桌面端需要明确哪些字段继续写本地，哪些字段停写
- provider 默认模型是否合法依赖运行时 capabilities，不能在后端写死一套完整模型白名单

### 8.2 待确认项

- provider 默认偏好是否需要在设置页集中展示，还是继续留在对话输入区内隐式保存
- shadow cache 是否沿用旧键兼容，还是切到新的统一键名
- “记住密码改系统凭据库”是否另开子 Spec，避免和本 Spec 混做
