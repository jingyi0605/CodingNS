# 任务清单 - spec015.2.1-插件运行实例与权限授权收口（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只解决一件事：

把 `spec015.2` 已经搭好的插件系统，再往前推一步，补成“按当前工作区运行、按授权拿能力、文件访问统一收口”的正式能力。

别把这件事做成一坨：

- 一边改前端桥
- 一边改后端动作
- 一边顺手再加新插件功能

那样最后只会失控。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- `BLOCKED` 必须写清楚卡在哪里
- `CANCELLED` 必须写清楚为什么不做
- 每做完一个任务，必须立刻更新这里

---

## 阶段 1：先把运行实例模型立起来

- [x] 1.1 新增 `PluginRuntimeSession` 表、仓库和基础服务
  - 状态：DONE
  - 这一步到底做什么：把“插件在某个工作区里打开一次”做成正式数据对象，而不是只靠路由参数临时传来传去。
  - 做完你能看到什么：数据库里有运行实例表，Host 能创建、读取、关闭插件运行实例。
  - 先依赖什么：`spec015.2` 现有插件注册与容器链路
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1「核心思路」
    - `design.md` §3.1「PluginRuntimeSession」
  - 主要改哪里：
    - `apps/host/src/types/domain.ts`
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/sqlite/client.ts`
    - `apps/host/src/storage/repositories/plugin-runtime-session-repository.ts`
    - `apps/host/src/modules/plugins/`
  - 这一步先不做什么：先不碰前端弹窗，不做文件读写。
  - 怎么算完成：
    1. Host 可以创建和关闭运行实例
    2. 运行实例能关联插件、工作区、用户和来源
    3. 失效实例再次使用会被拒绝
  - 怎么验证：
    - 新增 `apps/host/tests/plugins/plugin-runtime-session.test.ts`
    - 跑 Host 相关测试
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §3.1、§4.1、§5.1

- [x] 1.2 插件容器页改为先创建运行实例再加载 iframe
  - 状态：DONE
  - 这一步到底做什么：让前端插件容器页在加载插件前先拿到 `runtimeSessionId`，后续桥调用都只认这个 id。
  - 做完你能看到什么：打开插件页面时，会先创建运行实例，再把受控上下文注入 iframe。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §4.1「打开插件并创建运行实例」
    - `design.md` §5.1「创建运行实例」
  - 主要改哪里：
    - `apps/user-app/src/features/plugins/pages/PluginContainerPage.tsx`
    - `apps/user-app/src/features/plugins/runtime/plugin-bridge.ts`
    - `apps/user-app/src/features/plugins/api/plugins-api.ts`
  - 这一步先不做什么：不新增文件读写能力，只先把 session 注进去。
  - 怎么算完成：
    1. 前端桥上下文包含 `runtimeSessionId`
    2. 前端动作调用不再自由传 `workspaceId`
    3. 页面关闭或实例关闭后，再调会失败
  - 怎么验证：
    - 更新 `plugin-bridge.test.ts`
    - 增加容器页测试或人工走查
  - 对应需求：`requirements.md` 需求 1、需求 6
  - 对应设计：`design.md` §4.1、§4.2

### 阶段检查

- [x] 1.3 运行实例主链路检查
  - 状态：DONE
  - 这一步到底做什么：只检查“打开插件 -> 创建 session -> 用 session 调动作”这条主链路是不是已经成立。
  - 做完你能看到什么：后面加权限和文件网关时，不用再回头重改上下文模型。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新能力。
  - 怎么算完成：
    1. 前端不再依赖自由 `workspaceId`
    2. Host 能基于 `runtimeSessionId` 找回工作区
  - 怎么验证：
    - 集成测试
    - 人工走查请求链路
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.1、§4.1、§4.2

---

## 阶段 2：把权限声明和用户授权拆开

- [x] 2.1 新增 `PluginPermissionGrant` 表、仓库和权限 key 模型
  - 状态：DONE
  - 这一步到底做什么：建立正式授权记录，不再只看 manifest 里写没写权限。
  - 做完你能看到什么：数据库里能正式记录某插件在某工作区下拿到了什么授权、范围多大、多久有效。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4
    - `design.md` §3.2「PluginPermissionGrant」
    - `design.md` §3.4「运行时权限 key」
  - 主要改哪里：
    - `apps/host/src/types/domain.ts`
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/sqlite/client.ts`
    - `apps/host/src/storage/repositories/plugin-permission-grant-repository.ts`
  - 这一步先不做什么：不急着做 UI 提示，先把后端对象和表站稳。
  - 怎么算完成：
    1. 可以创建、查询、撤销授权记录
    2. 授权能区分 `once/session/persistent`
    3. 授权能区分 `file/directory/workspace`
  - 怎么验证：
    - 新增仓库单测
    - 跑 SQLite migration 测试
  - 对应需求：`requirements.md` 需求 2、需求 4、需求 6
  - 对应设计：`design.md` §3.2、§3.4、§5.4、§5.5

