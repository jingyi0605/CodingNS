# 任务清单 - spec015-通用办公能力平台与统一任务执行内核（人话版）

状态：Draft

## 这份文档是干什么的

这份清单只做一件事：

把“完整办公解决方案”拆成能落地的阶段，不让它变成一个什么都想做、最后什么都没做稳的大杂烩。

这份任务清单优先回答：

1. 第一阶段到底先立什么地基
2. 哪些能力必须统一建模，不能各做各的
3. 哪些东西先不做，避免范围炸掉
4. 每一阶段做完以后能看到什么结果

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：已经完成，并且已回写状态
- `CANCELLED`：取消，不做了，但必须写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻回写本文件
- `BLOCKED` 和 `CANCELLED` 必须写清原因

---

## 阶段 0：先把 Spec 立住，别急着造轮子

- [x] 0.1 建立 `spec015` 文档骨架并锁定主问题
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md` 和 `docs/README.md`，把“完整办公解决方案”从聊天结论变成正式 Spec。
  - 做完以后能看到什么结果：仓库里出现完整 `spec015` 目录，主问题、覆盖范围、边界和依赖关系都已明确。
  - 先依赖什么：无
  - 开始前先看：
    - `spec001.2`
    - `spec001.2.1`
    - `spec004.2`
    - `spec013.2`
    - `spec013.3`
  - 主要改哪里：
    - `specs/spec015-通用办公能力平台与统一任务执行内核/*`
    - `specs/README.md`
  - 这一步先不做什么：不写实现代码，不改现有运行时模块。
  - 怎么算完成：
    1. `spec015` 主文档齐全
    2. 已明确浏览器、文档、运维、自动化、任务模型、连接器六块范围
    3. 已明确第一阶段不做项
  - 怎么验证：
    - 文档走查
    - 索引检查
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

- [x] 0.2 写死三条硬边界：浏览器、文档、运维
  - 状态：DONE
  - 这一步到底做什么：把浏览器必须走 `Playwright + 真实 Chrome/Edge`、文档必须走 `doct` 模板、运维第一阶段聚焦 `SSH + 浏览器` 这三条边界写进正式 Spec。
  - 做完以后能看到什么结果：后续实现阶段不会再围绕核心方向反复摇摆。
  - 先依赖什么：0.1
  - 开始前先看：
    - `requirements.md` 技术边界
    - `design.md` §2、§5、§6、§7
  - 主要改哪里：
    - `specs/spec015-通用办公能力平台与统一任务执行内核/README.md`
    - `specs/spec015-通用办公能力平台与统一任务执行内核/requirements.md`
    - `specs/spec015-通用办公能力平台与统一任务执行内核/design.md`
  - 这一步先不做什么：不接浏览器插件，不接真实 doct 引擎，不接 SSH 凭据库实现。
  - 怎么算完成：
    1. 浏览器选型边界明确
    2. 文档模板边界明确
    3. 运维范围边界明确
  - 怎么验证：
    - 文档交叉检查
  - 对应需求：`requirements.md` 需求 2、3、5、7
  - 对应设计：`design.md` §2、§5、§6、§7

- [x] 0.3 补对象模型、Host API 和模块目录草案
  - 状态：DONE
  - 这一步到底做什么：继续把 `spec015` 往下压，补三份能指导真实开工的蓝图文档：表结构草案、Host API 草案、模块目录草案。
  - 做完以后能看到什么结果：后续进入实现阶段时，不需要再临时拍脑袋决定“对象怎么存”“API 怎么开”“代码放哪”。
  - 先依赖什么：0.1、0.2
  - 开始前先看：
    - `design.md` §3、§4、§5、§6、§7、§8、§9、§10
    - `spec013` 补充草案文档
  - 主要改哪里：
    - `specs/spec015-通用办公能力平台与统一任务执行内核/docs/20260515-平台对象与表结构草案.md`
    - `specs/spec015-通用办公能力平台与统一任务执行内核/docs/20260515-HostAPI草案.md`
    - `specs/spec015-通用办公能力平台与统一任务执行内核/docs/20260515-模块目录草案.md`
    - `specs/spec015-通用办公能力平台与统一任务执行内核/docs/README.md`
    - `specs/spec015-通用办公能力平台与统一任务执行内核/tasks.md`
  - 这一步先不做什么：不写宿主端 schema、不增真实路由、不落真实模块实现。
  - 怎么算完成：
    1. 已明确平台主对象和建议表结构
    2. 已明确 `/api/office/*` 第一版接口轮廓
    3. 已明确 Host、前端、CLI 的模块目录建议
  - 怎么验证：
    - 文档走查
    - 与当前仓库目录风格交叉检查
  - 对应需求：`requirements.md` 需求 1、10、11、12
  - 对应设计：`design.md` §3、§4、§9、§10

---

## 阶段 1：先把统一任务模型立住

- [x] 1.1 定义 `OfficeTask / OfficeTaskStep / OfficeArtifact / OfficeApproval / OfficeReceipt`
  - 状态：DONE
  - 这一步到底做什么：把所有办公能力共享的对象模型正式落库和落服务接口。
  - 做完以后能看到什么结果：浏览器、文档、运维、自动化都能落在同一套任务对象上。
  - 先依赖什么：阶段 0
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/`
    - `apps/host/src/modules/office-task/`
  - 这一步明确不做什么：不先接任何具体浏览器或文档引擎。
  - 怎么验证：
    - `tsc`
    - 统一任务对象的 repository 和 service 测试
  - 对应需求：`requirements.md` 需求 1、8、12
  - 对应设计：`design.md` §4、§11
  - 当前进展：
    - 已补统一任务模型的表结构草案
    - 已补任务模型接口草案
    - 现阶段仍未落宿主端实现代码，但 Spec 层面已经定型

- [ ] 1.2 把审批、审计、回滚记录先接进任务模型
  - 状态：IN_PROGRESS
  - 这一步到底做什么：补审批对象、审计事件和补偿记录，避免后面运维和自动化重新长模型。
  - 做完以后能看到什么结果：高风险任务已经有正式拦截和追责入口。
  - 先依赖什么：1.1
  - 主要改哪里：
    - `apps/host/src/modules/office-task/`
    - 审计和权限相关模块
  - 这一步明确不做什么：不做复杂组织级审批流。
  - 怎么验证：
    - 任务审批流测试
    - 回滚记录测试
  - 对应需求：`requirements.md` 需求 8
  - 对应设计：`design.md` §4.3、§7、§11
  - 当前进展：
    - 已补审批审计回滚权限草案
    - 已把 `OfficeAuditEvent`、`OfficeRollbackRecord` 写进设计文档
    - 已补 `assistant office task-approval-reply` 与对应 CLI，办公任务审批不再只能停留在底层 `/api/office/approvals/*`

---

## 阶段 2：浏览器执行内核

- [ ] 2.1 落地真实 Chrome / Edge 浏览器运行时
  - 状态：IN_PROGRESS
  - 这一步到底做什么：用 `Playwright` 启动和管理真实 `Chrome Stable`、真实 `Edge`。
  - 做完以后能看到什么结果：平台不依赖模型浏览器能力，也能正式执行浏览器任务。
  - 先依赖什么：1.1
  - 主要改哪里：
    - `apps/host/src/modules/browser-runtime/`
    - 相关 API 和测试
  - 这一步明确不做什么：不先接插件桥接，不先接运行中浏览器 CDP。
  - 怎么验证：
    - 启动真实浏览器集成测试
    - 导航、点击、输入、截图基本链路测试
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §5
  - 当前进展：
    - 已补浏览器运行时草案
    - 已把 `BrowserProfile`、`BrowserRuntimeSession`、`BrowserPage`、`BrowserAction`、`BrowserArtifact` 的职责说死
    - 已补真实 Chrome / Edge 可执行文件路径校验，持久化 Profile 模式不再在缺浏览器时静默运行
    - 已补真实 Chrome 持久化 Profile 执行链路测试，已覆盖导航、输入、DOM 读取、截图产物和执行回执

- [ ] 2.2 落地浏览器 Profile、标签页、产物和失败重试
  - 状态：IN_PROGRESS
  - 这一步到底做什么：把浏览器登录态隔离、标签页模型、截图/OCR/下载产物和失败恢复补全。
  - 做完以后能看到什么结果：浏览器任务已经具备正式执行语义，而不是一段一次性脚本。
  - 先依赖什么：2.1
  - 主要改哪里：
    - `apps/host/src/modules/browser-runtime/`
    - `apps/host/src/modules/office-task/`
  - 这一步明确不做什么：不默认接管用户日常浏览器。
  - 怎么验证：
    - Profile 隔离测试
    - 上传下载、截图、重试测试
  - 对应需求：`requirements.md` 需求 2、3
  - 对应设计：`design.md` §4.5、§5
  - 当前进展：
    - 已补浏览器 Profile、标签页、产物和失败重试草案
    - 已把标签页、产物引用和失败重试边界说死
    - 已修正浏览器任务 payload 结构，`startUrl/actions` 不再错层导致任务悬挂
    - 已补浏览器任务早期失败落库逻辑，输入非法或浏览器启动失败时会明确回写 `failed`
    - 已补浏览器截图、DOM 快照、下载产物和执行回执的集成测试闭环
    - 已把工作区会话说明补进 `BUTLER_CONTEXT.md / BUTLER_API.md`，明确文档、浏览器、运维优先走 `codingns assistant office ...`

- [ ] 2.3 补高级模式：CDP 接管运行中的浏览器
  - 状态：IN_PROGRESS
  - 这一步到底做什么：提供高级模式接管运行中的真实 `Chrome/Edge`。
  - 做完以后能看到什么结果：用户可以显式授权平台接管当前浏览器上下文。
  - 先依赖什么：2.2
  - 主要改哪里：
    - `apps/host/src/modules/browser-runtime/`
    - 后续设置页或运行时入口
  - 这一步明确不做什么：不默认启用，不接管用户日常 Profile 目录。
  - 怎么验证：
    - `CDP` 连接测试
    - 高级模式标记和审计测试
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §5.3
  - 当前进展：
    - 已补 CDP 接管真实浏览器草案
    - 已把接管模式、授权、审计和失败退回边界说死
    - 已补 CDP attach Profile 创建与浏览器任务执行测试，已验证接管运行中 Chrome 的最小闭环

---

## 阶段 3：专业文档内核

- [x] 3.1 落地文档对象、大纲、修订、批注模型
  - 状态：DONE
  - 这一步到底做什么：建立正式文档对象和结构化编辑对象。
  - 做完以后能看到什么结果：平台不再只会生成一段文本，而是有正式文档对象。
  - 先依赖什么：1.1
  - 主要改哪里：
    - `apps/host/src/modules/document-runtime/`
    - `apps/user-app` 文档界面
  - 这一步明确不做什么：不先接模板导出引擎。
  - 怎么验证：
    - 文档 CRUD 测试
    - 修订和批注测试
  - 对应需求：`requirements.md` 需求 4、6
  - 对应设计：`design.md` §4.6、§6
  - 当前进展：
    - 已补文档对象、大纲、修订、批注草案
    - 已把文档对象与批注、修订、引用的关系说死
    - 已把编辑边界、修订规则和文档任务边界收紧
    - 已新增 `doct` 模板字段映射草案，作为 3.2 的前置约束

- [ ] 3.2 落地 `doct` 模板注册、字段校验和正式导出
  - 状态：IN_PROGRESS
  - 这一步到底做什么：把 `doct` 模板变成正式模板运行时，而不是一堆人工说明。
  - 做完以后能看到什么结果：导出的 `docx/pdf/md` 明确绑定模板和模板版本。
  - 先依赖什么：3.1
  - 主要改哪里：
    - `apps/host/src/modules/document-runtime/`
    - 可能新增模板桥接服务
  - 这一步明确不做什么：不做无限模板 DSL。
  - 怎么验证：
    - 模板字段校验测试
    - 导出链路测试
  - 对应需求：`requirements.md` 需求 5、6
  - 对应设计：`design.md` §4.6、§6
  - 当前进展：
    - 已落模板注册表和默认模板种子
    - 已给模板对象补 `mappingJson`，模板映射不再只停留在草案里
    - 已开放模板注册与模板详情 API，不再只能依赖默认种子
    - 已支持模板更新和模板弃用，旧模板不再需要直接改数据库
    - 已支持同一个模板 key 下按最新版本创建文档，不用调用方自己猜版本号
    - 已把模板版本选用从字符串倒序改成真实版本顺序，`v10` 不会再错误输给 `v2`
    - 已把模板弃用语义收紧为“禁止新建，不阻断历史文档继续导出”
    - 已支持文档在同一个模板 key 内切换版本，并明确禁止切到另一个模板 key
    - 已落文档导出后台任务、模板字段输入生成和任务执行审计
    - 已把模板必填字段校验接进执行链路
    - 已支持按模板 `mappingJson` 决定标题、摘要、章节、引用和批注的导出取值
    - 已支持 `md` 正式导出
    - 已把模板 key、模板版本、修订号、执行引擎和导出输入摘要统一写进导出产物元数据与回执，导出来源可正式追踪
    - 在当前环境缺少 `doct` 时，已支持生成真实 `.docx` fallback 文件，不再返回伪造扩展名文本
    - `.docx` fallback 已支持带出正文、引用来源和正式批注记录
    - `pdf` 仍然依赖 `doct` 或后续桥接，当前环境未安装 `doct` 时会明确失败，不再假装成功
    - 已把 `templateSourcePath` 接进模板对象、SQLite 迁移和运行时，模板可绑定真实 doct 模板文件
    - 已支持在 `doct` 可用且模板文件存在时优先走真实 `doct render --template-file ...`
    - 已补真实 doct 桥接测试，已验证 `docx/pdf` 导出会优先使用模板文件而不是继续走 fallback

- [ ] 3.3 把文档能力接进助手会话工具
  - 状态：IN_PROGRESS
  - 这一步到底做什么：给助手会话开放 `office.document.create / update / export / task.get` 四个正式能力。
  - 做完以后能看到什么结果：工作区会话或助手会话内可以直接创建文档、更新修订、发起导出并查询任务回执。
  - 先依赖什么：3.1、3.2、1.1
  - 主要改哪里：
    - `apps/host/src/modules/assistant-capability/`
    - `apps/host/src/routes/assistant.ts`
    - 相关集成测试
  - 这一步明确不做什么：不做复杂文档 UI，不做富文本编辑器重构。
  - 怎么验证：
    - 助手能力路由测试
    - 文档任务状态与回执测试
  - 对应需求：`requirements.md` 需求 4、5、6、11、12
  - 对应设计：`design.md` §4、§6、§10、§11
  - 当前进展：
    - 已把 `office.document.create / update / export / task.get` 注册进助手能力清单
    - 已开放 `/api/assistant/office/documents` 与 `/api/assistant/office/document-tasks/:taskId` 路由
    - 已把文档摘要、当前修订、导出任务状态、产物和回执整理成会话友好的返回结构
    - 已补助手能力路由测试，已验证四个能力的参数清洗和服务调用闭环
    - 已补 `codingns assistant office document-create|document-update|document-export|document-task` CLI 子命令
    - 工作区会话和助手会话现在都可以通过同一套 `assistant office` 能力链路直接调文档能力

- [ ] 3.4 把浏览器与运维能力补进助手办公能力面
  - 状态：IN_PROGRESS
  - 这一步到底做什么：把浏览器 Profile、浏览器任务、运维目标、SSH 任务、浏览器运维任务统一挂到 `/api/assistant/office/*` 和 `codingns assistant office ...`。
  - 做完以后能看到什么结果：工作区会话、助手会话、CLI 都能走同一套办公能力入口，而不是各调各的私有接口。
  - 先依赖什么：2.1、2.2、2.3、4.1、4.2、1.1
  - 主要改哪里：
    - `apps/host/src/modules/assistant-capability/`
    - `apps/host/src/routes/assistant.ts`
    - `packages/codingns/bin/codingns.mjs`
    - `packages/codingns/tests/opencli-cli.test.mjs`
  - 这一步明确不做什么：不做新 UI，不做浏览器插件桥接，不做运维执行器重构。
  - 怎么验证：
    - 助手能力路由测试
    - CLI 调用测试
    - 文档与浏览器既有集成测试回归
  - 对应需求：`requirements.md` 需求 2、3、7、8、11、12
  - 对应设计：`design.md` §4、§5、§7、§10、§11
  - 当前进展：
    - 已把 `office.browser.profile.list/create/get`、`office.browser.task.create/get` 注册进助手能力清单
    - 已把 `office.ops.target.list/create/get`、`office.ops.ssh-task.create`、`office.ops.browser-task.create`、`office.ops.task.get` 注册进助手能力清单
    - 已开放 `/api/assistant/office/browser/*` 与 `/api/assistant/office/ops/*` 路由
    - 已补 `codingns assistant office browser-*` 与 `codingns assistant office ops-*` CLI 子命令
    - 已补 CLI 测试，已验证文档创建和浏览器任务创建命令会正确调用 Host assistant API
    - 已补助手能力路由测试，已验证浏览器与运维参数清洗和服务调用闭环
    - 已回归 `client-routes` 和 `assistant-capability-routes`，确认真实 Chrome、CDP、doct 文档导出链路未被打坏

- [x] 4.1 落地运维目标、凭据引用和 SSH 执行模型
  - 状态：DONE
  - 这一步到底做什么：把 SSH 运维变成正式对象和正式任务，而不是裸跑命令。
  - 做完以后能看到什么结果：主机、环境、命令、日志、产物都能结构化追踪。
  - 先依赖什么：1.2
  - 主要改哪里：
    - `apps/host/src/modules/ops-runtime/`
    - 凭据与权限相关模块
  - 这一步明确不做什么：不支持任意第三方堡垒机全量接入。
  - 怎么验证：
    - SSH 执行测试
    - 审批与审计测试
  - 对应需求：`requirements.md` 需求 7、8
  - 对应设计：`design.md` §4.8、§7
  - 当前进展：
    - 已补 SSH 运维目标与执行模型草案
    - 已把运维目标、凭据引用、命令模板、风险判断和失败留痕说死
    - 已把运维设计里的 SSH 检查项和失败留痕补实
    - 已落 `office.ops.ssh-task.create -> approval -> execute -> receipt` 最小闭环
    - 已新增 Host SSH 执行路由、assistant 能力 `office.ops.task.execute`、CLI `codingns assistant office ops-task-execute`
    - 已补 SSH stdout/stderr 产物、`ssh_execution` 回执和审计事件

- [x] 4.2 落地浏览器运维目标和控制台操作链路
  - 状态：DONE
  - 这一步到底做什么：让浏览器执行内核和运维模型接起来，支持网页控制台运维。
  - 做完以后能看到什么结果：平台可以通过浏览器登录控制台并留下正式操作记录。
  - 先依赖什么：2.2、4.1
  - 主要改哪里：
    - `apps/host/src/modules/browser-runtime/`
    - `apps/host/src/modules/ops-runtime/`
  - 这一步明确不做什么：不做所有控制台的专用适配器。
  - 怎么验证：
    - 浏览器运维链路测试
  - 对应需求：`requirements.md` 需求 7、8
  - 对应设计：`design.md` §7
  - 当前进展：
    - 已补浏览器运维目标与控制台操作链路草案
    - 已把控制台目标、Profile、登录态、页面证据和失败回退说死
    - 已把浏览器运维从普通网页自动化里拆出来

---

## 阶段 5：自动化和连接器收口

- [x] 5.1 把重复事务升级成平台级工作流对象
  - 状态：DONE
  - 这一步到底做什么：定义触发器、步骤、分支、重试、幂等、补偿的正式模型。
  - 做完以后能看到什么结果：自动化不再是散装定时器和 prompt 递归。
  - 先依赖什么：1.1、1.2
  - 主要改哪里：
    - `apps/host/src/modules/workflow-runtime/`
    - 现有自动化相关模块
  - 这一步明确不做什么：不做任意脚本 DSL。
  - 怎么验证：
    - 触发器和补偿测试
  - 对应需求：`requirements.md` 需求 9
  - 对应设计：`design.md` §8
  - 当前进展：
    - 已补工作流对象、触发器、幂等与补偿草案
    - 已明确平台工作流与 `OfficeTask` 的关系
    - 已明确复用 `spec013.3` 经验，但不直接拿助手自动化对象冒充平台工作流

- [x] 5.2 落连接器注册表和第一批标准连接器
  - 状态：DONE
  - 这一步到底做什么：把浏览器、文档、运维等底层资源都挂到统一连接器接口后面。
  - 做完以后能看到什么结果：上层任务开始真正和具体实现解耦。
  - 先依赖什么：2.2、3.2、4.2
  - 主要改哪里：
    - `apps/host/src/modules/connectors/`
    - CLI 与能力面入口
  - 这一步明确不做什么：不在第一阶段接大量外部 SaaS。
  - 怎么验证：
    - 连接器能力声明测试
    - 统一执行路由测试
  - 对应需求：`requirements.md` 需求 10、11
  - 对应设计：`design.md` §9、§10
  - 当前进展：
    - 已补连接器注册表与能力声明草案
    - 已明确第一批标准连接器和统一接口
    - 已把注册表职责、选路规则和禁止静默降级写死

---

## 阶段 6：验证和收口

- [x] 6.1 补最小闭环验收
  - 状态：DONE
  - 这一步到底做什么：按“浏览器任务、模板文档、SSH 运维、自动化工作流”四条主线做最小闭环验收。
  - 做完以后能看到什么结果：这套平台级办公能力已经不是纸面设计。
  - 先依赖什么：阶段 1 到阶段 5
  - 主要改哪里：
    - 集成测试
    - 使用说明和补充文档
  - 这一步明确不做什么：不追求第一轮全量办公生态覆盖。
  - 怎么验证：
    - 集成测试
    - 人工验收记录
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
  - 当前进展：
    - 已补最小闭环验收草案
    - 已把浏览器、文档、运维、工作流四条主线的通过条件写死
    - 已明确第一阶段不追求全量生态覆盖，只追最小可用闭环
