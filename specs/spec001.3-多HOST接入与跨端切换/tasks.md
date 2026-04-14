# 任务清单 - spec001.3 多HOST接入与跨端切换（人话版）

状态：Draft

## 2026-04-14 进展补记

- 已启动 `spec001.3`
- 已明确这次只做“单激活 HOST，多 HOST 可切换”，不做多 HOST 同时在线聚合
- 已确认桌面端入口固定放在收起按钮和通知按钮之间
- 已确认移动端入口复用顶部工作区切换器，展示 `HOST -> 工作区` 树
- 已确认 HOST 维度的登录态保存必须一起设计，不能把它留到实现时碰运气

## 这份文档是干什么的

这份任务清单只负责把“多 HOST”拆成能执行、能验收、不会越做越歪的步骤。

要求很简单：

1. 每一步到底建什么
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

## 阶段 0：先把范围、入口和边界钉死

- [x] 0.1 启动 spec001.3 并完成主文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec001.3` 目录和 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.3` 文档骨架，任何人都知道这次要解决的是多 HOST，不是泛化“环境配置”
  - 依赖什么：`spec001`
  - 主要改哪些文件：
    - `specs/spec001.3-多HOST接入与跨端切换/*`
  - 这一步明确不做什么：不写业务代码
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec001.3` 主文档初始化，并写清桌面端、移动端入口和 HOST 登录态边界

- [x] 0.2 回写父规格和总览，挂上 spec001.3
  - 状态：DONE
  - 这一步到底做什么：把 `spec001.3` 挂到 `spec001` 和 `specs/README.md`，避免后续继续把多 HOST 需求塞回父规格正文里
  - 做完以后能看到什么结果：总览和父规格都能看出 `spec001.3` 是独立子问题
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 这一步明确不做什么：不改 `spec001` 主体需求
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已在总览和父规格里补上 `spec001.3` 的职责说明

---

## 阶段 1：先把配置真相和迁移规则立住

- [x] 1.1 把单 `hostBaseUrl` 升级成多 HOST Profile 配置
  - 状态：DONE
  - 这一步到底做什么：把前端运行时配置和桌面壳配置从单 host 字符串升级为 `hosts[] + activeHostId`
  - 做完以后能看到什么结果：前端终于有正式的多 HOST 真相，而不是一堆地址历史
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/user-app/src/config/client-config-types.ts`
    - `apps/user-app/src/config/client-config-service.ts`
    - `apps/user-app/src/config/client-config-store.ts`
    - `apps/user-app/src/config/server-config.ts`
    - `apps/user-app/src-tauri/src/config.rs`
    - `apps/desktop/src-tauri/src/config.rs`
  - 这一步明确不做什么：先不改 UI
  - 怎么验证：
    - 单元测试
    - 旧配置迁移测试
  - 验证结果：
    - 已完成 `ClientRuntimeConfig`、`client-config-service`、`client-config-store`、`server-config`、`env` 和双 Tauri 配置桥改造
    - 已确认兼容层仍然通过“当前激活 HOST 视图”给登录页和设置页提供单地址编辑能力
    - 已通过 `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
    - 已通过 `pnpm --dir apps/user-app exec vitest run src/config/client-config-service.test.ts src/config/server-config.test.ts`
    - 已通过 `cargo test --manifest-path apps/user-app/src-tauri/Cargo.toml config::tests`

- [ ] 1.2 定义旧配置迁移和默认 HOST 生成规则
  - 状态：DONE
  - 这一步到底做什么：兼容旧 `hostBaseUrl`、旧登录态、旧 remember password，统一迁移成默认 HOST
  - 做完以后能看到什么结果：老用户升级后不会凭空丢配置
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/user-app/src/config/*`
    - `apps/user-app/src/features/auth/store/*`
    - 相关测试
  - 这一步明确不做什么：先不做多 HOST UI
  - 怎么验证：
    - 迁移测试
    - 回归测试
  - 验证结果：
    - 已完成旧 `client-runtime-config.hostBaseUrl -> hosts[] + activeHostId`
    - 已完成旧 `codingns.auth.session` -> HOST 级会话映射迁移
    - 已完成旧 `codingns.auth.remembered-login` -> HOST 级凭据映射迁移
    - 已通过迁移测试和登录页回归测试

---