- [x] 2.2 重做 `PluginPermissionService`：先看声明，再看授权
  - 状态：DONE
  - 这一步到底做什么：把当前“manifest 写了就放行”的逻辑改成“manifest 只决定能不能申请，grant 才决定能不能执行”。
  - 做完你能看到什么：未声明直接拒绝，已声明但未授权返回正式可提示拒绝结果。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4、需求 5
    - `design.md` §2.3「模块职责」
    - `design.md` §6「错误处理」
  - 主要改哪里：
    - `apps/host/src/modules/plugins/plugin-permission-service.ts`
    - `apps/host/src/modules/plugins/plugin-runtime-service.ts`
  - 这一步先不做什么：先不加新的权限类型，只覆盖本 Spec 这批 key。
  - 怎么算完成：
    1. 未声明权限请求会被直接拒绝
    2. 未授权请求会返回 `PLUGIN_PERMISSION_GRANT_REQUIRED`
    3. 已授权请求会正常放行
  - 怎么验证：
    - 新增 `plugin-permission-service.test.ts`
    - 覆盖声明缺失、授权缺失、授权命中、授权撤销
  - 对应需求：`requirements.md` 需求 2、需求 4、需求 5
  - 对应设计：`design.md` §2.3、§6.1、§7.2

### 阶段检查

- [x] 2.3 权限判定链路检查
  - 状态：DONE
  - 这一步到底做什么：确认 Host 已经能稳定区分“未声明”“未授权”“已授权”三种状态。
  - 做完你能看到什么：前端之后接权限弹窗时，不会再倒逼后端重改错误模型。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不扩范围。
  - 怎么算完成：
    1. 错误码和错误结构已稳定
    2. 授权撤销后会重新回到未授权状态
  - 怎么验证：
    - 集成测试
    - 审计结果走查
  - 对应需求：`requirements.md` 需求 2、需求 4
  - 对应设计：`design.md` §5.4、§6、§7.2

---

## 阶段 3：把文件读写和列目录统一收口到 Host 网关

- [x] 3.1 新增插件文件网关服务
  - 状态：DONE
  - 这一步到底做什么：把读文件、写文件、列目录做成统一 Host 服务，别再散在动作里乱写。
  - 做完你能看到什么：插件文件能力有固定入口，全部走 `FileAccessGuard` 和权限判定。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.3「模块职责」
    - `design.md` §4.3「插件文件读取」
    - `design.md` §4.4「插件文件写入」
  - 主要改哪里：
    - `apps/host/src/modules/plugins/plugin-file-gateway-service.ts`
    - `apps/host/src/modules/file/file-access-guard.ts`
    - `apps/host/src/modules/plugins/plugin-controller.ts`
  - 这一步先不做什么：不支持删除文件、不支持重命名。
  - 怎么算完成：
    1. 读/写/列目录都有正式 API
    2. 所有路径都要求相对路径并经过工作区边界校验
    3. 越界和未授权都会被记录
  - 怎么验证：
    - 新增 `plugin-file-gateway.test.ts`
    - 集成测试覆盖越界路径和正常路径
  - 对应需求：`requirements.md` 需求 3、需求 6
  - 对应设计：`design.md` §4.3、§4.4、§5.3、§7.3

