# 任务清单 - spec009-移动端体验与通知（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单用来把移动端能力拆成可执行步骤，避免“需求看起来很多，但没人知道先做什么”。

重点是四件事：

- 信息架构先站稳
- 会话与轻操作主链路可用
- 通知真正有用，不制造噪音
- 登录态和受保护边界不破

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：已完成并验证通过
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 才能勾选 `[x]`
- 每完成一个任务，必须立刻回写状态和验证结果
- `BLOCKED` 与 `CANCELLED` 必须说明原因和后续处理

---

## 阶段 1：先把移动端页面骨架和依赖边界定住

- [ ] 1.1 建立移动端信息架构与导航骨架
  - 状态：TODO
  - 这一步到底做什么：实现移动端首页、工作区页、会话页、通知收件箱页的基础导航结构。
  - 做完你能看到什么：用户可以在 1-2 次点击内从首页进入目标工作区和会话。
  - 先依赖什么：`spec008` 的移动壳与路由入口可用。
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1、§2.2
    - `spec008/design.md`（桌面端与 H5 共享边界）
  - 主要改哪里：
    - `apps/mobile/src/navigation/mobile-routes.ts`
    - `apps/mobile/src/pages/home/MobileHomePage.tsx`
    - `apps/mobile/src/pages/workspace/MobileWorkspacePage.tsx`
  - 这一步先不做什么：不接入深层业务逻辑，不做桌面式多栏布局。
  - 怎么算完成：
    1. 四个核心页面可互相跳转
    2. 首页能展示工作区摘要骨架
  - 怎么验证：
    - 路由集成测试
    - 人工走查（Android/iOS 模拟器）
  - 对应需求：`requirements.md` 需求 1、需求 7
  - 对应设计：`design.md` §2.1、§2.2

- [ ] 1.2 接入移动端鉴权守卫与受保护请求拦截
  - 状态：TODO
  - 这一步到底做什么：把路由守卫、HTTP 拦截、WebSocket 握手校验接入移动端。
  - 做完你能看到什么：未登录或令牌失效时，受保护页面和请求全部被拦截。
  - 先依赖什么：1.1，`spec001` 鉴权主链路可用。
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §2.2、§3.3、§5.3
    - `spec001/design.md`（初始化与鉴权）
    - `spec003/design.md`（会话页鉴权行为）
  - 主要改哪里：
    - `apps/mobile/src/guards/MobileAuthGuard.tsx`
    - `apps/mobile/src/network/mobile-http-client.ts`
    - `apps/mobile/src/network/mobile-realtime-client.ts`
  - 这一步先不做什么：不做多角色权限，不改后端认证协议。
  - 怎么算完成：
    1. 未登录访问受保护数据统一失败
    2. token 失效自动走刷新或重登流程
  - 怎么验证：
    - 鉴权 E2E
    - 令牌失效集成测试
  - 对应需求：`requirements.md` 需求 6、需求 7
  - 对应设计：`design.md` §2.2、§3.3、§6.1

- [ ] 1.3 阶段检查：移动端地基边界检查
  - 状态：TODO
  - 这一步到底做什么：确认“移动端只做查看+轻操作”和“受保护数据必须登录态”已写进实现。
  - 做完你能看到什么：后续功能开发不会跑偏成手机版桌面 IDE。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 全文
    - `design.md` §1.3、§2.1、§6.1
  - 主要改哪里：
    - 当前 Spec 文档与移动端导航/守卫代码
  - 这一步先不做什么：不扩展文件/Git/进程复杂能力。
  - 怎么算完成：
    1. 页面结构和安全边界评审通过
    2. 无“桌面重型布局”残留
  - 怎么验证：
    - 评审清单
    - 手工回归
  - 对应需求：`requirements.md` 需求 1、需求 6、需求 7
  - 对应设计：`design.md` §1.3、§2.1、§6.1

---

## 阶段 2：打通会话与文件/Git/进程轻操作主链路

- [ ] 2.1 接入移动端会话查看与回复
  - 状态：TODO
  - 这一步到底做什么：复用 `spec003` 会话运行时，完成移动端会话消息展示、回复、失败重试、弱网重连。
  - 做完你能看到什么：用户可以在手机上连续查看并回复会话，不丢上下文。
  - 先依赖什么：1.3，`spec003` 会话 API 与运行时契约稳定。
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §2.3.2、§4.1
    - `spec003/requirements.md`（消息运行时边界）
  - 主要改哪里：
    - `apps/mobile/src/pages/conversation/MobileConversationPage.tsx`
    - `apps/mobile/src/stores/mobile-session-runtime-store.ts`
    - `apps/mobile/src/components/conversation/MobileComposer.tsx`
  - 这一步先不做什么：不在移动端实现会话协议新字段。
  - 怎么算完成：
    1. 历史消息可加载，实时消息可更新
    2. 发送失败可重试，重连后可补齐消息
  - 怎么验证：
    - 会话链路 E2E
    - 弱网切换测试
  - 对应需求：`requirements.md` 需求 2、需求 7
  - 对应设计：`design.md` §2.3.2、§4.1、§4.2

