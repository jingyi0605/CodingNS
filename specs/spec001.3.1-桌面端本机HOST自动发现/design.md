# 设计文档 - spec001.3.1 桌面端本机HOST自动发现

状态：Draft

## 1. 概述

### 1.1 目标

- 在 `Windows`、`macOS` 桌面端补一条“本机 Host 自动发现”链路
- 让自动发现结果作为运行时补充数据接到现有 HOST 列表，不污染手工 HOST 配置
- 把自动发现 HOST 的用户名、密码继续放在本地凭据存储里，而不是塞进 `HostProfile`

### 1.2 覆盖需求

- `requirements.md` 需求 1：桌面端扫描本机 `codingns` Host
- `requirements.md` 需求 2：自动发现分类展示
- `requirements.md` 需求 3：自动发现与手动 HOST 去重
- `requirements.md` 需求 4：自动发现 HOST 的本地凭据保存
- `requirements.md` 需求 5：自动发现结果只做运行时数据
- `requirements.md` 需求 6：扫描链路不阻塞界面

### 1.3 技术约束

- 只在 `apps/desktop/src-tauri` 增加本机进程扫描桥接，不动 Host 后端协议
- `apps/user-app` 继续作为 HOST 列表和凭据展示的唯一 UI 实现
- 自动发现结果只存在于运行时 store，不直接写入 `ClientRuntimeConfig.hosts`
- 用户名、密码仍然走现有 HOST 凭据存储，不扩散进 `HostProfile`

### 1.4 当前实现诊断

现有多 HOST 机制已经把“手工保存的 HOST”做出来了，但还缺一层：

1. 桌面端没有任何“本机进程发现”能力，`DesktopShellBridge` 也没有相关命令
2. HOST 列表真相现在只有一份 `hosts[]`，没有“运行时发现结果”的承载位置
3. 凭据存储已经按 `hostId` 做了隔离，但自动发现 HOST 还没有稳定标识，直接硬接会串

一句人话：
这次真正要加的不是一个按钮，而是“桌面壳发现层 + 运行时合并层”。

## 2. 架构

### 2.1 总体结构

本机 HOST 自动发现分三层：

1. **桌面壳扫描层**
   - 枚举本机进程
   - 识别 `codingns` / `npm` / `npx` 相关命令行
   - 提取 Host 地址、端口、数据目录
2. **客户端运行时发现层**
   - 请求桌面壳扫描结果
   - 对候选地址做探活
   - 维护 `discoveredHosts[]`
3. **HOST 列表合并展示层**
   - 合并 `savedHosts[]` 和 `discoveredHosts[]`
   - 做按 `baseUrl` 去重
   - 把自动发现结果显示在单独分类下

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `desktop-host-discovery command` | 枚举本机进程并解析 `codingns` 启动信息 | OS 进程列表 | 候选 Host 线索 |
| `desktop host discovery bridge` | 暴露给 `user-app` 的桌面桥接口 | invoke 请求 | 扫描结果 DTO |
| `local-host-discovery-store` | 管理自动发现结果、扫描状态、冷却窗口 | bridge 结果、探活结果 | `discoveredHosts[]` |
| `host-list merge helper` | 合并手动 HOST 和自动发现 HOST | `hosts[]`、`discoveredHosts[]` | UI 可展示列表 |
| `credential key resolver` | 为自动发现 HOST 计算稳定凭据键 | 自动发现 DTO | 凭据键 |

### 2.3 为什么不能把自动发现直接写进 `hosts[]`

因为那是垃圾设计。

自动发现和手工保存在本质上不是一类东西：

- 手工 HOST 是用户明确维护的配置
- 自动发现 HOST 是当前机器此刻探测到的运行时结果

如果强行写进同一份持久化配置，会立刻出现三个烂问题：

1. 本机进程停了，列表里留下僵尸 HOST
2. 端口改了，旧自动发现记录继续留着污染用户视图
3. 用户根本分不清哪些是自己保存的，哪些是系统临时扫出来的

所以这次明确要求：

- `savedHosts` 和 `discoveredHosts` 分层
- UI 层合并展示
- 真正持久化的仍然只有手工 HOST 和凭据

## 3. 数据结构

### 3.1 DesktopLocalHostProcessHit

```ts
export interface DesktopLocalHostProcessHit {
  pid: number;
  commandLine: string;
  executable: string | null;
  source: "codingns" | "npm" | "npx" | "node";
  baseUrl: string | null;
  port: number | null;
  dataDir: string | null;
}
```

说明：

- 这是桌面壳返回给前端的“进程命中线索”
- `baseUrl` 解析不出来时不能直接进 HOST 列表
- `dataDir` 不是首要展示字段，但后续可作为凭据键的辅助信息

### 3.2 DiscoveredHostProfile

```ts
export interface DiscoveredHostProfile {
  id: string;
  discoveryKey: string;
  name: string;
  baseUrl: string;
  kind: "local";
  source: "desktop-process-scan";
  pid: number | null;
  executable: string | null;
  dataDir: string | null;
  discoveredAt: string;
  lastReachableAt: string | null;
  lastUsername: string | null;
}
```

