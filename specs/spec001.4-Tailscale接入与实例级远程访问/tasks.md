# 任务清单 - spec001.4 Tailscale接入与实例级远程访问（人话版）

状态：Draft

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

- [ ] 1.1 建立实例级 Tailscale 配置与状态存储
  - 状态：TODO
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

- [ ] 1.2 新增 Host 侧 Tailscale 系统接口
  - 状态：TODO
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

---

## 阶段 2：把运行中的 TailscaleManager 建出来

- [ ] 2.1 实现 `TailscaleManager` 状态机
  - 状态：TODO
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

- [ ] 2.2 接入 helper 生命周期管理
  - 状态：TODO
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

- [ ] 2.3 实现未初始化实例阻断
  - 状态：TODO
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

---

## 阶段 3：把设置页入口和交互接上

- [ ] 3.1 设置页新增 Tailscale 面板
  - 状态：TODO
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

- [ ] 3.2 接通启用、停用和配置保存
  - 状态：TODO
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

- [ ] 3.3 接通登录绑定和解绑交互
  - 状态：TODO
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

---

## 阶段 4：联调、恢复和回归

- [ ] 4.1 实现启用后的状态刷新与地址更新
  - 状态：TODO
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

- [ ] 4.2 实现重启后的自动恢复
  - 状态：TODO
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

- [ ] 4.3 全链路回归
  - 状态：TODO
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
