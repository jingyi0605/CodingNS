# 任务清单 - spec001.9.2 公共隧道管理员只读后台与权限通路（人话版）

状态：Draft

## 2026-04-20 进展补记

- 已启动 `spec001.9.2`
- 已确认当前 `apps/codingns-proxy` 只有用户控制台，没有管理员后台
- 已确认问题根源不是前端少几个页面，而是账号模型、鉴权和接口命名空间都没长出管理员通路
- 已确认第一版收敛为“角色模型 + 管理员鉴权 + 管理员只读后台”，不把复杂 RBAC、管理员注册和后台写操作混进来
- 已确认二期只补最小写操作：管理员解绑任意设备、停用未兑换激活码、重新启用未兑换激活码
- 已确认二期继续补“管理员在线生成激活码”，但只做页内生成和一次性结果回显，不做完整码长期存取

## 这份文档是干什么的

这份任务清单只负责把“公共隧道管理员只读后台与权限通路”拆成能执行、能验收、不会越做越脏的步骤。

还是那六个问题：

1. 这一步到底做什么
2. 做完以后能看到什么结果
3. 依赖什么
4. 主要改哪些文件
5. 这一步明确不做什么
6. 怎么验证

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

## 阶段 0：先把 spec 挂起来

- [x] 0.1 启动 `spec001.9.2` 并完成主文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec001.9.2` 目录和 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现完整的管理员后台 Spec 文档骨架，后续不再靠聊天记录记需求
  - 依赖什么：`spec001.9`、`spec001.9.1`
  - 主要改哪些文件：
    - `specs/spec001.9.2-公共隧道管理员只读后台与权限通路/*`
  - 这一步明确不做什么：不写业务代码
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec001.9.2` 主文档初始化，并写清角色模型、管理员鉴权、管理员只读接口和独立前端路由边界

- [x] 0.2 回写总览和父规格，挂上 `spec001.9.2`
  - 状态：DONE
  - 这一步到底做什么：把 `spec001.9.2` 挂到 `specs/README.md`、`spec001` 和 `spec001.9`
  - 做完以后能看到什么结果：总览和父规格都能看出“管理员后台”是独立子问题，不再隐身
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001.9-公共隧道服务接入与端到端加密远程访问/README.md`
  - 这一步明确不做什么：不改业务代码
  - 怎么验证：
    - 文档走查

---

## 阶段 1：先把角色模型和管理员鉴权长出来

- [x] 1.1 给账号补 `role` 字段和共享契约
  - 状态：DONE
  - 这一步到底做什么：给 `accounts` 增加 `role` 字段，并把 `AccountProfile`、登录响应、`me` 响应全部补上角色信息
  - 做完以后能看到什么结果：前后端都能明确区分 `user` 和 `admin`
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/database-migrations.ts`
    - `apps/codingns-proxy/apps/control-api/src/account-store.ts`
    - `apps/codingns-proxy/apps/control-api/src/state-store.ts`
    - `apps/codingns-proxy/packages/shared-contracts/src/index.ts`
    - 相关测试
  - 这一步明确不做什么：不做复杂权限树
  - 怎么验证：
    - 数据迁移测试
    - 登录 / `me` 契约测试
    - 老账号默认角色测试
  - 验证结果：
    - 已给 `accounts` 增加 `role` 迁移，默认值固定为 `user`
    - 已把 `AccountProfile`、登录响应和 `me` 响应全部补上 `role`
    - 已兼容旧 file-state 数据，旧账号会自动回填为 `user`

- [x] 1.2 新增 `requireAdmin()` 和管理员路由骨架
  - 状态：DONE
  - 这一步到底做什么：在 `control-api` 新增管理员鉴权和 `/api/admin/*` 路由骨架
  - 做完以后能看到什么结果：管理员接口有独立入口，普通用户访问管理员接口会被明确拒绝
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/app.ts`
    - `apps/codingns-proxy/packages/shared-contracts/src/index.ts`
    - 相关测试
  - 这一步明确不做什么：不先写全量后台 SQL
  - 怎么验证：
    - admin 访问返回 `200`
    - user 访问返回 `403`
    - 未登录访问返回 `401`
  - 验证结果：
    - 已在 `control-api` 增加 `requireAdmin()`
    - 已新增 `/api/admin/accounts`、`/api/admin/bindings`、`/api/admin/activation-codes`、`/api/admin/logs/payment-events`、`/api/admin/logs/relay-usage`
    - 已补测试覆盖 `401 / 403 / 200`

---

## 阶段 2：补齐管理员只读数据查询

- [x] 2.1 实现账号和绑定列表读模型
  - 状态：DONE
  - 这一步到底做什么：新增独立管理员读模型，先支持全局账号列表和绑定列表
  - 做完以后能看到什么结果：管理员可以直接看全局账号和设备绑定，不再只能查当前账号自己的数据
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/admin-store.ts`
    - `apps/codingns-proxy/apps/control-api/src/app.ts`
    - `apps/codingns-proxy/packages/shared-contracts/src/index.ts`
    - 相关测试
  - 这一步明确不做什么：不改现有 `binding-store.ts` 用户语义
  - 怎么验证：
    - 账号列表测试
    - 绑定列表测试
    - 筛选参数测试
  - 验证结果：
    - 已新增独立管理员读模型 `admin-store.ts`
    - 已支持全局账号列表与绑定列表查询
    - 已保持现有用户 `binding-store.ts` 语义不变

- [x] 2.2 实现激活码、支付事件和 relay usage 列表
  - 状态：DONE
  - 这一步到底做什么：补全管理员后台另外三类只读查询
  - 做完以后能看到什么结果：运营能在后台看激活码状态、支付事件和 relay usage
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/admin-store.ts`
    - `apps/codingns-proxy/apps/control-api/src/app.ts`
    - `apps/codingns-proxy/packages/shared-contracts/src/index.ts`
    - 相关测试
  - 这一步明确不做什么：不做后台写操作
  - 怎么验证：
    - 激活码列表测试
    - 支付事件列表测试
    - relay usage 列表测试
  - 验证结果：
    - 已补齐激活码、支付事件和 relay usage 的管理员只读接口
    - 已补后端测试，管理员可直接查看全局运营数据

---

## 阶段 3：补管理员前端路由和页面

- [x] 3.1 补浏览器 session 角色兼容和管理员路由壳
  - 状态：DONE
  - 这一步到底做什么：让前端 session 支持 `role`，兼容旧 session，并增加 `/admin/*` 路由壳
  - 做完以后能看到什么结果：管理员登录后会进入后台，普通用户继续进 `/dashboard`
  - 依赖什么：1.1、1.2
  - 开始前必须先阅读：
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/console-web/src/auth-store.ts`
    - `apps/codingns-proxy/apps/console-web/src/control-api-client.ts`
    - `apps/codingns-proxy/apps/console-web/src/App.tsx`
    - 相关测试
  - 这一步明确不做什么：不把管理员页面塞进 `DashboardPage.tsx`
  - 怎么验证：
    - admin 登录跳转测试
    - user 登录跳转测试
    - 旧 session 兼容测试
  - 验证结果：
    - 浏览器 session 已支持 `role`
    - 旧 session 缺 `role` 时会自动补拉 `/api/v1/auth/me`
    - 管理员登录后默认进入 `/admin/users`，普通用户继续进入 `/dashboard`

- [x] 3.2 实现管理员只读页面
  - 状态：DONE
  - 这一步到底做什么：实现用户、设备、激活码、支付事件、relay usage 五个管理员页面
  - 做完以后能看到什么结果：后台页面能直接看全局列表，不再只有 API
  - 依赖什么：2.2、3.1
  - 开始前必须先阅读：
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/console-web/src/pages/admin/*`
    - `apps/codingns-proxy/apps/console-web/src/i18n.ts`
    - `apps/codingns-proxy/apps/console-web/src/styles.css`
    - 相关测试
  - 这一步明确不做什么：不做复杂图表大盘，不做后台写操作按钮
  - 怎么验证：
    - 页面路由走查
    - 列表加载测试
    - 权限跳转测试
  - 验证结果：
    - 已新增用户、设备、激活码、支付事件、relay usage 五个管理员页面
    - 页面文案已接入现有 i18n
    - 页面布局按现有控制台基线扩展，没有把管理员内容塞回用户首页

---

## 阶段 4：回归验证和文档收口

- [x] 4.1 补齐后端回归和兼容验证
  - 状态：DONE
  - 这一步到底做什么：补管理员权限和用户兼容测试，确保新功能不破坏旧链路
  - 做完以后能看到什么结果：普通用户控制台继续正常，管理员接口权限边界清楚
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/app.test.ts`
    - 相关测试文件
  - 这一步明确不做什么：不替代人工联调
  - 怎么验证：
    - 测试通过
  - 验证结果：
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/control-api test`
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/control-api build`

- [x] 4.2 补齐前端验证和使用说明
  - 状态：DONE
  - 这一步到底做什么：补管理员前端测试，并回写使用说明或补充文档
  - 做完以后能看到什么结果：管理员后台的入口、边界和验证方式都能被别人接手
  - 依赖什么：3.2、4.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/console-web/src/App.test.tsx`
    - `apps/codingns-proxy/apps/console-web/src/pages/admin/*.test.tsx`
    - `apps/codingns-proxy/apps/console-web/README.md`
    - 如有必要，再补 `specs/spec001.9.2-公共隧道管理员只读后台与权限通路/docs/*`
  - 这一步明确不做什么：不额外扩需求
  - 怎么验证：
    - 测试通过
    - 文档走查
  - 验证结果：
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/console-web test`
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/console-web build`
    - 已更新 `apps/codingns-proxy/apps/console-web/README.md` 和 `apps/codingns-proxy/apps/control-api/README.md`

---

## 阶段 5：补二期最小写操作

- [x] 5.1 补管理员解绑设备和激活码状态切换接口
  - 状态：DONE
  - 这一步到底做什么：在独立管理员命名空间里补最小写接口，只支持解绑任意设备、停用激活码和重新启用未兑换激活码
  - 做完以后能看到什么结果：管理员不再只能看列表，还能直接处理设备解绑和激活码停用问题
  - 依赖什么：4.2
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/app.ts`
    - `apps/codingns-proxy/apps/control-api/src/binding-store.ts`
    - `apps/codingns-proxy/apps/control-api/src/traffic-wallet-store.ts`
    - `apps/codingns-proxy/apps/control-api/src/persistence.ts`
    - `apps/codingns-proxy/packages/shared-contracts/src/index.ts`
    - 相关测试
  - 这一步明确不做什么：不做手工加量、不做账号封禁、不做角色升降
  - 怎么验证：
    - 管理员解绑设备测试
    - 管理员停用 / 启用激活码测试
    - 已兑换激活码拒绝修改测试
    - build 通过
  - 验证结果：
    - 已新增 `DELETE /api/admin/bindings/:bindingId`
    - 已新增 `POST /api/admin/activation-codes/:activationCodeId/disable`
    - 已新增 `POST /api/admin/activation-codes/:activationCodeId/enable`
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/control-api test`
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/control-api build`

- [x] 5.2 补管理员前端写操作按钮和回归验证
  - 状态：DONE
  - 这一步到底做什么：在设备页和激活码页加最小写操作按钮、确认交互和成功反馈
  - 做完以后能看到什么结果：管理员可在浏览器里直接解绑设备、停用激活码和重新启用未兑换激活码
  - 依赖什么：5.1
  - 开始前必须先阅读：
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/console-web/src/control-api-client.ts`
    - `apps/codingns-proxy/apps/console-web/src/pages/admin/AdminBindingsPage.tsx`
    - `apps/codingns-proxy/apps/console-web/src/pages/admin/AdminActivationCodesPage.tsx`
    - `apps/codingns-proxy/apps/console-web/src/i18n.ts`
    - `apps/codingns-proxy/apps/console-web/src/styles.css`
    - `apps/codingns-proxy/apps/console-web/src/App.test.tsx`
  - 这一步明确不做什么：不新做后台弹窗系统，不扩展到用户页，不改用户 Dashboard
  - 怎么验证：
    - 设备页解绑交互测试
    - 激活码页停用 / 启用交互测试
    - build 通过
  - 验证结果：
    - 已在设备页增加“解除绑定”按钮和成功反馈
    - 已在激活码页增加“停用激活码 / 重新启用”按钮和成功反馈
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/console-web test`
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/console-web build`

- [x] 5.3 补管理员在线生成激活码
  - 状态：DONE
  - 这一步到底做什么：在管理员激活码页增加在线生成表单，并在管理员接口补生成入口，支持按数量、规格、批次标签和可选过期天数生成激活码
  - 做完以后能看到什么结果：管理员可以直接在浏览器里生成一批激活码，当前页一次性拿到完整码，后台列表同时出现对应掩码记录
  - 依赖什么：5.1、5.2
  - 开始前必须先阅读：
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
  - 主要改哪些文件：
    - `apps/codingns-proxy/packages/shared-contracts/src/index.ts`
    - `apps/codingns-proxy/apps/control-api/src/app.ts`
    - `apps/codingns-proxy/apps/control-api/src/app.test.ts`
    - `apps/codingns-proxy/apps/console-web/src/control-api-client.ts`
    - `apps/codingns-proxy/apps/console-web/src/pages/admin/AdminActivationCodesPage.tsx`
    - `apps/codingns-proxy/apps/console-web/src/i18n.ts`
    - `apps/codingns-proxy/apps/console-web/src/styles.css`
    - `apps/codingns-proxy/apps/console-web/src/App.test.tsx`
  - 这一步明确不做什么：不把完整激活码写回长期列表，不做导出，不做新的弹窗系统
  - 怎么验证：
    - 管理员在线生成激活码接口测试
    - 激活码页生成交互测试
    - `console-web` build 通过
    - `control-api` test/build 通过
  - 验证结果：
    - 已新增 `POST /api/admin/activation-codes/generate`
    - 已在管理员激活码页增加在线生成表单和一次性完整结果区
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/control-api test`
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/control-api build`
    - 已通过 `pnpm --dir apps/codingns-proxy/apps/console-web build`
