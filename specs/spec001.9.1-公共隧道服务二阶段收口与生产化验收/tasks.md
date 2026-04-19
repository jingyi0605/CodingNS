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

- [ ] 2.1 把控制面文件仓储迁移到正式数据库
  - 状态：TODO
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

- [ ] 2.2 实现正式域名池和绑定生命周期
  - 状态：TODO
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

---

## 阶段 3：把数据面补到生产化最低标准

- [ ] 3.1 为 `relay-edge` 引入共享状态和正式回收
  - 状态：TODO
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

- [ ] 3.2 把 usage 扣量补成幂等链路
  - 状态：TODO
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

---

## 阶段 4：把支付和流量闭环真正做完

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

- [ ] 4.2 增加对账能力和人工补发工具
  - 状态：TODO
  - 这一步到底做什么：补支付事件、发量记录和按订单补发 / 重放能力
  - 做完以后能看到什么结果：支付异常时可以人工修复，不必改库碰运气
  - 依赖什么：4.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/apps/control-api/src/*`
    - 新增工具脚本或受保护接口
    - 相关文档
  - 这一步明确不做什么：不做完整运营后台
  - 怎么验证：
    - 重复回调测试
    - 补发测试
    - 对账文档走查

- [ ] 4.3 固定“扣量、超额断流、购买恢复”闭环
  - 状态：TODO
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

---

## 阶段 5：收口主仓库回归和安全验收

- [ ] 5.1 补齐主仓库公共隧道回归基线
  - 状态：TODO
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

- [ ] 5.2 补“中继不可见业务明文”的正式验收记录
  - 状态：TODO
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

---

## 阶段 6：补运维文档并形成上线基线

- [ ] 6.1 补部署说明、环境变量样例和运维文档
  - 状态：TODO
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

- [ ] 6.2 补 Paddle 出款与中国大陆银行卡提现说明
  - 状态：TODO
  - 这一步到底做什么：把 Paddle 收款、Payoneer 出款和中国大陆银行卡提现路径写成正式运维文档
  - 做完以后能看到什么结果：运营者知道钱怎么从 Paddle 合法落到手上
  - 依赖什么：4.1
  - 主要改哪些文件：
    - `apps/codingns-proxy/docs/*`
  - 这一步明确不做什么：不处理税务和法律咨询
  - 怎么验证：
    - 文档走查
    - 配置项核对

- [ ] 6.3 固定二阶段最低验收清单
  - 状态：TODO
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
