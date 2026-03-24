# 验收清单 - spec005 Git 上下文与提交规则引擎

## 核心边界

- [x] Git 能力绑定工作区执行
- [x] Git 接口默认受鉴权保护
- [x] 非 Git 仓库返回明确错误
- [x] 仓库边界外路径被拒绝

## Git 核心能力

- [x] 可读取 Git 状态
- [x] 可读取单文件 diff
- [x] 可执行暂存
- [x] 可执行取消暂存
- [x] 可执行提交
- [x] 可查看分支
- [x] 可创建或切换分支
- [x] 可查看最近历史
- [x] 可执行远程同步

## 提交规则引擎

- [x] 提交前先读取规则
- [x] 支持标题模板校验
- [x] 支持标题长度校验
- [x] 支持 body 必填校验
- [x] 支持 issue 必填校验
- [x] 支持语言约束校验
- [x] AI 只生成草稿
- [x] 提交前必须二次校验

## 会话页接入

- [x] Git 能力接在 `spec003` 会话页辅助区
- [x] 不新增 Git 主页面
- [x] 不破坏消息工作区结构
- [x] 侧栏可展示状态、diff、提交流程、分支、历史、远程同步

## 验证命令

- [x] `corepack pnpm --filter host test`
- [x] `corepack pnpm --filter host build`
- [x] `corepack pnpm --dir apps/user-app test`
- [x] `corepack pnpm --dir apps/user-app build`
