# spec015.3-ONLYOFFICE文档预览与编辑接入

## 这次要解决什么问题

`CodingNS` 现在内置文件预览只覆盖了 `HTML / 图片 / PDF`。`docx / xlsx / pptx` 这类 Office 文件，用户只能外部打开，做不到在产品里直接看、直接改。

这次要补的不是“再加一个文件类型判断”，而是把 **ONLYOFFICE 作为可选集成能力** 接进来：

- 默认不开，不影响现在已有安装
- 需要时由用户自己填写 ONLYOFFICE 服务地址
- 同时填写 `CodingNS` 对外地址 / 回调地址，兼容本机部署和外部部署
- 打开 `docx / xlsx / pptx` 时，优先在现有文件查看器里直接嵌入 ONLYOFFICE

一句人话：

这一步是把 Office 文件从“只能下载”补到“能在 CodingNS 里打开，配置对了还能直接编辑保存”。

## 这次计划覆盖什么

- 在 `office` 设置页增加 ONLYOFFICE 开关、地址配置、连接检测
- Host 保存 ONLYOFFICE 集成配置，并提供状态检查接口
- 工作区文件预览支持 `docx / xlsx / pptx` 走 ONLYOFFICE
- 事务文档库预览同步支持 ONLYOFFICE
- Host 提供 ONLYOFFICE 回调保存入口，把编辑结果写回原文件
- 补一份 macOS / Windows 推荐部署说明，明确本地 Docker 和外部部署怎么配

## 这次明确不做什么

- 不把 ONLYOFFICE 打成 `CodingNS` 的必装依赖
- 不内置安装 Docker、拉镜像、自动部署 ONLYOFFICE 服务
- 不做多人协作冲突处理、批注审阅、权限矩阵细化
- 不覆盖全部 Office 扩展名，第一轮先把主流 `docx / xlsx / pptx` 接通
- 不重做文件查看器壳层，继续复用现有 `FileViewerPanel`

## 主要影响哪里

- `apps/host/src/modules/office/`
- `apps/host/src/modules/file/`
- `apps/host/src/modules/workspace/`
- `apps/user-app/src/settings/SkillManagementPanel.tsx`
- `apps/user-app/src/features/conversation/components/FileViewerModal.tsx`
- `apps/user-app/src/shared/i18n/index.ts`

## 主文档

- `requirements.md`
- `design.md`
- `tasks.md`
- `docs/20260603-macOS与外部部署推荐方案.md`
