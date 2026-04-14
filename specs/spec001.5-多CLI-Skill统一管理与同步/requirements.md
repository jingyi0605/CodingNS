# 需求文档 - spec001.5-多CLI-Skill统一管理与同步

状态：Draft

## 简介

当前仓库里已经出现了 Skill 的真实使用场景，但管理方式还是临时拼出来的。

最明显的问题有两个：

1. 现有逻辑只会把 `codingns-assistant` 从一个 Codex home 复制到另一个 Codex home，没有统一模型，也没有状态记录。
2. 后面如果再把 Claude、Gemini、OpenCode 一起接进来，很容易变成“每个 CLI 各写一套目录扫描和复制逻辑”。

这不是功能不够多的问题，这是结构已经开始发散的问题。

这次 Spec 的目标很明确：

- 不做 Skill 市场
- 不接远端仓库
- 不发明新格式
- 只做一层统一的 `SkillManager`

这层统一管理只负责三件事：

1. 读取各个 CLI 本地已经存在的 skill
2. 把统一管理的 skill 同步到指定 CLI
3. 支持为指定 CLI 新增新的 skill，并把状态记下来

## 术语表

- **System**：本项目的 Host、CLI 和相关管理逻辑
- **Skill**：一个以 `SKILL.md` 为入口的本地 skill 目录
- **SkillManager**：统一读取、记录、同步和写入 skill 的管理服务
- **Skill Source**：skill 的来源，第一阶段只允许 `builtin`、`local-import`、`managed-copy`
- **Target CLI**：skill 的目标 CLI 环境，例如 `codex`、`claude-code`、`gemini`、`opencode`
- **SSOT**：单一事实源目录。统一管理的 skill 先落在这里，再同步到目标 CLI
- **Unmanaged Skill**：已经存在于某个 CLI 目录下，但还没有进入 `SkillManager` 记录的 skill

## 范围说明

### In Scope

- 识别并读取各个 CLI 本地 skill 目录中的 skill
- 记录统一管理的 skill 元数据、启用目标和来源信息
- 把 skill 同步到一个或多个目标 CLI
- 为指定 CLI 添加新的 skill
- 导入当前本地已有但未纳管的 skill
- 在现有设置页里提供最小前端入口
- 迁移现有 Butler 里硬编码的 `codingns-assistant` skill 同步逻辑

### Out of Scope

- 任何形式的 Skill 市场、远端仓库搜索和在线安装
- 浏览器里直接编写和编辑 skill
- 重新定义各 CLI 的 skill 文件格式
- 工作台顶级导航入口或 Butler 主页面入口
- 把 skill 管理和 provider 会话管理揉成同一个模块

## 需求

### 需求 1：统一读取本地 Skill 现状

**用户故事：** 作为维护者，我希望系统能统一读取各个 CLI 本地已有的 skill 状态，以便我先看清当前机器上到底有什么，而不是靠猜目录。

#### 验收标准

1. WHEN `SkillManager` 扫描受支持的 CLI 目录 THEN System SHALL 识别所有包含 `SKILL.md` 的 skill 目录并返回结构化结果。
2. WHEN 同一个 skill 同时存在于多个 CLI 目录 THEN System SHALL 明确返回它出现在哪些 CLI，而不是把结果打散。
3. WHEN 某个 CLI 目录不存在、不可读或为空 THEN System SHALL 返回可区分的诊断信息，而不是直接把整个扫描流程做失败。

### 需求 2：统一记录并同步受管 Skill

**用户故事：** 作为维护者，我希望统一管理的 skill 先落到单一来源，再按目标 CLI 同步，以便状态、冲突和后续更新都有一个权威边界。

#### 验收标准

1. WHEN 新 skill 被纳入统一管理 THEN System SHALL 先把它写入 SSOT，再根据目标列表同步到对应 CLI 目录。
2. WHEN 同一个受管 skill 被启用到多个目标 CLI THEN System SHALL 保证各目标目录里的内容来自同一个 SSOT 副本。
3. WHEN 目标目录已存在同名但来源不同的 skill THEN System SHALL 拒绝直接覆盖，并返回明确的冲突信息。

### 需求 3：支持为指定 CLI 新增 Skill

**用户故事：** 作为维护者，我希望可以为某个 CLI 单独添加新的 skill，以便不用手工进目录复制，也不用顺手破坏其他 CLI 的状态。

#### 验收标准

