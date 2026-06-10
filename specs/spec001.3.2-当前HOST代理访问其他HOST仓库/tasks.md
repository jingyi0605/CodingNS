# 任务清单 - spec001.3.2 当前HOST代理访问其他HOST仓库（人话版）

状态：IN_REVIEW

## 2026-06-09 进展补记

- 已启动 `spec001.3.2`
- 已明确这次不是继续做 HOST 切换，而是让当前 HOST 作为受控代理访问其他 HOST
- 已明确目标 HOST 必须局域网可达、版本一致、API 兼容
- 已明确前端不保存目标 HOST token，只传 `targetHostId`
- 已明确工作区视图必须使用 `hostId + workspaceId`，不能再假设 `workspaceId` 全局唯一


## 2026-06-09 实现补记

- 后端已新增 Peer HOST 配置、握手检查、目标 HOST 登录态保存和受控 HTTP 代理。
- 代理白名单已按“请求方法 + 路径”检查，不再只靠路径放行。
- 前端 `httpClient` 已支持 `targetHostId`，代理请求仍只连当前 HOST。
- 工作区引用已开始使用 `hostId + workspaceId`，缓存 key 和列表 key 避免跨 HOST 冲突。
- 移动端工作区切换入口已有最小接入：能显示 HOST/工作区来源，不可用或暂不支持直接打开的远端项会给提示。
- WebSocket 代理已补上，并已放开远程终端流；完整远端工作区实时刷新已通过 Workbench 实时客户端的 `targetHostId` 链路接入，仍建议真实双 HOST 环境做手动验收。

本轮最小验证：

```bash
pnpm --dir apps/host exec tsc --noEmit --pretty false
pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json
pnpm --dir apps/host test -- tests/integration/peer-host-routes.test.ts
pnpm --dir apps/user-app test -- src/network/http-client.test.ts src/features/workbench/utils/workbench-navigation-snapshot.test.ts
NODE_ENV=test pnpm --dir apps/user-app test src/features/mobile-shell/components/MobileWorkspaceSwitcherHeader.test.tsx
pnpm check:sqlite-runtime
```

说明：`MobileWorkspaceSwitcherHeader.test.tsx` 普通环境之前出现过 React production act 报错；加 `NODE_ENV=test` 后通过。


## 2026-06-09 第二轮实现补记

- 第二轮曾新增设置页 Peer HOST 管理面板；第三轮已按最新要求取消该入口，Peer HOST 管理迁移到顶部 HOST 连接列表。
- 移动端工作区切换会真实拉取其他 HOST 的工作区，不再只靠旧缓存。
- 点击 Peer HOST 工作区会携带 `hostId + workspaceId`，URL 通过 `targetHostId` 保留目标 HOST。
- Workbench 实时客户端和会话实时客户端都支持 `targetHostId`，通过当前 HOST 的窄口 WS 代理连接目标 HOST。
- 后端新增 `/api/host-proxy/hosts/:peerHostId/ws`，现在会转发工作台、文件树、Git、工作区管理、终端管理、会话实时消息和远程终端流。
- 仍需真实双 HOST 环境做手动验收，确认局域网可达、版本一致和目标登录态实际可用。

本轮最小验证：

```bash
pnpm --dir apps/host exec tsc --noEmit --pretty false
pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json
NODE_ENV=test pnpm --dir apps/user-app test src/features/mobile-shell/components/MobileWorkspaceSwitcherHeader.test.tsx src/network/workbench-realtime-client.test.ts src/network/realtime-client.test.ts
```

## 2026-06-09 第三轮实现补记

- 已按最新要求取消“设置页 Peer HOST 管理”方向，Peer HOST 开关迁移到顶部 HOST 连接列表。
- 顶部 HOST 列表现在以当前 HOST 为主 HOST，其他已保存 HOST 可编辑 4 字以内别名，并在通过检查和登录后启用为 Peer HOST。
- 启用 Peer HOST 前会走当前主 HOST 的后端检查：网络可达、版本/API 兼容、目标账号登录可用；目标 HOST 密码只用于本次登录检查，不保存到主 HOST，也不再复用前端本地记住的密码。
- WebSocket 代理已放开远程终端流：`terminal.subscribe`、`terminal.input`、`terminal.resize` 和对应输出/状态消息可以通过 Peer HOST 代理转发。
- 项目管理窗口已支持为项目选择使用的 HOST，只列当前主 HOST 和已启用 Peer HOST；项目名旁边显示 HOST 别名标签。
- 工作区侧栏和项目管理窗口都显示 HOST 标签，标签颜色按 HOST 稳定分配，标签文字来自 HOST 连接记录里的别名。

