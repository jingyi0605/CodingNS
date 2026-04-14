# 设计文档 - spec001.5-多CLI-Skill统一管理与同步

状态：Draft

## 1. 概述

### 1.1 目标

- 把本地 skill 管理从“谁用谁拷目录”改成统一的 `SkillManager`
- 让各 CLI 的 skill 目录继续保持各自原生约定，但管理权收口到项目内部
- 用最小代价替换当前 Butler 里 Codex 专用的 skill 同步硬编码
- 为后续新增目标 CLI 保留稳定扩展点
- 给用户一个稳定的前端入口，但不把 Skill 管理做成工作台主导航

### 1.2 覆盖需求

- `requirements.md` 需求 1：统一读取本地 Skill 现状
- `requirements.md` 需求 2：统一记录并同步受管 Skill
- `requirements.md` 需求 3：支持为指定 CLI 新增 Skill
- `requirements.md` 需求 4：支持导入和纳管本地已有 Skill
- `requirements.md` 需求 5：替换现有零散硬编码逻辑
- `requirements.md` 需求 6：前端入口保持环境级，而不是项目级

### 1.3 技术约束

- 后端：`Node.js 22 + TypeScript + Fastify`
- CLI：`packages/codingns`
- 前端：`apps/user-app`
- 数据存储：沿用现有 Host 存储体系，新增独立 skill 元数据表
- 外部依赖：只依赖本机文件系统中的 CLI skill 目录，不依赖远端仓库
- 当前已知遗留：`apps/host/src/modules/butler/butler-control-session-service.ts` 里存在 Codex 专用 skill 目录复制逻辑
- 当前现有稳定前端入口：`/settings` 与 `/settings/:section`

## 2. 架构

### 2.1 系统结构

第一阶段只做五层：

1. `SkillStore`
   - 保存受管 skill 的元数据、来源、启用目标和同步状态
2. `SkillManager`
   - 负责扫描、导入、添加、同步、冲突检查
3. `SkillTargetAdapter`
   - 描述每个 CLI 的 skill 目录位置和目标读写规则
4. `Transport`
   - 对外暴露 Host API 和 `codingns skills ...` CLI
5. `Settings Entry`
   - 在现有设置页下提供最小前端入口

数据流很简单：

1. 先扫描各 CLI 本地 skill 目录
2. 把受管 skill 落到 SSOT
3. 根据目标列表同步到指定 CLI
4. 所有状态都回写 `SkillStore`
5. 设置页按需读取 SkillManager 状态并触发导入、添加、同步动作

关键原则：

- 各 CLI 继续使用它们自己的 skill 目录
- 系统内部只认一套受管 skill 记录
- 不做市场，不做远端安装，不做第二套格式
- 前端入口是环境级配置入口，不是项目级工作入口

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `skill-store` | 保存受管 skill 记录和目标状态 | skill 元数据、同步结果 | 持久化记录 |
| `skill-manager` | 统一扫描、导入、添加、同步、冲突检查 | 本地目录、目标 CLI、请求参数 | 结构化 skill 结果 |
| `skill-target-adapter` | 解析各 CLI 的 skill 根目录并封装目标写入规则 | CLI 标识、环境配置 | 目标目录信息 |
| `skill-reconciler` | 重扫本地目录并对比受管状态 | 当前目录快照、已保存记录 | 差异与修复建议 |
| `skill-controller` | 暴露 Host API | HTTP 请求 | JSON 结果 |
| `codingns skills` | 暴露命令行入口 | CLI 参数 | 文本或 JSON 输出 |
| `settings-skills-section` | 在设置页里展示 skill 状态和触发操作 | Skill API 响应、用户操作 | 页面状态与提交动作 |

### 2.3 关键流程

#### 2.3.1 本地扫描流程

1. `SkillManager` 向所有 `SkillTargetAdapter` 请求 skill 根目录。
2. 遍历每个目标目录下含 `SKILL.md` 的一级子目录。
3. 读取 skill 基础信息并计算内容哈希。
4. 把结果分成：
   - 已受管 skill
   - 未纳管 skill
   - 冲突 skill
   - 扫描失败目标

#### 2.3.2 新增 skill 流程

1. 用户提交本地 skill 目录和目标 CLI 列表。
2. `SkillManager` 校验目录合法性和 `SKILL.md` 存在性。
3. 复制到 SSOT，并生成受管 skill 记录。
4. 同步到指定目标 CLI。
5. 回写每个目标的同步结果。

