# 任务清单 - spec001.8-登录设备管理与主设备控制（人话版）

状态：IN_PROGRESS

## 2026-04-18 进展补记

- 已启动 `spec001.8`
- 已确认主设备不唯一，由当前登录设备通过管理员密码显式设置
- 已确认最近登录记录只保留 10 条
- 已确认来源地址只展示 Host 解析到的地址，不做地区解析
- 已确认第一阶段不把 `token` 直接当设备，而是拆成设备、设备会话和最近登录事件
- 已补设备显示名识别：新登录会根据客户端类型和 `User-Agent` 生成 `Desktop · macOS`、`Safari · macOS` 这类可读名称
- 已补设备结构化详情：设备接口现在会返回浏览器名、浏览器版本、系统名、系统版本
- 已补设备图标展示：设置页弹窗使用本地 SVG 图标显示常见客户端、浏览器和操作系统，不额外引入三方图标库
- 已把设备图标切换为成熟依赖：设置页设备弹窗改为使用 `react-icons`，品牌图标直接复用其 `Simple Icons` 子集，不再单独维护本地图标资源
- 已把设备卡片改成紧凑布局：去掉重复的客户端图标徽章，把浏览器/系统信息并入元信息行，当前设备和最近登录记录都同步收缩高度
- 已把退出设备方式改成逐设备退出：前端不再提供粗暴的“退出其他设备”主按钮，改为在每条其他在线设备记录上单独提供退出按钮；Host 同步新增按 `deviceId` 撤销指定设备的接口
- 已把设备卡片进一步收成浅玻璃面板：卡片底板、图标容器、按钮和标签统一改为更克制的浅灰玻璃材质；当前设备取消明显蓝色边框，改成低对比选中态
- 已把设备标签和操作按钮继续收回 macOS 原生灰阶：去掉当前设备/主设备标签和退出设备按钮上的蓝红语义色，只保留中性灰层级区分

## 2026-04-18 自动化验证记录

- Host 定向验证：
  - `pnpm --filter host exec vitest run tests/spec001/host-foundation.e2e.test.ts tests/integration/auth-login-captcha.test.ts tests/integration/auth-device-management.test.ts`
- User App 定向验证：
  - `pnpm --filter user-app exec vitest run src/network/http-client.test.ts src/settings/AuthDeviceManagementPanel.test.tsx src/features/settings/pages/SettingsPage.test.tsx`
- 本轮设备识别增强验证：
  - `pnpm --filter host exec vitest run tests/integration/auth-device-management.test.ts tests/integration/sqlite-bootstrap.test.ts`
  - `pnpm --filter user-app exec vitest run src/settings/AuthDeviceManagementPanel.test.tsx src/features/settings/pages/SettingsPage.test.tsx`
- 本轮设备详情与图标增强验证：
  - `pnpm --filter host exec tsc --noEmit`
  - `pnpm --filter user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --filter user-app exec tsc --noEmit -p tsconfig.node.json`
  - `pnpm --filter host exec vitest run tests/integration/auth-device-management.test.ts tests/integration/sqlite-bootstrap.test.ts`
  - `pnpm --filter user-app exec vitest run src/settings/AuthDeviceManagementPanel.test.tsx src/features/settings/pages/SettingsPage.test.tsx`
- 本轮图标库替换验证：
  - `pnpm --filter user-app add react-icons@^5.6.0`
  - `pnpm --filter user-app exec tsc --noEmit -p tsconfig.json`
  - `pnpm --filter user-app exec tsc --noEmit -p tsconfig.node.json`
  - `pnpm --filter user-app exec vitest run src/settings/AuthDeviceManagementPanel.test.tsx src/features/settings/pages/SettingsPage.test.tsx`
- 本轮设备卡片玻璃风格收敛验证：
  - `pnpm --filter user-app exec vitest run src/settings/AuthDeviceManagementPanel.test.tsx src/features/settings/pages/SettingsPage.test.tsx`
- 结果：
  - 上述命令均返回 exit code `0`
  - Host 覆盖了主设备设置、主设备退出其他设备、旧登录态兜底和最近 10 条记录裁剪
  - User App 覆盖了设备管理面板加载、设备详情展示、设为主设备、退出其他设备和设置页挂载

## 这份文档是干什么的

这份任务清单只回答这些问题：

- 设备管理到底先做什么，后做什么
- 哪些改动会进 Host，哪些改动会进设置页
- 哪些事情这一步明确不做
- 每一阶段怎么验证不是“看着像做了”

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：完成并已回写
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 的任务才能勾成 `[x]`
- 每做完一个任务，都要立刻回写这份文档
- `BLOCKED` 和 `CANCELLED` 必须写清楚卡在哪

---

## 阶段 0：先把边界和总览钉死

