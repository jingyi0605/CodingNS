# 设计文档 - spec001.6-客户端与服务端统一更新机制

状态：Draft

## 1. 概述

### 1.1 目标

- 把桌面端、Android、服务端三条更新链路分开设计、统一入口
- macOS / Windows 改成正式桌面更新机制，不再维护手搓下载器
- Android 明确走 `APK` 直装，不假装能静默安装
- 服务端把“检查 npm 包更新”和“执行全局升级”接进统一后台任务体系
- 设置页的软件更新区域真正能反映状态，不再只给半套按钮

### 1.2 覆盖需求

- `requirements.md` 需求 1：桌面端必须能检测到新版本并触发正式安装流程
- `requirements.md` 需求 2：桌面端发布链路必须提供安装更新所需的签名与发布元数据
- `requirements.md` 需求 3：Android 客户端必须支持 `APK` 直装更新
- `requirements.md` 需求 4：Android 更新流程必须明确承认系统限制
- `requirements.md` 需求 5：服务端必须能检测受管全局 npm 包是否有更新
- `requirements.md` 需求 6：服务端必须支持点击后自动执行全局 npm 包升级
- `requirements.md` 需求 7：服务端更新后必须明确区分“包已升级”和“当前进程已切到新版本”
- `requirements.md` 需求 8：设置页必须提供统一的更新入口和可读状态

### 1.3 技术约束

- 桌面端继续使用 `Tauri 2`
- Android 继续基于 `Tauri Mobile` 的 `apps/user-app/src-tauri`
- 服务端继续使用 `Node.js 22 + Fastify`
- 后台升级任务必须接入 `TaskManager`
- 当前受管服务包默认至少包含 `@jingyi0605/codingns`
- Android 第一版只支持 `APK` 直装，不支持静默安装

### 1.4 当前实现判断

- 桌面端前端已经有更新面板，但 Rust 侧仍是手搓下载器
- Android 已有壳和打包脚本，但没有正式更新链路
- 服务端已经能查 registry 版本，但没有执行更新接口
- 现在的服务端升级命令展示也不够准确，第一版要修成真实可执行的全局升级动作

### 1.5 现状盘点结论

详细盘点见：

- [20260415-更新机制现状盘点.md](/Users/jackson/Code/CodingNS/specs/spec001.6-客户端与服务端统一更新机制/docs/20260415-更新机制现状盘点.md)

这里先把结论钉死：

- 桌面端：有 UI、有桥接命令、有回退入口，但底层还是私有下载器，不是正式 updater
- Android：只有壳、打包脚本和 `FileProvider`，没有真正的更新实现
- 服务端：只有单包版本检查，没有全局升级任务、没有安装接口、没有“需要重启”状态
- 发布流水线：桌面端能出安装包，但还不是正式更新产物链路；Android 还没有客户端可直接消费的发布清单

## 2. 架构

### 2.1 总体结构

这次不搞“一套更新器打天下”，而是三条链路并行：

1. **Desktop Update**  
   由桌面壳自己完成检查、下载和安装，元数据来源于公开发布端点，不依赖当前 Host 是否在线。
2. **Android APK Update**  
   由移动端应用检查 Android 发布清单，下载 `APK`，校验后唤起系统安装器。
3. **Service Package Update**  
   由 Host 检查受管 npm 包版本，并通过后台任务执行全局升级。

统一点只有两个：

- 设置页统一展示状态
- 版本、通道、任务状态模型统一命名

### 2.2 模块划分

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `desktop-release-manager` | 桌面端更新检查与安装 | 通道、当前版本 | 桌面更新状态 |
| `android-release-manager` | Android 发布清单读取、下载与安装 | 通道、当前版本 | Android 更新状态 |
| `service-update-manager` | 服务端版本检查和安装触发 | 通道、受管包列表 | 服务端更新状态 |
| `service-update-task-service` | 通过 `TaskManager` 执行全局 npm 升级 | 包名、目标版本、通道 | 后台任务结果 |
| `release-metadata-publisher` | 发布流水线产出客户端更新元数据与校验文件 | 构建产物、签名配置 | 可供客户端消费的 manifest |
| `software-update-panel` | 设置页统一入口 | 客户端 / 服务端状态 | 用户可读状态与操作按钮 |

### 2.3 关键原则

#### 2.3.1 客户端自更新不能依赖当前 Host

桌面端和 Android 要更新的是“客户端自己”。  
如果它们的更新元数据还要靠当前连接的 Host 提供，一旦 Host 不通，更新也死了。这是坏设计。

所以客户端发布清单必须来自公共发布源，比如 GitHub Release 资产或等价的静态发布地址。

#### 2.3.2 服务端升级必须走后台任务

`npm install -g` 不是请求主链路该做的事。

它有外部进程、网络、磁盘写入和较长耗时，必须走 `TaskManager` 的 `external_process`。

#### 2.3.3 Android 必须尊重系统安装边界

Android `APK` 直装的最后一步一定是系统安装器。  
第一版不要再幻想“自动安装完成”。应用最多做到：

1. 检查
2. 下载
3. 校验
4. 唤起系统安装器

