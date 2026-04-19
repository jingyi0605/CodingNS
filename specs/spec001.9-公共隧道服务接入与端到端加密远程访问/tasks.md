# 任务清单 - spec001.9 公共隧道服务接入与端到端加密远程访问（人话版）

状态：IN_PROGRESS

## 2026-04-19 进展补记

- 已启动 `spec001.9`
- 已明确这次做的是“公共隧道服务接入 + 端到端加密远程访问”，不是普通反向代理
- 已明确本仓库只实现 Spec、Host 侧隧道客户端、客户端 / H5 接入层和加密协议
- 已明确公共隧道站点、支付、流量账本和数据面转发节点必须放到独立子仓库
- 已明确“用户三级域名直接托管完整业务 H5 页面”和“中继看不到内容”不能同时成立
- 已在 `apps/codingns-proxy` 落下第一批可运行骨架：`shared-contracts`、`control-api`、`relay-edge`
- `control-api` 已补最小邮箱注册闭环，支持申请邮箱验证码和携带验证码注册
- `control-api` 已补文件持久化、邮箱密码登录和 Bearer 会话查询
- `control-api` 已补邮箱验证码频控，默认支持冷却时间和窗口次数限制，并可跨重启保留限制状态
- `control-api` 已补账号归属的 Host 绑定、流量钱包，以及 relay 内部授权与字节记账接口
- `relay-edge` 已补最小 WebSocket 盲中继骨架，支持预留会话后由 `upstream` / `downstream` 双端接入并原样转发帧
- `relay-edge` 已接控制面内部授权与配额校验，支持按字节扣量并在额度耗尽后拒绝新会话
- 主仓库已补 `instance_relay_tunnel_config/status` 的正式落库和仓储，公共隧道不再依赖零散页面状态
- 主仓库已补 `relay-tunnel` Host 控制面骨架，支持 `status/config/bind/unbind/enable/disable` 系统接口和基础状态流转
- `user-app` 已把公共隧道 profile 真正挂到 `HostTransport` 解析链路，当前 Host 可以按配置自动切直连或公共隧道
- `user-app` 设置页已补公共隧道 profile、Host 管理面板、流量钱包、套餐与订单展示，并补了信任边界提示
- `control-api` 已把支付骨架切到 Paddle，支持流量套餐、订单、Paddle Checkout 会话创建、Paddle webhook 处理和流量到账发放
- `apps/codingns-proxy` 子仓库已完成当前阶段 `pnpm build` 与 `pnpm test`

## 这份文档是干什么的

这份任务清单只负责把 “公共隧道服务接入与端到端加密远程访问” 拆成能执行、能验收、不会越做越歪的步骤。

要求还是那六个老问题：

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

## 阶段 0：先把边界钉死，别一开始就写歪

