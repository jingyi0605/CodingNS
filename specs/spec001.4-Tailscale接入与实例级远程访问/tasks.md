# 任务清单 - spec001.4 Tailscale接入与实例级远程访问（人话版）

状态：IN_REVIEW

## 2026-04-14 进展补记

- 已启动 `spec001.4`
- 已确认这次做的是“实例级 Tailscale 接入管理”，不是 CLI 启动参数增强
- 已确认 Tailscale 只负责打通网络，不接管 CodingNS 的业务认证
- 已确认设置页需要支持动态启用、停用、绑定账号和自定义 control server
- 已确认 Host 主服务不应跟着 Tailscale 去动态改监听地址，真正动态变化的是外部暴露层

## 这份文档是干什么的

这份任务清单只负责把 “Tailscale 接入与远程访问管理” 拆成能执行、能验收、不会越做越歪的步骤。

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

## 阶段 0：先把规格和边界钉死

- [x] 0.1 启动 spec001.4 并完成主文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec001.4` 目录和 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.4` 文档骨架，任何人都知道这次解决的是实例级 Tailscale 接入，不是单纯加个启动参数
  - 依赖什么：`spec001`
  - 主要改哪些文件：
    - `specs/spec001.4-Tailscale接入与实例级远程访问/*`
  - 这一步明确不做什么：不写业务代码
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec001.4` 主文档初始化，并写清实例级配置、设置页动态启用、control server、自有认证保留和未初始化阻断边界

- [x] 0.2 回写总览和父规格，挂上 spec001.4
  - 状态：DONE
  - 这一步到底做什么：把 `spec001.4` 挂到 `spec001` 和 `specs/README.md`，避免后续继续把 Tailscale 接入需求塞回父规格正文里混做
  - 做完以后能看到什么结果：总览和父规格都能看出 `spec001.4` 是独立子问题
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 这一步明确不做什么：不改 `spec001` 主体认证设计
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已在 `specs/README.md`、`spec001/README.md`、`spec001/design.md`、`spec001/tasks.md` 中补上 `spec001.4` 的职责说明和目录挂接

---

## 阶段 1：先把实例级配置和状态真相立住

- [x] 1.1 建立实例级 Tailscale 配置与状态存储
  - 状态：DONE
  - 这一步到底做什么：新增实例级配置表和状态读写仓储，保存 `enabled`、`controlServerUrl`、`hostname`、`stateDir`、最近状态快照
  - 做完以后能看到什么结果：Tailscale 配置不再混进用户偏好，而是有正式落点
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/*`
    - `apps/host/src/types/domain.ts`
  - 这一步明确不做什么：不启动 helper，不接 UI
  - 怎么验证：
    - 仓储层测试
    - schema 走查
  - 验证结果：
    - 已新增 `instance_tailscale_config`、`instance_tailscale_status` 两张实例级表，未复用用户偏好表
    - 已新增 `InstanceTailscaleRepository`，分别覆盖配置读写和状态快照读写
    - 最近状态快照已补充 `accountName` 字段，供设置页直接展示当前绑定账号，不需要前端自己猜状态字段
    - 已在 `tests/integration/tailscale-storage-and-service.test.ts` 中覆盖建表检查、配置/状态持久化，以及未初始化实例启用时的 `blocked_uninitialized` 骨架状态