规则：

- `id` 只用于当前前端运行时，不写入手工 `hosts[]`
- `discoveryKey` 是自动发现 HOST 的稳定标识，优先使用 `baseUrl + dataDir`，回退到 `baseUrl`
- `kind` 固定为 `local`

### 3.3 HostListViewModel

```ts
export interface HostListViewModel {
  savedHosts: HostProfile[];
  discoveredHosts: DiscoveredHostProfile[];
}
```

UI 合并规则：

1. 先渲染手工 HOST
2. 再渲染“自动发现”分类
3. 自动发现项若与手工 HOST `baseUrl` 规范化后一致，则隐藏自动发现项

### 3.4 自动发现 HOST 的凭据键

自动发现 HOST 不能直接复用随机运行时 `id` 作为凭据键，否则每次重扫都会变。

采用下面规则：

1. 优先 `local-discovered:${normalizedBaseUrl}:${normalizedDataDir}`
2. 若没有 `dataDir`，回退 `local-discovered:${normalizedBaseUrl}`
3. 若用户把自动发现 HOST 另存为手工 HOST，则后续以手工 `hostId` 为主

这样能保证：

- 同一实例重复发现时可以回填原有用户名密码
- 不会因为一次重新扫描就丢掉已保存凭据

## 4. 核心流程

### 4.1 启动后的后台扫描

1. 客户端启动并初始化 HOST 配置
2. 若平台是桌面端，且 OS 为 `Windows/macOS`，则异步触发一次本机进程扫描
3. 桌面壳返回候选进程命中
4. 客户端解析出候选 `baseUrl`
5. 对候选地址做 `probeHost`
6. 生成 `discoveredHosts[]`
7. 与手工 HOST 做去重后交给 HOST 列表展示

### 4.2 展开 HOST 列表时的刷新

1. 用户展开 HOST 列表
2. 先展示最近一次自动发现结果
3. 如果距离上次扫描已超过冷却窗口，再后台发起一次刷新
4. 新结果回来后静默更新“自动发现”分类

冷却建议：

- 10 秒内不重复做全量扫描

### 4.3 自动发现 HOST 的凭据保存

1. 用户点开自动发现 HOST
2. 若当前没有对应凭据，则允许输入用户名、密码
3. 保存时使用 `discoveryKey` 对应的本地凭据槽位
4. 下次同地址同实例再次出现时按 `discoveryKey` 回填

### 4.4 去重逻辑

去重按 `normalizeServerBaseUrl(baseUrl)` 处理后的结果做：

1. 先去掉自动发现内部重复项
2. 再拿自动发现项去和手工 HOST 比
3. 命中同地址的自动发现项不展示
4. 手工 HOST 删除后，若自动发现项仍存在，则恢复显示

## 5. 进程扫描策略

### 5.1 Windows

优先方案：

- 通过桌面壳调用系统命令拿到进程列表和命令行
- 识别以下模式：
  - `codingns start --port 3002`
  - `npx @jingyi0605/codingns start --port 3002`
  - `node .../codingns.mjs start --port 3002`

### 5.2 macOS

优先方案：

- 通过桌面壳调用 `ps` 类命令拿到进程列表和完整命令行
- 识别同样的 `codingns/npx/node` 启动模式

### 5.3 解析规则

必须解析的参数：

- `--port`
- `--host`
- `--data-dir`

地址生成规则：

1. 未显式给 `--host` 时，默认按 `127.0.0.1`
2. 未显式给 `--port` 时，默认按 `3002`
3. 若 `--host` 是 `0.0.0.0`，展示地址时仍要落成可连接的本机地址，例如 `127.0.0.1`

## 6. UI 方案

### 6.1 HOST 列表结构

桌面端 HOST 切换菜单改成：

1. 手工 HOST 列表
2. 自动发现分组标题
3. 自动发现 HOST 列表
4. 新增 HOST 入口

### 6.2 自动发现项展示

每条自动发现 HOST 至少显示：

- 名称：优先 `localhost:port`，若能识别为默认实例可显示“本机 CodingNS”
- 地址：标准化后的 `baseUrl`
- 状态：可连接/不可连接/正在刷新

### 6.3 自动发现项操作

第一阶段建议支持：

- 切换连接
- 保存用户名密码
- 可选“另存为手动 HOST”

第一阶段明确不做：

- 直接删除自动发现项
- 编辑自动发现项地址

## 7. 风险与兜底

### 7.1 风险：进程列表拿不到完整命令行

兜底：

- 桌面壳返回明确错误码
- 前端保留手工 HOST 流程，不因为自动发现失败影响基本连接

### 7.2 风险：同一地址被多条命令行重复命中

兜底：

- 先按标准化 `baseUrl` 去重
- 再按 `dataDir` 细化稳定标识

### 7.3 风险：自动发现凭据与手工 HOST 凭据混用

兜底：

- 自动发现凭据键单独命名
- 命中手工 HOST 去重后，以手工 HOST 凭据为唯一来源