本轮最小验证：

```bash
pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json --pretty false
pnpm --dir apps/host exec tsc --noEmit --pretty false
pnpm --dir apps/host test tests/integration/peer-host-ws-proxy.test.ts
pnpm check:sqlite-runtime
```

说明：按“不要一直卡在测试阶段”的要求，本轮只跑类型检查、SQLite 禁用检查和 WS 终端代理最小测试，没有跑全量测试。


## 这份文档是干什么的

这份任务清单把“当前 HOST 代理访问其他 HOST 仓库”拆成可以一步步做完的任务。

每一步都要让人一眼看懂：

1. 这一步到底做什么
2. 做完以后能看到什么结果
3. 这一步依赖什么
4. 主要改哪些文件
5. 这一步明确不做什么
6. 怎么验证是不是真的做完了

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并验证
- `CANCELLED`：取消并写原因

规则：

- 只有 `状态：DONE` 的任务才能勾成 `[x]`
- 每做完一个任务，都要立刻回写这份文档
- `BLOCKED` 和 `CANCELLED` 必须写清楚原因

---

## 阶段 0：先把范围和文档立住

- [x] 0.1 启动 spec001.3.2 并完成主文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec001.3.2` 目录，写清需求、设计和任务拆分
  - 做完以后能看到什么结果：仓库里有完整的 `spec001.3.2` 文档，别人能看懂这次是“当前 HOST 代理其他 HOST”，不是继续改 HOST 切换
  - 依赖什么：用户确认继续推进 Spec 流程
  - 主要改哪些文件：
    - `specs/spec001.3.2-当前HOST代理访问其他HOST仓库/README.md`
    - `specs/spec001.3.2-当前HOST代理访问其他HOST仓库/requirements.md`
    - `specs/spec001.3.2-当前HOST代理访问其他HOST仓库/design.md`
    - `specs/spec001.3.2-当前HOST代理访问其他HOST仓库/tasks.md`
    - `specs/spec001.3.2-当前HOST代理访问其他HOST仓库/docs/README.md`
  - 这一步明确不做什么：不写业务代码，不改 API，不改数据库
  - 怎么验证：
    - 人工走查文档
  - 验证结果：
    - 已完成文档初始化

- [x] 0.2 回写父规格和总览，挂上 spec001.3.2
  - 状态：DONE
  - 这一步到底做什么：把 `spec001.3.2` 加到 `specs/README.md` 和 `spec001` 父规格说明里
  - 做完以后能看到什么结果：从规格总览能找到这个新子规格，并知道它和 `spec001.3`、`spec001.3.1` 的边界
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 这一步明确不做什么：不改 `spec001.3` 已有单激活 HOST 设计
  - 怎么验证：
    - `grep -n "spec001.3.2" specs/README.md specs/spec001-平台底座与工作区基础/README.md specs/spec001-平台底座与工作区基础/design.md specs/spec001-平台底座与工作区基础/tasks.md`
  - 验证结果：
    - 已回写总览和父规格引用

---

## 阶段 1：后端先有 Peer HOST 真相

- [x] 1.1 建 Peer HOST 存储和基础接口
  - 状态：DONE
  - 这一步到底做什么：在 Host 数据库里保存当前用户的 Peer HOST 配置，并提供增删改查接口
  - 做完以后能看到什么结果：当前 HOST 可以保存其他 HOST 地址，但还不代理业务 API
  - 依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 6
    - `design.md` §3.1、§4.2、§6.1
  - 主要改哪些文件：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/*peer-host*`
    - `apps/host/src/modules/*peer-host*`
    - `apps/host/src/routes/*peer-host*`
    - `apps/host/src/server/create-server.ts`
  - 这一步明确不做什么：不保存目标 HOST token，不做代理转发，不做前端页面
  - 怎么算完成：
    1. Peer HOST 能按当前用户保存和查询
    2. 同一个用户下相同地址不能重复保存
    3. 删除 Peer HOST 后列表不再展示
  - 怎么验证：
    - `pnpm test:related -- apps/host/src/storage/repositories/*peer-host* apps/host/src/modules/*peer-host*`
  - 对应需求：`requirements.md` 需求 1、需求 6
  - 对应设计：`design.md` §3.1、§4.2、§6.1

