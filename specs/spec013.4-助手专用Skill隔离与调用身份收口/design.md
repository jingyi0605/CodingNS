# 设计文档 - spec013.4-助手专用Skill隔离与调用身份收口

状态：Draft

## 1. 概述

### 1.1 目标

- 把 `codingns-assistant` 从公共 Skill 分发链中拆出去
- 保留 Butler 专用 home 的 `codingns-assistant` 注入能力
- 给助手能力面补正式调用者身份边界，而不是继续靠 Skill 文本约束
- 为助手专用目录名建立保留和诊断机制
- 清理或隔离历史公共残留，避免旧机器继续误触发

### 1.2 覆盖需求

- `requirements.md` 需求 1：区分公共 Skill 与助手专用运行时资产
- `requirements.md` 需求 2：停止公共安装与公共同步
- `requirements.md` 需求 3：保留 Butler 专用注入
- `requirements.md` 需求 4：保留目录名与拦截
- `requirements.md` 需求 5：助手调用者身份边界
- `requirements.md` 需求 6：保留用户显式交互入口
- `requirements.md` 需求 7：旧残留处理
- `requirements.md` 需求 8：普通公共 Skill 管理不受影响
- `requirements.md` 需求 9：最小诊断与回归验证

### 1.3 与前置 Spec 的关系

- `spec001.5` 解决的是公共本地 Skill 管理，不该继续替 Butler 专用资产兜底
- `spec013.1` 已有 Butler 专用工作区、规则文件和专用凭证模型
- `spec013.2` 已有 `codingns assistant ...` 与 `/api/assistant/*` 能力面
- `spec013.3` 已继续扩展 Butler 专用运行时和沙箱，但不负责修公共 Skill 泄漏边界

一句话：

- `spec001.5` 管公共 Skill
- `spec013.2` 管助手能力面
- `spec013.4` 专门修“助手专用资产误入公共 Skill”这条边界

## 2. 核心思路

### 2.1 这不是提示词问题，是分发边界错了

`codingns-assistant` 的语义非常明确：

- 让助手先查 `codingns assistant --help`
- 让助手只通过真实项目会话和受控终端推进
- 让助手在 Butler 专用沙箱里工作

这种东西本来就不是普通项目工作区会话应该看到的。

现在的问题是它被落到了公共 `skills/` 根目录里。只要普通会话能扫目录，它就会误读。  
所以正确修法不是“把 `SKILL.md` 写得更狠”，而是把它从错误分发位置拿掉。

### 2.2 错的数据结构是“只有 targetCli，没有 audience”

当前公共 Skill 管理主要关心：

- 这个 Skill 要同步到哪个 CLI
- 它在那个 CLI 的 `skills/` 根目录下长什么样

但这里缺了一个关键维度：

- 这个东西是给普通会话用，还是只给助手运行时用

如果继续把 `codingns-assistant` 塞进公共 `SkillManager`，后面只会不断长更多例外判断。

所以这里不把 `codingns-assistant` 继续纳入公共 Skill 范畴，而是直接拆成另一类资产：

- 公共 Skill：继续走 `SkillManager`
- 助手专用运行时资产：只走 Butler 专用注入链

### 2.3 Skill 文本不是权限系统

就算把 `codingns-assistant` 藏好了，也不能假装问题已经解决。

因为普通会话一旦拿到 Butler 凭证或能伪造调用路径，仍然可能去调 `/api/assistant/*`。

所以还要补第二道边界：

- 把助手能力调用区分成“交互式用户入口”和“助手运行时入口”
- 服务端按调用者身份做正式校验和审计

### 2.4 迁移必须保守，不能乱删用户目录

历史上已经被同步出去的 `codingns-assistant` 目录不一定都还保持原样。

所以迁移只能分两类：

1. 明确能确认是系统旧副本的，允许自动清理或自动禁用
2. 内容已漂移的，只做诊断和阻断，不静默删

这条边界必须守住，不然修一个问题又会制造新的数据损坏。

## 3. 总体架构

### 3.1 模块分层

| 层级 | 作用 | 主要模块 |
| --- | --- | --- |
| 公共 Skill 层 | 继续管理普通公共 Skill | `skill-manager-service`、`builtin-skill-service` |
| 助手运行时资产层 | 只负责 Butler 专用资产分发 | `assistant-runtime-asset-service` |
| 助手能力调用层 | 校验调用者身份并记录来源 | `assistant-capability-service` + 新的调用者分类/校验组件 |
| 迁移诊断层 | 识别公共目录旧残留并决定清理或告警 | `assistant-skill-legacy-cleaner` |

### 3.2 关键原则

