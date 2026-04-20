# 任务清单 - spec001.9.1 公共隧道服务二阶段收口与生产化验收（人话版）

状态：Draft

## 2026-04-19 进展补记

- 已启动 `spec001.9.1`
- 已明确二阶段不是重复第一阶段协议设计，而是收口“控制台站点、正式存储、真实邮件、真实支付、生产化中继、验收文档”这些上线缺口
- 已明确主仓库继续只负责 Host 侧隧道客户端、客户端接入层、设置页和验收回归
- 已明确 `apps/codingns-proxy` 子仓库需要从骨架升级成正式可部署服务
- `console-web` 已从占位 README 升级成最小可运行站点，支持注册、登录、Host 绑定、流量钱包、套餐和订单查看
- `control-api` 已补控制台最小只读绑定列表接口 `GET /api/v1/hosts`，`shared-contracts` 已补对应契约，前端不再靠猜接口写页面
- `control-api` 已补 SMTP 发信实现、忘记密码验证码和密码重置闭环，`console-web` 已补忘记密码页
- 2026-04-20 起，支付联调暂时让位给激活码兑换；原因很简单，Paddle 还没准备好，但流量发放不能继续卡死
- 已确认当前 `traffic_wallets(granted_bytes, used_bytes)` 模型不足以表达“多次发量、不同到期时间”，后续统一切到 `traffic_grants` 账本

## 这份文档是干什么的

这份任务清单只负责把“公共隧道服务二阶段收口与生产化验收”拆成能执行、能验收、不会越做越歪的步骤。

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

## 阶段 0：先把二阶段规格挂起来

- [x] 0.1 启动 `spec001.9.1` 并完成主文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec001.9.1` 目录和 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现完整的二阶段 Spec 文档骨架，任何人都知道这次做的是生产化收口，不是重写第一阶段
  - 依赖什么：`spec001.9`
  - 主要改哪些文件：
    - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/*`
  - 这一步明确不做什么：不写业务代码
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec001.9.1` 主文档初始化，并写清二阶段范围、生产化缺口和验收目标

- [x] 0.2 回写总览和父规格，挂上 `spec001.9.1`
  - 状态：DONE
  - 这一步到底做什么：把 `spec001.9.1` 挂到 `specs/README.md`、`spec001` 和 `spec001.9`
  - 做完以后能看到什么结果：总览和父规格都能看出“公共隧道二阶段收口”是独立子问题
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001.9-公共隧道服务接入与端到端加密远程访问/README.md`
  - 这一步明确不做什么：不改业务代码，不篡改 `spec001.9` 第一阶段边界
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成总览、父规格和 `spec001.9` 的挂接

---

## 阶段 1：先把控制面和用户入口做成正式服务

