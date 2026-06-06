# spec018.1-Teable自定义前端视图块

状态：Draft

## 这份 Spec 是什么

`spec018` 已经把 Teable 的连接、表同步、字段映射和同步日志做成设置能力。

这份 `spec018.1` 继续做下一步：

**在事务工作台画布里新增 Teable 块，但不再嵌入 Teable 原生页面，而是用 Teable API 拉取表、字段、记录，在 CodingNS 里实现自己的表格、表单、日历和看板视图。**

## 为什么要单独成一个 Spec

之前用 iframe 嵌入 Teable 分享页已经证明不合适：

- 样式不可控
- 页面稳定性差
- 跨域、资源代理、COOP、React hydration 都容易出问题
- 新建记录成功反馈也不可靠

所以新方案必须换成：

- 浏览器只访问 CodingNS Host
- Host 调 Teable API
- 前端只渲染 CodingNS 自己的组件

## 本 Spec 做什么

- 工作台添加 Teable 块
- 选择 Teable 表和视图
- 用自定义前端实现：
  - 表格视图
  - 表单视图
  - 日历视图
  - 看板视图
- 统一记录详情抽屉
- 支持新建、编辑、删除记录
- 保留设置页里的连接和同步配置，不把同步设置塞回画布

## 本 Spec 不做什么

- 不恢复 iframe
- 不代理 Teable 分享页
- 不复刻 Teable 全部高级能力
- 不把 Teable token 暴露给前端
- 不改变 `spec018` 的镜像同步主链路

## 主要文档

- `requirements.md`：用户要什么、验收看什么
- `design.md`：前后端怎么拆、接口怎么走
- `tasks.md`：按阶段落地的任务清单
- `docs/20260606-Teable自定义视图块接口草案.md`：Host runtime API 草案
