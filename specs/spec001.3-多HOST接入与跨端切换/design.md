# 设计文档 - spec001.3 多HOST接入与跨端切换

状态：Draft

## 1. 概述

### 1.1 目标

- 把前端运行时配置从“单 `hostBaseUrl`”升级成“多 HOST Profile + 当前激活 HOST”
- 让桌面端和移动端共用同一套多 HOST 真相，不各写各的
- 让登录态、记住密码和最近连接信息按 HOST 隔离保存
- 保证切换 HOST 时 HTTP、WebSocket 和页面运行时一起切，不留下半截状态

### 1.2 覆盖需求

- `requirements.md` 需求 1：正式多 HOST 配置模型
- `requirements.md` 需求 2：HOST 级登录态隔离
- `requirements.md` 需求 3：完整切换事务
- `requirements.md` 需求 4：桌面端顶部快速切换器
- `requirements.md` 需求 5：移动端 HOST 树
- `requirements.md` 需求 6：现有主流程兼容

### 1.3 技术约束

- 前端主实现仍然只改 `apps/user-app`
- 桌面壳配置仍然走现有 Tauri 配置读写桥
- 桌面端本机 `codingns` 进程扫描与自动发现能力由 `spec001.3.1-桌面端本机HOST自动发现` 单独展开
- iOS / Android 不能继续只靠单个 `localStorage` 键硬撑
- 业务 API 和实时链路继续复用现有 Host，不引入额外聚合服务
- 所有新增用户可见文案必须进入 i18n 字典

### 1.4 当前实现诊断

现在的问题不是“前端不能换 host”，而是“能换，但数据结构太烂”。

已经确认的现状：

1. `ClientRuntimeConfig` 里只有一个 `hostBaseUrl`，说明模型天生是单 host。
2. HTTP 和 WebSocket 的地址都从当前运行时配置动态计算，说明这事适合做运行时切换，不适合做多套构建。
3. `server-config` 只是输入历史，不是正式 HOST 管理。
4. `auth session` 和 `remembered login` 都是单槽位，切 host 只是在赌自己不会串。

一句人话：
这次要改的不是某个输入框，而是配置真相。

## 2. 架构

### 2.1 总体结构

多 HOST 方案分四层：

1. **HOST Profile Store**
   - 保存 `hosts[]`、`activeHostId`
   - 负责迁移旧配置和持久化
2. **HOST Auth Store**
   - 按 HOST 保存登录态、remember password、最近用户
   - 负责切 HOST 时切换当前认证上下文
3. **HOST Runtime Coordinator**
   - 负责执行 `switchHost(hostId)` 事务
   - 统一收口实时连接和页面运行时
4. **HOST-aware UI**
   - 桌面端顶部快速切换器
   - 移动端顶部 `HOST -> 工作区` 树状切换器

### 2.2 模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| `multi-host-config-store` | 维护多 HOST 配置真相 | 本地配置、桌面壳配置、迁移输入 | `hosts[]`、`activeHostId` |
| `host-session-store` | 维护按 HOST 隔离的认证会话 | hostId、登录结果、刷新结果 | 当前 HOST 会话、会话映射 |
| `host-credential-store` | 维护按 HOST 保存的记住密码 | hostId、用户名密码 | 凭据映射 |
| `host-switch-coordinator` | 执行 HOST 切换事务 | 目标 hostId | 成功/失败、重建后的运行时 |
| `desktop-host-switcher` | 桌面端顶部快速切换 UI | 当前激活 HOST、HOST 列表 | 切换动作、新增入口 |
| `mobile-host-workspace-switcher` | 移动端 HOST 树切换 UI | 当前激活 HOST、工作区列表 | HOST 切换、工作区跳转 |

### 2.3 为什么不搞“多个环境变量 + 多次打包”

因为那是垃圾方案。

现有 HTTP 和 WebSocket 已经是运行时按当前 host 拼出来的：

- 这说明当前架构天然适合运行时切换
- 如果还去做多套 `.env` 或多套安装包，只是在把一个运行时问题降级成运维麻烦

所以本 Spec 明确要求：

- 多 HOST 必须是运行时能力
- 不靠重新打包切环境

## 3. 数据结构

### 3.1 MultiHostRuntimeConfig