- [x] 1.2 增加 HOST 握手和版本一致检查
  - 状态：DONE
  - 这一步到底做什么：给每个 HOST 暴露轻量握手接口，并在检查 Peer HOST 时确认产品、版本和 API 兼容标识一致
  - 做完以后能看到什么结果：不可达或版本不一致的 Peer HOST 会被明确标记，不能进入可代理状态
  - 依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2
    - `design.md` §4.1、§6.2、§7.3
  - 主要改哪些文件：
    - `apps/host/src/modules/client/client-service.ts`
    - `apps/host/src/modules/client/client-controller.ts`
    - `apps/host/src/routes/public.ts`
    - `apps/host/src/modules/*peer-host*`
  - 这一步明确不做什么：不做登录态保存，不做业务 API 代理
  - 怎么算完成：
    1. `/api/public/host-handshake` 返回版本和 API 兼容标识
    2. Peer HOST 检查能识别同版本、不可达、版本不一致
    3. 版本不一致时代理状态不可用
  - 怎么验证：
    - `pnpm test:related -- apps/host/src/modules/client/client-service.ts apps/host/src/modules/*peer-host*`
  - 对应需求：`requirements.md` 需求 2
  - 对应设计：`design.md` §4.1、§6.2、§7.3

- [x] 1.3 保存和刷新目标 HOST 登录态
  - 状态：DONE
  - 这一步到底做什么：当前 HOST 代用户登录目标 HOST，并把目标 HOST token 安全保存在后端
  - 做完以后能看到什么结果：前端不拿目标 HOST token，当前 HOST 能用目标 HOST 会话发起后端请求
  - 依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 4
    - `design.md` §3.2、§4.2、§6.3、§7.1
  - 主要改哪些文件：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/*peer-host-session*`
    - `apps/host/src/modules/*peer-host-auth*`
    - `apps/host/src/modules/auth/*`
  - 这一步明确不做什么：不把目标 HOST token 返回给前端，不接工作区页面
  - 怎么算完成：
    1. Peer HOST 登录成功后后端有可用会话
    2. token 过期时能刷新
    3. 目标 HOST 会话失效只影响该 Peer HOST
  - 怎么验证：
    - `pnpm test:related -- apps/host/src/storage/repositories/*peer-host-session* apps/host/src/modules/*peer-host-auth*`
  - 对应需求：`requirements.md` 需求 4
  - 对应设计：`design.md` §3.2、§6.3、§7.1

---

## 阶段 2：做受控 API 代理，不做任意转发器

- [x] 2.1 实现 HTTP 代理服务和路径白名单
  - 状态：DONE
  - 这一步到底做什么：新增当前 HOST 到 Peer HOST 的受控 HTTP 代理，只允许仓库操作主链路
  - 做完以后能看到什么结果：通过当前 HOST 可以请求目标 HOST 的 `/api/workspaces`、Git、文件、会话等白名单 API
  - 依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3、需求 6、需求 7
    - `design.md` §4.3、§4.4、§6.3、§7.4
  - 主要改哪些文件：
    - `apps/host/src/modules/*host-api-proxy*`
    - `apps/host/src/routes/*host-api-proxy*`
    - `apps/host/src/server/create-server.ts`
  - 这一步明确不做什么：不支持任意 URL，不代理所有 `/api/*`，不做 WebSocket
  - 怎么算完成：
    1. 白名单路径能代理成功
    2. 非白名单路径会被拒绝
    3. 版本不一致、未登录目标 HOST、不可达都会返回明确错误
  - 怎么验证：
    - `pnpm test:related -- apps/host/src/modules/*host-api-proxy* apps/host/src/routes/*host-api-proxy*`
  - 对应需求：`requirements.md` 需求 3、需求 6、需求 7
  - 对应设计：`design.md` §4.3、§4.4、§6.3、§7.4

- [x] 2.2 前端 API 客户端支持 `targetHostId`
  - 状态：DONE
  - 这一步到底做什么：改造 `httpClient`，调用方传 `targetHostId` 时自动走当前 HOST 代理入口
  - 做完以后能看到什么结果：页面 API 不需要知道目标 HOST `baseUrl`，只传目标 HOST ID
  - 依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §5.1
  - 主要改哪些文件：
    - `apps/user-app/src/network/http-client.ts`
    - `apps/user-app/src/network/http-client.test.ts`
  - 这一步明确不做什么：不改所有业务 API 调用，不做页面展示
  - 怎么算完成：
    1. 无 `targetHostId` 时现有请求完全不变
    2. 有 `targetHostId` 时请求路径被改写到 `/api/host-proxy/hosts/:targetHostId/...`
    3. 代理请求失败不会清空当前 HOST 登录态
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- src/network/http-client.test.ts`
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §5.1

---

## 阶段 3：工作区视图接入 HOST 作用域

- [x] 3.1 建立 `WorkspaceRef` 和 scoped workspace API
  - 状态：DONE
  - 这一步到底做什么：给工作区 API 增加带 HOST 归属的封装，避免页面直接拼代理参数
  - 做完以后能看到什么结果：代码里能用 `hostId + workspaceId` 表达一个工作区
  - 依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §3.3、§3.4、§5.2、§7.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/features/workbench/utils/*`
    - 相关测试
  - 这一步明确不做什么：不大改页面布局，不接 WebSocket 代理
  - 怎么算完成：
    1. 当前 HOST 工作区和 Peer HOST 工作区都有统一引用结构
    2. 缓存 key 和 React key 不再裸用跨 HOST `workspaceId`
    3. 同 ID 工作区在不同 HOST 下不会冲突
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/conversation/api/conversation-api.ts apps/user-app/src/features/workbench/utils`
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §3.3、§3.4、§5.2、§7.2

- [x] 3.2 工作区视图展示 Peer HOST 仓库
  - 状态：DONE
  - 这一步到底做什么：在工作区视图里展示 Peer HOST 分组和远端仓库，并把点击后的操作目标落到对应 HOST
  - 做完以后能看到什么结果：用户能看到某个仓库来自哪台 HOST，也能切换不同 HOST 下的同类仓库
  - 依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5、需求 7
    - `design.md` §5.3
    - 前端页面规范文档
  - 主要改哪些文件：
    - `apps/user-app/src/features/workbench/components/*`
    - `apps/user-app/src/features/conversation/*`
    - `apps/user-app/src/i18n/*`
  - 这一步明确不做什么：不做跨 HOST 全局搜索，不做远端 HOST 管理复杂页面
  - 怎么算完成：
    1. 工作区树能显示 HOST 来源
    2. 目标 HOST 不可用时有明确状态
    3. 点击远端工作区后，后续 API 带 `targetHostId`
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/workbench/components apps/user-app/src/features/conversation`
  - 对应需求：`requirements.md` 需求 5、需求 7
  - 对应设计：`design.md` §5.3

---

## 阶段 4：必要实时链路和验收

- [x] 4.1 评估并接入必要 WebSocket 代理
  - 状态：DONE
  - 这一步到底做什么：只给确实需要实时能力的远端仓库场景接 WebSocket 代理
  - 做完以后能看到什么结果：远端会话或工作台需要实时刷新时，不再只能靠手动刷新
  - 依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §4.5
    - 后台任务规范文档
  - 主要改哪些文件：
    - `apps/host/src/modules/*host-api-proxy*`
    - `apps/user-app/src/network/*realtime*`
  - 这一步明确不做什么：不代理所有 WebSocket 消息，不做跨 HOST 全量实时聚合
  - 怎么算完成：
    1. 明确哪些消息类型需要代理
    2. 未允许的消息类型会被拒绝
    3. 断线错误能显示目标 HOST 信息
  - 怎么验证：
    - `pnpm test:related -- apps/host/src/modules/*host-api-proxy* apps/user-app/src/network`
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §4.5

- [ ] 4.2 主流程验收
  - 状态：IN_REVIEW
  - 这一步到底做什么：验证从添加 Peer HOST 到操作远端仓库的完整流程
  - 做完以后能看到什么结果：这套机制不是纸面设计，能跑通真实主链路
  - 依赖什么：4.1
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪些文件：
    - 自动化测试
    - 验收记录文档
  - 这一步明确不做什么：不追加新能力，不扩大代理范围
  - 怎么算完成：
    1. 同版本 Peer HOST 可添加、可登录、可代理
    2. 版本不一致 Peer HOST 被阻断
    3. 当前 HOST 和目标 HOST 登录态互不污染
    4. 同名或同 ID 工作区不会串
  - 怎么验证：
    - 最小相关测试命令
    - 手动验收清单
  - 对应需求：全部需求
  - 对应设计：全部设计
