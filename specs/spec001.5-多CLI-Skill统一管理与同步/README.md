# spec001.5-多CLI-Skill统一管理与同步

## 当前定位

这是 `spec001` 下的新子 Spec。

它只解决一件事：
把项目里现在零散、硬编码、只照顾单个 CLI 的 SKILL 处理方式，收口成一个统一的 `SkillManager`。

这次要定住的不是“再给 Codex 复制一个 skill 目录”，而是下面这些真问题：

- 各个 CLI 自己已有的 skill 目录怎么读
- 哪些 skill 是系统统一管理的，哪些只是本地散落文件
- 同一个 skill 怎么同步到一个或多个 CLI
- 给某个 CLI 新增 skill 时，谁负责写入、谁记录状态、谁处理冲突
- 现有 Butler 里那段只会同步 `codingns-assistant` 的硬编码复制逻辑怎么迁出去

一句人话：
这次做的是“统一的本地 Skill 管理层”，不是“Skill 市场”，也不是“再造一套 provider 系统”。

## 计划覆盖

- `SkillManager` 的统一职责、状态模型和同步边界
- 各 CLI 本地 skill 目录的读取、导入、同步和冲突处理
- 为指定 CLI 新增 skill 的最小入口
- 设置页里的最小前端入口与状态展示
- 系统内置 skill 与用户本地 skill 的统一记录方式
- 现有 Butler / Codex 专用 skill 同步逻辑迁移
- Host API 与 `codingns` CLI 的最小管理入口

## 依赖关系

- 前置依赖：`spec001-平台底座与工作区基础`
- 强相关依赖：
  - `spec010-Provider扩展框架`
  - `spec013.2-助手内部API与代理执行编排`
- 直接影响：
  - `apps/host`
  - `packages/codingns`
  - 后续可能影响 `apps/user-app`

## 本阶段明确不做

- 不做 Skill 市场、远端仓库搜索、排行榜、社区发现
- 不把 skill 管理塞进 provider runtime
- 不新增一套和各 CLI 脱节的私有 skill 格式
- 不做在线编辑器或可视化 Skill 编写器
- 不做工作台顶级导航入口
- 不把 Skill 管理塞进 Butler 首页或会话页主流程
- 不要求第一阶段就补完整设置页，只做最小入口

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
