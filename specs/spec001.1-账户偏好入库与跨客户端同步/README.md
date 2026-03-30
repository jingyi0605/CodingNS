# spec001.1-账户偏好入库与跨客户端同步

## 当前定位

这个子 Spec 只解决一件事：

- 把默认会话权限、语言、主题、各个 provider 的默认模型和默认推理等级，这些“人跟着走”的偏好，从本地 `localStorage` 和桌面端本地配置文件里拆出来，改成账户级数据库偏好，并让同一账号在多个客户端之间保持一致。

一句人话：
同一个账号在桌面端改了默认会话权限，Web 和移动端登录后也应该看到同样的默认值；反过来，服务器地址、更新通道、面板宽度这些跟设备和当前环境强绑定的东西，别硬同步。

## 计划覆盖

- 默认会话权限落库并跨客户端生效
- 账户级偏好与设备级配置分层
- 首批账户级偏好清单：
  - `defaultPermissionMode`
  - `language`
  - `theme`
  - `defaultModel`（按 provider）
  - `defaultReasoningLevel`（按 provider）
- 登录前后读取优先级、shadow cache 和一次性回填迁移
- 现有 `localStorage` 键的去留清单和兼容策略

## 依赖关系

- 前置依赖：`spec001-平台底座与工作区基础`
- 直接影响：
  - `apps/host`
  - `apps/user-app`
  - `apps/user-app/src-tauri`
- 后续受益：
  - 设置页
  - 对话发送链路
  - 主题和语言切换
  - provider 默认模型/推理等级选择
  - 多端一致性

## 本阶段明确不做

- 不把 `hostBaseUrl`、`releaseChannel`、`autoReconnect`、`autoCheckUpdate` 改成账户设置
- 不把 `workbench.*`、`mobile.*`、草稿、终端恢复状态这类现场状态落库
- 不把 `codingns.auth.session` 这类登录令牌做成跨端同步
- 不在这个 Spec 里展开“记住密码改系统凭据库”的实现
- 不改 provider 运行时的权限语义，只改默认值来源

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