- [x] 1.2 新增 Host 侧 Tailscale 系统接口
  - 状态：DONE
  - 这一步到底做什么：新增 `status/config/enable/disable/login/logout` 这组 API
  - 做完以后能看到什么结果：前端终于有正式控制面接口可调
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/routes/*`
    - `apps/host/src/modules/*`
  - 这一步明确不做什么：先不实现真实 helper 集成
  - 怎么验证：
    - 接口测试
    - 受保护接口鉴权测试
  - 验证结果：
    - 已新增受保护接口：
      - `GET /api/system/tailscale/status`
      - `PUT /api/system/tailscale/config`
      - `POST /api/system/tailscale/enable`
      - `POST /api/system/tailscale/disable`
      - `POST /api/system/tailscale/login`
      - `POST /api/system/tailscale/logout`
    - 已新增 `TailscaleService`、`TailscaleController` 和 `registerSystemRoutes`，并接入 `create-server.ts`
    - 当前接口已能返回实例级配置 + 状态骨架，启用后在已初始化场景下进入 `needs_login`，未初始化逻辑保留为 `blocked_uninitialized`
    - 当本机缺少可执行的 `tailscale` 命令时，错误信息会直接返回中文可读说明，不再把 `TAILSCALE_CLI_UNAVAILABLE` 这种内部错误码直接展示给用户
    - 已在 `tests/integration/tailscale-system-routes.test.ts` 中覆盖默认读取、配置保存、启用/停用、登录/登出骨架流程、重启后持久化，以及未授权请求拒绝

---

## 阶段 2：把运行中的 TailscaleManager 建出来

- [x] 2.1 实现 `TailscaleManager` 状态机
  - 状态：DONE
  - 这一步到底做什么：建立 `disabled/blocked_uninitialized/starting/needs_login/running/stopping/error` 这套状态机，并统一管理状态迁移
  - 做完以后能看到什么结果：Tailscale 状态有唯一真相，不再靠页面自己猜
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/host/src/modules/tailscale/*`
    - `apps/host/src/server/create-server.ts`
  - 这一步明确不做什么：先不做 UI
  - 怎么验证：
    - 单元测试
    - 状态迁移测试
  - 验证结果：
    - 已新增 `TailscaleManager`，把 `enable/disable/login/logout` 的状态迁移从 `TailscaleService` 中收口出来
    - 已把 `disabled/blocked_uninitialized/starting/needs_login/running/stopping/error` 的合法迁移规则固定在 manager 内部，非法切换会直接拒绝
    - `TailscaleService` 现在只负责实例级配置读写和 Host API DTO 组装，不再自己拼 phase 真相
    - 已在 `tests/integration/tailscale-manager.test.ts` 中覆盖启用进入 `needs_login`、运行态回写、错误态回退、非法迁移拒绝等状态迁移测试

- [x] 2.2 接入 helper 生命周期管理
  - 状态：DONE
  - 这一步到底做什么：让 Manager 能启动、停止、监控 helper，并同步退出错误
  - 做完以后能看到什么结果：系统不只是保存了开关，而是真的能管进程
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/host/src/modules/tailscale/*`
    - `packages/codingns/*`
    - helper 相关代码
  - 这一步明确不做什么：不把 Tailscale 逻辑塞进前端
  - 怎么验证：
    - 进程生命周期测试
    - 异常退出测试
  - 验证结果：
    - 已新增 `TailscaleHelperClient` 和 `TailscaleHelperProcess`，由 `TailscaleManager` 统一管理 helper 启停、状态同步和异常退出回写
    - helper 第一阶段直接包装真实 `tailscale` CLI，已接通 `status --json`、`up`、`login`、`down`、`logout`、`set --hostname`
    - helper 现在会在裸命令不可用时自动回退到常见安装路径，优先兼容 macOS 下桌面端 PATH 不完整导致的误判
    - `TailscaleManager.restoreOnStartup()` 已在 Host 启动时执行，会按实例级配置恢复 helper 生命周期
    - 已在 `tests/integration/tailscale-helper-client.test.ts`、`tests/integration/tailscale-manager.test.ts` 中覆盖 helper 进程管理、状态读取和异常路径

- [x] 2.3 实现未初始化实例阻断
  - 状态：DONE
  - 这一步到底做什么：在启用流程里检查 bootstrap 状态，未初始化时禁止正式对外暴露
  - 做完以后能看到什么结果：不会把首个管理员 setup 入口暴露到 tailnet
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/host/src/modules/tailscale/*`
    - `apps/host/src/modules/bootstrap/*`
  - 这一步明确不做什么：不改现有 bootstrap 协议
  - 怎么验证：
    - 未初始化阻断测试
    - 初始化后再启用测试
  - 验证结果：
    - `TailscaleManager.enable()` 已统一检查 bootstrap 状态，未初始化实例只会进入 `blocked_uninitialized`，不会进入 `starting/running`
    - 已初始化实例启用后会按状态机进入 `needs_login`，后续等待 helper/登录流程继续推进
    - 已在 `tests/integration/tailscale-storage-and-service.test.ts`、`tests/integration/tailscale-manager.test.ts`、`tests/integration/tailscale-system-routes.test.ts` 中覆盖未初始化阻断和初始化后启用的对照场景

---

## 阶段 3：把设置页入口和交互接上

- [x] 3.1 设置页新增 Tailscale 面板
  - 状态：DONE
  - 这一步到底做什么：在设置页新增独立面板，展示开关、control server、hostname、状态、错误和地址
  - 做完以后能看到什么结果：管理员不需要离开应用就能管理 Tailscale
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `apps/user-app/src/settings/*`
    - i18n 字典
  - 这一步明确不做什么：先不做复杂日志面板
  - 怎么验证：
    - 组件测试
    - 手动走查
  - 验证结果：
    - 已新增 `apps/user-app/src/settings/TailscalePanel.tsx`
    - 桌面端设置页已新增独立“远程访问”区块，移动端已新增 `remote-access` 分类入口
    - 设置页主视图现已收敛为状态摘要 + 关键操作，不再把全部配置和详细地址直接摊开
    - 已移除远程访问区块外层的 `Tailscale 接入` 标题说明，避免重复文案堆叠
    - `control server`、设备名称和详细地址已收进配置模态框，主界面进一步压缩为 4 个核心状态项，并改成每行两列的紧凑网格
    - 每个状态卡片内部已改成单行布局，左侧显示标签，右侧显示值，视觉上改成更简约的 macOS 指标行样式
    - 状态指示器已从大标签改成小圆点 + 状态文字，使用绿灯 / 黄灯 / 灰灯三档
    - 指标卡高度和内部上下留白已收紧，并与下方按钮区补出额外间距，避免贴在一起
    - 当 Host 检测到当前机器缺少 `tailscale` CLI 时，设置页会直接显示“一键安装 Tailscale”入口；macOS 和 Windows 会分别跳到官方安装页
      - 状态指示器
      - 服务器地址
      - 账号名
      - IP 地址
    - 已补齐 `zh-CN`、`en-US` i18n 文案，并为面板新增必要样式

- [x] 3.2 接通启用、停用和配置保存
  - 状态：DONE
  - 这一步到底做什么：把设置页表单和 Host API 接通，完成保存配置、启用和停用主流程
  - 做完以后能看到什么结果：设置页不再是摆设，真的能控制实例级状态
  - 依赖什么：3.1、2.2
  - 主要改哪些文件：
    - 设置页组件
    - 前端 API 封装
    - 相关测试
  - 这一步明确不做什么：先不做授权链接轮询优化
  - 怎么验证：
    - 前端集成测试
    - 联调验证
  - 验证结果：
    - 已新增前端 API 封装 `apps/user-app/src/platform/server/tailscale-manager.ts`
    - 设置页已接通 `GET status`、`PUT config`、`POST enable`、`POST disable`
    - 当前实现会在启用前先保存脏配置，避免 control server / hostname 改了但启用时没落盘
    - 配置保存入口已从主界面移动到模态框，避免设置页出现过长表单
    - 点击安装入口后，页面会在应用重新获得焦点或重新可见时自动重检 Tailscale 状态，不需要用户手动再配 CLI 路径
    - 已在 `src/settings/TailscalePanel.test.tsx` 中覆盖配置保存、启用和停用相关交互骨架

- [x] 3.3 接通登录绑定和解绑交互
  - 状态：DONE
  - 这一步到底做什么：在设置页里提供获取登录链接、查看待授权状态、主动解绑
  - 做完以后能看到什么结果：用户能在 UI 内完成绑定流程闭环
  - 依赖什么：3.2
  - 主要改哪些文件：
    - 设置页组件
    - 前端 API 封装
    - helper / manager 状态接口
  - 这一步明确不做什么：不接入业务 SSO
  - 怎么验证：
    - 组件测试
    - 联调验证
  - 验证结果：
    - 设置页已接通 `POST login`、`POST logout`
    - `needs_login` 状态下会显示授权链接，管理员可以直接跳到 Tailscale 登录页面完成绑定
    - 已在 `src/settings/TailscalePanel.test.tsx` 中覆盖登录链接展示、绑定动作和解绑入口

---

## 阶段 4：联调、恢复和回归

- [x] 4.1 实现启用后的状态刷新与地址更新
  - 状态：DONE
  - 这一步到底做什么：让设置页能在合理时间内看到最新 phase、FQDN、IP 和访问地址
  - 做完以后能看到什么结果：用户不用刷新整页去猜是否成功
  - 依赖什么：3.3
  - 主要改哪些文件：
    - Host 状态接口
    - 前端轮询或状态刷新逻辑
  - 这一步明确不做什么：先不加独立实时频道
  - 怎么验证：
    - 状态更新测试
    - 手动联调
  - 验证结果：
    - `TailscalePanel` 已在初次打开时拉取状态，并每 5 秒轮询一次最新状态
    - 面板已提供显式“刷新状态”按钮，方便管理员立即同步 phase 和地址变化
    - 已在 `src/settings/TailscalePanel.test.tsx` 中覆盖刷新后 `reachableBaseUrl` 更新
    - 已修正账号名来源，设置页现在只展示 Tailscale 用户账号字段，不再把 tailnet 域名误显示成账号名
    - 已把 `reachableBaseUrl` 从 Host API 端口切换为前端访问入口端口；调试模式默认走前端开发端口 `4174`，也可通过 `CODINGNS_WEB_UI_PORT` 覆盖
    - npm 包安装模式下，前端由 Host 自己托管，外部暴露端口会直接跟随 `codingns start --port` 的参数值，不再被开发态端口覆盖

- [x] 4.2 实现重启后的自动恢复
  - 状态：DONE
  - 这一步到底做什么：让 Host 重启后按实例级配置恢复 Tailscale 接入状态
  - 做完以后能看到什么结果：用户不用每次手动重新启用
  - 依赖什么：2.2、4.1
  - 主要改哪些文件：
    - `apps/host/src/server/create-server.ts`
    - `apps/host/src/modules/tailscale/*`
  - 这一步明确不做什么：不扩展到多 tailnet
  - 怎么验证：
    - 重启恢复测试
    - 联调验证
  - 验证结果：
    - Host 启动时已调用 `TailscaleManager.restoreOnStartup()`，会根据实例级配置尝试恢复 Tailscale 状态
    - `status/config` 会继续从 SQLite 中读取实例级真相，不依赖前端缓存
    - 已在 `tests/integration/tailscale-system-routes.test.ts`、`tests/integration/tailscale-manager.test.ts` 中覆盖配置持久化和重启后恢复路径

- [ ] 4.3 全链路回归
  - 状态：IN_REVIEW
  - 这一步到底做什么：验证“未初始化阻断 -> 初始化 -> 启用 -> 绑定 -> 外部访问 -> 业务登录 -> 停用”整条主流程
  - 做完以后能看到什么结果：这套能力不是纸面设计
  - 依赖什么：4.2
  - 主要改哪些文件：
    - 自动化测试
    - 验收记录文档
  - 这一步明确不做什么：不继续扩 scope
  - 怎么验证：
    - 自动化测试
    - 手动验收清单
  - 当前复核情况：
    - Host 侧自动化测试已覆盖未初始化阻断、启用、登录/登出、状态持久化、helper 生命周期和重启恢复
    - 前端自动化测试已覆盖设置页入口、配置保存、启用、绑定、刷新和地址更新
    - 真实 tailnet 外部设备访问 + CodingNS 业务登录的人工验收还没有在带 `tailscale` 环境的机器上走完，因此暂时保留 `IN_REVIEW`