- [x] 3.2 前端插件桥接入 `readFile/writeFile/listDir`
  - 状态：DONE
  - 这一步到底做什么：让静态 HTML 插件能通过桥正式调文件网关，而不是自己碰宿主路径。
  - 做完你能看到什么：插件前端可以读文件、写文件、列目录，但都走 Host API。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §5.3「读文件 / 写文件 / 列目录」
  - 主要改哪里：
    - `apps/host/src/modules/plugins/runtime/plugin-runtime-sdk.js`
    - `apps/user-app/src/features/plugins/runtime/plugin-bridge.ts`
    - `apps/user-app/src/features/plugins/api/plugins-api.ts`
  - 这一步先不做什么：先不处理二进制大文件分片。
  - 怎么算完成：
    1. 前端桥提供读/写/列目录能力
    2. 请求统一带 `runtimeSessionId`
    3. Host 返回统一错误结构
  - 怎么验证：
    - 更新 `plugin-bridge.test.ts`
    - 前端联调用例
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` §4.3、§4.4、§5.3

### 阶段检查

- [x] 3.3 文件网关主链路检查
  - 状态：DONE
  - 这一步到底做什么：检查“未授权拒绝 -> 授权后放行 -> 越界拒绝”这条主链路是不是已经站稳。
  - 做完你能看到什么：文件相关能力已经从零散入口变成可维护的正式能力。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不再继续加新的文件操作类型。
  - 怎么算完成：
    1. 读/写/列目录行为一致
    2. 授权和越界错误能分清
  - 怎么验证：
    - 集成测试
    - 人工走查 API 响应
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` §4.3、§4.4、§6、§7.3

---

## 阶段 4：把权限提示、桌面动作和详情页串起来

- [x] 4.1 新增插件权限提示弹窗与授权 API
  - 状态：DONE
  - 这一步到底做什么：当前端收到“未授权但可申请”的拒绝结果时，弹出正式权限提示，让用户决定给不给。
  - 做完你能看到什么：插件第一次读写文件或触发桌面动作时，用户会看到明确提示，而不是后台直接报错。
  - 先依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §5.4「创建授权记录」
    - `design.md` §6.2「前端可提示拒绝结果」
    - 模态框规范文档
  - 主要改哪里：
    - `apps/user-app/src/features/plugins/components/PluginPermissionPromptModal.tsx`
    - `apps/user-app/src/features/plugins/runtime/plugin-bridge.ts`
    - `apps/user-app/src/features/plugins/api/plugins-api.ts`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步先不做什么：不做花哨的批量授权 UI。
  - 怎么算完成：
    1. 能针对读、写、桌面动作弹出不同提示
    2. 用户可选择一次 / 本次会话 / 目录级长期授权中的首批支持项
    3. 前端会把授权结果回写到 Host
  - 怎么验证：
    - 新增组件测试
    - 手工走读权限提示流程
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §5.4、§6.2

- [x] 4.2 桌面动作接入同一套授权链路
  - 状态：DONE
  - 这一步到底做什么：把 `open_file` 和 `reveal_in_file_manager` 从“只有 manifest 检查”改成“manifest + grant + 工作区边界”的完整模型。
  - 做完你能看到什么：桌面动作不再是插件体系里的第二套特例。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §4.5「插件桌面动作」
  - 主要改哪里：
    - `apps/host/src/modules/plugins/plugin-runtime-service.ts`
    - `apps/host/src/modules/plugins/plugin-controller.ts`
    - `apps/user-app/src/features/plugins/runtime/plugin-bridge.ts`
  - 这一步先不做什么：不开放新的桌面能力。
  - 怎么算完成：
    1. 未声明桌面权限直接拒绝
    2. 已声明但未授权返回可提示拒绝结果
    3. 已授权且工作区内路径可真正调用桌面桥
  - 怎么验证：
    - 更新 `plugins-routes.test.ts`
    - 桌面桥联调验证
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §4.5、§7.1、§7.3