1. `codingns-assistant` 不再是公共 Skill  
2. Butler 仍然能拿到 `codingns-assistant`  
3. 普通项目工作区默认看不到官方分发的 `codingns-assistant`  
4. `/api/assistant/*` 不能只看“有人会调”，必须看“是谁在调”  
5. 迁移默认保守，不静默删除用户改过的目录  

## 4. 组件设计

### 4.1 `builtin-skill-service` 只保留公共内置 Skill

当前问题之一，是 `builtin-skill-service` 把 `codingns-assistant` 列进了公共内置 Skill 列表。

调整后：

- `builtin-skill-service` 只管理公共内置 Skill
- `codingns-assistant` 从这里移除
- 公共 `/settings/skills` 和 `codingns skills ...` 不再把它当受管公共 Skill 展示

结果：

- `spec001.5` 回到本职，只管公共本地 Skill
- 助手专用资产不再污染公共 Skill 状态

### 4.2 新增 `assistant-runtime-asset-service`

新增一个 Butler 专用运行时资产服务，职责只有一件事：

- 把 `codingns-assistant` 这类助手专用资产注入到 Butler 专用 home

它不做公共扫描，不进公共 Skill 表，不走 `SkillManager` 的受管状态。

#### 4.2.1 输入

- 目标 provider：`codex` / `claude-code`
- 目标专用 home 路径
- 资产目录名：当前固定为 `codingns-assistant`

#### 4.2.2 输出

- 注入成功 / 失败结果
- 资产源路径
- 目标路径
- 诊断信息

#### 4.2.3 使用位置

- Butler 准备 `codex` 专用 home 时
- Butler 准备 `claude-code` 专用 home 时
- 需要回归检查 Butler 运行时资产时

### 4.3 公共 Skill 保留目录名规则

为公共 Skill 管理增加保留目录名集合：

```ts
const RESERVED_ASSISTANT_SKILL_NAMES = [
  "codingns-assistant"
];
```

公共 Skill 的这些入口统一校验：

- `addManagedSkill`
- `importUnmanagedSkill`
- `ensureBuiltinSkill`
- 公共扫描结果归类

处理规则：

- 用户新增/导入/同步保留目录名时，直接拒绝
- 扫描到保留目录名时，归类为“助手专用残留/冲突”，不进入普通受管流程

### 4.4 `postinstall` 不再向公共 `~/.codex/skills` 复制助手 Skill

当前 npm `postinstall` 会直接复制 `codingns-assistant` 到公共 `~/.codex/skills`。

这条链必须删掉，因为它绕过了所有后续管理和注入边界。

调整后：

- `postinstall` 不再复制 `codingns-assistant`
- 如需校验 Butler 专用运行时资产是否存在，交给 Butler 初始化链路处理

### 4.5 助手调用者身份模型

这里不把所有调用都改成一套复杂权限平台，只补最小可用的调用者分类：

```ts
type AssistantCallerKind =
  | "interactive_user"
  | "assistant_runtime";
```

说明：

- `interactive_user`：用户通过正常产品登录态，从页面发起显式操作
- `assistant_runtime`：Butler 专用工作区/专用 CLI 凭证发起的助手运行时调用

#### 4.5.1 为什么要分两类

- 页面上的 Butler 功能本来就是用户显式操作，不能被一起锁死
- 但普通项目工作区会话不该凭一个公共 Skill 就冒充 `assistant_runtime`

#### 4.5.2 最小实现方式

- Butler 专用凭证文件增加明确的调用者类型或作用域字段
- `codingns assistant ...` 通过该专用凭证调用时，服务端识别为 `assistant_runtime`
- 页面请求继续走现有用户登录态，服务端识别为 `interactive_user`

#### 4.5.3 服务端策略

- 对需要助手专用入口语义的调用，必须识别来源
- 缺少合法调用者身份时，返回明确错误
- 审计记录里写入调用者类型

### 4.6 旧残留清理器

新增公共目录旧残留处理逻辑，分两种情况：

#### 4.6.1 可确认的系统旧副本

条件：

- 目录名命中保留名
- 内容哈希与系统历史已知副本一致

处理：

- 自动删除，或移动到系统保留的禁用目录
- 记录清理结果

#### 4.6.2 已漂移或用户手改过的目录

条件：

- 目录名命中保留名
- 内容与系统已知副本不一致

处理：

- 不自动删除
- 在扫描结果和日志里明确标记为“保留目录冲突”
- 阻止其继续进入公共 Skill 正常流程

## 5. 数据与状态模型

### 5.1 公共 Skill 数据模型不新增复杂权限字段

这里不把 `ManagedSkillRecord` 改成权限大杂烩。

原因很简单：

- 公共 Skill 本来就只解决公共目录管理问题
- `codingns-assistant` 已经决定移出公共 Skill 范畴

