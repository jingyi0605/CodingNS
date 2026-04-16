# 任务清单 - spec001.3.1 桌面端本机HOST自动发现（人话版）

状态：Draft

## 2026-04-16 进展补记

- 已启动 `spec001.3.1`
- 已明确这次只做 `Windows/macOS` 桌面端本机 `codingns` Host 自动发现
- 已明确自动发现 HOST 必须单独归类，不得直接污染手工 `hosts[]`
- 已明确自动发现 HOST 的用户名、密码仍然走本地凭据存储，而不是塞进 HOST 元数据

## 这份文档是干什么的

这份任务清单只负责把“桌面端自动发现本机 HOST”拆成能执行、能验收、不会越做越烂的步骤。

要求很简单：

1. 这一步到底建什么
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

## 阶段 0：先把子规格挂起来

- [x] 0.1 启动 `spec001.3.1` 并完成主文档初始化
  - 状态：DONE
  - 这一步到底做什么：建立 `spec001.3.1` 目录和 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.3.1` 文档骨架，任何人都知道这次只做桌面端本机 HOST 自动发现
  - 依赖什么：`spec001.3`
  - 主要改哪些文件：
    - `specs/spec001.3.1-桌面端本机HOST自动发现/*`
  - 这一步明确不做什么：不写业务代码
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成 `spec001.3.1` 主文档初始化，并写清自动发现分类、去重和本地凭据边界

- [x] 0.2 回写总览和父规格，挂上 `spec001.3.1`
  - 状态：DONE
  - 这一步到底做什么：把 `spec001.3.1` 挂到 `spec001.3`、`spec001` 和 `specs/README.md`
  - 做完以后能看到什么结果：总览和父规格都能看出“桌面端本机 HOST 自动发现”是独立子问题
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
    - `specs/spec001.3-多HOST接入与跨端切换/README.md`
    - `specs/spec001.3-多HOST接入与跨端切换/design.md`
    - `specs/spec001.3-多HOST接入与跨端切换/tasks.md`
  - 这一步明确不做什么：不改现有 `spec001.3` 的主体需求
  - 怎么验证：
    - 文档走查
  - 验证结果：
    - 已完成总览和父规格挂载，`specs/README.md`、`spec001`、`spec001.3` 均已补入 `spec001.3.1` 入口和边界说明

---

## 阶段 1：先把数据真相和桌面桥边界定住

- [ ] 1.1 定义自动发现 HOST 的运行时数据结构
  - 状态：TODO
  - 这一步到底做什么：新增 `discoveredHosts[]`、扫描状态和自动发现 HOST 的稳定凭据键规则
  - 做完以后能看到什么结果：自动发现结果终于有自己的真相层，不再硬塞进手工 `hosts[]`
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/user-app/src/config/*`
    - `apps/user-app/src/features/workbench/*`
    - 相关测试
  - 这一步明确不做什么：先不做实际桌面进程扫描
  - 怎么验证：
    - 单元测试
    - 文档与代码结构走查

- [ ] 1.2 定义桌面壳进程扫描桥接口
  - 状态：TODO
  - 这一步到底做什么：在 `apps/desktop/src-tauri` 设计扫描本机 `codingns` 进程的命令、返回 DTO 和错误码
  - 做完以后能看到什么结果：前端有正式桌面桥可调用，不需要自己猜系统命令
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/desktop/src-tauri/src/lib.rs`
    - 新增或补充桌面端扫描模块
    - `apps/user-app/src/platform/platform-adapter.ts`
  - 这一步明确不做什么：先不把扫描结果接到 UI
  - 怎么验证：
    - Rust 单测
    - 桌面桥调用测试

---

## 阶段 2：实现扫描、探活、去重

- [ ] 2.1 Windows、macOS 本机进程扫描落地
  - 状态：TODO
  - 这一步到底做什么：实现两端系统下的进程枚举和命令行解析，识别 `codingns start`、`npx codingns`、`node codingns.mjs`
  - 做完以后能看到什么结果：桌面壳能返回一批候选本机 HOST 线索
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/desktop/src-tauri/src/*`
    - 相关测试
  - 这一步明确不做什么：先不处理 UI 展示
  - 怎么验证：
    - Rust 单测
    - 桌面端手动样例验证

- [ ] 2.2 在客户端建立自动发现运行时 store
  - 状态：TODO
  - 这一步到底做什么：调用桌面桥、对候选地址做 `probeHost`、维护 `discoveredHosts[]` 和冷却窗口
  - 做完以后能看到什么结果：前端有一份稳定的自动发现结果，可以被 HOST 列表直接消费
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/user-app/src/config/*`
    - `apps/user-app/src/network/*`
    - 相关测试
  - 这一步明确不做什么：先不改现有 HOST 列表外观
  - 怎么验证：
    - 单元测试
    - 探活回归测试

- [ ] 2.3 把自动发现 HOST 与手动 HOST 按地址去重
  - 状态：TODO
  - 这一步到底做什么：实现自动发现内部去重，以及自动发现与手动 HOST 的去重合并
  - 做完以后能看到什么结果：同一地址只显示一条，不会把列表变成垃圾场
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/workbench/*`
    - `apps/user-app/src/config/*`
    - 相关测试
  - 这一步明确不做什么：先不引入“另存为手动 HOST”
  - 怎么验证：
    - 去重测试
    - HOST 列表回归测试

---

## 阶段 3：把 UI 和凭据接上

- [ ] 3.1 在 HOST 列表里增加“自动发现”分类
  - 状态：TODO
  - 这一步到底做什么：在桌面端 HOST 切换菜单里加自动发现分组，并展示本机发现结果
  - 做完以后能看到什么结果：用户能一眼看到“手动 HOST”和“自动发现 HOST”
  - 依赖什么：2.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/workbench/components/WorkbenchHostSwitcher.tsx`
    - `apps/user-app/src/app/workbench-native.css`
    - `apps/user-app/src/shared/i18n/index.ts`
    - 相关测试
  - 这一步明确不做什么：先不做复杂管理面板
  - 怎么验证：
    - 组件测试
    - 桌面端手动验收

- [ ] 3.2 为自动发现 HOST 接入用户名、密码本地保存
  - 状态：TODO
  - 这一步到底做什么：让自动发现 HOST 使用稳定凭据键保存和回填用户名、密码
  - 做完以后能看到什么结果：用户给自动发现 HOST 填过一次凭据，下次再出现时能回填
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/auth/store/*`
    - `apps/user-app/src/features/workbench/components/WorkbenchHostSwitcher.tsx`
    - 相关测试
  - 这一步明确不做什么：不改 Host 后端认证协议
  - 怎么验证：
    - remember password 测试
    - HOST 列表回填测试

---

## 阶段 4：收口体验和回归

- [ ] 4.1 扫描失败、无结果、冷却窗口体验收口
  - 状态：TODO
  - 这一步到底做什么：把“未发现”“扫描中”“扫描失败”“冷却复用”这些状态做清楚
  - 做完以后能看到什么结果：自动发现不是黑盒，失败时用户也知道发生了什么
  - 依赖什么：3.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/workbench/*`
    - `apps/user-app/src/shared/i18n/index.ts`
    - 相关测试
  - 这一步明确不做什么：不做复杂诊断中心
  - 怎么验证：
    - 状态测试
    - 手动回归

- [ ] 4.2 建立最低验收集
  - 状态：TODO
  - 这一步到底做什么：固定最小验收口径，包括 Windows/macOS 发现、去重、凭据回填和手动 HOST 兼容
  - 做完以后能看到什么结果：后面改动这条链路时有明确回归基线
  - 依赖什么：4.1
  - 主要改哪些文件：
    - `specs/spec001.3.1-桌面端本机HOST自动发现/docs/*`
    - 测试文件
  - 这一步明确不做什么：不做完整自动化 E2E 平台
  - 怎么验证：
    - 文档走查
    - 回归用例核对
