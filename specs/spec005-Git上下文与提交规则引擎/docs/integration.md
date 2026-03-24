# 联调说明 - spec005 Git 上下文接入

## 这份文档解决什么问题

这份文档只回答一件事：  
`spec005` 的 Git 能力现在是怎么接进 `spec003` 会话页辅助区的，联调时先看哪里，出了问题先查哪里。

## 当前接入方式

Git 没有做成独立页面，也没有抢走会话工作区。现在的结构是：

- `ConversationPage` 仍然负责消息时间线、会话头部和输入区
- `GitSidebar` 挂在右侧侧栏，属于辅助区
- 所有 Git 请求都带 `workspaceId`
- 所有 Git 请求都走 Host 的受保护接口

## 前后端主要文件

### Host 侧

- `apps/host/src/routes/git.ts`
- `apps/host/src/modules/git/git-controller.ts`
- `apps/host/src/modules/git/git-read-service.ts`
- `apps/host/src/modules/git/git-write-service.ts`
- `apps/host/src/modules/git/commit-orchestrator.ts`
- `apps/host/src/modules/git/commit-rule-engine.ts`

### user-app 侧

- `apps/user-app/src/features/conversation/pages/ConversationPage.tsx`
- `apps/user-app/src/features/conversation/components/GitSidebar.tsx`
- `apps/user-app/src/features/conversation/api/git-api.ts`
- `apps/user-app/src/i18n/zh-CN.ts`
- `apps/user-app/src/app/styles.css`

## 已接通的最小链路

### 1. 工作区绑定的 Git 上下文读取

侧栏进入会话页后，会并行读取：

- 状态
- 规则
- 历史
- 分支

只要 `workspaceId` 不存在，侧栏会直接清空自身状态，不会脱离工作区执行 Git。

### 2. 变更文件与 diff

- 点击变更文件，侧栏请求单文件 diff
- diff 只在侧栏预览，不打断消息区
- 长 diff 依赖 Host 的截断保护，避免把大仓库一次性打爆

### 3. 暂存 / 取消暂存

- 侧栏按钮直接调用 `stage` / `unstage`
- 成功后刷新当前 Git 状态
- 当前选中文件会切换到对应的 staged / worktree diff

### 4. 规则先于生成的提交流程

当前链路固定为：

1. 读取规则
2. 生成草稿
3. 返回第一次校验结果
4. 用户修改
5. 再次校验
6. 才允许执行提交

这里最重要的一条是：  
AI 只能产出草稿，不能直接提交。

### 5. 分支、历史、远程同步

侧栏已经提供最小操作入口：

- 分支切换 / 新建
- 最近历史查看
- `fetch / pull / push / publish`

这些能力都留在辅助区，没有变成新的 Git 主页面。

## 联调时优先检查什么

### 现象：侧栏空白

先查：

- 会话是否拿到了 `workspaceId`
- Host 登录态是否有效
- `/api/git/status` 是否返回 200

### 现象：AI 草稿能出，但提交失败

先查：

- `/api/git/commit/validate`
- `/api/git/commit`
- 当前规则是否要求 body / issue / 指定语言

### 现象：切分支或远程同步失败

先查：

- 当前仓库是否真有远程
- 当前工作区是否是 Git 仓库
- Host 返回的错误码是否为仓库边界、远程不存在、分支冲突或同步失败

## 明确不做什么

这次联调明确不碰这些范围：

- PR
- Review
- 审批流
- 多人协作面板
- 企业审计系统
- Git 托管平台替代能力