- [x] 0.1 建立 `spec001.8` 文档骨架
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`，把设备、设备会话、最近登录记录和主设备边界写清楚。
  - 做完以后能看到什么结果：仓库里出现完整的 `spec001.8` 目录，后续实现不再靠聊天记录兜底。
  - 依赖什么：无
  - 主要改哪些文件：
    - `specs/spec001.8-登录设备管理与主设备控制/*`
  - 这一步先不做什么：不直接改实现代码。
  - 怎么验证：
    - 文档走查
  - 回写时间：2026-04-18

- [x] 0.2 更新总览和父 Spec 入口
  - 状态：DONE
  - 这一步到底做什么：把 `specs/README.md` 和 `spec001` 主文档挂上 `spec001.8`，避免新 Spec 变成游离目录。
  - 做完以后能看到什么结果：总览和父 Spec 都能找到这份子规格。
  - 依赖什么：0.1
  - 主要改哪些文件：
    - `specs/README.md`
    - `specs/spec001-平台底座与工作区基础/README.md`
    - `specs/spec001-平台底座与工作区基础/design.md`
    - `specs/spec001-平台底座与工作区基础/tasks.md`
  - 这一步先不做什么：不修改父 Spec 主体需求。
  - 怎么验证：
    - 文档走查
  - 回写时间：2026-04-18

---

## 阶段 1：Host 先把设备数据结构补对

- [x] 1.1 增加设备、设备会话和最近登录事件表
  - 状态：DONE
  - 这一步到底做什么：在 SQLite 里新增 `auth_devices`、`auth_device_sessions`、`auth_login_events`，并扩展 `auth_tokens` 的设备关联字段。
  - 做完以后能看到什么结果：Host 有正式的数据落点，不再硬拿 token 猜设备。
  - 依赖什么：0.2
  - 主要改哪些文件：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/*`
    - 对应类型定义
  - 这一步先不做什么：不接设置页 UI。
  - 怎么验证：
    - `pnpm --filter host exec vitest run tests/integration/auth-device-management.test.ts`
    - schema 走查
  - 回写时间：2026-04-18

- [x] 1.2 接入登录成功后的设备识别与登录事件写入
  - 状态：DONE
  - 这一步到底做什么：在登录流程里解析 `clientType/clientInstanceId/sourceAddress`，查找或创建设备、绑定设备会话，并记录最近登录事件。
  - 做完以后能看到什么结果：每次成功登录都会落到设备管理链路上。
  - 依赖什么：1.1
  - 主要改哪些文件：
    - `apps/host/src/modules/auth/auth-service.ts`
    - `apps/host/src/modules/auth/*`
    - `apps/host/src/middlewares/auth-guard.ts`
  - 这一步先不做什么：不实现退出其他设备。
  - 怎么验证：
    - `pnpm --filter host exec vitest run tests/integration/auth-device-management.test.ts`
    - 验证同一 `clientInstanceId` 不重复创建设备
  - 回写时间：2026-04-18

- [x] 1.3 接入刷新链路的设备补齐和最近在线更新时间
  - 状态：DONE
  - 这一步到底做什么：让刷新 token 仍然绑定原设备会话，并更新设备最近在线时间与来源地址。
  - 做完以后能看到什么结果：同一设备刷新 token 不会被拆成新设备。
  - 依赖什么：1.2
  - 主要改哪些文件：
    - `apps/host/src/modules/auth/auth-service.ts`
    - 相关仓储与测试
  - 这一步先不做什么：不新增主设备动作。
  - 怎么验证：
    - `pnpm --filter host exec vitest run tests/integration/auth-device-management.test.ts`
    - 刷新前后设备 ID 保持一致
    - 最近登录记录条数不因刷新增加
  - 回写时间：2026-04-18

---

## 阶段 2：补设备管理接口和主设备动作

- [x] 2.1 新增设备管理读取接口
  - 状态：DONE
  - 这一步到底做什么：提供 `GET /api/auth/devices`，统一返回当前设备、其他在线设备和最近 10 条登录记录。
  - 做完以后能看到什么结果：前端可以直接拉设备管理数据，不用自己拼三路接口。
  - 依赖什么：1.3
  - 主要改哪些文件：
    - `apps/host/src/modules/auth/*`
    - `apps/host/src/routes/auth.ts`
    - DTO 定义
  - 这一步先不做什么：不加设置页 UI。
  - 怎么验证：
    - `pnpm --filter host exec vitest run tests/integration/auth-device-management.test.ts`
    - 集成测试校验列表结构、排序和 10 条裁剪结果
  - 回写时间：2026-04-18

- [x] 2.2 新增当前设备设置/取消主设备接口
  - 状态：DONE
  - 这一步到底做什么：提供 `POST /api/auth/devices/current/primary`，要求管理员密码校验后更新当前设备主设备状态。
  - 做完以后能看到什么结果：当前设备可以正式成为主设备或取消主设备。
  - 依赖什么：2.1
  - 主要改哪些文件：
    - `apps/host/src/modules/auth/auth-controller.ts`
    - `apps/host/src/modules/auth/auth-service.ts`
    - `apps/host/src/routes/auth.ts`
  - 这一步先不做什么：不做逐设备命名。
  - 怎么验证：
    - `pnpm --filter host exec vitest run tests/integration/auth-device-management.test.ts`
    - 密码正确时设置成功
    - 密码错误时返回明确错误
    - 主设备允许多台并存
  - 回写时间：2026-04-18

- [x] 2.3 新增主设备退出其他设备接口
  - 状态：DONE
  - 这一步到底做什么：提供 `POST /api/auth/devices/logout-others`，只允许主设备批量撤销其他交互式设备会话。
  - 做完以后能看到什么结果：主设备可以把其他设备全部踢下线，自己不受影响。
  - 依赖什么：2.2
  - 主要改哪些文件：
    - `apps/host/src/modules/auth/auth-service.ts`
    - `apps/host/src/modules/auth/auth-controller.ts`
    - 相关仓储与测试
  - 这一步先不做什么：不做逐个设备单独下线。
  - 怎么验证：
    - `pnpm --filter host exec vitest run tests/integration/auth-device-management.test.ts`
    - 非主设备调用被拒绝
    - 主设备调用后其他设备请求变成未授权
    - 当前设备仍可继续访问
  - 回写时间：2026-04-18

---

## 阶段 3：设置页补正式入口

- [x] 3.1 新增前端设备管理 API 封装
  - 状态：DONE
  - 这一步到底做什么：在 `user-app` 里增加设备管理 DTO 和请求函数。
  - 做完以后能看到什么结果：设置页组件不再自己拼设备管理请求。
  - 依赖什么：2.3
  - 主要改哪些文件：
    - `apps/user-app/src/features/settings/api/*`
  - 这一步先不做什么：不写复杂样式。
  - 怎么验证：
    - `pnpm --filter user-app exec vitest run src/network/http-client.test.ts`
  - 回写时间：2026-04-18

- [x] 3.2 桌面端设置页增加登录设备管理区块
  - 状态：DONE
  - 这一步到底做什么：在 `安全与隐私` 分区内增加当前设备、其他在线设备、最近登录记录和主设备动作入口。
  - 做完以后能看到什么结果：桌面端用户可以在设置页正式管理登录设备。
  - 依赖什么：3.1
  - 主要改哪些文件：
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - 新增设备管理面板组件
    - i18n 字典
  - 这一步先不做什么：不顺手改登录页。
  - 怎么验证：
    - `pnpm --filter user-app exec vitest run src/settings/AuthDeviceManagementPanel.test.tsx src/features/settings/pages/SettingsPage.test.tsx`
    - `SettingsPage.test.tsx`
    - 设备管理组件测试
  - 回写时间：2026-04-18

- [x] 3.3 移动端设置页补设备管理区块
  - 状态：DONE
  - 这一步到底做什么：在移动端 `安全与隐私` 页面里补相同能力，保证手机端也能做主设备设置和退出其他设备。
  - 做完以后能看到什么结果：移动端不是只能看，能真正操作。
  - 依赖什么：3.2
  - 主要改哪些文件：
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - i18n 字典
  - 这一步先不做什么：不新增新的顶级导航。
  - 怎么验证：
    - `pnpm --filter user-app exec vitest run src/features/settings/pages/SettingsPage.test.tsx`
    - 移动端 `SettingsPage` 测试覆盖入口与交互
  - 回写时间：2026-04-18

---

## 阶段 4：兼容性和验收

- [x] 4.1 补旧登录态兼容测试和回归清单
  - 状态：DONE
  - 这一步到底做什么：验证没有设备元数据的旧 token 仍能继续登录访问，并在设备页得到兜底展示。
  - 做完以后能看到什么结果：这次改动不会把现网老登录态一锅端。
  - 依赖什么：3.3
  - 主要改哪些文件：
    - `apps/host/tests/integration/*`
    - `specs/spec001.8-登录设备管理与主设备控制/docs/*`
  - 这一步先不做什么：不扩 Scope。
  - 怎么验证：
    - `pnpm --filter host exec vitest run tests/integration/auth-device-management.test.ts`
    - 自动化测试
  - 回写时间：2026-04-18

- [ ] 4.2 形成验收记录
  - 状态：TODO
  - 这一步到底做什么：把桌面端、移动端、主设备设置、退出其他设备和最近 10 条记录的手工验证结果回写到文档。
  - 做完以后能看到什么结果：别人接手时知道这功能在哪些路径上验过。
  - 依赖什么：4.1
  - 主要改哪些文件：
    - `specs/spec001.8-登录设备管理与主设备控制/docs/*`
    - `tasks.md`
  - 这一步先不做什么：不再新增功能。
  - 怎么验证：
    - 文档和自动化结果走查