用户确认之后才算真正安装。

#### 2.3.4 服务端升级执行命令要可控

检查可以参考 `npm outdated -g` 的思路，  
但真正执行统一用：

```bash
npm install -g <package>@<tag or version>
```

不要把第一版执行入口做成模糊的 `npm update -g`。后者受当前 semver 范围影响，太不稳定。

#### 2.3.5 检查失败不能伪装成“没有更新”

当前服务端版本检查在 registry 失败时会退回 `latestVersion: null + hasUpdate: false`。

这会把两种完全不同的状态混在一起：

1. registry 真的返回“没有更高版本”
2. 当前根本没查成功

第一版必须把这两种状态拆开，否则设置页会一直说“没更新”，实际上只是请求炸了。

## 3. 组件和接口

### 3.1 客户端发布清单模型

覆盖需求：1、2、3、4

客户端发布清单分两类：

- `DesktopReleaseManifest`
- `AndroidApkManifest`

两者共享这些字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `channel` | `stable \| beta` | 是 | 发布通道 |
| `version` | string | 是 | 目标版本 |
| `publishedAt` | string | 是 | 发布时间 |
| `notes` | string | 否 | 更新说明 |
| `sha256` | string | 是 | 下载包校验值 |

#### 3.1.1 `DesktopReleaseManifest`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `platform` | string | 是 | 如 `windows-x64`、`macos-universal` |
| `packageUrl` | string | 是 | 更新包地址 |
| `signature` | string | 是 | updater 所需签名 |
| `releasePageUrl` | string | 否 | 人工查看页面 |

#### 3.1.2 `AndroidApkManifest`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `packageName` | string | 是 | Android 包名 |
| `versionCode` | number | 是 | Android 比较版本主依据 |
| `downloadUrl` | string | 是 | APK 下载地址 |
| `fileName` | string | 是 | 建议保存名 |
| `minSupportedVersionCode` | number | 否 | 低于该版本需强提醒 |

### 3.2 服务端更新模型

覆盖需求：5、6、7、8

#### 3.2.1 `ManagedServicePackage`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `packageName` | string | 是 | 受管 npm 包名 |
| `displayName` | string | 是 | 界面显示名 |
| `channel` | `stable \| beta` | 是 | 当前通道 |
| `currentVersion` | string | 是 | 当前全局已安装版本 |
| `latestVersion` | string | 否 | registry 最新可升级版本 |
| `hasUpdate` | boolean | 是 | 是否有更新 |
| `checkStatus` | `idle \| succeeded \| failed` | 是 | 最近一次检查状态 |
| `checkErrorMessage` | string | 否 | 检查失败摘要 |
| `packagePageUrl` | string | 否 | npm 页面 |
| `installCommand` | string | 是 | 实际执行命令 |
| `restartRequired` | boolean | 是 | 包升级后是否还需要重启才能生效 |

#### 3.2.2 `ServiceUpdateJobState`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `taskId` | string | 是 | 后台任务 ID |
| `packageName` | string | 是 | 目标包名 |
| `targetVersion` | string | 否 | 目标版本 |
| `status` | string | 是 | `queued/running/succeeded/failed/timeout` |
| `summary` | string | 否 | 结果摘要 |
| `startedAt` | string | 否 | 开始时间 |
| `finishedAt` | string | 否 | 结束时间 |
| `restartRequired` | boolean | 是 | 任务成功后是否需要重启 |

### 3.3 服务端接口

#### 3.3.1 `GET /api/client/service-update`

- 类型：HTTP
- 输入：`channel`
- 输出：受管包列表和每个包的版本状态
- 说明：
  - 第一版从单包起步，但返回结构按多包设计
  - registry 失败要返回失败状态，不要伪装“已最新”

#### 3.3.2 `POST /api/client/service-update/install`

- 类型：HTTP
- 输入：`{ packageName: string, channel?: "stable" | "beta" }`
- 输出：`ServiceUpdateJobState`
- 说明：
  - 只负责触发后台任务
  - 不在接口主线程里直接跑 `npm install -g`

#### 3.3.3 `GET /api/client/service-update/tasks/:taskId`

- 类型：HTTP
- 输入：任务 ID
- 输出：任务状态与摘要
- 说明：
  - 前端轮询或事件刷新时使用

#### 3.3.4 服务端细化设计参考

服务端实现切分和接口返回建议见：

- [20260415-服务端全局NPM升级链路细化设计.md](/Users/jackson/Code/CodingNS/specs/spec001.6-客户端与服务端统一更新机制/docs/20260415-服务端全局NPM升级链路细化设计.md)

### 3.4 后台任务定义

覆盖需求：5、6、7

建议新增两个任务类型：

- `service.npm_global_update_check`
- `service.npm_global_update_install`

规则：

- `check` 可走 `host_background` 或轻量 `external_process`，第一版允许直接在请求里查单包 registry，但如果扩到多包就必须任务化
- `install` 必须走 `external_process`
- `install` 的去重 key 采用：`packageName + channel`

当前要明确一条现实约束：

- 现有 `TaskManager` 只显式补了 `helper_process` 执行器
- 如果不新增 `external_process` 执行器，`service.npm_global_update_install` 只是名字写得好看，真正还是在 Host 里本地跑