#### 2.3.3 导入未纳管 skill 流程

1. 用户从扫描结果中选择某个未纳管 skill。
2. `SkillManager` 以选定来源目录为准复制到 SSOT。
3. 建立受管记录，并绑定初始来源目标。
4. 如用户要求，再同步到其他目标 CLI。

#### 2.3.4 Butler 迁移流程

1. Butler 不再自己拼 skill 目录路径和复制目录。
2. Butler 只表达需求：“确保目标 Codex home 有 `codingns-assistant` skill”。
3. `SkillManager` 负责检查 SSOT、检查目标目录、执行同步。
4. Butler 只处理结果，不再关心具体目录复制细节。

#### 2.3.5 前端入口流程

1. 用户从 `/settings/skills` 或设置页里的 Skill 分段进入。
2. 页面先请求 Skill 概况和扫描结果。
3. 页面展示：
   - 受管 skill
   - 未纳管 skill
   - 目标 CLI 状态
   - 最小操作入口
4. 用户触发“导入”“添加”“重新同步”时，前端调用 Host API。
5. 页面只展示环境状态，不混入项目会话上下文。

## 3. 组件和接口

### 3.1 核心组件

覆盖需求：1、2、3、4、5、6

- `SkillManagerService`：本功能的主入口，统一对外提供读取、导入、添加、同步能力
- `SkillRepository`：持久化受管 skill 记录和目标状态
- `SkillTargetAdapter`：按 CLI 拆分目录发现和目标写入逻辑
- `SkillSyncPlanner`：在“新增、导入、重扫、补同步”几种场景里决定要写哪些目标
- `SkillReconciler`：比较实际目录状态和受管记录，输出差异
- `SettingsSkillsPageSection`：复用现有设置页结构，承接最小前端入口

### 3.2 数据结构

覆盖需求：1、2、3、4

#### 3.2.1 `ManagedSkillRecord`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `id` | string | 是 | 受管 skill 主键 | 全局唯一 |
| `name` | string | 是 | skill 显示名 | 非空 |
| `directoryName` | string | 是 | SSOT 与目标目录名 | 仅允许安全目录名 |
| `sourceType` | string | 是 | `builtin/local-import/managed-copy` | 枚举值 |
| `sourcePath` | string | 否 | 导入来源路径 | 本地绝对路径或空 |
| `contentHash` | string | 是 | 目录内容哈希 | 用于冲突和漂移判断 |
| `managedState` | string | 是 | `active/conflicted/missing` | 枚举值 |
| `createdAt` | string | 是 | 创建时间 | ISO 时间 |
| `updatedAt` | string | 是 | 更新时间 | ISO 时间 |

#### 3.2.2 `SkillTargetBinding`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `skillId` | string | 是 | 对应受管 skill | 必须存在 |
| `targetCli` | string | 是 | 目标 CLI 标识 | `codex/claude-code/gemini/opencode` |
| `enabled` | boolean | 是 | 是否应保持同步 | 布尔值 |
| `syncStatus` | string | 是 | `synced/pending/failed/conflicted` | 枚举值 |
| `lastSyncedAt` | string | 否 | 最近同步时间 | ISO 时间或空 |
| `lastErrorCode` | string | 否 | 最近错误码 | 可空 |
| `lastErrorDetail` | string | 否 | 最近错误说明 | 可空 |

#### 3.2.3 `SkillScanEntry`

| 字段 | 类型 | 必填 | 说明 | 约束 |
| --- | --- | --- | --- | --- |
| `targetCli` | string | 是 | 来自哪个 CLI | 枚举值 |
| `directoryPath` | string | 是 | skill 实际目录 | 绝对路径 |
| `directoryName` | string | 是 | 目录名 | 非空 |
| `name` | string | 是 | 从 `SKILL.md` 读取的名称 | 允许回退目录名 |
| `contentHash` | string | 是 | 实际目录内容哈希 | 非空 |
| `managementState` | string | 是 | `managed/unmanaged/conflicted` | 枚举值 |
| `managedSkillId` | string | 否 | 已匹配的受管 skill | 可空 |

### 3.3 接口契约

覆盖需求：1、2、3、4、5、6

#### 3.3.1 `scanSkills()`