所以这次不往公共 Skill 主表里硬塞 `audience`、`acl`、`runtime_role` 这种新字段，避免把 `spec001.5` 的模型污染坏。

### 5.2 新增运行时资产规格

```ts
interface AssistantRuntimeAssetSpec {
  directoryName: string
  sourcePath: string
  supportedProviders: Array<"codex" | "claude-code">
}
```

第一阶段只需要一条：

```ts
{
  directoryName: "codingns-assistant",
  sourcePath: ".../builtin-skills/codingns-assistant",
  supportedProviders: ["codex", "claude-code"]
}
```

### 5.3 助手调用者分类

```ts
interface AssistantCallerContext {
  kind: "interactive_user" | "assistant_runtime"
  userId: string | null
  credentialId: string | null
}
```

用途：

- 能力层区分调用来源
- 审计层保留最小诊断信息

## 6. 流程设计

### 6.1 公共内置 Skill 启动同步流程

1. Host 启动
2. `builtin-skill-service` 读取公共内置 Skill 列表
3. 列表中不再包含 `codingns-assistant`
4. 公共 Skill 同步照常执行

结果：

- 普通公共 Skill 继续工作
- `codingns-assistant` 不会再被重新同步回公共目录

### 6.2 Butler 专用 home 初始化流程

1. Butler 创建或刷新专用 home
2. 写入专用规则和专用凭证
3. `assistant-runtime-asset-service` 把 `codingns-assistant` 注入专用 home
4. 返回初始化结果

结果：

- Butler 仍然能看到 `codingns-assistant`
- 不依赖公共 `~/.codex/skills`

### 6.3 公共 Skill 导入/扫描流程

1. 用户导入或系统扫描公共 Skill
2. 命中保留目录名时，走保留冲突分支
3. 不命中时，继续原有公共 Skill 流程

结果：

- 普通公共 Skill 不受影响
- `codingns-assistant` 不会再次被纳管成公共 Skill

### 6.4 助手能力调用流程

1. 请求进入 `/api/assistant/*`
2. 服务端识别调用来源：
   - 页面登录态：`interactive_user`
   - Butler 专用凭证：`assistant_runtime`
3. 根据路由和来源类型决定是否允许
4. 写入审计来源

结果：

- 页面显式交互继续可用
- 普通项目工作区无法仅靠读到 Skill 就冒充助手运行时

### 6.5 旧残留处理流程

1. 启动扫描公共 Skill 根目录
2. 发现 `codingns-assistant`
3. 对比目录内容哈希
4. 分流：
   - 系统旧副本：自动清理/禁用
   - 漂移副本：保留但诊断并阻断

## 7. 接口契约

### 7.1 `ensureAssistantRuntimeAsset()`

- 类型：Host 内部服务
- 输入：`provider`、`targetHomeDir`
- 输出：注入结果、源路径、目标路径、诊断
- 错误：`ASSISTANT_RUNTIME_ASSET_NOT_FOUND`、`ASSISTANT_RUNTIME_ASSET_SYNC_FAILED`

### 7.2 公共 Skill 保留名校验

- 类型：Host 内部服务
- 入口：
  - `addManagedSkill`
  - `importUnmanagedSkill`
  - `ensureBuiltinSkill`
  - `scanSkills`
- 输入：目录名、来源路径、内容哈希
- 输出：允许 / 拒绝 / 诊断
- 错误：`SKILL_RESERVED_FOR_ASSISTANT_RUNTIME`

### 7.3 助手调用者识别

- 类型：Host 内部服务 / 路由前置校验
- 输入：认证上下文、凭证类型、请求来源
- 输出：`AssistantCallerContext`
- 错误：`ASSISTANT_CALLER_NOT_ALLOWED`

### 7.4 旧残留诊断

- 类型：Host 内部服务
- 输入：公共 Skill 根目录
- 输出：清理结果或诊断结果
- 错误：`ASSISTANT_SKILL_LEGACY_CONFLICT`

## 8. 风险与兼容

### 8.1 最大风险

最大风险不是删错目录，而是只停了新同步，却没处理旧残留，最后用户仍然看到普通项目会话读到 `codingns-assistant`。

### 8.2 兼容策略

- Butler 专用注入链优先落地，再停公共同步
- 保留页面交互入口，不把用户显式操作一起锁死
- 对旧残留目录采取“能确认才自动清理，否则只诊断”的保守策略

### 8.3 回归重点

- Butler 专用 `codex` / `claude-code` home 仍可发现 `codingns-assistant`
- 公共 `~/.codex/skills` 默认不再出现官方 `codingns-assistant`
- 普通公共 Skill 扫描、导入、同步照常可用
- `/api/assistant/*` 能区分 `interactive_user` 与 `assistant_runtime`
