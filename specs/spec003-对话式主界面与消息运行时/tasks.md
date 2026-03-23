# 任务清单 - spec003 对话式主界面与消息运行时（人话版）

状态：DONE

## 这份文档是干什么的

这份任务清单用于把 spec003 落成可执行步骤，避免“想法很多，落地很乱”。
重点是把主舞台、消息运行时、能力门控、登录保护和断线重连一条主链路跑通。

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻更新本文件状态
- `BLOCKED` 必须写清楚阻塞项和依赖方

---

## 阶段 1：先把页面骨架和边界立住

- [x] 1.1 建立会话页主舞台骨架
  - 状态：DONE
  - 这一步到底做什么：实现会话页基础布局，确保对话区是主视图，头部和输入区位置固定。
  - 做完你能看到什么：页面打开后，中间是消息主舞台，输入区可直接交互，侧栏不抢焦点。
  - 先依赖什么：`spec001` 的登录基础路由可用。
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1、§3.1
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
    - `apps/user-app/src/features/conversation/components/ConversationLayout.tsx`
  - 这一步先不做什么：不接入文件、Git、终端、进程面板的真实业务数据。
  - 怎么算完成：
    1. 桌面和移动布局都能展示主舞台
    2. 输入区固定在高频操作路径
  - 怎么验证：
    - 页面人工走查（桌面 + 移动断点）
    - UI 冒烟测试
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.1、§3.1

- [x] 1.2 接入会话头部与状态展示
  - 状态：DONE
  - 这一步到底做什么：实现 `SessionHeader`，显示会话标题、连接状态、能力摘要。
  - 做完你能看到什么：用户不用下钻也能知道会话是否在线、当前能力是否受限。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 5
    - `design.md` §2.2、§3.1、§4.2
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/SessionHeader.tsx`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
  - 这一步先不做什么：不实现复杂筛选和多会话批量操作。
  - 怎么算完成：
    1. 会话头部可显示连接态和能力摘要
    2. 连接状态变化时头部可同步更新
  - 怎么验证：
    - 组件单元测试
    - WebSocket 模拟事件集成测试
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 5
  - 对应设计：`design.md` §2.2、§3.1、§4.2

- [x] 1.3 阶段检查：主舞台边界检查
  - 状态：DONE
  - 这一步到底做什么：确认页面不会退化成后台风布局，并确认会话头部信息闭环。
  - 做完你能看到什么：阶段 1 的页面骨架可以作为后续运行时接入基底。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md` 需求 1
    - `design.md` §2.1、§3.1
  - 主要改哪里：本阶段相关页面和样式文件
  - 这一步先不做什么：不引入消息同步逻辑。
  - 怎么算完成：
    1. 页面骨架通过评审
    2. 边界约束（主舞台优先）有检查记录
  - 怎么验证：
    - 评审清单核对
    - 快照对比
  - 对应需求：`requirements.md` 需求 1
  - 对应设计：`design.md` §2.1、§3.1

---

## 阶段 2：做稳消息运行时主链路

- [x] 2.1 建立消息运行时 store 和状态机
  - 状态：DONE
  - 这一步到底做什么：实现 `session-runtime-store`，覆盖历史加载、增量合并、发送状态、连接状态。
  - 做完你能看到什么：页面状态不再靠多个组件拼凑，消息运行时有统一入口。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3、需求 5
    - `design.md` §2.2、§4.1、§4.2
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-machine.ts`
  - 这一步先不做什么：不做离线本地消息持久化。
  - 怎么算完成：
    1. 支持历史分页加载和消息去重
    2. 支持连接状态机流转（含重连）
  - 怎么验证：
    - 状态机单元测试
    - 历史 + 增量合并集成测试
  - 对应需求：`requirements.md` 需求 3、需求 5
  - 对应设计：`design.md` §2.2、§4.1、§4.2、§6.1、§6.4

- [x] 2.2 接入能力门控组件并移除散落特判
  - 状态：DONE
  - 这一步到底做什么：实现 `CapabilityGate`，统一消费 `Capability Descriptor` 控制按钮可用性。
  - 做完你能看到什么：不支持的功能直接在会话头部和输入区体现，不再点了才报错。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 6
    - `design.md` §2.2、§3.2、§3.3
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/capability/capability-gate.tsx`
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - `apps/user-app/src/features/conversation/components/SessionHeader.tsx`
  - 这一步先不做什么：不做 provider 新能力接入（由 `spec010` 负责）。
  - 怎么算完成：
    1. 页面入口全部经能力门控
    2. 代码中不再散落 provider 名字判断
  - 怎么验证：
    - 静态扫描禁止模式（如 `provider ===`）检查
    - 能力矩阵用例测试
  - 对应需求：`requirements.md` 需求 2、需求 6
  - 对应设计：`design.md` §2.2、§3.2、§3.3、§6.2