- 类型：Function / Host 内部服务
- 路径或标识：`SkillManager.scanSkills`
- 输入：可选 `targetCli[]`
- 输出：`managed`、`unmanaged`、`conflicted`、`diagnostics`
- 校验：目标 CLI 必须在注册表内
- 错误：`SKILL_TARGET_NOT_SUPPORTED`、`SKILL_SCAN_FAILED`

#### 3.3.2 `addManagedSkill()`

- 类型：Function / Host 内部服务
- 路径或标识：`SkillManager.addManagedSkill`
- 输入：`sourcePath`、`targetCli[]`、`sourceType`
- 输出：受管 skill 记录和目标同步结果
- 校验：目录必须存在、必须含 `SKILL.md`、目录名必须安全
- 错误：`SKILL_SOURCE_INVALID`、`SKILL_NAME_CONFLICT`、`SKILL_SYNC_FAILED`

#### 3.3.3 `importUnmanagedSkill()`

- 类型：Function / Host 内部服务
- 路径或标识：`SkillManager.importUnmanagedSkill`
- 输入：扫描结果里的 `targetCli + directoryPath`，可选附加目标列表
- 输出：新建的受管 skill 记录
- 校验：来源目录必须仍然存在且哈希未变化
- 错误：`SKILL_IMPORT_SOURCE_MISSING`、`SKILL_IMPORT_CONFLICT`

#### 3.3.4 `POST /api/skills/import`

- 类型：HTTP
- 路径或标识：`/api/skills/import`
- 输入：来源目录、目标 CLI 列表
- 输出：受管 skill 与同步结果
- 校验：需要登录态，参数必须完整
- 错误：`UNAUTHORIZED`、`INVALID_INPUT`、`SKILL_IMPORT_CONFLICT`

#### 3.3.5 `POST /api/skills/sync`

- 类型：HTTP
- 路径或标识：`/api/skills/sync`
- 输入：`skillId`、目标 CLI 列表
- 输出：每个目标的同步结果
- 校验：skill 必须存在，目标必须受支持
- 错误：`SKILL_NOT_FOUND`、`SKILL_TARGET_NOT_SUPPORTED`、`SKILL_SYNC_FAILED`

#### 3.3.6 `codingns skills add`

- 类型：CLI
- 路径或标识：`codingns skills add`
- 输入：`--source <path>`、`--target <cli>` 可重复
- 输出：新增 skill 结果与目标同步结果
- 校验：参数必须明确，不允许默认写到所有 CLI
- 错误：返回明确错误文本和非零退出码

#### 3.3.7 `GET /api/skills/overview`

- 类型：HTTP
- 路径或标识：`/api/skills/overview`
- 输入：登录态令牌
- 输出：受管 skill 统计、未纳管数量、目标 CLI 诊断、最近扫描时间
- 校验：必须鉴权
- 错误：`UNAUTHORIZED`、`SKILL_SCAN_FAILED`

#### 3.3.8 设置页入口约定

- 类型：前端路由
- 路径或标识：`/settings/skills`
- 输入：用户点击设置页入口
- 输出：Skill 管理分段页面
- 校验：必须复用现有设置页 section 路由，不新增顶级导航
- 错误：页面级错误只显示 Skill 相关加载失败，不影响其他设置分段

## 4. 数据与状态模型

### 4.1 数据关系

- 一个 `ManagedSkillRecord` 对应一个 SSOT 目录
- 一个 `ManagedSkillRecord` 可以绑定多个 `SkillTargetBinding`
- 一个 `SkillScanEntry` 来自某个实际目标目录快照
- `SkillReconciler` 用 `contentHash + directoryName + targetCli` 判断漂移和冲突
- 设置页读取的是聚合后的 skill 概况，不直接碰文件系统目录

### 4.2 状态流转

| 状态 | 含义 | 进入条件 | 退出条件 |
| --- | --- | --- | --- |
| `active` | 受管 skill 正常存在于 SSOT | 新增成功或导入成功 | SSOT 缺失或冲突 |
| `conflicted` | 同名或同目标发生冲突 | 导入或同步发现冲突 | 冲突被人工解决 |
| `missing` | 受管记录存在但 SSOT 丢失 | 重扫时找不到 SSOT 目录 | 补齐 SSOT 或删除记录 |
| `synced` | 目标 CLI 目录与 SSOT 一致 | 同步成功 | 目标漂移、删除或失败 |
| `failed` | 目标同步失败 | 写入失败、权限失败 | 下次同步成功 |
| `pending` | 目标等待同步 | 新增目标后尚未执行同步 | 同步完成或失败 |

