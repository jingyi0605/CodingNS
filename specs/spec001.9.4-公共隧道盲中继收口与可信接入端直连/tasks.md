# 任务清单 - spec001.9.4 公共隧道盲中继收口与可信接入端直连（人话版）

状态：IN_PROGRESS

## 2026-04-21 进展补记

- 已启动 `spec001.9.4`
- 已明确这次的目标不是继续修补公网业务代理，而是把 `relay-edge` 收口成真正的盲中继
- 已明确最简方案是在保留 H5 的前提下，继续使用可信 H5 / 官方桌面客户端 + WSS + 客户端与 Host 端到端加密
- 已明确这次要删掉的是 `relay-edge` 的公网业务 HTTP / WebSocket 桥接，不是客户端与 Host 两端现有的加密传输层
- `user-app` 已切到统一的 `connect-init -> downstream ws -> E2EE` SDK 链路，桌面端和 H5 共用同一套客户端隧道代码
- `connectTicket` 已从控制面下发到客户端，并在 `relay-edge` 下游接入时强制校验，不再只是摆设字段
- 已补上 `connectTicket` 缺失 / 错误 的回归测试，防止后续又退回“只靠 sessionId 就能接”的松散实现

## 这份文档是干什么的

这份任务清单只回答一件事：

- 怎么把公共隧道从“中继还能看到明文”的混合方案，改成真正的盲中继方案

每个任务都必须说清楚：

1. 这一步到底做什么
2. 做完以后能看到什么结果
3. 依赖什么
4. 主要改哪些文件
5. 这一步明确不做什么
6. 怎么验证真的做完了

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并验证
- `CANCELLED`：取消并写原因

---

## 阶段 0：把边界先钉死