- [x] 4.3 插件详情页展示授权摘要并支持撤销授权
  - 状态：DONE
  - 这一步到底做什么：让人能在插件详情里看到当前工作区已经批了什么权限，并能撤销。
  - 做完你能看到什么：插件授权不再是只写数据库、没人看得见。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §5.5「撤销授权与查询授权」
  - 主要改哪里：
    - `apps/user-app/src/features/plugins/pages/PluginDetailPage.tsx`
    - `apps/user-app/src/settings/PluginManagementModal.tsx`
    - `apps/user-app/src/features/plugins/api/plugins-api.ts`
  - 这一步先不做什么：不做复杂权限筛选器。
  - 怎么算完成：
    1. 详情页能显示当前工作区授权摘要
    2. 能看见最近授权相关事件
    3. 撤销后后续请求重新进入未授权状态
  - 怎么验证：
    - 页面测试
    - 手工撤销再重试能力调用
  - 对应需求：`requirements.md` 需求 4、需求 6
  - 对应设计：`design.md` §5.5、§6.1

### 阶段检查

- [x] 4.4 授权体验与桌面动作收口检查
  - 状态：DONE
  - 这一步到底做什么：检查前端提示、后端授权和桌面动作是不是已经接到同一条线上。
  - 做完你能看到什么：插件权限不再一半在 Host、一半在前端、一半在桌面桥里漂着。
  - 先依赖什么：4.1、4.2、4.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不加新桌面能力。
  - 怎么算完成：
    1. 读/写/桌面动作权限体验一致
    2. 详情页和审计记录能对上
  - 怎么验证：
    - 联调回放
    - 人工验收
  - 对应需求：`requirements.md` 需求 4、需求 5、需求 6
  - 对应设计：`design.md` §4.5、§5.4、§5.5、§6

---

## 阶段 5：补后端动作上下文和回归验证

- [x] 5.1 插件后端动作 payload 补上 `runtimeSessionId`
  - 状态：DONE
  - 这一步到底做什么：让后端动作至少知道自己属于哪个插件运行实例，方便后续受控能力和审计继续往下做。
  - 做完你能看到什么：Node 动作日志和运行记录能对应到具体前端实例。
  - 先依赖什么：4.4
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §4.2「插件动作调用」
    - `design.md` §3.3「PluginRun 扩展」
  - 主要改哪里：
    - `apps/host/src/modules/plugins/plugin-runtime-service.ts`
    - `apps/host/src/modules/plugins/plugin-process-runner.ts`
    - 测试插件脚本样例
  - 这一步先不做什么：不在这一步引入真正强沙箱。
  - 怎么算完成：
    1. 后端动作收到 `runtimeSessionId`
    2. `PluginRun` 能回写该字段
    3. 不破坏现有动作执行结果
  - 怎么验证：
    - 更新动作执行测试
    - 检查 run 记录字段
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §3.3、§4.2

- [x] 5.2 做完整回归与安全回归
  - 状态：DONE
  - 这一步到底做什么：把主链路和已知风险点全部走一遍，确认没把现有插件能力搞坏，也没把普通 HTML 预览污染掉。
  - 做完你能看到什么：能比较有底气地说这次改造不是“功能加了，边界炸了”。
  - 先依赖什么：5.1
  - 开始前先看：
    - `requirements.md` 全部需求
    - `design.md` §8「测试策略」
    - `design.md` §9「风险与待确认项」
  - 主要改哪里：
    - `apps/host/tests/plugins/*`
    - `apps/user-app/src/features/plugins/**/*.test.ts*`
    - 必要的补充文档
  - 这一步先不做什么：不顺手加新能力。
  - 怎么算完成：
    1. 主链路测试通过：打开插件、创建 session、调动作、读写文件、桌面动作、授权提示、撤销授权
    2. 回归测试通过：启用/禁用、现有插件容器、普通 HTML 预览
    3. 已知非目标项写清楚：当前仍不是强沙箱
  - 怎么验证：
    - 跑插件相关测试集
    - 按验收清单人工回放
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §8、§9

### 最终检查

- [x] 5.3 最终检查点
  - 状态：DONE
  - 这一步到底做什么：确认这份 Spec 的需求、设计、任务和测试证据能对上，不留“以后再补”的黑洞。
  - 做完你能看到什么：接手的人第一眼就知道已经做了什么、没做什么、风险还剩什么。
  - 先依赖什么：5.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不再追加新需求。
  - 怎么算完成：
    1. 关键任务都能追到需求和设计
    2. 风险和非目标项已经写清楚
    3. 后续继续做强沙箱时，知道该接哪一层
  - 怎么验证：
    - 按 Spec 验收清单逐项核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
