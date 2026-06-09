# spec001.3.2-当前HOST代理访问其他HOST仓库

## 当前定位

这是 `spec001` 下的新子 Spec。

它只解决一件事：用户当前只连接一个 HOST，但这个当前 HOST 可以代用户访问局域网里的其他 CodingNS HOST，并把那些 HOST 下的仓库接到工作区视图里。

这不是继续做“切换 HOST”。`spec001.3` 已经解决了客户端在多个 HOST 之间切换的问题。这里要解决的是：

- 当前客户端仍然只和当前 HOST 建一条主连接
- 当前 HOST 负责保存、检查和访问其他 HOST
- 工作区视图可以展示“这个仓库来自哪个 HOST”
- 用户操作远端仓库时，API 走当前 HOST 的代理入口

一句人话：
当前 HOST 变成受控代理，不让前端到处直连其他 HOST。

## 为什么要单独拆出来

现有 `spec001.3` 明确只做“单激活 HOST，多 HOST 可切换”，不做多个 HOST 同时在线聚合。

这次需求已经超过那个边界：用户希望在一个工作区视图里看到不同 HOST 下的仓库，并能切换不同 HOST 来操作同一类仓库。

如果直接往 `spec001.3` 里硬塞，会把原来清楚的 `activeHostId` 模型改乱。

## 计划覆盖

- 当前 HOST 管理其他可访问 HOST 的配置
- 添加 HOST 时做局域网可达检查和版本一致检查
- 当前 HOST 代用户访问其他 HOST 的 HTTP API
- 必要的 WebSocket 代理边界
- 前端 API 客户端支持按 `targetHostId` 走代理
- 工作区视图把仓库标记为 `hostId + workspaceId`
- 远端 HOST 的登录态由当前 HOST 保存和刷新，不暴露给前端

## 依赖关系

- 前置依赖：`spec001`
- 强相关依赖：
  - `spec001.3-多HOST接入与跨端切换`
  - `spec001.3.1-桌面端本机HOST自动发现`
  - `spec001.9.3-公共隧道流量优化与局域网自动直连`
  - `spec001.9.4-公共隧道盲中继收口与可信接入端直连`
  - `spec013.2-助手内部API与代理执行编排`

## 本阶段明确不做

- 不支持不同版本 HOST 之间互相代理
- 不支持公网任意地址代理
- 不做跨 HOST 的全量实时聚合
- 不做跨 HOST 迁移仓库
- 不把远端 HOST token 暴露给前端
- 不把现有 `activeHostId` 模型改成多个激活 HOST

## 后续主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/`