## 阶段 2：把 HOST 级认证数据隔离开

- [x] 2.1 按 HOST 保存和读取登录态
  - 状态：DONE
  - 这一步到底做什么：把 `authStore` 从单会话改成按 HOST 保存，当前使用会话取决于 `activeHostId`
  - 做完以后能看到什么结果：两个 HOST 的 token 不会互相覆盖
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/auth/store/auth-store.ts`
    - `apps/user-app/src/auth/auth-gateway.ts`
    - 相关测试
  - 这一步明确不做什么：不改后端认证协议
  - 怎么验证：
    - 多 HOST 登录/退出测试
    - refresh 流程测试
  - 验证结果：
    - 已把 `authStore` 升级为 HOST 级 `sessionMap`
    - `activeHostId` 变化时会自动切换当前认证上下文
    - `logout`/`401`/`BOOTSTRAP_REQUIRED` 只清当前 HOST，会保留其他 HOST 会话
    - 已通过 `auth-store.test.ts`、`http-client.test.ts`、`workbench-realtime-client.test.ts`、`terminal-realtime-client.test.ts`

- [x] 2.2 按 HOST 保存和读取 remember password
  - 状态：DONE
  - 这一步到底做什么：把 remember password 从单条记录改成按 HOST 保存
  - 做完以后能看到什么结果：登录页能根据当前 HOST 回填对应账号密码
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/auth/store/remembered-login.ts`
    - `apps/user-app/src/features/auth/pages/LoginPage.tsx`
    - 相关测试
  - 这一步明确不做什么：不做跨账号密码管理
  - 怎么验证：
    - remember password 测试
    - 登录页回填测试
  - 验证结果：
    - 已把 remember password 升级为 HOST 级凭据映射
    - 登录页会按当前 HOST 读取和保存凭据
    - 旧单条 remember password 会迁移到当前 HOST，并保留一次性旧地址兼容信息
    - 已通过 `remembered-login.test.ts`、`LoginPage.test.tsx`

---

## 阶段 3：把 HOST 切换事务做干净

