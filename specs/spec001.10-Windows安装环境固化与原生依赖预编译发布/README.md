# spec001.10 - Windows 安装环境固化与原生依赖预编译发布

状态：Draft

## 这个 Spec 要解决什么问题

当前 `@jingyi0605/codingns` 在 Windows 上安装太脆：

- 用户机器上的 Node 版本不一定合适
- `better-sqlite3` 预编译包不一定命中
- `node-pty` 默认要本机编译
- 一旦落到 `node-gyp`，就要求用户自己补 Visual Studio Build Tools

这套链路对开发者还能忍，对普通部署用户就是灾难。用户不是来学习 Windows 原生模块编译链的，用户只是想把 CodingNS 装起来。

所以这个 Spec 只解决两件现实问题：

1. 安装脚本不要再把成功与否押在用户系统 Node 上，给 CodingNS 准备一份私有 Node 22 LTS 运行时。
2. `node-pty` 不再依赖用户本机编译，先做一条我们自己维护的 Windows x64 + Node 22 预编译发布链路。

补一句最关键的设计选择：

- Windows 下，CodingNS 正式运行时统一走私有 Node 22，系统 Node 只保留诊断价值，不再参与正式安装和升级路径。

## 为什么要现在做

- 这是当前 Windows 安装失败的主因，不解决它，安装脚本再怎么修提示文案都只是止痛片。
- 现有 npm 服务包已经能跑起来，但真正交付时最先撞墙的就是原生模块安装。
- 这件事拖得越久，后面用户越多，兼容债和排障成本越高。

## 本 Spec 产物

- `requirements.md`：明确这次到底要把 Windows 安装链路收口到什么程度
- `design.md`：定义私有 Node 运行时和 `@codingns/node-pty` 预编译分发方案
- `tasks.md`：拆成可以执行和回写状态的任务
- `docs/`：放补充验收、发布和故障排查文档

## 关联 Spec

- `spec011-单包安装与统一服务发布`
- `spec001.6-客户端与服务端统一更新机制`

## 当前结论

- `better-sqlite3` 在命中预编译包时可以免本机编译
- `node-pty@1.0.0` 当前不适合直接指望 Windows 用户本机免编译
- 现成的 prebuilt fork 覆盖面不够稳，不能直接作为正式方案
- 所以这次要自己固化运行环境，并自己接管 `node-pty` 的 Windows 预编译发布
