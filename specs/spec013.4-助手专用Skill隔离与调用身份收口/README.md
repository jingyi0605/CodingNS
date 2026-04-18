# spec013.4-助手专用Skill隔离与调用身份收口

## 当前定位

`spec001.5` 已经把本地 Skill 管理收口成统一 `SkillManager`，`spec013.2` 也已经把 Butler 助手能力面和 `codingns assistant ...` 命令补出来了。

但现在有个很实际、也很蠢的问题：

- `codingns-assistant` 本来是给 Butler 助手运行时用的约束型 Skill
- 现在却被当成普通内置 Skill，同步进了公共 `~/.codex/skills`、`~/.claude/skills`
- 结果就是普通项目工作区会话也能扫到它，行为被带偏
- 更糟的是，助手能力路由主要还是靠 prompt 约束，没有把“谁能调”这个身份边界收死

一句人话：

这一步要把 `codingns-assistant` 从“公共 Skill”改回“助手专用运行时资产”，同时把助手能力调用补上真正的调用者身份边界。

## 计划覆盖

- 把 `codingns-assistant` 从公共 Skill 分发链里拆出来
- 定义“助手专用运行时资产”和“公共 Skill”的边界
- 保留 Butler 专用 home 的 Skill 注入能力，但不再向普通 CLI home 公共同步
- 给 `codingns assistant ...` 和 `/api/assistant/*` 补调用者身份收口
- 为 `codingns-assistant` 这类助手专用目录名加保留规则和迁移清理策略
- 明确旧残留目录怎么清理、怎么诊断、怎么避免再次长回来

## 依赖关系

- 前置依赖：
  - `spec001.5-多CLI-Skill统一管理与同步`
  - `spec013.1-代码助手控制面对话与聚合上下文`
  - `spec013.2-助手内部API与代理执行编排`
- 强相关依赖：
  - `spec013.3-助手自动化调度与临时沙箱工作区`
- 直接影响：
  - `apps/host`
  - `packages/codingns`
  - 必要时补充 `apps/user-app` 的最小诊断展示

## 本阶段明确不做

- 不重做整个 Skill 管理页面
- 不把所有本地 Skill 都改成复杂权限系统
- 不重写整套 Host 鉴权模型
- 不靠“再写一层更狠的 prompt”冒充权限控制
- 不开放普通项目会话直接拿助手专用能力去改正式工作区

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