- [x] 0.1 启动 spec001.9 并完成主文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec001.9` 目录和 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.9` 文档骨架，任何人都知道这次解决的是公共隧道 + 端到端加密，不是云端站点混进主仓库
  - 依赖什么：`spec001`
  - 主要改哪些文件：
    - `specs/spec001.9-公共隧道服务接入与端到端加密远程访问/*`
  - 这一步明确不做什么：不写业务代码，不创建云端站点代码目录
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec001.9` 主文档初始化，并写清主仓库职责、独立子仓库职责、E2EE 信任边界、三级域名入口边界、流量和支付边界

- [x] 0.2 回写总览和父规格，挂上 spec001.9
  - 状态：DONE
  - 这一步到底做什么：把 `spec001.9` 挂到 `specs/README.md` 和 `spec001` 父规格，避免后续继续把公共隧道需求塞回父规格正文里混做
  - 做完以后能看到什么结果：总览和父规格都能看出 `spec001.9` 是独立子问题
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 这一步明确不做什么：不改业务代码
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已在总览和 `spec001` 父规格中补上 `spec001.9` 的职责说明和目录挂接

---

## 阶段 1：先把本仓库和云端仓库切开

- [x] 1.1 固定独立子仓库路径和主仓库忽略策略
  - 状态：DONE
  - 这一步到底做什么：约定公共隧道云端代码的独立子仓库路径，并让主仓库忽略该目录
  - 做完以后能看到什么结果：公共云端代码未来能在当前工作目录下开发，但不会被主仓库误跟踪
  - 依赖什么：0.2
  - 主要改哪些文件：
    - 根目录 `.gitignore`
    - `spec001.9` 相关开发说明文档
    - `apps/codingns-proxy/*`
  - 这一步明确不做什么：不实现公共云站点业务功能，不接支付链路
  - 怎么验证：
    - `git status` 不显示子仓库内部代码
    - 文档走查
  - 验证结果：
    - 已把独立子仓库路径定为 `apps/codingns-proxy/`
    - 已在主仓库 `.gitignore` 中忽略 `apps/codingns-proxy/`
    - 已创建独立子仓库骨架，并在 `apps/codingns-proxy/` 下执行 `git init -b main`
    - 主仓库 `git status --short --ignored` 已显示 `apps/codingns-proxy/` 为忽略目录

- [x] 1.2 固定控制面 / 数据面 / 本仓库职责边界
  - 状态：DONE
  - 这一步到底做什么：把账号、三级域名、支付、流量账本、盲中继、Host 客户端和客户端接入层的职责拆清楚
  - 做完以后能看到什么结果：后续不会再把云端计费逻辑硬塞进 Host
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `spec001.9` 文档
    - `spec001.9/docs/20260419-开发顺序与三端职责说明.md`
    - `apps/codingns-proxy/README.md`
    - `apps/codingns-proxy/apps/control-api/README.md`
    - `apps/codingns-proxy/apps/relay-edge/README.md`
  - 这一步明确不做什么：不把云端计费逻辑塞进 Host，不提前实现支付细节
  - 怎么验证：
    - 评审走查
  - 验证结果：
    - 已在 `spec001.9` 主文档和补充文档中写清主仓库、控制面、数据面的边界
    - 已在 `apps/codingns-proxy/README.md` 中固化子仓库职责
    - 已把 `control-api` 与 `relay-edge` 的目录职责和最小接口落到各自 README，后续不会再把控制面和数据面混成一个服务

---

## 阶段 2：先把 Host 侧隧道客户端和状态真相立住

- [x] 2.1 建立实例级公共隧道配置和状态存储
  - 状态：DONE
  - 这一步到底做什么：新增实例级公共隧道配置表、状态表和仓储，保存启用状态、绑定信息、公钥、指纹、最近状态
  - 做完以后能看到什么结果：公共隧道不再是零散页面状态，而是有正式落点
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/*`
    - `apps/host/src/types/domain.ts`
  - 这一步明确不做什么：不启动实际长连接
  - 怎么验证：
    - 仓储层测试
    - schema 走查
  - 验证结果：
    - 已新增 `instance_relay_tunnel_config` 和 `instance_relay_tunnel_status` 表
    - 已新增 `InstanceRelayTunnelRepository`，支持配置和状态快照的读写
    - 已在 Host `domain` 中补齐公共隧道配置与状态类型，并把仓储注册进 `create-server`
    - 已新增 `apps/host/tests/integration/relay-tunnel-storage.test.ts`
    - 已通过定向测试：`pnpm --filter host test -- tailscale-storage-and-service relay-tunnel-storage sqlite-bootstrap`
    - Host 全量 `build` 当前仍被现有无关类型错误阻断：`apps/host/src/modules/skills/skill-controller.ts:63`

- [x] 2.2 建立 Host 隧道状态机和系统接口
  - 状态：DONE
  - 这一步到底做什么：新增 `status/bind/unbind/enable/disable` 等 Host API，并把状态统一成 `disabled/unbound/binding/connecting/running/quota_exhausted/error`
  - 做完以后能看到什么结果：设置页终于有正式控制面接口可调
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/host/src/modules/relay-tunnel/*`
    - `apps/host/src/routes/system.ts`
    - `apps/host/src/server/create-server.ts`
  - 这一步明确不做什么：先不接真实云端
  - 怎么验证：
    - 接口测试
    - 状态迁移测试
  - 验证结果：
    - 已新增 `RelayTunnelService` 和 `RelayTunnelController`
    - 已新增系统接口：
      - `GET /api/system/relay-tunnel/status`
      - `PUT /api/system/relay-tunnel/config`
      - `POST /api/system/relay-tunnel/bind`
      - `POST /api/system/relay-tunnel/unbind`
      - `POST /api/system/relay-tunnel/enable`
      - `POST /api/system/relay-tunnel/disable`
    - 已验证未授权拒绝、未绑定启用阻断、绑定后启用进入 `connecting`、停用回到 `disabled`、解绑清空绑定信息、重启后状态保留
    - 已通过定向测试：
      - `pnpm --filter host test -- relay-tunnel-storage relay-tunnel-system-routes`
      - `pnpm --filter host test -- tailscale-system-routes tailscale-storage-and-service sqlite-bootstrap`
    - Host 全量 `build` 当前仍被现有无关类型错误阻断：`apps/host/src/modules/skills/skill-controller.ts:63`

- [x] 2.3 接入后台任务和长连接恢复
  - 状态：DONE
  - 这一步到底做什么：把隧道连接、自动重连、状态刷新接入 `TaskManager`
  - 做完以后能看到什么结果：Host 重启或断线后能恢复，不靠散装定时器硬撑
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/host/src/modules/tasks/*`
    - `apps/host/src/modules/relay-tunnel/*`
    - `apps/host/src/server/create-server.ts`
    - `apps/host/tests/integration/relay-tunnel-background.test.ts`
  - 这一步明确不做什么：不做支付逻辑
  - 怎么验证：
    - 重连测试
    - 启动恢复测试
  - 验证结果：
    - 已把 `relay_tunnel.connect` 注册进统一 `TaskManager`，不再为公共隧道额外长出私有 `timer` / `inflight`
    - `RelayTunnelService.restoreOnStartup()` 已改成仅入队后台恢复任务，不阻塞 Host `app.ready`
    - `enable`、`bind`、`updateConfig` 会触发统一后台重连；`disable`、`unbind` 会取消已存在的连接任务
    - 已补 `RelayTunnelRuntimeAdapter`，当前默认实现仍是骨架版 `Noop`，后续真实云端接入可继续替换，不影响当前状态机和恢复流程
    - 已补 `apps/host/tests/integration/relay-tunnel-background.test.ts`，覆盖：
      - 启动恢复只入队，不阻塞调用方
      - 重复重连请求按固定 key 去重
      - 后台连接成功写回 `running`
      - 后台连接失败写回 `error` 和 `lastError`
    - 已通过定向测试：
      - `pnpm --filter host test -- relay-tunnel-storage relay-tunnel-system-routes relay-tunnel-background`
      - `pnpm --filter host test -- tailscale-system-routes tailscale-storage-and-service sqlite-bootstrap`
    - Host 全量 `build` 当前仍被现有无关类型错误阻断：`apps/host/src/modules/skills/skill-controller.ts:63`

- [x] 2.4 实现未初始化实例阻断
  - 状态：DONE
  - 这一步到底做什么：在启用流程里检查 bootstrap 状态，未初始化时禁止通过公共隧道暴露
  - 做完以后能看到什么结果：不会把首个管理员入口直接挂上公网
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/host/src/modules/relay-tunnel/*`
    - `apps/host/src/modules/bootstrap/*`
  - 这一步明确不做什么：不改现有 bootstrap 协议
  - 怎么验证：
    - 未初始化阻断测试
    - 初始化后再启用测试
  - 验证结果：
    - 已把 `BootstrapStateRepository` 注入 `RelayTunnelService`，公共隧道启用、绑定后自动重连、启动恢复都统一读取实例初始化状态
    - 未初始化时，已绑定且启用的公共隧道会进入 `blocked_uninitialized`，不会入队后台连接，也不会偷偷恢复外网连接
    - 初始化完成后再启用公共隧道，会正常进入 `connecting` 并触发后台连接任务
    - 已补 `apps/host/tests/integration/relay-tunnel-background.test.ts`，覆盖：
      - 未初始化实例启用时进入 `blocked_uninitialized`
      - 初始化后启用会进入 `connecting` 并启动后台连接
      - 未初始化实例启动恢复时不会出公网连接
    - 已通过定向与相邻链路回归测试：
      - `pnpm --filter host test -- relay-tunnel-storage relay-tunnel-system-routes relay-tunnel-background tailscale-system-routes tailscale-storage-and-service sqlite-bootstrap`
    - Host 全量 `build` 当前仍被现有无关类型错误阻断：`apps/host/src/modules/skills/skill-controller.ts:63`

---

## 阶段 3：把端到端加密传输层接进去

- [x] 3.1 建立 Host 身份密钥、公钥登记和指纹展示
  - 状态：DONE
  - 这一步到底做什么：为 Host 生成长期身份密钥，并提供公钥和指纹管理
  - 做完以后能看到什么结果：客户端能验证“连到的是哪个 Host”
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/host/src/modules/relay-tunnel/crypto/*`
    - `apps/host/src/storage/*`
  - 这一步明确不做什么：不把业务 token 当密钥
  - 怎么验证：
    - 密钥读写测试
    - 指纹一致性测试
  - 验证结果：
    - 已新增 `instance_relay_tunnel_identity` 实例级身份表，保存 Host 长期私钥、公钥、指纹和时间戳
    - 已新增 `InstanceRelayTunnelIdentityRepository` 和 `RelayTunnelIdentityService`，当前采用 `x25519` 生成长期身份密钥
    - 已把公钥指纹固定为公钥 `SPKI DER` 的 `SHA256`，避免因为 PEM 换行或格式差异造成指纹漂移
    - 已新增 `POST /api/system/relay-tunnel/identity/ensure`，用于在设置页或绑定前确保本机已经有身份密钥，并直接返回当前状态中的公钥与指纹
    - `RelayTunnelService` 已接入身份材料：
      - `status` 会展示当前 Host 公钥和指纹
      - `bind` 会优先使用本机长期身份公钥和指纹，不再把外部传入值当真相
      - `enable`、启动恢复、后台 connect 会在缺失身份材料时自动补齐
    - 已补测试：
      - `apps/host/tests/integration/relay-tunnel-identity.test.ts`
      - `apps/host/tests/integration/relay-tunnel-storage.test.ts`
      - `apps/host/tests/integration/relay-tunnel-system-routes.test.ts`
    - 已通过定向与相邻链路回归测试：
      - `pnpm --filter host test -- relay-tunnel-identity relay-tunnel-storage relay-tunnel-system-routes relay-tunnel-background tailscale-system-routes tailscale-storage-and-service sqlite-bootstrap`
    - Host 全量 `build` 当前仍被现有无关类型错误阻断：`apps/host/src/modules/skills/skill-controller.ts:63`

- [x] 3.2 建立客户端 / Host 的加密握手与加密帧
  - 状态：DONE
  - 这一步到底做什么：实现端到端握手、会话密钥和加密帧封装
  - 做完以后能看到什么结果：中继只能看到帧长度和连接元数据，看不到业务明文
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/host/src/modules/relay-tunnel/*`
    - `apps/user-app/src/network/*`
    - 可能新增共享包
  - 这一步明确不做什么：不改业务 `/api/*` 语义
  - 怎么验证：
    - 握手成功 / 失败测试
    - 指纹不匹配测试
    - 抓包验证中继不可见明文
  - 验证结果：
    - 已新增 `apps/host/src/modules/relay-tunnel/crypto/relay-tunnel-protocol.ts`，提供：
      - 客户端 `clientHello`
      - Host `serverHello`
      - 基于 `x25519 + HKDF-SHA256 + AES-256-GCM` 的会话密钥推导
      - 双向加密帧封装与解封
      - 帧方向、会话标识、序号和完整性校验
    - 客户端握手开始前会先校验“Host 公钥和指纹是否自洽”；Host 握手阶段会校验客户端请求的 Host 指纹；客户端完成握手时会再次校验 Host 公钥、指纹和握手证明
    - 当前协议骨架先落在 Host 侧 `relay-tunnel/crypto` 模块，避免提前长出无意义共享包；后续 `3.3` 接真实传输链路时再把同一协议接到客户端 / H5
    - 已补测试：
      - `apps/host/tests/integration/relay-tunnel-protocol.test.ts`
      - 覆盖握手成功、指纹不匹配、握手证明篡改、加密帧篡改、重复帧/乱序帧拒绝
    - 已通过定向与相邻链路回归测试：
      - `pnpm --filter host test -- relay-tunnel-protocol relay-tunnel-identity relay-tunnel-storage relay-tunnel-system-routes relay-tunnel-background tailscale-system-routes tailscale-storage-and-service sqlite-bootstrap`
    - “抓包确认中继不可见明文” 需要等 `3.3` 把真实隧道传输链路接起来后再做联调验证
    - Host 全量 `build` 当前仍被现有无关类型错误阻断：`apps/host/src/modules/skills/skill-controller.ts:63`

- [x] 3.3 把现有 HTTP / WebSocket 访问改接到隧道传输层
  - 状态：DONE
  - 这一步到底做什么：让客户端访问 Host 时可以走公共隧道，不重写业务 API
  - 做完以后能看到什么结果：用户通过公共隧道也能正常使用现有工作台和实时能力
  - 依赖什么：3.2
  - 主要改哪些文件：
    - `apps/user-app/src/network/*`
    - `apps/host/src/ws/*`
    - `apps/host/src/server/*`
  - 这一步明确不做什么：不删本地直连
  - 怎么验证：
    - HTTP 接口联调
    - `/ws` 实时链路联调
  - 当前进展：
    - 已新增 `apps/host/src/modules/relay-tunnel/crypto/relay-tunnel-packets.ts`，把加密帧里的业务负载正式定义为 `http.request / http.response / ws.open / ws.opened / ws.message / ws.closed / error`
    - 已新增 `apps/host/src/modules/relay-tunnel/relay-tunnel-gateway-service.ts`，Host 可以把隧道里的 HTTP 包转发到本地业务 Host，并把隧道里的 WebSocket 包转发到本地 `/ws` 类实时链路
    - 已把 `apps/user-app/src/network/*` 改造成统一 `HostTransport` 接入：
      - 新增 `host-transport.ts / direct-host-transport.ts / host-transport-registry.ts`
      - `httpClient`、`RealtimeClient`、`WorkbenchRealtimeClient` 不再直接写死 `fetch / new WebSocket`，而是统一走 transport 解析
      - 默认仍然使用直连 transport，所以现有本地 / 局域网 / 可信域名直连不受影响
    - 已新增客户端侧隧道包 transport 骨架：
      - `apps/user-app/src/network/relay-tunnel-packets.ts`
      - `apps/user-app/src/network/relay-tunnel-client-transport.ts`
      - 当前已经把 `http.request / http.response / ws.open / ws.opened / ws.message / ws.closed / error` 映射成前端可用的 `fetch / WebSocket` 语义
      - 后续只需要给它补上“真实加密会话 + relay-edge 上下游连接”，不需要再重写 HTTP/WS 适配逻辑
    - 已新增 `apps/user-app/src/network/relay-tunnel-protocol.ts`，在 `user-app` 侧补齐浏览器可用的加密协议：
      - 使用 Web Crypto 对齐 Host 侧的 `x25519 + HKDF-SHA256 + AES-256-GCM`
      - 支持 Host 公钥指纹计算、客户端握手、服务端握手校验、双向加密帧封装与解封
      - 已新增 `apps/user-app/src/network/relay-tunnel-protocol.test.ts`，确认 `user-app` 协议实现可以和 Host 现有 `relay-tunnel-protocol.ts` 互通
    - 已新增 `apps/user-app/src/network/relay-tunnel-client-session.ts`，把“原始隧道链路”正式组装成客户端加密会话：
      - 当前会话层负责发出 `client_hello`、接收 `server_hello`、建立加密会话并把业务包编码成 `encrypted_frame`
      - `RelayTunnelClientTransport` 现在可以直接挂到这个会话层上，不再只是依赖裸的 packet mock
      - 已新增 `apps/user-app/src/network/relay-tunnel-client-session.test.ts`，覆盖：
        - 原始链路上的握手与加密包收发
        - `RelayTunnelClientTransport` 挂到真实客户端会话后的 HTTP / WebSocket 收发
    - 已新增 `apps/user-app/src/network/relay-tunnel-edge-client.ts`，打通 `user-app -> control-api -> relay-edge` 的原始接入链路：
      - 会先向 `control-api` 解析 `tunnelDomain`，拿到 `relayBaseUrl / controlBaseUrl / hostPublicKey / hostFingerprint`
      - 会向 `relay-edge` 预留 `sessionId`
      - 会以 `downstream` 角色连接 `relay-edge /ws`
      - 已新增 `connectRelayTunnelClientSessionViaEdge()`，把“控制面解析 + 数据面接入 + 客户端加密会话建立”串成一条可复用入口
    - 已新增 `apps/codingns-proxy/apps/relay-edge` 的 Host 身份挑战与待接会话领取链路：
      - 新增 `POST /api/public/hosts/challenge`
      - 新增 `POST /api/public/hosts/claim-next-session`
      - Host 现在不是靠明文账号密码去领会话，而是基于长期 `x25519` 身份密钥完成 challenge-response 证明后再领取待接 `sessionId`
      - `relay-edge` 会为每个待接会话维护最小 claim lease，避免多个 Host 或重复轮询把同一个待接会话抢乱
    - 已同步修正子仓库控制面契约，当前 `control-api` 公开绑定信息已经包含 `hostPublicKey`：
      - `apps/codingns-proxy/packages/shared-contracts/src/index.ts`
      - `apps/codingns-proxy/apps/control-api/src/binding-store.ts`
      - 否则客户端即使知道 `hostFingerprint` 也没法安全完成握手
    - 已新增 `apps/host/src/modules/relay-tunnel/relay-tunnel-runtime-adapter.ts`，把 Host 真实接到 `relay-edge`：
      - Host 会后台轮询领取待接会话，并以 `upstream` 角色接入 `relay-edge /ws`
      - 收到 `client_hello` 后会用本机长期身份密钥返回 `server_hello`
      - 随后的 `encrypted_frame` 会在 Host 端解密后交给 `RelayTunnelGatewayService`
      - 本地业务响应和本地 WebSocket 消息会重新封装成加密帧回写给客户端
      - `create-server.ts` 已改成注入真实 runtime adapter，不再一直停留在 `Noop` 骨架
    - 已新增 `apps/host/tests/integration/relay-tunnel-gateway.test.ts`，覆盖：
      - HTTP 包转发到本地业务 Host
      - WebSocket 包转发到本地业务 `/ws`
    - 已新增 `apps/host/tests/integration/relay-tunnel-runtime-adapter.test.ts`，覆盖：
      - Host runtime adapter 通过 Host 身份挑战领取待接会话
      - 客户端与 Host 完成真实端到端握手
      - 加密后的 HTTP / WebSocket 业务包通过 `relay-edge` 盲中继转发到本地目标服务并返回结果
    - 已新增前端定向测试，确认网络层现在支持“默认直连 + 可替换 transport”：
      - `apps/user-app/src/network/http-client.test.ts`
      - `apps/user-app/src/network/realtime-client.test.ts`
      - `apps/user-app/src/network/workbench-realtime-client.test.ts`
      - `apps/user-app/src/network/relay-tunnel-client-transport.test.ts`
      - `apps/user-app/src/network/relay-tunnel-protocol.test.ts`
      - `apps/user-app/src/network/relay-tunnel-client-session.test.ts`
      - `apps/user-app/src/network/relay-tunnel-edge-client.test.ts`
    - 已通过当前阶段回归测试：
      - `pnpm --filter host test -- relay-tunnel-gateway relay-tunnel-protocol relay-tunnel-identity relay-tunnel-storage relay-tunnel-background relay-tunnel-system-routes tailscale-system-routes tailscale-storage-and-service sqlite-bootstrap`
      - `pnpm --dir apps/user-app exec vitest run src/network/relay-tunnel-edge-client.test.ts src/network/relay-tunnel-client-session.test.ts src/network/relay-tunnel-protocol.test.ts src/network/relay-tunnel-client-transport.test.ts src/network/http-client.test.ts src/network/realtime-client.test.ts src/network/workbench-realtime-client.test.ts`
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/codingns-proxy/packages/shared-contracts exec vitest run src/index.test.ts`
      - `pnpm --dir apps/codingns-proxy/packages/shared-contracts exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/codingns-proxy/apps/control-api exec vitest run src/app.test.ts`
      - `pnpm --dir apps/codingns-proxy/apps/control-api exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/codingns-proxy/apps/relay-edge exec vitest run src/app.test.ts`
      - `pnpm --filter host test -- relay-tunnel-runtime-adapter relay-tunnel-background relay-tunnel-gateway relay-tunnel-protocol relay-tunnel-identity relay-tunnel-storage relay-tunnel-system-routes`
      - `pnpm --filter host exec tsc --noEmit -p tsconfig.json`
    - 已新增 `apps/user-app/src/network/relay-tunnel-managed-transport.ts`，会按需建立公共隧道会话，并把延迟建立的真实连接包装成前端可用的 `fetch / WebSocket`
    - 已把 `apps/user-app/src/network/host-transport-registry.ts` 改成真正读取当前 Host profile：
      - 当前 Host profile 启用 `relayTunnel` 时自动走公共隧道
      - 未启用时仍走本地直连
      - profile 变化时会回收旧 transport，避免旧连接泄漏
    - 已把 `apps/user-app/src/config/host-runtime-store.ts` 改成同时感知 `baseUrl + relayTunnel` 连接签名，公共隧道 profile 变化时会刷新运行时边界
    - 已补前端回归测试：
      - `apps/user-app/src/config/host-runtime-store.test.tsx`
      - `apps/user-app/src/network/relay-tunnel-managed-transport.test.ts`
      - `apps/user-app/src/network/http-client.test.ts`
      - `apps/user-app/src/network/realtime-client.test.ts`
      - `apps/user-app/src/network/workbench-realtime-client.test.ts`
    - 已通过当前阶段补充验证：
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/user-app exec vitest run src/config/host-runtime-store.test.tsx src/network/relay-tunnel-managed-transport.test.ts src/network/http-client.test.ts src/network/realtime-client.test.ts src/network/workbench-realtime-client.test.ts`
    - Host 全量 `build` 当前仍被现有无关类型错误阻断：`apps/host/src/modules/skills/skill-controller.ts:63`
  - 验证结果：
    - 现有 HTTP / WebSocket 主链路现在已经能按用户配置自动切到公共隧道 transport
    - 直连链路回归测试已通过，未破坏现有本地 / 局域网访问
    - 公共隧道延迟 WebSocket wrapper 已补事件转发和失败/提前关闭测试，避免运行时只在连接慢时才暴露问题

---

## 阶段 4：把设置页入口和用户交互接上

- [x] 4.1 让“远程访问”页支持公共隧道 provider
  - 状态：DONE
  - 这一步到底做什么：在设置页现有远程访问入口下新增公共隧道卡片或 provider 切换
  - 做完以后能看到什么结果：管理员能直接看到绑定状态、三级域名、流量余量和最近错误
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `apps/user-app/src/settings/*`
    - i18n 字典
  - 这一步明确不做什么：不发明新按钮体系，不脱离现有设置页样式基线
  - 怎么验证：
    - 组件测试
    - 手动走查
  - 验证结果：
    - 已新增 `apps/user-app/src/settings/RelayTunnelPanel.tsx`
    - 远程访问页现在会显示公共隧道状态、绑定域名、Host 指纹、流量余量、钱包、套餐与最近订单
    - `SettingsPage` 桌面端与移动端都已接入公共隧道入口，不再只能显示 Tailscale
    - 已补 i18n 文案：
      - `apps/user-app/src/i18n/zh-CN.ts`
      - `apps/user-app/src/i18n/en-US.ts`
    - 已通过组件与相邻回归测试：
      - `pnpm --dir apps/user-app exec vitest run src/features/settings/pages/SettingsPage.test.tsx`

- [x] 4.2 接通绑定、启用、停用和解绑交互
  - 状态：DONE
  - 这一步到底做什么：把设置页与 Host API 接通，完成基础管理闭环
  - 做完以后能看到什么结果：用户可以真正启用和管理公共隧道
  - 依赖什么：4.1、2.3
  - 主要改哪些文件：
    - 设置页组件
    - 前端 API 封装
  - 这一步明确不做什么：不在本仓库里做支付
  - 怎么验证：
    - 前端集成测试
    - 联调验证
  - 验证结果：
    - 已新增 `apps/user-app/src/platform/server/relay-tunnel-manager.ts`，统一封装：
      - Host 本地 `status/config/bind/unbind/enable/disable/identity`
      - 控制面 `login/hosts-bind/wallet/packages/orders/checkout-session`
    - 设置页已经接通：
      - 保存隧道配置
      - 登录控制面账号
      - 绑定当前 Host
      - 启用 / 停用 / 解绑公共隧道
      - 读取钱包、套餐、订单并发起支付页跳转
    - 已补 `SettingsPage` 中“当前 Host 公共隧道 profile 保存”测试，确认配置会真正写回客户端运行时配置
    - 已通过当前阶段验证：
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/user-app exec vitest run src/features/settings/pages/SettingsPage.test.tsx`

- [x] 4.3 明确官方 H5 入口和信任边界提示
  - 状态：DONE
  - 这一步到底做什么：在 UI 和文档里说明三级域名只是入口，真正 H5 由可信域名加载
  - 做完以后能看到什么结果：用户不会误以为任意子域页面都天然等于端到端加密
  - 依赖什么：4.1
  - 主要改哪些文件：
    - 设置页组件
    - 补充说明文档
  - 这一步明确不做什么：不把整套帮助中心写进设置页
  - 怎么验证：
    - 文案走查
  - 验证结果：
    - 已在公共隧道状态区补充明确提示：
      - 三级域名只负责把客户端接到当前 Host 的端到端加密隧道
      - 官方 H5 页面仍应从可信主域加载
      - 中继站点无法读取隧道内明文
    - 已在 Host profile 公共隧道说明中明确“客户端会通过隧道域名和控制站点建立端到端加密连接，而不是直接请求这个地址”

---

## 阶段 5：云端子仓库联动能力

- [x] 5.1 在独立子仓库实现控制面、数据面和流量账本
  - 状态：DONE
  - 这一步到底做什么：实现账号、三级域名、绑定、公网盲中继和流量计量
  - 做完以后能看到什么结果：无公网地址 Host 可以通过官方入口被访问
  - 依赖什么：阶段 1 到阶段 4
  - 主要改哪些文件：
    - `apps/codingns-proxy/*`
  - 这一步明确不做什么：不回写到主仓库
  - 怎么验证：
    - 子仓库自己的测试和联调记录
  - 当前进展：
    - 已新增 `@codingns-proxy/shared-contracts`
    - 已新增 `control-api` 最小 Fastify 服务，当前支持健康检查、公共元数据、邮箱验证码申请、邮箱验证码频控、邮箱注册、文件持久化、邮箱密码登录、Bearer `me` 查询、账号归属的 Host 绑定、流量钱包、relay 内部授权和按字节记账
    - 已新增 `relay-edge` 最小 Fastify 服务，当前支持健康检查、公共元数据、向控制面申请会话授权、会话预留、会话列表、Host challenge-response 领取待接会话，以及预留会话后的最小 WebSocket 双端盲中继和按字节扣量
    - 已完成子仓库 `pnpm build` 与 `pnpm test`

- [ ] 5.2 在独立子仓库接成熟支付方式和流量包发放
  - 状态：IN_PROGRESS
  - 这一步到底做什么：实现订单、支付回调、流量钱包发放和异常对账
  - 做完以后能看到什么结果：用户可以直接购买流量包
  - 依赖什么：5.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/*`
  - 这一步明确不做什么：不把支付 SDK 带回主仓库
  - 怎么验证：
    - 沙箱支付验证
    - 订单到账与流量到账一致性验证
  - 当前进展：
    - 已在 `apps/codingns-proxy/apps/control-api` 落下支付与到账骨架：
      - 新增公共流量套餐列表接口 `GET /api/public/traffic-packages`
      - 新增订单列表接口 `GET /api/v1/orders`
      - 新增 Checkout 会话创建接口 `POST /api/v1/payments/checkout-sessions`
      - 新增 Paddle webhook 接口 `POST /api/public/payments/paddle/webhook`
    - 已新增持久化订单和支付事件存储：
      - `apps/codingns-proxy/apps/control-api/src/traffic-order-store.ts`
      - `apps/codingns-proxy/apps/control-api/src/state-store.ts`
    - 已给流量钱包补 `grantBytes()`，支付到账后会直接把套餐流量发到账号钱包
    - 已新增 Paddle 支付网关实现：
      - `apps/codingns-proxy/apps/control-api/src/payment-gateway.ts`
      - 当前采用 `Paddle transaction + checkout.url + webhook`，控制面只保存订单与流量发放状态，不接触用户的支付凭据
      - 国内用户可以通过 Paddle 托管页上的 Alipay 完成付款，海外用户继续走 Paddle 默认支付方式
    - 已补控制面测试，覆盖：
      - 列出套餐
      - 创建订单与 Checkout 会话
      - webhook 到账后发放流量
      - webhook 幂等，重复通知不会重复发放流量
    - 已通过当前阶段验证：
      - `pnpm --dir apps/codingns-proxy/apps/control-api exec vitest run src/app.test.ts`
      - `pnpm --dir apps/codingns-proxy/apps/control-api exec tsc -p tsconfig.json --noEmit`
      - `pnpm --dir apps/codingns-proxy build`
      - `pnpm --dir apps/codingns-proxy test`
  - 还没做完的部分：
    - 还没有接真实 Paddle 沙箱密钥做端到端联调
    - 还没有补订单异常对账和人工补发工具

---

## 阶段 6：回归与验收

- [ ] 6.1 验证本地直连、Tailscale、公共隧道并存
  - 状态：TODO
  - 这一步到底做什么：确认新增公共隧道后，不破坏已有访问方式
  - 做完以后能看到什么结果：远程访问能力增加了，但旧用户不会被打断
  - 依赖什么：阶段 2 到阶段 4
  - 主要改哪些文件：
    - 测试代码
    - 验收文档
  - 这一步明确不做什么：不扩新范围
  - 怎么验证：
    - 自动化回归
    - 联调走查

- [ ] 6.2 验证中继不可见业务明文
  - 状态：TODO
  - 这一步到底做什么：通过抓包和日志确认中继只看到密文帧、连接元数据和字节数
  - 做完以后能看到什么结果：端到端加密不是嘴上说说
  - 依赖什么：3.2、5.1
  - 主要改哪些文件：
    - 验收记录
  - 这一步明确不做什么：不做形式主义安全报告
  - 怎么验证：
    - 抓包验证
    - 日志核对

- [ ] 6.3 验证流量限额与支付到账链路
  - 状态：TODO
  - 这一步到底做什么：确认购买、到账、扣量、超额断流和恢复都能闭环
  - 做完以后能看到什么结果：计费链路不是纸上设计
  - 依赖什么：5.2
  - 主要改哪些文件：
    - 验收记录
  - 这一步明确不做什么：不加新支付渠道
  - 怎么验证：
    - 沙箱支付联调
    - 超额场景测试