- [ ] 2.2 接入文件 / Git / 进程轻操作面板
  - 状态：TODO
  - 这一步到底做什么：接入 `spec004/005/007` 的能力入口，只保留移动端高价值轻操作。
  - 做完你能看到什么：用户可在手机上完成小改文件、轻量 Git 操作、进程启停与状态查看。
  - 先依赖什么：2.1，`spec004/005/007` 核心接口可用。
  - 开始前先看：
    - `requirements.md` 需求 3、需求 7
    - `design.md` §2.3.3、§3.2.2
    - `spec004/design.md`
    - `spec005/design.md`
    - `spec007/design.md`
  - 主要改哪里：
    - `apps/mobile/src/pages/workspace/MobileLightActionPanel.tsx`
    - `apps/mobile/src/pages/file/MobileFileQuickEditPage.tsx`
    - `apps/mobile/src/pages/git/MobileGitQuickActionPage.tsx`
    - `apps/mobile/src/pages/process/MobileProcessQuickActionPage.tsx`
  - 这一步先不做什么：不做复杂分支治理，不做批量高风险文件操作。
  - 怎么算完成：
    1. 三类轻操作入口都可用
    2. 高风险操作有确认提示
  - 怎么验证：
    - 功能回归测试
    - 风险操作确认测试
  - 对应需求：`requirements.md` 需求 3、需求 7
  - 对应设计：`design.md` §2.3.3、§3.2.2、§4.1

- [ ] 2.3 完成全屏终端与日志查看边界
  - 状态：TODO
  - 这一步到底做什么：实现移动端全屏终端和日志页，保证可读性与受控输入。
  - 做完你能看到什么：用户能看终端与日志，不会被小屏幕碎片化面板干扰。
  - 先依赖什么：2.2，`spec007` 的进程与日志能力可用，终端流复用现有 Host 通道。
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.3、§5.3
    - `spec007/design.md`
  - 主要改哪里：
    - `apps/mobile/src/pages/terminal/MobileTerminalPage.tsx`
    - `apps/mobile/src/pages/log/MobileLogPage.tsx`
    - `apps/mobile/src/components/terminal/MobileTerminalInputGuard.tsx`
  - 这一步先不做什么：不做移动端完整终端开发工作流。
  - 怎么算完成：
    1. 全屏终端/日志可正常浏览与滚动
    2. 手动命令输入需要显式确认
  - 怎么验证：
    - 终端日志可用性测试
    - 输入保护测试
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §2.3.3、§5.3

- [ ] 2.4 阶段检查：轻操作主链路检查
  - 状态：TODO
  - 这一步到底做什么：串起来验证“看会话 -> 回一句 -> 小改动 -> 看日志”的移动端真实链路。
  - 做完你能看到什么：移动端核心价值已经可用，不是空壳页面。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3、需求 4
    - `design.md` §2.3、§4.2
  - 主要改哪里：
    - 移动端 E2E 测试脚本与验收文档
  - 这一步先不做什么：不扩展桌面端功能到移动端。
  - 怎么算完成：
    1. 主链路回放通过
    2. 弱网与失败场景可恢复
  - 怎么验证：
    - 端到端回放
    - 故障注入测试
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 4
  - 对应设计：`design.md` §2.3、§4.2、§7

---

## 阶段 3：完成通知策略与最终验收

- [ ] 3.1 建立通知订阅、收件箱与已读同步
  - 状态：TODO
  - 这一步到底做什么：接入移动端设备订阅、应用内收件箱和已读状态同步。
  - 做完你能看到什么：用户能统一查看通知，不会漏掉关键事件。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 5、需求 6
    - `design.md` §2.3.4、§3.3、§4.1
  - 主要改哪里：
    - `apps/mobile/src/pages/notification/MobileNotificationInboxPage.tsx`
    - `apps/mobile/src/stores/mobile-notification-store.ts`
    - `apps/mobile/src/network/mobile-notification-client.ts`
  - 这一步先不做什么：不做复杂通知审批流。
  - 怎么算完成：
    1. 设备订阅成功并持久化
    2. 收件箱支持分页和已读回写
  - 怎么验证：
    - 通知订阅与收件箱集成测试
    - 已读同步测试
  - 对应需求：`requirements.md` 需求 5、需求 6
  - 对应设计：`design.md` §2.3.4、§3.3.3、§4.1

- [ ] 3.2 实现关键事件通知规则与人工介入入口
  - 状态：TODO
  - 这一步到底做什么：实现会话进展、进程状态、关键失败、人工介入事件的通知分级和深链。
  - 做完你能看到什么：用户只收到有价值提醒，点击后能直达处理页面。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.4、§3.2.3、§6.3
  - 主要改哪里：
    - `apps/mobile/src/notifications/mobile-notification-rules.ts`
    - `apps/mobile/src/notifications/mobile-deeplink-resolver.ts`
    - `apps/mobile/src/pages/notification/MobileInterventionEntry.tsx`
  - 这一步先不做什么：不做营销类提醒，不做低价值高频推送。
  - 怎么算完成：
    1. 四类关键事件触发规则可配置且可测试
    2. 每条关键通知都能定位到对应工作区/会话/进程
  - 怎么验证：
    - 规则单元测试
    - 深链集成测试
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.4、§3.2.3、§6.3

- [ ] 3.3 最终检查：移动端可交付验收
  - 状态：TODO
  - 这一步到底做什么：按需求、设计、任务映射做总验收，确认移动端交付边界没有跑偏。
  - 做完你能看到什么：spec009 可以进入实现排期，不会和前置 Spec 打架。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：
    - `spec009` 当前目录全部文件
  - 这一步先不做什么：不新增新需求。
  - 怎么算完成：
    1. 所有核心需求有对应实现任务和验证方式
    2. 与 `spec003/004/005/007/008` 的依赖关系清晰
    3. 关键风险与回退策略记录完整
  - 怎么验证：
    - 验收清单逐项核对
    - 评审会记录
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