1. WHEN 用户通过 Host API 或 `codingns` CLI 提交“为指定 CLI 添加 skill”请求 THEN System SHALL 支持把本地 skill 目录纳入管理并同步到目标 CLI。
2. WHEN 用户只指定一个目标 CLI THEN System SHALL 只写入该目标，不得默认扩散到所有 CLI。
3. WHEN 输入目录不合法、缺少 `SKILL.md` 或存在路径穿越风险 THEN System SHALL 直接拒绝并返回明确错误。

### 需求 4：支持导入和纳管本地已有 Skill

**用户故事：** 作为维护者，我希望系统能把各 CLI 目录里已经存在但尚未纳管的 skill 导入统一管理，以便后续同步和状态判断都有依据。

#### 验收标准

1. WHEN 系统发现 `Unmanaged Skill` THEN System SHALL 支持把它导入 SSOT，并生成统一管理记录。
2. WHEN 同名 skill 在多个 CLI 中内容一致 THEN System SHALL 允许一次导入后绑定多个来源目标。
3. WHEN 同名 skill 在多个 CLI 中内容不一致 THEN System SHALL 不得自动合并，而是返回冲突并要求用户明确选择来源。

### 需求 5：替换现有零散硬编码逻辑

**用户故事：** 作为维护者，我希望现有 Butler 和后续模块都通过统一 `SkillManager` 处理 skill，同步逻辑不要继续散在业务代码里，以便后面新增 CLI 时不再复制垃圾代码。

#### 验收标准

1. WHEN Butler 需要同步 `codingns-assistant` skill THEN System SHALL 通过统一 `SkillManager` 完成，而不是继续直接复制目录。
2. WHEN 后续模块需要读取或写入 skill THEN System SHALL 通过统一接口调用，不得继续在业务模块内直接拼装 skill 路径和复制逻辑。
3. WHEN 新增目标 CLI THEN System SHALL 只要求新增目标适配器，不得要求修改现有业务模块的主流程判断。

### 需求 6：前端入口保持环境级，而不是项目级

**用户故事：** 作为普通用户，我希望在一个稳定、容易找到的位置查看和管理本机 skill 状态，以便知道这台设备上的 CLI 环境到底有没有配好。

#### 验收标准

1. WHEN 第一阶段前端开放 Skill 管理入口 THEN System SHALL 把入口放在现有设置页体系下，而不是新增工作台顶级导航入口。
2. WHEN 用户打开 Skill 管理入口 THEN System SHALL 至少能看到受管 skill、未纳管 skill、目标 CLI 状态和最小操作入口。
3. WHEN 用户处于 Butler 或项目会话页面 THEN System SHALL 不把 Skill 管理主页面塞进 Butler 首页或会话主流程；最多只允许跳转提示。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN 某个目标 CLI 同步失败 THEN System SHALL 隔离失败范围，只标记该目标失败，不得让其他已成功目标回退成未知状态。
2. WHEN 系统重启后重新扫描 THEN System SHALL 能根据 SSOT 和目标目录重新还原受管 skill 状态。

### 非功能需求 2：可维护性

1. WHEN 新增一个受支持的 CLI THEN System SHALL 通过新增 `SkillTargetAdapter` 完成接入，而不是在多个业务模块内加 `if provider === ...` 分支。
2. WHEN 排查 skill 问题 THEN System SHALL 能区分“扫描失败”“导入失败”“同步失败”“冲突拒绝”这几类错误。
3. WHEN 前端继续扩展 Skill 页面 THEN System SHALL 复用现有设置页路由和分段结构，而不是另起一套页面骨架。

### 非功能需求 3：安全性

1. WHEN 系统处理本地目录导入 THEN System SHALL 拒绝路径穿越、符号链接越界和缺少 `SKILL.md` 的目录。
2. WHEN 系统向目标 CLI 写入 skill THEN System SHALL 只写入目标 skill 目录，不得越界改动 CLI 其他配置文件。

## 成功定义

- 系统内不再保留面向单个 CLI 的 skill 复制硬编码主流程
- 维护者可以通过统一入口看到本机已有 skill、导入 skill、同步 skill、为指定 CLI 添加 skill
- 普通用户可以从设置页进入 Skill 管理，不需要记 CLI 命令或翻 Butler 页面
- 后续新增 CLI skill 支持时，主要工作集中在目标适配器，而不是散落修改业务模块