```ts
export interface HostProfile {
  id: string;
  name: string;
  baseUrl: string;
  kind: "local" | "lan" | "remote" | "custom";
  createdAt: string;
  updatedAt: string;
  lastConnectedAt: string | null;
  lastUserId: string | null;
  lastUsername: string | null;
}

export interface MultiHostRuntimeConfig {
  platform: RuntimePlatform;
  activeHostId: string | null;
  hosts: HostProfile[];
  releaseChannel: ReleaseChannel;
  autoReconnect: boolean;
  autoCheckUpdate: boolean;
}
```

说明：

- `activeHostId` 才是当前 host 真相，`hostBaseUrl` 不再作为顶层字段存在
- `name` 是用户能看懂的标签，不强迫用户只看 URL
- `lastConnectedAt`、`lastUserId`、`lastUsername` 只是本地辅助显示，不是服务端真相

### 3.2 HostSessionMap

```ts
export interface HostSessionEnvelope {
  hostId: string;
  session: AuthSession | null;
  savedAt: number;
}

export type HostSessionMap = Record<string, HostSessionEnvelope>;
```

规则：

- 每个 `hostId` 最多保存一份当前登录态
- 当前页面真正使用的登录态 = `activeHostId` 对应的会话
- `logout(hostId)` 只清理该 host 的会话

### 3.3 HostCredentialMap

```ts
export interface HostRememberedLogin {
  hostId: string;
  username: string;
  password: string;
  savedAt: number;
}

export type HostCredentialMap = Record<string, HostRememberedLogin>;
```

规则：

- 这是“按 HOST 记住密码”，不是全局只记最后一个
- 删除 HOST 时必须一起删掉它的记住密码

### 3.4 旧配置迁移

旧结构：

- `client-runtime-config.hostBaseUrl`
- `codingns.auth.session`
- `codingns.auth.remembered-login`

迁移目标：

1. 生成一条默认 HOST Profile
2. 把旧登录态挂到该默认 HOST 下
3. 把旧 remember password 也挂到该默认 HOST 下
4. 迁移后新代码只读新结构，旧结构保留一段兼容期

## 4. 核心流程

### 4.1 启动流程

1. 先读取本地多 HOST 配置
2. 如果还是旧配置结构，则执行一次迁移
3. 得到 `hosts[] + activeHostId`
4. 读取 `activeHostId` 对应 HOST 的会话
5. 用该 HOST 初始化 HTTP / WebSocket / 页面运行时

### 4.2 登录流程

1. 用户在当前激活 HOST 上登录
2. 登录请求使用当前 `activeHostId` 对应的 `baseUrl`
3. 登录成功后，把会话写入 `HostSessionMap[hostId]`
4. 如果开启记住密码，则写入 `HostCredentialMap[hostId]`
5. 工作台后续请求和刷新都只用当前 HOST 会话

### 4.3 HOST 切换事务

`switchHost(hostId)` 必须按这个顺序做：

1. 校验目标 HOST 是否存在
2. 预计算目标 `baseUrl`
3. 可选执行轻量探活
4. 关闭旧 HOST 下的实时连接
5. 清理旧 HOST 绑定的运行时 store / 页面缓存
6. 写入新的 `activeHostId`
7. 切换当前认证上下文到目标 HOST 会话
8. 触发应用运行时边界重建
9. 重新拉取工作台快照、工作区和会话导航

如果第 3 步失败，则终止切换，原 HOST 保持不变。

### 4.4 为什么要“运行时边界重建”

因为现在会话页、工作台、终端、Butler 都持有各自的实时客户端和页面级状态。

如果切 HOST 时只改一个 `baseUrl`，就会出现典型垃圾状态：

- 旧页面还拿着旧 HOST 的 socket
- 新请求已经打到新 HOST
- 当前 token 却可能还是旧 HOST 的

所以最简单、最干净的办法不是补一堆 `if`，而是：

- 以 `activeHostId` 或 `runtimeEpoch` 作为认证后应用壳的 `key`
- HOST 一变，整棵运行时边界卸载再挂载

这比到处手写“关一下这个 client、清一下那个 state”好得多。

## 5. 界面方案

### 5.1 桌面端顶部快速切换器

#### 5.1.1 位置

- 固定放在收起按钮和通知按钮之间
- 这是硬约束，不允许随手塞进设置页右上角或更多菜单里

#### 5.1.2 展示内容

