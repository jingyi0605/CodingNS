# 任务清单 - spec015.2-插件管理能力与静态HTML插件运行时（人话版）

状态：Draft

## 这份文档是干什么的

这份清单只做一件事：

把“`CodingNS` 增加正式插件管理能力与静态 HTML 插件运行时”拆成能落地的任务，不让它最后变成“到处加桥、到处放权限、到处长私有脚本入口”的事故现场。

这份任务清单优先回答：

1. 插件系统先改哪些对象
2. 哪些能力在 Host，哪些能力在 Desktop，哪些能力在前端
3. 怎样保证静态 HTML 插件能跑，但普通 HTML 预览不被污染
4. 怎样保证插件不能跨工作区访问文件
5. 怎样证明这次接入没有破坏现有主链路

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

## 阶段 0：先把规格说死，别直接开改

- [x] 0.1 建立 `spec015.2` 暂存文档骨架并锁定主问题
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`，把这次插件需求从聊天结论变成正式暂存规格。
  - 做完以后能看到什么结果：`SynologyDrive` 下出现完整 `spec015.2` 目录，范围、边界、依赖和落地顺序都已明确。
  - 先依赖什么：`spec015`、`spec015.1`
  - 主要改哪里：
    - `spec015.2-插件管理能力与静态HTML插件运行时/*`
  - 这一步明确不做什么：不改 `CodingNS` 实现代码，不改正式 `specs/` 目录。
  - 怎么验证：
    1. 目录结构完整
    2. 已明确 Host 主导、Desktop 收口
    3. 已明确静态 HTML 插件与普通 HTML 预览分离
    4. 已明确“只能访问当前工作区”的边界
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 阶段 1：先把插件对象模型和注册表做出来

- [x] 1.1 定义插件清单结构与清单校验器
  - 状态：DONE
  - 这一步到底做什么：定义 `plugin.json` 结构，校验前端入口、后端动作、权限与调度声明。
  - 做完以后能看到什么结果：插件注册不再靠猜目录结构。
  - 先依赖什么：阶段 0
  - 主要改哪里：
    - `apps/host/src/modules/plugins/plugin-manifest.ts`
    - 相关 schema / validator
  - 这一步明确不做什么：不接入前端容器，不执行脚本。
  - 怎么验证：
    1. 合法 manifest 可通过校验
    2. 缺字段、越界路径、非法动作可明确报错
    3. 已补 `apps/host/tests/plugins/plugin-manifest.test.ts`
  - 对应需求：`requirements.md` 需求 1、8
  - 对应设计：`design.md` §4.1、§5.1

- [x] 1.2 建立插件注册表与启用状态存储
  - 状态：DONE
  - 这一步到底做什么：新增插件注册表、启用状态表和基本查询接口。
  - 做完以后能看到什么结果：系统能正式记录“有哪些插件、哪些启用、哪些禁用”。
  - 先依赖什么：1.1
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/modules/plugins/plugin-registry-service.ts`
  - 这一步明确不做什么：不做插件运行时。
  - 怎么验证：
    1. 注册插件可落库
    2. 启用状态可读写
    3. 注册失败可落审计
    4. 已补 `apps/host/tests/plugins/plugin-registry-service.test.ts`
  - 对应需求：`requirements.md` 需求 1、2、12
  - 对应设计：`design.md` §4.2、§4.3、§4.7

- [x] 1.3 提供统一插件管理 API / CLI 基础入口
  - 状态：DONE
  - 这一步到底做什么：先把 `list/get/enable/disable` 做成固定网关入口。
  - 做完以后能看到什么结果：插件状态切换不再靠手改数据库或脚本。
  - 先依赖什么：1.2
  - 主要改哪里：
    - `apps/host/src/routes/plugins.ts`
    - `apps/host/src/server/create-server.ts`
    - `packages/codingns`
  - 这一步明确不做什么：不执行插件动作。
  - 怎么验证：
    1. API 可列出插件
    2. CLI 可启用/禁用插件
    3. 禁用状态对后续访问有统一影响
    4. 已补 `apps/host/tests/plugins/plugins-routes.test.ts`
    5. 已补 `packages/codingns/tests/plugins-cli.test.mjs`
  - 对应需求：`requirements.md` 需求 2、5、12
  - 对应设计：`design.md` §6

---

## 阶段 2：把静态 HTML 插件前端跑进正式容器

- [x] 2.1 建立插件静态资源托管链路
  - 状态：DONE
  - 这一步到底做什么：为插件前端提供独立资源托管，不复用普通 HTML 文件预览链路。
  - 做完以后能看到什么结果：插件前端有正式 URL 与资源访问策略。
  - 先依赖什么：阶段 1
  - 主要改哪里：
    - `apps/host/src/modules/plugins/plugin-static-service.ts`
    - 插件前端资源路由
  - 这一步明确不做什么：不放开高权限桥。
  - 怎么验证：
    1. 插件前端可加载
    2. 普通 HTML 预览仍走旧链路
    3. 插件禁用后资源入口失效
  - 对应需求：`requirements.md` 需求 3、11
  - 对应设计：`design.md` §3、§9

- [x] 2.2 新增插件容器页与插件桥前端 SDK
  - 状态：DONE
  - 这一步到底做什么：在 `user-app` 里提供插件容器页，并注入受控插件桥。
  - 做完以后能看到什么结果：静态 HTML 插件前端可在 `CodingNS` 内正式运行。
  - 先依赖什么：2.1
  - 主要改哪里：
    - `apps/user-app`
  - 这一步明确不做什么：不开放桌面直连。
  - 怎么验证：
    1. 仅前端插件可正常打开
    2. 插件可读取当前插件上下文
    3. 插件不能直接访问宿主原生桥
  - 对应需求：`requirements.md` 需求 3、9、11
  - 对应设计：`design.md` §7

- [x] 2.3 补插件 iframe sandbox 与 CSP 基础策略
  - 状态：DONE
  - 这一步到底做什么：为插件前端建立与普通 HTML 预览不同的 sandbox / CSP 策略。
  - 做完以后能看到什么结果：插件前端脚本能受控运行，而不是裸奔。
  - 先依赖什么：2.1、2.2
  - 主要改哪里：
    - Host 响应头
    - 前端 iframe 容器
  - 这一步明确不做什么：不一次性支持所有插件网络策略变体。
  - 怎么验证：
    1. 插件脚本可执行
    2. 未授权网络或宿主能力不可直接访问
    3. 普通 HTML 预览策略不被污染
  - 对应需求：`requirements.md` 需求 9、11
  - 对应设计：`design.md` §7.2、§7.3

---

## 阶段 3：把 Node.js 插件后端动作接进统一网关

- [x] 3.1 实现插件动作执行器与按需 Node.js 进程拉起
  - 状态：DONE
  - 这一步到底做什么：把插件动作执行收敛成统一运行器，默认按需拉起 Node.js 脚本。
  - 做完以后能看到什么结果：插件前端、CLI 和自动化都能调用正式动作，而不是直接调脚本。
  - 先依赖什么：阶段 1
  - 主要改哪里：
    - `apps/host/src/modules/plugins/plugin-runtime-service.ts`
    - `apps/host/src/modules/plugins/plugin-process-runner.ts`
  - 这一步明确不做什么：不支持常驻守护进程默认开启。
  - 怎么验证：
    1. 动作可执行并返回结果
    2. 超时、失败、退出码可记录
    3. 插件禁用后动作被拒绝
  - 对应需求：`requirements.md` 需求 4、5、12
  - 对应设计：`design.md` §5.4

- [x] 3.2 提供插件动作调用 API / CLI / 前端桥统一分发
  - 状态：DONE
  - 这一步到底做什么：让前端桥、Host API 和 CLI 都走同一条动作分发链路。
  - 做完以后能看到什么结果：插件能力暴露不再到处重复实现。
  - 先依赖什么：3.1
  - 主要改哪里：
    - `apps/host/src/routes/plugins.ts`
    - `packages/codingns`
    - 前端插件桥
  - 这一步明确不做什么：不为每个插件动态造独立 API 模块。
  - 怎么验证：
    1. 三种入口结果一致
    2. 参数和错误结构一致
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §6、§7.4

- [x] 3.3 增加插件运行记录与错误落库
  - 状态：DONE
  - 这一步到底做什么：把动作执行、拒绝、失败写入正式 `PluginRun` 和审计事件。
  - 做完以后能看到什么结果：插件故障可排查、越权可追责。
  - 先依赖什么：3.1
  - 主要改哪里：
    - `apps/host/src/modules/plugins/`
    - SQLite schema
  - 这一步明确不做什么：不做复杂实时日志 UI。
  - 怎么验证：
    1. 成功与失败运行都有记录
    2. 拒绝调用也有审计
  - 对应需求：`requirements.md` 需求 12
  - 对应设计：`design.md` §4.6、§4.7

---

## 阶段 4：把工作区隔离和桌面能力收口做硬

- [x] 4.1 插件动作与文件访问强绑定当前工作区
  - 状态：DONE
  - 这一步到底做什么：禁止插件自由传 `workspaceId`，所有作用域从当前上下文注入。
  - 做完以后能看到什么结果：插件不能跨工作区请求文件或动作。
  - 先依赖什么：阶段 2、阶段 3
  - 主要改哪里：
    - 插件 API 网关
    - 权限服务
    - 文件访问集成层
  - 这一步明确不做什么：不开放跨工作区白名单特例。
  - 怎么验证：
    1. 传入其他 `workspaceId` 被拒绝
    2. 路径穿越被拒绝
    3. 软链接越界被拒绝
  - 对应需求：`requirements.md` 需求 7、8
  - 对应设计：`design.md` §8

- [x] 4.2 桌面动作改为 Host 中介 + 工作区边界校验
  - 状态：DONE
  - 这一步到底做什么：插件请求“打开文件/打开目录”必须走 Host 中介，并做工作区内路径解析。
  - 做完以后能看到什么结果：插件无法把桌面桥当成本地后门。
  - 先依赖什么：4.1
  - 主要改哪里：
    - `apps/desktop`
    - Host 插件权限层
    - 插件桥
  - 这一步明确不做什么：不向插件直接暴露 `window.CodingNSDesktop`。
  - 怎么验证：
    1. 工作区内文件可受控打开
    2. 工作区外路径被拒绝
    3. 无权限插件被拒绝
  - 对应需求：`requirements.md` 需求 7、10
  - 对应设计：`design.md` §7.4、§8.4

- [x] 4.3 收紧插件消息通道与桌面桥暴露范围
  - 状态：DONE
  - 这一步到底做什么：把插件页与宿主之间的消息协议、来源校验和桥接暴露范围收口。
  - 做完以后能看到什么结果：插件不能伪造消息或借 frame 拿到宿主能力。
  - 先依赖什么：2.2、4.2
  - 主要改哪里：
    - `apps/desktop`
    - `apps/user-app`
    - 插件桥协议
  - 这一步明确不做什么：不保留长期 `postMessage('*')` 方案。
  - 怎么验证：
    1. 来源不合法消息被拒绝
    2. 插件页不能直接接触原生桥
  - 对应需求：`requirements.md` 需求 9、10
  - 对应设计：`design.md` §7.5

---

## 阶段 5：把插件调度接进正式后台任务体系

- [x] 5.1 定义插件调度模型并接入后台任务体系
  - 状态：DONE
  - 这一步到底做什么：让插件可以声明周期性动作，并由正式调度器执行。
  - 做完以后能看到什么结果：插件不需要自己写私有 `setInterval`。
  - 先依赖什么：阶段 3
  - 主要改哪里：
    - `apps/host/src/modules/plugins/plugin-scheduler-service.ts`
    - 现有任务调度接入点
  - 这一步明确不做什么：不支持任意复杂 DSL。
  - 怎么验证：
    1. 调度触发会创建正式运行记录
    2. 禁用插件后调度停止
  - 对应需求：`requirements.md` 需求 6、12
  - 对应设计：`design.md` §5.5

- [x] 5.2 插件调度失败重试与审计回写
  - 状态：DONE
  - 这一步到底做什么：复用正式后台任务策略处理插件调度失败。
  - 做完以后能看到什么结果：插件调度失败不会静默丢失。
  - 先依赖什么：5.1
  - 主要改哪里：
    - `apps/host/src/modules/plugins/plugin-scheduler-service.ts`
    - `apps/host/src/modules/tasks/task-types.ts`
    - `apps/host/src/storage/sqlite/*`
    - `apps/host/tests/plugins/plugin-scheduler-service.test.ts`
  - 这一步明确不做什么：不做插件私有重试队列。
  - 怎么验证：
    1. 调度触发会入正式 `plugin.schedule.trigger` 任务，不再自己吞失败
    2. 失败重试记录会写 `plugin.schedule_retry_scheduled`
    3. 多工作区时会写 `plugin.schedule_skipped`，不会乱猜工作区
    4. 插件禁用后不会继续触发
    5. 已补 `apps/host/tests/plugins/plugin-scheduler-service.test.ts`
  - 对应需求：`requirements.md` 需求 6、12
  - 对应设计：`design.md` §5.5

---

## 阶段 6：零破坏回归与安全回归

- [x] 6.1 做普通 HTML 预览零破坏回归
  - 状态：DONE
  - 这一步到底做什么：证明插件系统接入后，普通 HTML 文件预览仍按原有预览链路工作。
  - 做完以后能看到什么结果：引入插件系统不会污染文件预览主流程。
  - 先依赖什么：阶段 2、阶段 4
  - 主要改哪里：
    - `apps/host/tests/`
    - `apps/user-app/tests/`
  - 这一步明确不做什么：不把普通 HTML 预览变成插件运行时。
  - 怎么验证：
    1. 普通 HTML 文件仍可预览
    2. 普通预览拿不到插件桥
    3. 普通预览 CSP / sandbox 不被插件策略覆盖
  - 对应需求：`requirements.md` 需求 11
  - 对应设计：`design.md` §9

- [x] 6.2 做跨工作区越权回归
  - 状态：DONE
  - 这一步到底做什么：系统性验证插件不能查看或操作其他工作区文件。
  - 做完以后能看到什么结果：工作区边界不是纸糊的。
  - 先依赖什么：阶段 4
  - 主要改哪里：
    - Host 插件集成测试
    - 桌面动作测试
  - 这一步明确不做什么：不接受“前端没提供入口所以算安全”这种伪验证。
  - 怎么验证：
    1. 传 workspaceId 越权失败
    2. 路径跳出失败
    3. 桌面打开工作区外路径失败
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §8

- [x] 6.3 做插件前端越权与宿主桥泄漏回归
  - 状态：DONE
  - 这一步到底做什么：验证插件页无法直接访问原生桥、宿主私有 token 或未授权能力。
  - 做完以后能看到什么结果：静态 HTML 插件不会变成本地权限漏洞。
  - 先依赖什么：阶段 2、阶段 4
  - 主要改哪里：
    - 插件容器测试
    - 桌面桥测试
  - 这一步明确不做什么：不接受“约定开发者别乱来”这种笑话。
  - 怎么验证：
    1. `window.CodingNSDesktop` 不可直接访问
    2. 未授权插件桥调用失败
    3. 非法消息来源被拒绝
  - 对应需求：`requirements.md` 需求 9、10
  - 对应设计：`design.md` §7

- 说明：阶段 5 已收口到正式任务体系。当前仍保留 scheduler tick 负责“扫描哪些 schedule 到点了”，但真正的动作触发、失败重试和审计已经统一走 `plugin.schedule.trigger` + `plugin.action.execute`，没有再长插件私有重试队列。