- [x] 2.3 接入发送链路与失败重试
  - 状态：DONE
  - 这一步到底做什么：实现发送动作、发送中反馈、失败重试，保持消息来源一致性。
  - 做完你能看到什么：输入区发送后有明确状态，失败可重试，成功后消息归并到正式列表。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md` 需求 3、需求 6
    - `design.md` §2.3.3、§3.3、§5.3
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/ComposerPanel.tsx`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
  - 这一步先不做什么：不做附件上传、语音输入等扩展动作。
  - 怎么算完成：
    1. 发送状态三态完整
    2. 失败重试成功后不会产生重复消息
  - 怎么验证：
    - 发送链路集成测试
    - 错误注入测试
  - 对应需求：`requirements.md` 需求 3、需求 6
  - 对应设计：`design.md` §2.3.3、§3.3、§5.3、§6.1

- [x] 2.4 阶段检查：消息运行时主链路检查
  - 状态：DONE
  - 这一步到底做什么：确认“加载历史 -> 收实时 -> 发送 -> 重连补偿”主链路可用。
  - 做完你能看到什么：可以进入鉴权和异常链路收口阶段。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3、需求 5、需求 6
    - `design.md` §2.3、§4.2、§6
  - 主要改哪里：本阶段运行时和页面组件相关文件
  - 这一步先不做什么：不扩展额外 UI 功能。
  - 怎么算完成：
    1. 主链路回放通过
    2. 关键错误路径有处理记录
  - 怎么验证：
    - 主链路 E2E
    - 故障回放脚本
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 5、需求 6
  - 对应设计：`design.md` §2.3、§4.2、§6

---

## 阶段 3：鉴权、重连和验收收口

- [x] 3.1 接入页面鉴权保护与 WS 鉴权握手
  - 状态：DONE
  - 这一步到底做什么：在路由层和通信层接入鉴权保护，未登录无法触达受保护会话数据。
  - 做完你能看到什么：未登录访问会话页会被拦截，WS 未鉴权订阅无法建立。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §2.3.1、§3.3、§6.3
  - 主要改哪里：
    - `apps/user-app/src/app/router.tsx`
    - `apps/user-app/src/network/http-client.ts`
    - `apps/user-app/src/network/realtime-client.ts`
  - 这一步先不做什么：不做多角色权限系统。
  - 怎么算完成：
    1. 未登录不显示受保护数据
    2. token 失效后流程可恢复
  - 怎么验证：
    - 鉴权 E2E
    - token 过期场景集成测试
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §2.3.1、§3.3、§6.3

- [x] 3.2 完成断线重连体验与手动恢复入口
  - 状态：DONE
  - 这一步到底做什么：实现连接状态提示、自动重连、失败后手动重试入口。
  - 做完你能看到什么：弱网下用户知道系统在做什么，不会卡死在静默失败状态。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.4、§4.2、§5.3
  - 主要改哪里：
    - `apps/user-app/src/network/realtime-client.ts`
    - `apps/user-app/src/features/conversation/components/ConnectionBanner.tsx`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
  - 这一步先不做什么：不做离线编辑和离线消息排队。
  - 怎么算完成：
    1. 自动重连成功后可恢复会话流
    2. 多次失败后有明显手动恢复入口
  - 怎么验证：
    - 网络抖动模拟测试
    - 断线恢复 E2E
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.4、§4.2、§6.4

- [x] 3.3 最终检查点：spec003 验收收口
  - 状态：DONE
  - 这一步到底做什么：核对需求、设计、任务和验证证据是否一一对齐。
  - 做完你能看到什么：spec003 可以作为实现基线，不留关键边界歧义。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/README.md`
  - 主要改哪里：当前 spec 全部文档与实现关联记录
  - 这一步先不做什么：不新增新功能需求。
  - 怎么算完成：
    1. 六条功能需求均有验证证据
    2. 关键风险有结论或明确后续负责人
    3. 可把未完成项转入后续 spec，不混在本 spec 拖延
  - 怎么验证：
    - 验收清单逐项核对
    - 评审记录签字
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