所以第一版服务端升级实现必须同时补：

1. 任务类型
2. 安装接口
3. `external_process` 执行器

执行命令统一为：

```bash
npm install -g <packageName>@<resolvedTagOrVersion>
```

### 3.5 桌面端更新链路

覆盖需求：1、2、8

#### 3.5.1 现状问题

当前 Rust 侧是自己请求 GitHub Release、自己下载、自己算 `sha256`、再手工打开安装包。

这套东西不是不能用，但它有三个问题：

1. 和 Tauri 官方更新链路分叉，后面越维护越脏
2. 发布流水线没有强约束 updater 需要的完整产物
3. 前端“安装更新”按钮实际上不是标准桌面更新能力

另外还有两个硬伤：

4. Rust 依赖里还没有 `tauri-plugin-updater`
5. `tauri.conf.json` 里也没有 updater 配置块、公钥和端点

#### 3.5.2 目标方案

- 桌面端接入 Tauri 官方 updater
- 桌面应用内继续保留现有 `ReleasePanel` 交互入口
- Rust 侧只做 updater 桥接，不再维护私有下载器
- 发布流水线负责生成 updater 需要的元数据和签名文件

### 3.6 Android APK 直装链路

覆盖需求：3、4、8

#### 3.6.1 流程

1. Android 客户端读取通道对应的 `AndroidApkManifest`
2. 比较本机 `versionCode`
3. 有更新则下载 APK 到应用私有目录
4. 下载完成后计算 `sha256`
5. 校验通过后通过系统安装器打开
6. 安装器接管，等待用户确认

#### 3.6.2 权限与提示

- 若缺少“允许安装未知来源应用”授权，则先给跳转设置引导
- 若用户取消安装，则状态写成“已取消”，允许重新触发
- 若校验失败，必须删掉坏包或至少标记坏包不可安装

#### 3.6.3 当前可复用点

- 现有 Android 壳和打包脚本可继续使用
- `AndroidManifest.xml` 已经有 `FileProvider`
- 但还没有任何 APK 下载、校验、安装命令桥接，所以第一版不能高估当前基础

### 3.7 设置页统一入口

覆盖需求：8

设置页继续保留“软件更新”一级分组，但内部拆成三块：

1. 服务端更新
2. 客户端更新
3. 当前任务 / 重启提示

原则：

- 桌面端显示桌面客户端更新
- Android 显示 Android `APK` 更新
- Web 端不显示本机客户端安装按钮

## 4. 数据与状态模型

### 4.1 状态流转

#### 4.1.1 桌面端

`idle -> checking -> update_ready -> downloading/installing -> installed_or_failed`

#### 4.1.2 Android

`idle -> checking -> update_ready -> downloading -> verifying -> awaiting_system_install -> installed_or_cancelled_or_failed`

#### 4.1.3 服务端

`idle -> checking -> update_ready -> queued -> running -> succeeded_or_failed`

若更新的是当前 Host 自身：

`... -> succeeded + restart_required`

### 4.2 版本比较规则

- 桌面端：按语义化版本比较
- Android：按 `versionCode` 优先比较，`versionName` 只做展示
- 服务端：按 registry 返回版本与当前全局已安装版本比较

## 5. 错误处理

### 5.1 桌面端错误

- 更新元数据缺失
- 签名缺失或校验失败
- 下载失败
- 安装器启动失败

### 5.2 Android 错误

- 清单缺失或格式不合法
- 下载失败
- `sha256` 校验失败
- 缺少安装未知来源应用授权
- 系统安装被用户取消

### 5.3 服务端错误

- registry 请求失败
- 本地 npm 不可用
- 全局安装权限不足
- 网络错误
- 当前进程无法确认何时重启

### 5.4 处理策略

1. 更新元数据不完整：立即失败，不显示安装按钮
2. 下载失败：保留失败摘要和重试入口
3. 服务端升级成功但未重启：明确显示“包已升级，等待重启生效”
4. Android 被系统拦截：显示下一步要做什么，不编造成功状态

## 6. 验证方案

### 6.1 桌面端

1. 构造新版本发布
2. 检查应用能发现新版本
3. 安装后验证版本号变化
4. 验证用户配置未丢失

### 6.2 Android

1. 构造更高 `versionCode` 的 APK 清单
2. 检查应用能发现更新
3. 下载后验证 `sha256`
4. 验证能正常唤起系统安装器
5. 验证取消安装和授权缺失提示

### 6.3 服务端

1. 模拟 registry 新版本
2. 触发受管包升级
3. 验证 `TaskManager` 状态变化
4. 验证升级后重启提示

## 7. 迁移策略

### 7.1 桌面端

- 逐步废弃当前自写下载器
- 保留现有设置页入口，底层切换为官方 updater

### 7.2 Android

- 从“只有打包脚本”迁到“有正式在线更新链路”
- 不改变现有包名和签名体系

### 7.3 服务端

- 先把单包升级链路跑通
- 再扩展受管包列表
- 第一版不强行实现自动重启，只把“升级”和“需要重启”说清楚