- [x] 0.1 启动 `spec001.9.4` 并建立主文档骨架
  - 状态：DONE
  - 这一步到底做什么：建立 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.9.4` 文档骨架，后续讨论不再散在聊天里
  - 依赖什么：`spec001.9`
  - 主要改哪些文件：
    - `specs/spec001.9.4-公共隧道盲中继收口与可信接入端直连/*`
  - 这一步明确不做什么：不写业务代码，不直接修改隧道实现
  - 怎么验证：
    - 文档走查

- [x] 0.2 回写父规格和总览引用
  - 状态：DONE
  - 这一步到底做什么：把 `spec001.9.4` 挂到 `specs/README.md`、`spec001` 父规格和 `spec001.9` 主规格里
  - 做完以后能看到什么结果：任何接手的人都能找到这份子规格
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
    - `specs/spec001.9-公共隧道服务接入与端到端加密远程访问/README.md`
  - 这一步明确不做什么：不改业务代码
  - 怎么验证：
    - 文档走查

---

## 阶段 1：先把 Channel 端收干净

- [x] 1.1 删除 `relay-edge` 的公网业务 HTTP / WebSocket 代理入口
  - 状态：DONE
  - 这一步到底做什么：下线 `relay-edge` 当前用于 `*.tunnelDomain` 明文业务代理的 `GET/POST/... /*` 和业务桥接逻辑
  - 做完以后能看到什么结果：`relay-edge` 不再读取公网业务 body，也不再充当伪客户端
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/relay-edge/src/app.ts`
    - `apps/codingns-proxy/apps/relay-edge/src/public-tunnel-gateway.ts`
    - `apps/codingns-proxy/apps/relay-edge/src/app.test.ts`
  - 这一步明确不做什么：不删除健康检查、会话预留、Host challenge 和字节计量
  - 怎么验证：
    - 代码搜索不到公网业务代理入口
    - 回归测试确认旧公网 HTTP / WebSocket 入口会被明确拒绝

- [x] 1.2 新增 `connect-init`，把客户端眼里的连接前置步骤收成一步
  - 状态：DONE
  - 这一步到底做什么：在 `control-api` 提供最小连接初始化接口，返回 `relayBaseUrl`、`sessionId`、`connectTicket`、Host 公钥和指纹
  - 做完以后能看到什么结果：客户端不再自己串“先 resolve binding，再 reserve”的散装流程
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/app.ts`
    - `apps/codingns-proxy/packages/shared-contracts/src/index.ts`
    - `apps/codingns-proxy/apps/control-api/src/relay-edge-client.ts`
    - `apps/user-app/src/network/relay-tunnel-edge-client.ts`
  - 这一步明确不做什么：不把业务认证塞进隧道票据
  - 怎么验证：
    - `control-api` 接口测试
    - `user-app` 建连测试
    - `relay-edge` 内部会话预留返回过期时间的回归测试

- [x] 1.3 把 Host 改成单条持久上游信道
  - 状态：DONE
  - 这一步到底做什么：让 Host 上线后只维护一条长期上游 WSS，并在这条信道上复用多个下游会话
  - 做完以后能看到什么结果：不再为每个客户端会话重新 claim / attach 一次
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/relay-edge/src/app.ts`
    - `apps/codingns-proxy/apps/relay-edge/src/session-registry.ts`
    - `apps/host/src/modules/relay-tunnel/*`
  - 这一步明确不做什么：不改 Host 本地业务 API 语义
  - 怎么验证：
    - `pnpm --filter @codingns-proxy/relay-edge test -- src/session-registry.test.ts src/app.test.ts`
    - `pnpm --filter @codingns-proxy/relay-edge lint`
    - `npm test -- --run tests/integration/relay-tunnel-runtime-adapter.test.ts`

---

## 阶段 2：让桌面客户端和 H5 真正自己建隧道

- [ ] 2.1 收口客户端侧隧道 SDK，桌面客户端和 H5 共用一套
  - 状态：IN_REVIEW
  - 这一步到底做什么：把连接初始化、Host 公钥校验、E2EE 握手、密文帧收发收口成统一客户端 SDK
  - 做完以后能看到什么结果：桌面客户端和 H5 不再各自维护一套隧道建连逻辑
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/user-app/src/network/*`
    - `apps/user-app/src/platform/server/*`
  - 这一步明确不做什么：不重写业务 `/api/*` 与 `/ws` 语义
  - 怎么验证：
    - `npm test -- --run src/network/relay-tunnel-edge-client.test.ts src/network/relay-tunnel-managed-transport.test.ts src/network/host-transport-registry.test.ts`
    - `npx tsc --noEmit -p tsconfig.json`
    - 桌面端联调待补
    - H5 联调待补

- [ ] 2.2 把 `*.tunnelDomain` 收口成可信入口，不再承载业务代理
  - 状态：DONE
  - 这一步到底做什么：把入口域名改成跳转入口、路由入口或提示页，不再直接代理业务 HTTP / WS
  - 做完以后能看到什么结果：H5 只能从可信域名加载业务代码
  - 依赖什么：1.1、2.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/*`
    - `apps/codingns-proxy/apps/console-web/*`
    - `apps/codingns-proxy/apps/relay-edge/*`
    - 部署文档与入口说明
  - 这一步明确不做什么：不让 `*.tunnelDomain` 承载可执行业务页面
  - 怎么验证：
    - `pnpm --filter @codingns-proxy/relay-edge test -- src/app.test.ts`
    - `pnpm --filter @codingns-proxy/console-web test -- src/App.test.tsx`
    - 直接访问入口域名时，`GET` 只会跳转到可信入口页，旧业务请求不再被代理

---

## 阶段 3：补迁移和验收

- [ ] 3.1 下线旧公网业务代理路径并补兼容提示
  - 状态：DONE
  - 这一步到底做什么：把旧的公网业务代理入口彻底关闭，并对旧入口给出明确错误或升级提示
  - 做完以后能看到什么结果：旧链路不会继续偷偷绕回明文桥接
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/relay-edge/*`
    - `apps/codingns-proxy/apps/console-web/*`
    - 部署文档与 README
  - 这一步明确不做什么：不保留长期双轨运行
  - 怎么验证：
    - `pnpm --filter @codingns-proxy/relay-edge test -- src/app.test.ts`
    - 旧 HTTP 入口返回 `410 PUBLIC_TUNNEL_PROXY_DISABLED`
    - 旧 WebSocket 入口返回 `1008 PUBLIC_TUNNEL_PROXY_DISABLED`
    - 入口域名 `GET` 请求只会落到可信主域入口页

- [ ] 3.2 固定“中继看不到业务明文”的最低验收清单
  - 状态：DONE
  - 这一步到底做什么：补抓包、日志、数据库、回归测试清单，避免以后又把业务代理偷偷加回来
  - 做完以后能看到什么结果：后续任何改动都能按固定标准验收
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `spec001.9.4/docs/*`
    - 相关测试与部署说明
  - 这一步明确不做什么：不拿“看起来差不多”当验收
  - 怎么验证：
    - 文档走查
    - `specs/spec001.9.4-公共隧道盲中继收口与可信接入端直连/docs/20260421-公共隧道盲中继最低验收清单.md` 已落库
    - 测试命令与人工验收动作已固化