- 当前激活 HOST 名称
- 当前 HOST 简短状态，例如已登录用户、连接状态
- 展开后列出已保存 HOST
- 底部提供“新增 HOST”入口

#### 5.1.3 行为

- 点击当前项展开列表
- 选择其他 HOST 后执行 `switchHost(hostId)`
- 切换成功后，工作台整体刷新成新 HOST 上下文
- 切换失败则保留原 HOST，并展示明确错误

### 5.2 移动端顶部 HOST 树切换器

#### 5.2.1 结构

移动端顶部工作区切换器改成：

- 第一层：HOST
- 第二层：该 HOST 下当前可见工作区

排序规则：

1. 当前激活 HOST 置顶
2. 其余 HOST 按最近连接时间倒序
3. HOST 内的工作区继续沿用现有工作区排序规则

#### 5.2.2 行为

- 点击 HOST 节点：只切 HOST，不强制进入某个工作区
- 点击工作区节点：先切到对应 HOST，再进入该工作区
- 如果 HOST 当前无工作区，也必须能单独切过去

#### 5.2.3 为什么不用“先切 HOST 再单独开工作区菜单”

因为那会让移动端多一步，而且脑子要切两次上下文。

用户真正要看的就是：

- 我现在连了哪些 HOST
- 这个 HOST 下面有什么工作区

那就一次给全。

## 6. 组件与接口改造

### 6.1 前端配置层

主要改造：

- `client-config-types.ts`
- `client-config-service.ts`
- `client-config-store.ts`
- `server-config.ts`

核心变化：

- `hostBaseUrl` 顶层字段升级为 `activeHostId + hosts[]`
- 旧 `serverConfigStore` 从“单地址兼容层”升级成“当前 HOST 兼容视图”

### 6.2 认证层

主要改造：

- `auth-store.ts`
- `remembered-login.ts`
- `auth-gateway.ts`
- 登录页和设置页的 server/host 选择逻辑

核心变化：

- 当前会话从“全局单例”变成“按 hostId 取值”
- 登录、刷新、退出都必须带上 host 语义

### 6.3 运行时层

主要改造：

- `http-client.ts`
- `realtime-client.ts`
- `workbench-realtime-client.ts`
- `terminal-realtime-client.ts`
- `App.tsx` 或认证后主壳

核心变化：

- 继续复用动态 URL 拼接逻辑
- 但 HOST 变化时通过运行时边界重建，避免旧 client 残留

### 6.4 桌面壳配置层

主要改造：

- `apps/user-app/src-tauri/src/config.rs`
- `apps/desktop/src-tauri/src/config.rs`

核心变化：

- 从单 `host_base_url` 扩展到 `active_host_id + hosts`
- 保留旧字段读取兼容

## 7. 错误处理

### 7.1 错误类型

- `HOST_NOT_FOUND`：目标 HOST 不存在
- `HOST_UNREACHABLE`：目标 HOST 无法连接
- `HOST_SWITCH_ABORTED`：切换事务中断
- `HOST_AUTH_MISSING`：目标 HOST 没有可用登录态
- `HOST_CONFIG_INVALID`：HOST 配置非法

### 7.2 失败策略

- 切换前探活失败：不切
- 切换中运行时重建失败：回退到登录页或空工作台，但不允许新旧 HOST 混跑
- 目标 HOST 无登录态：允许切过去，但进入未登录态

## 8. 验证策略

### 8.1 自动化验证

- 单 HOST 旧配置迁移测试
- 按 HOST 保存和读取登录态测试
- 按 HOST 保存和读取 remember password 测试
- 切 HOST 时 HTTP / WebSocket 地址切换测试
- 桌面端切换器显示和交互测试
- 移动端 HOST 树切换器行为测试

### 8.2 手动验收

1. 预置两个 HOST：本地测试环境、远端环境
2. 两个 HOST 分别登录不同账号
3. 在桌面端顶部切换器来回切换
4. 确认工作台、会话、通知和标题栏状态同步切换
5. 在移动端切换器中按 `HOST -> 工作区` 跳转
6. 确认切换时不会串用另一 HOST 的登录态

## 9. 边界与非目标

- 本 Spec 只做“单激活 HOST，多 HOST 可切换”
- 不做“多 HOST 同时在线并排对比”
- 不做后端聚合层
- 不把 HOST 配置变成账户级同步数据