## 5. 错误处理

### 5.1 错误类型

- `扫描错误`：目标目录不存在、不可读、目录结构非法
- `导入错误`：来源目录缺失、哈希变化、内容冲突
- `同步错误`：目标目录写入失败、权限不足、同名冲突
- `状态错误`：受管记录缺失、SSOT 丢失、目标 CLI 未受支持

### 5.2 错误响应格式

```json
{
  "detail": "目标 CLI 目录里已存在同名 skill，且内容与受管 skill 不一致",
  "error_code": "SKILL_NAME_CONFLICT",
  "field": "targetCli",
  "timestamp": "2026-04-14T00:00:00Z"
}
```

### 5.3 处理策略

1. 输入验证错误：直接拒绝，不写 SSOT，不写目标目录。
2. 冲突错误：返回明确冲突对象，不自动覆盖。
3. 单目标同步错误：只把该目标标记为 `failed`，不回滚其他已成功目标。
4. SSOT 缺失错误：标记受管记录异常，要求人工修复或删除。

## 6. 正确性属性

### 6.1 属性 1：SSOT 是受管 skill 的唯一权威源

*对于任何* 已进入统一管理的 skill，系统都应该满足：目标 CLI 目录只是副本，判断当前权威内容时只能以 SSOT 为准。

**验证需求：** 需求 2、需求 5

### 6.2 属性 2：单目标操作不能偷偷扩散

*对于任何* “只给某个 CLI 添加 skill”的请求，系统都应该满足：除用户明确指定的目标外，其他 CLI 不会被写入。

**验证需求：** 需求 3

### 6.3 属性 3：同名不同内容不能自动合并

*对于任何* 来自不同目标目录的同名 skill，系统都应该满足：内容哈希不同就必须显式报冲突，不能自动认为它们是同一个 skill。

**验证需求：** 需求 4

### 6.4 属性 4：前端入口不能污染项目主流程

*对于任何* 第一阶段的 Skill 管理页面，系统都应该满足：它必须作为设置页下的环境级入口存在，而不是工作台顶级导航、Butler 首页或会话主流程的一部分。

**验证需求：** 需求 6

## 7. 测试策略

### 7.1 单元测试

- `SkillTargetAdapter` 的目录解析和安全校验
- `SkillManager` 的新增、导入、同步、冲突判断
- `SkillReconciler` 的漂移和差异识别

### 7.2 集成测试

- Host API 的扫描、导入、同步链路
- Butler 调 `SkillManager` 替代旧硬编码逻辑的链路
- CLI `codingns skills ...` 对 Host API 的参数映射
- 设置页入口对 Skill API 的读取和提交流程

### 7.3 端到端测试

- 构造临时的 `codex/claude-code/gemini/opencode` skill 目录，验证扫描、导入、添加、同步
- 验证只写单目标 CLI 时，其他目标目录不变

### 7.4 验证映射

| 需求 | 设计章节 | 验证方式 |
| --- | --- | --- |
| `requirements.md` 需求 1 | `design.md` §2.3.1、§3.3.1 | 单元测试 + 集成扫描测试 |
| `requirements.md` 需求 2 | `design.md` §2.3.2、§4.1、§6.1 | 同步测试 + 状态回写测试 |
| `requirements.md` 需求 3 | `design.md` §2.3.2、§3.3.2、§3.3.6 | CLI / API 新增链路测试 |
| `requirements.md` 需求 4 | `design.md` §2.3.3、§6.3 | 导入与冲突测试 |
| `requirements.md` 需求 5 | `design.md` §2.3.4、§6.1 | Butler 集成测试 |
| `requirements.md` 需求 6 | `design.md` §2.3.5、§3.3.8、§6.4 | 设置页路由与页面集成测试 |

## 8. 风险与待确认项

### 8.1 风险

- 不同 CLI 的默认 skill 目录位置在不同平台上可能不完全一致，需要目标适配器明确定义优先级
- 某些 CLI 目录里可能存在符号链接或历史残留文件，导入时需要更严格的安全检查
- 当前仓库里还没有现成的 skill 元数据表，需要控制新增表结构不要和现有配置存储打架
- 设置页如果一开始做得太重，容易把第一阶段范围又拉回“技能中心”这种垃圾方向

### 8.2 待确认项

- 除 `codingns-assistant` 之外，是否还有项目内置 skill 需要在第一阶段一起纳管
