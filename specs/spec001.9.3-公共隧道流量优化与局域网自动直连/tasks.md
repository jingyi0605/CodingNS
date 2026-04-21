# 任务清单 - spec001.9.3 公共隧道流量优化与局域网自动直连（人话版）

状态：Draft

## 2026-04-21 进展补记

- 已启动 `spec001.9.3`
- 已确认当前问题不是“多加几个缓存 if”就能收住，而是 Host 连接模型还是单入口
- 已确认第一优先级不是先改 relay 协议，而是先做候选入口和自动局域网直连
- 已确认第二优先级是把高频只读链路改成“带版本先问一嘴”，不是没变化也整包重发
- 已确认 relay 二进制化属于后续阶段，不和第一轮交付绑死

## 这份文档是干什么的

这份任务清单只负责把“公共隧道流量优化与局域网自动直连”拆成能执行、能验收、不会越做越乱的步骤。

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

- [x] 0.1 启动 `spec001.9.3` 并完成主文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec001.9.3` 目录和 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现完整的流量优化与自动直连 Spec 文档骨架，后续不再靠聊天记录记决策
  - 依赖什么：`spec001.9`、`spec001.3`、`spec001.3.1`
  - 主要改哪些文件：
    - `specs/spec001.9.3-公共隧道流量优化与局域网自动直连/*`
  - 这一步明确不做什么：不写业务代码
  - 怎么验证：
    - 文档走查

- [x] 0.2 回写总览和父规格，挂上 `spec001.9.3`
  - 状态：DONE
  - 这一步到底做什么：把 `spec001.9.3` 挂到 `specs/README.md`、`spec001` 和 `spec001.9`
  - 做完以后能看到什么结果：总览和父规格都能看出“远程访问流量优化与自动直连”是独立子问题，不再藏在聊天里
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001.9-公共隧道服务接入与端到端加密远程访问/README.md`
  - 这一步明确不做什么：不改业务代码
  - 怎么验证：
    - 文档走查

---

## 阶段 1：先把连接模型修正

- [x] 1.1 给 Host 增加候选连接入口模型
  - 状态：DONE
  - 这一步到底做什么：把当前单一 `baseUrl` 视角升级成候选入口集合，让同一台 Host 能表达 relay、局域网、Tailscale 等多个入口
  - 做完以后能看到什么结果：客户端不再只能盯着一个地址决定传输方式
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/host/src/types/domain.ts`
    - `apps/user-app/src/config/client-config-types.ts`
    - 相关接口契约与测试
  - 这一步明确不做什么：不先做自动切换
  - 怎么验证：
    - `pnpm --dir apps/host test -- relay-tunnel-system-routes.test.ts`
    - `pnpm --dir apps/user-app exec vitest run src/settings/RelayTunnelPanel.test.tsx`
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
  - 2026-04-21 完成补记：
    - Host 侧已新增 `HostCandidateEndpoint` / `HostCandidateEndpointKind`
    - `relay-tunnel status` 已开始返回 `candidateEndpoints`
    - 当前先覆盖 `relay`、`loopback`、`lan` 三类入口；`tailscale` 类型先保留在模型里，留后续接入
    - 当 `localTargetBaseUrl` 是 `127.0.0.1`、`localhost`、`0.0.0.0` 这类仅本机可见地址时，Host 会补出本机私网 IPv4 候选地址
    - user-app 已能把候选入口、绑定 ID、Host 指纹写回本地 Host Profile，后续自动直连状态机可以直接复用

- [x] 1.2 给 Host 补候选入口读取接口
  - 状态：DONE
  - 这一步到底做什么：在认证后接口里返回当前实例候选入口、Host 指纹和绑定信息
  - 做完以后能看到什么结果：客户端登录远程 Host 后，能拿到局域网地址和其他入口提示
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/modules/client/*`
    - `apps/host/src/routes/client.ts`
    - 相关测试
  - 这一步明确不做什么：不做匿名公开接口
  - 怎么验证：
    - `pnpm --dir apps/host test -- client-routes.test.ts`
    - `pnpm --dir apps/user-app exec vitest run src/platform/server/client-runtime-manager.test.ts src/features/auth/store/auth-store.test.ts src/settings/RelayTunnelPanel.test.tsx`
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - 2026-04-21 完成补记：
    - Host 侧已把 `relayTunnel` 运行时信息挂到认证接口 `/api/client/runtime-config`
    - 认证接口现在会返回 `candidateEndpoints`、`bindingId`、`hostFingerprint` 和当前 `controlBaseUrl`
    - user-app 已在登录成功、token refresh 成功、以及切换到已保存会话的 Host 时自动同步这份运行时配置
    - 当前同步逻辑只回写当前激活 Host，且不会拿服务端返回的 `hostBaseUrl` 反向覆盖本地服务器地址，避免把远程客户端错误改回 `127.0.0.1`

---

## 阶段 2：补自动局域网直连

- [x] 2.1 客户端新增候选入口探活与验身状态机
  - 状态：DONE
  - 这一步到底做什么：客户端后台探活候选入口，并校验是不是同一台 Host
  - 做完以后能看到什么结果：客户端能知道哪些地址可达、哪些地址只是“看起来能连”
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/user-app/src/network/*`
    - `apps/user-app/src/config/host-runtime-store.ts`
    - `apps/user-app/src/config/host-switch-coordinator.ts`
    - 相关测试
  - 这一步明确不做什么：不直接替换当前链路
  - 怎么验证：
    - `pnpm --dir apps/user-app exec vitest run src/config/host-runtime-store.test.tsx src/config/host-runtime-store-candidates.test.tsx src/config/host-switch-coordinator.test.ts src/platform/server/client-runtime-manager.test.ts src/features/auth/store/auth-store.test.ts`
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - 2026-04-21 完成补记：
    - 已新增 `host-candidate-probe.ts`，用当前登录 token 主动请求候选入口的 `/api/client/runtime-config`
    - 验身不再只看“能不能连通”，而是比对 `bindingId` 和 `hostFingerprint`，避免误连到同网其他 Host
    - `host-runtime-store` 已开始统一维护候选入口探测状态、验身结果和当前优选入口
    - 当前会产出 `candidateEndpoints`、`preferredCandidateEndpointId`、`preferredDirectCandidateEndpointId`
    - 这一层只负责“探活 + 验身 + 选当前最优入口”，不直接改写 HTTP / WebSocket 链路
    - 已覆盖可达直连入口验身成功、身份不匹配拒绝、认证态切换后自动重探等测试场景

- [x] 2.2 transport registry 按当前活跃入口统一选路
  - 状态：DONE
  - 这一步到底做什么：把 transport 选择器从“看 baseUrl 和 relay 开关”改成“看当前活跃入口”
  - 做完以后能看到什么结果：HTTP / WebSocket 都能统一走当前最优入口
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/user-app/src/network/host-transport-registry.ts`
    - `apps/user-app/src/network/relay-tunnel-managed-transport.ts`
    - `apps/user-app/src/network/http-client.ts`
    - `apps/user-app/src/network/realtime-client.ts`
    - `apps/user-app/src/network/workbench-realtime-client.ts`
    - 相关测试
  - 这一步明确不做什么：不改业务层 API 调用方式
  - 怎么验证：
    - `pnpm --dir apps/user-app exec vitest run src/network/host-transport-registry.test.ts src/network/http-client.test.ts src/network/realtime-client.test.ts src/network/workbench-realtime-client.test.ts`
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - 2026-04-21 完成补记：
    - `host-transport-registry` 已新增“解析后的传输目标”，不再只返回 transport，还会给出当前应命中的真实入口 `baseUrl`
    - 当前激活 Host 如果已经验身出可用 `lan` 入口，HTTP、普通实时连接、工作台实时连接都会统一改写到该入口
    - 没有可用直连时会继续保留 relay 入口，不会误切换
    - relay transport 判定已经改成“只有目标地址本身是 relay 入口时才走 relay transport”，避免局域网直连时还套一层 relay
    - 已补齐普通实时连接和工作台实时连接的局域网改写测试，确保三条主链路行为一致

- [x] 2.3 设置页和连接状态补当前链路来源展示
  - 状态：DONE
  - 这一步到底做什么：在合适位置展示当前正在走 `relay`、`lan` 或 `tailscale`
  - 做完以后能看到什么结果：用户知道系统是不是已经自动直连成功
  - 依赖什么：2.2
  - 开始前必须先阅读：
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
  - 主要改哪些文件：
    - `apps/user-app/src/components/connection/*`
    - `apps/user-app/src/settings/*`
    - i18n 与测试
  - 这一步明确不做什么：不堆调试细节到主界面
  - 怎么验证：
    - `pnpm --dir apps/user-app exec vitest run src/settings/RelayTunnelPanel.test.tsx src/features/conversation/components/ConnectionBanner.test.tsx`
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
  - 2026-04-21 完成补记：
    - 已新增统一的活跃链路解析逻辑，设置页和会话连接提示不再各自重复判断当前入口
    - 远程访问设置页现在会展示“当前客户端链路”和“当前客户端地址”，能直接看出现在走的是公共隧道、局域网直连还是其他直连入口
    - 会话实时连接在重连中和重连失败提示里，已经顺手带出当前连接方式，避免用户只看到“断线了”却不知道当前到底走哪条链路
    - 文案保持普通用户视角，不把 `candidate endpoint`、`runtime store` 这类内部术语直接暴露到界面
    - 桌面端 `HOST 切换` 当前选中项已新增“详情”入口，悬浮框会展示当前是直连还是中继、当前实际命中的地址，以及中继链路下的本次客户端会话流量和当前链路延时

---

## 阶段 3：补高频快照减量传输

- [x] 3.1 给 `workbench`、`fileTree`、`git`、`terminalManager` 增加版本字段
  - 状态：DONE
  - 这一步到底做什么：给高频快照统一补 `revision` 或等价版本标识
  - 做完以后能看到什么结果：客户端后续刷新时可以带着已知版本号，不必每次盲拉全量
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/host/src/modules/workbench/*`
    - `apps/host/src/ws/workbench-ws-hub.ts`
    - `apps/user-app/src/network/workbench-realtime-client.ts`
    - 相关 DTO 与测试
  - 这一步明确不做什么：不先做复杂 patch 协议
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
    - `pnpm --dir apps/host test -- workbench-ws-hub.test.ts workbench-panel-snapshots.test.ts`
    - `pnpm --dir apps/user-app exec vitest run src/network/workbench-realtime-client.test.ts`
  - 2026-04-21 完成补记：
    - Host 侧 `workbench`、`fileTree`、`git`、`terminalManager`、`workspaceManagement` 快照都已统一带 `revision`
    - `workbench-ws-hub` 已支持 `knownRevision` / `knownRevisions`，未变化时会回 `unchanged: true` 且不再重复下发整包
    - 客户端 realtime 协议已经兼容 `snapshot: null` 的未变化响应，并会把最新 `revision` 回写到本地状态
    - 根目录文件树现在也允许带空字符串路径的已知版本，不会再因为根路径 key 被过滤而退化成全量拉取

- [x] 3.2 客户端本地缓存改成“先回显，再校验版本”
  - 状态：DONE
  - 这一步到底做什么：把现有 view snapshot cache 从页面体验缓存升级成版本校验前置缓存
  - 做完以后能看到什么结果：页面能秒开，且未变化时网络上只走轻量校验
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/user-app/src/shared/cache/view-snapshot-cache.ts`
    - 相关页面和 store
    - 相关测试
  - 这一步明确不做什么：不把所有页面都塞进统一大缓存
  - 怎么验证：
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
    - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/GitSidebar.test.tsx src/features/workbench/components/TerminalManagerPanel.test.tsx src/features/mobile-workspaces/pages/WorkspaceHomePage.test.tsx src/features/mobile-workspaces/pages/WorkspaceDetailPage.test.tsx src/features/terminal/pages/TerminalPage.test.tsx`
  - 2026-04-21 完成补记：
    - `GitSidebar`、`TerminalManagerPanel`、移动端工作区首页、工作区详情页、终端页都已在命中本地缓存时带着缓存里的 `revision` 订阅或刷新
    - `FileContextPanel` 已补齐 `path -> revision` 本地缓存与恢复逻辑，目录订阅和目录刷新都会把当前已知版本一并带回去
    - Workbench 重连后会把已有订阅和待刷新请求连同 `knownRevision` / `knownRevisionByPath` 一起重放，不会丢掉“先回显，再校验版本”的前提
    - `FileViewerModal` 顺手补了缺失能力字段的空值保护，避免旧测试数据里没带 `capabilities` 时直接炸空指针
    - 当前仓库里 `FileContextPanel.test.tsx` 还有一批查看器历史断言与现状不一致（主要是查看器文案与重复文本匹配方式），不属于本轮版本校验链路本身
- [x] 3.3 先把 `git` 链路做成真正少传
  - 状态：DONE
  - 这一步到底做什么：把 `git` 从“服务端局部缓存”继续推进到“客户端没变化时不收整包”
  - 做完以后能看到什么结果：状态没变时，远程访问不再反复下发历史和分支数据
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/host/src/modules/workbench/workspace-panel-snapshot-service.ts`
    - `apps/host/src/ws/workbench-ws-hub.ts`
    - `apps/user-app/src/network/workbench-realtime-client.ts`
    - 相关测试
  - 这一步明确不做什么：不改 Git 业务语义
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc -p tsconfig.json --noEmit`
    - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
    - `pnpm --dir apps/host test -- workbench-ws-hub.test.ts workbench-panel-snapshots.test.ts`
    - `pnpm --dir apps/user-app exec vitest run src/network/workbench-realtime-client.test.ts src/features/conversation/components/GitSidebar.test.tsx src/features/mobile-workspaces/pages/WorkspaceHomePage.test.tsx src/features/mobile-workspaces/pages/WorkspaceDetailPage.test.tsx`
  - 2026-04-21 完成补记：
    - Host 侧 `git` 快照现在会先做轻量 status 比较，状态没变时直接复用缓存 revision，不再重算 history / branches
    - `workbench-ws-hub` 对 `git.subscribe` / `git.refresh` 已支持单客户端 `knownRevision`，状态未变化时只回一条 `unchanged` 响应
    - user-app 已把 Git 缓存里的 `revision` 真正回传给订阅和刷新请求，状态没变时不再反复收整包历史和分支数据
    - 移动端首页、工作区详情页和桌面 Git 侧栏都已接入这条减量链路

---

## 阶段 4：评估 relay 传输层瘦身

- [ ] 4.1 盘点 HTTP / WebSocket 在 relay 里的包体放大
  - 状态：TODO
  - 这一步到底做什么：把 JSON + base64 + 加密这条链路的放大点量化清楚
  - 做完以后能看到什么结果：知道到底哪些流量值得进协议层优化，不再拍脑袋
  - 依赖什么：3.3
  - 主要改哪些文件：
    - `docs/`
    - 如有需要再补观测代码
  - 这一步明确不做什么：不直接改协议
  - 怎么验证：
    - 文档与统计结果走查

- [ ] 4.2 如果收益成立，再单开二进制 envelope 方案
  - 状态：TODO
  - 这一步到底做什么：在有证据的前提下，单独提出 relay 二进制化方案和迁移步骤
  - 做完以后能看到什么结果：后续协议瘦身有明确入口，不会和当前自动直连改动混成一锅
  - 依赖什么：4.1
  - 主要改哪些文件：
    - 后续单独设计文档或新子 spec
  - 这一步明确不做什么：不在当前 spec 里直接开干
  - 怎么验证：
    - 方案评审

---

## 阶段 5：回归与验收

- [ ] 5.1 自动局域网直连回归
  - 状态：TODO
  - 这一步到底做什么：验证同网可直连、断开可回退、旧 Host 可兼容
  - 做完以后能看到什么结果：链路优化不会把现有远程访问搞挂
  - 依赖什么：2.3
  - 主要改哪些文件：
    - 集成测试
    - 验收记录文档
  - 这一步明确不做什么：不顺手扩需求
  - 怎么验证：
    - 集成测试
    - 手工联调记录

- [ ] 5.2 远程访问流量对比验收
  - 状态：TODO
  - 这一步到底做什么：记录改造前后在典型页面和典型操作下的流量变化
  - 做完以后能看到什么结果：知道这次优化到底省了多少，不靠感觉
  - 依赖什么：3.3、4.1
  - 主要改哪些文件：
    - `docs/20260421-远程访问流量对比验收记录.md`
  - 这一步明确不做什么：不做花哨报表系统
  - 怎么验证：
    - 文档走查
