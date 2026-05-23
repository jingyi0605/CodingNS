# 开发者手册

这里放的是给开发者看的平台接入说明，不是面向普通用户的操作教程。

如果你只是想安装、登录、打开工作区、使用文件面板或远程访问，先去用户文档，不要在这里兜圈子。

## 这部分文档适合谁

适合这些人：

- 在 CodingNS 里接静态 HTML 工具页的人
- 在插件前端里接工作区文件能力的人
- 需要搞清 `CodingNSWorkspace` 和 `CodingNSDesktop` 边界的人
- 需要在静态 HTML 中打开客户端本地镜像文件的人
- 后面要继续维护这套桥接能力的人

## 先看什么

### 1. 想先搞清整套能力边界

先看：

- [工作区文件桥与桌面包装](/developer-guide/workspace-file-bridge-and-desktop-wrapper)

这篇会先讲清：

- `CodingNSWorkspace` 是干什么的
- `CodingNSDesktop` 是干什么的
- 为什么页面侧只能传 workspace 相对路径
- 为什么当前 workspace 文件打开 / 定位要先过 Host 校验
- 为什么客户端本地镜像文件应直接走 `CodingNSDesktop`

### 2. 想接桌面壳能力或客户端本地镜像文件

看：

- [CodingNSDesktop 桌面壳能力接口规范](/developer-guide/desktop-shell-bridge)

这篇会讲清：

- `CodingNSDesktop` 的直接调用接口
- 预览 iframe 里的 `_cns_parent_origin` 中继规则
- 客户端本地镜像根目录应该保存在客户端侧，不是 Host 配置

### 3. 想在插件前端里落地接入

再看：

- [插件前端接入工作区文件桥](/developer-guide/plugin-frontend-workspace-file-bridge)

这篇更偏实际接法，会直接说：

- 什么场景该用 `CodingNSWorkspace`
- 什么场景才直接碰 `CodingNSDesktop`
- 客户端本地镜像资料库为什么不该走 Host workspace 包装
- 哪些写法不允许继续长出来

## 这部分文档明确不讲什么

这里不讲：

- 普通用户怎么安装和登录
- 工作区页面怎么点按钮
- Git、终端、远程访问的日常操作

这些内容去用户文档看更快。

## 相关入口

- 用户向导总览：[/overview/docs-overview](/overview/docs-overview)
- 工作区与会话：[/user-guide/workspaces-and-sessions](/user-guide/workspaces-and-sessions)
- 文件、Git 与终端：[/user-guide/files-git-and-terminal](/user-guide/files-git-and-terminal)

## 一句话说明

开发者手册只回答一件事：**如果你要在 CodingNS 里接能力，标准入口是什么，边界在哪，哪些做法不能乱来。**