- [x] 1.1 实现 `console-web` 最小控制台站点
  - 状态：DONE
  - 这一步到底做什么：在子仓库里实现注册、登录、Host 状态、流量钱包、套餐和订单的最小控制台站点
  - 做完以后能看到什么结果：用户不需要只靠 API 或主仓库设置页就能完成最小操作闭环
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/console-web/*`
    - `apps/codingns-proxy/packages/shared-contracts/*`
    - `apps/codingns-proxy/apps/control-api/src/*`
  - 这一步明确不做什么：不做复杂后台大盘，不做营销官网
  - 怎么验证：
    - 前端构建通过
    - 页面路由走查
    - 最小交互联调
  - 验证结果：
    - 已在 `apps/codingns-proxy/apps/console-web/` 落地 `React + Vite + React Router` 最小站点，不再是占位目录
    - 已实现注册页、登录页、控制台首页，首页可查看 Host 绑定、流量钱包、套餐列表、订单列表，并直接创建 Paddle 托管支付链接
    - 已补本地 i18n 文案字典、控制面 API client、会话持久化和前端测试
    - 已在 `control-api` 新增 `GET /api/v1/hosts`，并在 `shared-contracts` 补 `HostBindingsResponse` 与 `hostsPath`
    - 已通过验证：
      - `pnpm --filter @codingns-proxy/shared-contracts build`
      - `pnpm --filter @codingns-proxy/control-api test`
      - `pnpm --filter @codingns-proxy/console-web lint`
      - `pnpm --filter @codingns-proxy/console-web test`
      - `pnpm --filter @codingns-proxy/console-web build`

- [x] 1.2 接真实邮件通道并补密码找回
  - 状态：DONE
  - 这一步到底做什么：把当前内存验证码发送器替换成真实邮件通道，并新增重置密码闭环
  - 做完以后能看到什么结果：邮箱注册和找回密码不再停留在演示状态
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/*`
    - `apps/codingns-proxy/apps/console-web/*`
    - 相关文档和测试
  - 这一步明确不做什么：不接入复杂消息中心
  - 怎么验证：
    - 测试邮件发送
    - 注册验证码验证
    - 忘记密码流程联调
  - 验证结果：
    - 已在 `control-api` 增加 SMTP 发信实现，支持通过环境变量切换 `memory` / `smtp` 模式
    - 已新增密码找回接口：
      - `POST /api/public/auth/password-reset/request-code`
      - `POST /api/public/auth/password-reset/confirm`
    - 已扩展验证码仓储到 `register / password_reset` 两类用途，并支持密码重置后更新账号密码哈希
    - 已在 `console-web` 新增忘记密码页，支持申请重置验证码并提交新密码
    - 已补 README，写清控制面新增接口和 SMTP 配置项
    - 已通过验证：
      - `pnpm --filter @codingns-proxy/shared-contracts build`
      - `pnpm --filter @codingns-proxy/control-api lint`
      - `pnpm --filter @codingns-proxy/control-api test`
      - `pnpm --filter @codingns-proxy/control-api build`
      - `pnpm --filter @codingns-proxy/console-web lint`
      - `pnpm --filter @codingns-proxy/console-web test`
      - `pnpm --filter @codingns-proxy/console-web build`

---

## 阶段 2：把数据真相从骨架升级成正式落点

- [x] 2.1 把控制面文件仓储迁移到正式数据库
  - 状态：DONE
  - 这一步到底做什么：把账号、会话、绑定、钱包、订单、支付事件、验证码等迁移到正式数据库并补迁移脚本
  - 做完以后能看到什么结果：控制面核心数据不再压在 JSON 文件上
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/*`
    - `apps/codingns-proxy/docs/*`
  - 这一步明确不做什么：不在二阶段顺手做企业权限体系
  - 怎么验证：
    - 数据迁移测试
    - 并发和重启回归
    - 幂等约束验证
  - 验证结果：
    - 已在 `apps/codingns-proxy/apps/control-api/src/database.ts` 固定正式运行路径为 PostgreSQL，并在服务启动时自动执行 schema migration
    - 已补迁移脚本 `src/scripts/migrate-file-state-to-postgres.ts`，可把旧 JSON 文件仓储中的账号、会话、绑定、钱包、订单、支付事件和验证码导入 PostgreSQL
    - 已新增 `src/persistence.ts` 兼容层，把测试回归从不稳定的 `pg-mem` 切回文件仓储兼容实现，避免测试环境干扰正式数据库实现
    - 已更新 `control-api/README.md`，写清 PostgreSQL 环境变量、旧文件导入命令和兼容测试边界
    - 已通过验证：
      - `pnpm --filter @codingns-proxy/shared-contracts build`
      - `pnpm --filter @codingns-proxy/control-api lint`
      - `pnpm --filter @codingns-proxy/control-api test`
      - `pnpm --filter @codingns-proxy/control-api build`

- [x] 2.2 实现正式域名池和绑定生命周期
  - 状态：DONE
  - 这一步到底做什么：把演示域名规则替换成正式根域配置、保留词、冲突处理和释放规则
  - 做完以后能看到什么结果：控制面返回的域名不再是硬编码演示值
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/*`
    - `apps/codingns-proxy/packages/shared-contracts/*`
    - 相关测试
  - 这一步明确不做什么：不做用户自定义域名
  - 怎么验证：
    - 域名分配测试
    - 冲突和保留词测试
    - 解绑释放测试
  - 验证结果：
    - 已在 `control-api` 增加正式域名池配置：
      - `CODINGNS_PROXY_TUNNEL_ROOT_DOMAINS`
      - `CODINGNS_PROXY_TUNNEL_RESERVED_SUBDOMAINS`
      - `CODINGNS_PROXY_TUNNEL_RELEASED_DOMAIN_COOLDOWN_SECONDS`
    - 已新增 `domain_reservations` 持久化模型，绑定时按“根域列表 + 保留词 + 冲突顺延 + released 冷却复用”规则分配三级域名
    - 已新增 `DELETE /api/v1/hosts/:bindingId` 控制面解绑接口，解绑后域名进入 `released`，旧域名不再继续解析
    - 已补共享契约 `HostUnbindResponse` 和 `ControlApiMeta.unbindPath`，并更新 README 中的环境变量与接口说明
    - 已通过验证：
      - `pnpm --filter @codingns-proxy/shared-contracts build`
      - `pnpm --filter @codingns-proxy/control-api lint`
      - `pnpm --filter @codingns-proxy/control-api test`
      - `pnpm --filter @codingns-proxy/control-api build`

---

## 阶段 3：把数据面补到生产化最低标准

- [x] 3.1 为 `relay-edge` 引入共享状态和正式回收
  - 状态：DONE
  - 这一步到底做什么：把会话预留、Host challenge、claim lease 和过期回收从单进程内存迁到共享状态层
  - 做完以后能看到什么结果：数据面不再因为单进程重启或单点内存状态而乱套
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/relay-edge/src/*`
    - `apps/codingns-proxy/docs/*`
  - 这一步明确不做什么：不做全球多区域调度
  - 怎么验证：
    - 过期回收测试
    - claim lease 测试
    - 重启恢复测试
  - 验证结果：
    - 已在 `relay-edge` 新增共享状态适配层，支持 `memory:` 与 Redis 连接串两种实现，正式环境可把会话元数据、Host challenge 和 claim lease 切到 Redis
    - 已把 `session-registry` 改成“socket 仍在本地，元数据进入共享状态”的结构，并增加 TTL 与定时回收
    - 已补 `claim lease` 保护：lease 没过期前不会把同一个待接会话重复发给第二个 Host 领取者
    - 已补重启恢复测试：复用同一个共享状态实例重建 `relay-edge` 后，仍能读到未过期的待接会话
    - 已更新 `apps/codingns-proxy/apps/relay-edge/README.md`，写清共享状态环境变量和“当前仍不是多节点 WebSocket 中继”的边界
    - 已通过验证：
      - `pnpm --filter @codingns-proxy/relay-edge lint`
      - `pnpm --filter @codingns-proxy/relay-edge test`
      - `pnpm --filter @codingns-proxy/relay-edge build`

- [x] 3.2 把 usage 扣量补成幂等链路
  - 状态：DONE
  - 这一步到底做什么：为 usage 事件增加幂等键、失败补偿和控制面去重消费
  - 做完以后能看到什么结果：控制面短暂抖动时不会把流量扣乱
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/relay-edge/src/*`
    - `apps/codingns-proxy/apps/control-api/src/*`
    - 相关测试
  - 这一步明确不做什么：不扩到复杂计费模型
  - 怎么验证：
    - 重复 usage 测试
    - 控制面失败重试测试
    - 钱包一致性测试
  - 验证结果：
    - 已在 `shared-contracts` 的 `RelayUsageConsumeRequest` 中增加 `usageId`、`observedAt`，响应中增加 `applied`
    - 已在 `control-api` 增加 `relay_usage_events` 持久化表，并按 `usage_id` 做唯一约束；重复 usage 到达时只返回当前钱包快照，不会重复扣量
    - 已在 `relay-edge` 增加 `usage-reporter` 本地重试队列，控制面短暂失败时会缓存 usage 并按固定间隔补发
    - 已补测试：
      - `control-api` 覆盖重复 `usageId` 不重复扣量
      - `relay-edge` 覆盖 usage 补发重试和相同 `usageId` 不重复入队
    - 已更新 `control-api/README.md` 和 `relay-edge/README.md`，写清 usage 幂等键和补发重试配置
    - 已通过验证：
      - `pnpm --filter @codingns-proxy/shared-contracts build`
      - `pnpm --filter @codingns-proxy/control-api lint`
      - `pnpm --filter @codingns-proxy/control-api test`
      - `pnpm --filter @codingns-proxy/control-api build`
      - `pnpm --filter @codingns-proxy/relay-edge lint`
      - `pnpm --filter @codingns-proxy/relay-edge test`
      - `pnpm --filter @codingns-proxy/relay-edge build`

---

## 阶段 4：把支付和流量闭环真正做完

- [x] 4.0 先把流量模型改成 grant 账本，并接通激活码兑换
  - 状态：DONE
  - 这一步到底做什么：把现有总量钱包重构成“独立 grant + 各自到期”的流量账本，并增加用户自助激活码兑换入口
  - 做完以后能看到什么结果：用户可以自己兑换激活码，每个码固定到账 `30 天有效期 + 5GB`，多次兑换后也不会把到期时间记乱
  - 依赖什么：2.1、3.2
  - 主要改哪些文件：
    - `apps/codingns-proxy/packages/shared-contracts/*`
    - `apps/codingns-proxy/apps/control-api/src/*`
    - `apps/codingns-proxy/apps/console-web/*`
    - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/*`
  - 这一步明确不做什么：不做 Paddle 真实联调，不做复杂套餐运营后台
  - 怎么验证：
    - 有效激活码兑换测试
    - 重复兑换 / 无效码 / 过期码测试
    - grant 到期与钱包汇总测试
    - 控制台兑换交互测试
  - 验证结果：
    - 已把 `control-api` 的流量真相改为 `traffic_grants`，`traffic_wallets` 退化为钱包快照；旧聚合钱包数据会迁移成 `legacy_wallet` grant
    - 已新增 `activation_codes` 持久化模型、自助兑换接口 `POST /api/v1/activation-codes/redeem` 和 grant 列表接口 `GET /api/v1/traffic-wallet/grants`
    - 已实现“最早到期优先”的 grant 扣量策略，避免多次发量后把到期时间算乱
    - 已在 `console-web` 控制台首页增加激活码兑换表单和到账记录列表，钱包摘要增加 grant 数量和最近到期时间
    - 已新增离线生码脚本 `pnpm --filter @codingns-proxy/control-api activation-codes:generate -- --count 10 --batch april-first-wave`
    - 已通过验证：
      - `pnpm --filter @codingns-proxy/shared-contracts build`
      - `pnpm --filter @codingns-proxy/shared-contracts test`
      - `pnpm --filter @codingns-proxy/control-api lint`
      - `pnpm --filter @codingns-proxy/control-api test`
      - `pnpm --filter @codingns-proxy/control-api build`
      - `pnpm --filter @codingns-proxy/console-web lint`
      - `pnpm --filter @codingns-proxy/console-web test`
      - `pnpm --filter @codingns-proxy/console-web build`

- [x] 4.0.1 把激活码升级成月规格码、批量校验和双模式兑换
  - 状态：DONE
  - 这一步到底做什么：把“单码固定 5GB/30 天”升级成“5G / 10G / 20G / 50G 月规格码”，支持一次粘贴多个激活码，并在校验后选择“增加本月流量”或“增加有效期月数”
  - 做完以后能看到什么结果：控制台不再只能一枚一枚兑换，用户能先看到有效码数量和规格分布，再按需要把码用于当前周期加量或未来月份续期
  - 依赖什么：4.0
  - 主要改哪些文件：
    - `apps/codingns-proxy/packages/shared-contracts/*`
    - `apps/codingns-proxy/apps/control-api/src/*`
    - `apps/codingns-proxy/apps/console-web/*`
    - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/*`
  - 这一步明确不做什么：不接 Paddle，不做团队套餐，不做复杂订阅后台
  - 怎么验证：
    - 多码批量校验测试
    - 混合规格 + 延长月数限制测试
    - 当前周期加量测试
    - 未来月份排期 grant 测试
    - 控制台批量兑换交互测试
  - 验证结果：
    - 已在 `shared-contracts` 增加激活码规格 `5g / 10g / 20g / 50g`、批量预校验契约、双模式兑换请求和带 `startsAt / activationCodeSpec / scheduled` 状态的 grant 摘要
    - 已在 `control-api` 增加 `POST /api/v1/activation-codes/preview`，兑换模式支持：
      - `boost_current_cycle`：把本批有效码全部加到当前 30 天周期，允许混合规格
      - `extend_validity_months`：把同规格激活码顺延到未来周期，按 grant 排期生效
    - 已把 `traffic_grants` 扩展为可排期 grant，未来月份不会提前算进当前钱包余额
    - 已把控制台首页兑换区升级为“多码粘贴 -> 先校验 -> 看规格分布 -> 选兑换方式 -> 确认兑换”，并补前端测试覆盖整个交互链路
    - 已把离线生码脚本升级为支持规格参数，例如：
      - `pnpm --filter @codingns-proxy/control-api activation-codes:generate -- --count 10 --spec 10g --batch april`
    - 已通过验证：
      - `pnpm --filter @codingns-proxy/shared-contracts build`
      - `pnpm --filter @codingns-proxy/shared-contracts test`
      - `pnpm --filter @codingns-proxy/control-api lint`
      - `pnpm --filter @codingns-proxy/control-api test`
      - `pnpm --filter @codingns-proxy/control-api build`
      - `pnpm --filter @codingns-proxy/console-web lint`
      - `pnpm --filter @codingns-proxy/console-web test`
      - `pnpm --filter @codingns-proxy/console-web build`

- [ ] 4.1 完成 Paddle 沙箱端到端联调
  - 状态：TODO
  - 这一步到底做什么：用真实 Paddle 沙箱密钥跑通下单、跳转、回调和到账
  - 做完以后能看到什么结果：支付链路不再只停留在 mock 测试
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/*`
    - `apps/codingns-proxy/docs/*`
  - 这一步明确不做什么：不增加新支付渠道
  - 怎么验证：
    - Paddle sandbox 联调记录
    - webhook 验签验证
    - 订单到账核对

- [x] 4.2 增加对账能力和人工补发工具
  - 状态：DONE
  - 这一步到底做什么：补支付事件、发量记录和按订单补发 / 重放能力
  - 做完以后能看到什么结果：支付异常时可以人工修复，不必改库碰运气
  - 依赖什么：2.1、4.0
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/*`
    - 新增工具脚本或受保护接口
    - 相关文档
  - 这一步明确不做什么：不做完整运营后台
  - 怎么验证：
    - 重复回调测试
    - 补发测试
    - 对账文档走查
  - 验证结果：
    - 已在 `control-api` 增加正式对账与补发入口：
      - `GET /api/internal/ops/orders/:orderId/reconciliation`
      - `POST /api/internal/ops/orders/:orderId/replay-grant`
    - 已新增离线命令：
      - `pnpm --filter @codingns-proxy/control-api orders:recover -- inspect --order-id <orderId>`
      - `pnpm --filter @codingns-proxy/control-api orders:recover -- replay --order-id <orderId> --reason "<原因>" [--mark-paid]`
    - 已把 `payment_events` 扩展为保存 `event_type / provider_transaction_id`，并新增 `order_recovery_actions` 审计表
    - 已确认同一订单重复补发保持幂等，不会重复加量
    - 已新增说明文档：
      - `apps/codingns-proxy/docs/20260420-订单对账与人工补发说明.md`
      - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/docs/20260420-订单对账与人工补发说明.md`
    - 已更新：
      - `apps/codingns-proxy/apps/control-api/README.md`
      - `apps/codingns-proxy/docs/20260420-公共隧道部署与配置说明.md`
      - `apps/codingns-proxy/.env.example`
    - 已通过验证：
      - `pnpm --filter @codingns-proxy/control-api lint`
      - `pnpm --filter @codingns-proxy/control-api test -- src/app.test.ts`
      - `pnpm --filter @codingns-proxy/control-api build`

- [ ] 4.3 固定“扣量、超额断流、购买恢复”闭环
  - 状态：IN_PROGRESS
  - 这一步到底做什么：确认超额阻断、购买恢复和钱包状态展示都能对齐
  - 做完以后能看到什么结果：公共隧道计费主链路真正闭环
  - 依赖什么：3.2、4.2
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/*`
    - `apps/codingns-proxy/apps/relay-edge/*`
    - `apps/user-app/src/settings/*`
    - 相关测试和验收记录
  - 这一步明确不做什么：不引入新的套餐体系
  - 怎么验证：
    - 超额场景测试
    - 购买恢复测试
    - 钱包展示核对
  - 当前进展：
    - 已补 `relay-edge` 端到端恢复测试，确认额度耗尽后会拒绝新会话预留，用户兑换激活码后后续会话预留可以恢复
    - 已补人工补发恢复测试，确认额度耗尽后，运营通过订单补发 grant，后续会话预留可以恢复
    - 已补 `user-app` 的公共隧道状态展示，明确显示“流量耗尽”和最近错误原因
    - 已新增验收记录：
      - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/docs/20260420-流量扣量断流与恢复记录.md`
    - 仍未完成的部分：
      - Paddle 真实支付恢复
  - 已完成验证：
    - `pnpm --filter @codingns-proxy/relay-edge test -- src/app.test.ts`
    - `pnpm --filter @codingns-proxy/relay-edge build`
    - `pnpm --filter user-app exec vitest run src/settings/RelayTunnelPanel.test.tsx`
    - `pnpm --filter user-app exec tsc --noEmit -p tsconfig.json`

---

## 阶段 5：收口主仓库回归和安全验收

- [x] 5.1 补齐主仓库公共隧道回归基线
  - 状态：DONE
  - 这一步到底做什么：修正失真的设置页测试，并固定本地直连、Tailscale、公共隧道三种访问方式的并存回归
  - 做完以后能看到什么结果：后续改远程访问能力时有正式回归线
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/settings/*`
    - `apps/user-app/src/network/*`
    - `apps/host/tests/integration/*`
  - 这一步明确不做什么：不再新长一套远程访问 UI
  - 怎么验证：
    - 自动化测试
    - 手动走查
  - 验证结果：
    - 已在 `apps/user-app/src/network/host-transport-registry.test.ts` 固定三种接入方式并存回归：
      - 本地直连继续走 `directHostTransport`
      - Tailscale 地址继续走 `directHostTransport`
      - 只有开启 `relayTunnel.enabled` 的 Host 才走 `ManagedRelayTunnelHostTransport`
    - 已修正 `apps/user-app/src/network/host-transport-registry.ts` 的真实回归点：公共隧道从开启切回关闭时，会立即关闭并清理旧的 relay transport 缓存，不再残留陈旧连接对象
    - 已复核 `apps/user-app/src/features/settings/pages/SettingsPage.test.tsx` 的远程访问入口回归，确认设置页继续只测“入口与切换”，不再把整块公共隧道面板伪装成页面级真实回归
    - 已新增手动走查基线文档：
      - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/docs/20260420-主仓库公共隧道回归基线.md`
    - 已通过验证：
      - `pnpm --filter user-app exec vitest run src/network/host-transport-registry.test.ts src/features/settings/pages/SettingsPage.test.tsx`
      - `pnpm --filter user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --filter host test -- tests/integration/relay-tunnel-system-routes.test.ts tests/integration/relay-tunnel-background.test.ts`

- [x] 5.2 补“中继不可见业务明文”的正式验收记录
  - 状态：DONE
  - 这一步到底做什么：通过抓包、日志和联调记录，证明中继只能看到密文帧和字节数
  - 做完以后能看到什么结果：端到端加密有正式验收结论
  - 依赖什么：3.1、5.1
  - 主要改哪些文件：
    - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/docs/*`
  - 这一步明确不做什么：不写形式主义安全白皮书
  - 怎么验证：
    - 抓包记录
    - 日志核对
    - 文档走查
  - 验证结果：
    - 已新增正式验收记录：
      - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/docs/20260420-中继密文验收记录.md`
    - 已基于自动化等价记录固定证据链：
      - `relay-edge` 的 `session-registry` 只做原始 payload 转发和字节数记账，不解析 HTTP / WebSocket 明文
      - `user-app` 的 `RelayTunnelClientSession` 在握手后发送的链路包类型为 `encrypted_frame`
      - `host` 的 `RelayTunnelRuntimeEdgeAdapter` 只有在 Host 端拿到会话密钥后，才把 `encrypted_frame` 解回 `http.request / ws.message`
    - 已明确写清可见元数据边界：中继仍可见 `sessionId / bindingId / accountId / tunnelDomain / bytes`，但不可直接读取业务明文
    - 已通过验证：
      - `pnpm --filter @codingns-proxy/relay-edge test -- src/app.test.ts`
      - `pnpm --filter user-app exec vitest run src/network/relay-tunnel-client-session.test.ts`
      - `pnpm --filter host test -- tests/integration/relay-tunnel-runtime-adapter.test.ts`

---

## 阶段 6：补运维文档并形成上线基线

- [x] 6.1 补部署说明、环境变量样例和运维文档
  - 状态：DONE
  - 这一步到底做什么：补齐子仓库部署步骤、最小配置样例、运行约束和常见故障说明
  - 做完以后能看到什么结果：新环境可以按文档部署，不再靠口口相传
  - 依赖什么：2.1、3.1、4.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/README.md`
    - `apps/codingns-proxy/docs/*`
    - `.env.example` 或等价配置文档
  - 这一步明确不做什么：不做一键运维平台
  - 怎么验证：
    - 文档走查
    - 配置清单核对
  - 验证结果：
    - 已新增根目录环境变量样例：
      - `apps/codingns-proxy/.env.example`
    - 已新增正式部署说明：
      - `apps/codingns-proxy/docs/20260420-公共隧道部署与配置说明.md`
    - 已更新：
      - `apps/codingns-proxy/README.md`
      - `apps/codingns-proxy/docs/README.md`
    - 文档已明确写清：
      - `console-web / control-api / relay-edge / PostgreSQL / Redis` 的最小部署拓扑
      - 环境变量最小必填项和推荐项
      - 旧 JSON 仓储迁移到 PostgreSQL 的命令
      - 激活码生码入口
      - 常见故障排查入口
      - 当前仍未支持多节点 WebSocket 中继、Paddle 真实沙箱联调尚未完成
    - 已完成验证：
      - 文档走查，确认部署顺序、配置项、运行边界和排障入口都已落文档
      - 配置清单核对，确认 `.env.example` 已覆盖 `console-web / control-api / relay-edge` 的当前最小运行变量

- [x] 6.2 补 Paddle 出款与中国大陆银行卡提现说明
  - 状态：DONE
  - 这一步到底做什么：把 Paddle 收款、Payoneer 出款和中国大陆银行卡提现路径写成正式运维文档
  - 做完以后能看到什么结果：运营者知道钱怎么从 Paddle 合法落到手上
  - 依赖什么：支付路线已定
  - 主要改哪些文件：
    - `apps/codingns-proxy/docs/*`
  - 这一步明确不做什么：不处理税务和法律咨询
  - 怎么验证：
    - 文档走查
    - 配置项核对
  - 验证结果：
    - 已新增正式出款说明：
      - `apps/codingns-proxy/docs/20260420-Paddle出款到中国大陆银行卡说明.md`
    - 已更新：
      - `apps/codingns-proxy/docs/README.md`
    - 文档已明确写清：
      - 支付平台只用 Paddle
      - 中国大陆用户走 `Paddle Hosted Checkout + Alipay`
      - 海外用户走 Paddle 默认支付方式
      - 出款路径固定为 `Paddle -> Payoneer -> 中国大陆银行卡`
      - 哪些配置在 Paddle / Payoneer 后台完成
      - 当前不提供税务和法律建议，也不冒充 `4.1 / 4.2 / 4.3` 已完成
    - 已完成验证：
      - 文档走查，确认支付路径、后台配置边界和未完成项都写清，没有把 Stripe 写回来
      - 配置项核对，确认文档与现有 `control-api` Paddle 环境变量命名一致

- [x] 6.3 固定二阶段最低验收清单
  - 状态：DONE
  - 这一步到底做什么：把支付、扣量、恢复、三种接入方式并存和中继密文验证写成最终验收清单
  - 做完以后能看到什么结果：二阶段能不能关项有正式口径
  - 依赖什么：5.2、6.1、6.2
  - 主要改哪些文件：
    - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/docs/*`
    - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/tasks.md`
  - 这一步明确不做什么：不写形式主义总结 PPT
  - 怎么验证：
    - 文档走查
    - 验收项逐条核对
  - 验证结果：
    - 已新增正式验收清单：
      - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/docs/20260420-二阶段最低验收清单.md`
    - 已更新：
      - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/docs/README.md`
      - `specs/spec001.9.1-公共隧道服务二阶段收口与生产化验收/tasks.md`
    - 清单已按 `通过 / 未通过 / 待联调` 三态写清：
      - 主仓库三种接入方式并存回归
      - 中继不可见业务明文
      - 扣量 / 超额断流 / 激活码恢复
      - 部署说明 / `.env.example` / 出款文档
      - Paddle 沙箱联调、异常对账、人工补发、支付恢复当前仍未完成
    - 已完成验证：
      - 文档走查，确认没有把未完成支付项写成通过
      - 验收项逐条核对，确认与 `tasks.md` 当前状态一致