- [x] 3.1 实现统一的 `switchHost(hostId)` 协调器
  - 状态：DONE
  - 这一步到底做什么：建立 HOST 切换事务，统一处理探活、切换配置、认证上下文切换和运行时重建
  - 做完以后能看到什么结果：切 HOST 不再是“改个字符串赌命”
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/config/*`
    - `apps/user-app/src/network/*`
    - `apps/user-app/src/app/*`
    - 必要的新协调器文件
  - 这一步明确不做什么：先不接桌面和移动端 UI
  - 怎么验证：
    - HOST 切换集成测试
    - HTTP / WebSocket 地址切换测试
  - 验证结果：
    - 已新增 `host-switch-coordinator`，统一执行目标 HOST 校验、探活和 `activeHostId` 切换
    - 探活失败时会保持原 HOST 不变
    - 已通过 `host-switch-coordinator.test.ts`，确认切换后 `getHostBaseUrl()` / `getHostWebSocketUrl()` 一起切到目标 HOST

- [x] 3.2 建立运行时边界重建机制
  - 状态：DONE
  - 这一步到底做什么：让 HOST 切换后工作台、会话、终端、Butler 等运行时整体重建
  - 做完以后能看到什么结果：不会出现旧 HOST socket 和新 HOST 请求混用
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/user-app/src/app/App.tsx`
    - `apps/user-app/src/app/router.tsx`
    - 运行时相关 store / client
  - 这一步明确不做什么：不重写业务页面
  - 怎么验证：
    - 工作台回归测试
    - 终端/会话切换测试
  - 验证结果：
    - 已新增 `host-runtime-store`，在 `activeHostId` 变化时自动 bump runtime key
    - 已把认证后路由树挂到 runtime boundary key 下，HOST 切换时整棵已登录运行时子树会重建
    - 已通过 `host-runtime-store.test.tsx`，确认 HOST 变化时边界 key 会递增更新

---

## 阶段 4：接桌面端入口

- [x] 4.1 桌面端顶部 HOST 快速切换器落位
  - 状态：DONE
  - 这一步到底做什么：在桌面端标题栏区接入 HOST 快速切换器，位置固定为收起按钮和通知按钮之间
  - 做完以后能看到什么结果：桌面端主界面可以直接切 HOST
  - 依赖什么：3.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/workbench/*`
    - 桌面端标题栏相关组件
    - 相关样式文件
  - 这一步明确不做什么：不把 HOST 管理塞进设置页代替顶部入口
  - 怎么验证：
    - 组件测试
    - 桌面端手动验收
  - 验证结果：
    - 已新增桌面端 `WorkbenchHostSwitcher`，并接到左侧标题栏和收起态 rail
    - 已确认入口顺序固定为“收起按钮 -> HOST 切换器 -> 通知按钮”
    - 已通过 `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/WorkbenchLayout.test.tsx -t "HOST 切换器"`

- [x] 4.2 桌面端 HOST 管理弹层和新增入口
  - 状态：DONE
  - 这一步到底做什么：补齐切换器下拉内容，包括 HOST 列表、当前激活态和新增 HOST 入口
  - 做完以后能看到什么结果：用户不必手输地址才能维护多个 HOST
  - 依赖什么：4.1
  - 主要改哪些文件：
    - HOST 切换器组件
    - 设置页或独立弹层组件
    - i18n 字典
  - 这一步明确不做什么：不做复杂批量管理
  - 怎么验证：
    - 组件测试
    - 手动验收
  - 验证结果：
    - 已在桌面端切换器弹层里补齐 HOST 列表、当前激活态和新增 HOST 表单
    - 已在登录和切 HOST 时同步更新 `lastConnectedAt` / `lastUsername`，让列表状态可用
    - 已通过 `pnpm --dir apps/user-app exec vitest run src/features/workbench/components/WorkbenchHostSwitcher.test.tsx`

---

## 阶段 5：接移动端入口

- [x] 5.1 移动端顶部工作区切换器改成 HOST 树
  - 状态：DONE
  - 这一步到底做什么：把顶部工作区切换器升级成 `HOST -> 工作区` 树状结构
  - 做完以后能看到什么结果：用户在一个入口里就能看到 HOST 和工作区
  - 依赖什么：3.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/mobile-*`
    - `apps/user-app/src/features/workbench/*`
    - 相关 i18n 和样式
  - 这一步明确不做什么：不重写整套移动端导航架构
  - 怎么验证：
    - 组件测试
    - 移动端手动验收
  - 验证结果：
    - 已把 `MobileWorkspaceSwitcherHeader` 升级成 `HOST -> 工作区` 树，当前 HOST 走实时导航，其余 HOST 走按 HOST 隔离的导航快照
    - 已支持“无工作区 HOST”时继续显示 HOST 标题和地址，不会把头部入口直接消掉
    - 已通过 `pnpm --dir apps/user-app exec vitest run src/features/mobile-shell/components/MobileWorkspaceSwitcherHeader.test.tsx`

- [x] 5.2 接通 HOST 切换与工作区跳转联动
  - 状态：DONE
  - 这一步到底做什么：点击 HOST 节点时切 HOST，点击工作区节点时先切 HOST 再跳工作区
  - 做完以后能看到什么结果：移动端树状入口是真能用，不是摆设
  - 依赖什么：5.1
  - 主要改哪些文件：
    - 移动端切换器组件
    - 路由跳转逻辑
    - 相关测试
  - 这一步明确不做什么：不做跨 HOST 多工作区同时展示
  - 怎么验证：
    - 跳转测试
    - 手动验收
  - 验证结果：
    - 点击 HOST 节点时会执行 `switchHost(hostId)` 并回到工作区首页
    - 点击工作区节点时会先切 HOST，再回调现有工作区选择逻辑，不在页面里堆额外分支
    - 已通过 `pnpm --dir apps/user-app exec vitest run src/features/mobile-shell/components/MobileWorkspaceSwitcherHeader.test.tsx`

---

## 阶段 6：回归和验收

- [ ] 6.1 多 HOST 主流程回归
  - 状态：TODO
  - 这一步到底做什么：验证旧用户迁移、双 HOST 登录、切换、退出、工作区跳转整条主流程
  - 做完以后能看到什么结果：这套机制不是纸面设计
  - 依赖什么：4.2、5.2
  - 主要改哪些文件：
    - 自动化测试
    - 验收记录文档
  - 这一步明确不做什么：不扩 scope
  - 怎么验证：
    - 自动化测试
    - 手动验收清单
