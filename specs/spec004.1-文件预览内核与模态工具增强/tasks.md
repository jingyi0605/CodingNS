# 任务清单 - spec004.1-文件预览内核与模态工具增强（人话版）

状态：Draft

## 2026-04-14 立项补记

- 已确认 `TXT / PDF / 图片` 使用内置预览，不走外部 H5 在线工具主方案。
- 已确认这次范围聚焦在现有文件查看器增强，不重做文件管理面板。
- 已确认模态框需要支持调整尺寸，并且工具按钮要按文件格式切换。
- 已确认 `Office` 文件预览留到后续，不纳入 `spec004.1`。
- 已完成本子 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化。

## 任务 1：先把预览类型模型钉死

目标结果：
做完后，前后端都知道一个文件应该按什么类型预览，图片和 PDF 不再被粗暴归类成“二进制不可预览”。

依赖：
- `spec004`

主要文件：
- `requirements.md`
- `design.md`
- `apps/host/src/modules/file/file-preview-service.ts`
- `apps/user-app/src/features/conversation/api/file-context-api.ts`

明确不做：
- 不在这一任务里直接落 UI
- 不引入 Office 预览

当前状态：
- [x] 已完成（2026-04-14）

完成记录：
- 服务端预览结果已扩展为 `text / markdown / html / image / pdf / binary / unsupported`
- 前端 `FilePreviewDto` 已同步 `kind / previewPath / previewUrl / capabilities`
- 继续保持旧字段兼容，没有把现有调用一刀切打断

## 任务 2：把服务端预览链路扩成通用资源预览

目标结果：
做完后，图片、PDF、HTML 这类资源型文件都能生成受控预览资源，前端不需要再单独给 HTML 开私路。

依赖：
- 任务 1

主要文件：
- `apps/host/src/modules/file/file-preview-service.ts`
- `apps/host/src/modules/file/file-preview-link-service.ts`
- `apps/host/src/modules/file/file-controller.ts`

明确不做：
- 不在这一阶段处理大 PDF 的 `Range` 流式传输
- 不做第三方在线预览

当前状态：
- [x] 已完成（2026-04-14）

完成记录：
- `file-preview-link-service` 已允许 `HTML / 图片 / PDF` 生成受控预览链接
- `GET /api/files/preview` 已能直接返回资源型 `previewUrl`，前端不用再只给 HTML 走私路
- 公共预览资源接口继续走本地受控链路，没有接第三方在线预览
- 已拆分文本轻量预览与资源型预览大小限制，避免扫描 PDF 被 `512 KB` 文本阈值误伤

## 任务 3：重构文件查看器壳，支持模态框尺寸调整

目标结果：
做完后，文件查看器有统一的尺寸状态，用户可以切换查看空间，不再被固定弹层卡死。

依赖：
- 任务 1

主要文件：
- `apps/user-app/src/features/conversation/components/FileViewerModal.tsx`
- `apps/user-app/src/app/styles.css`
- 相关本地偏好或 UI 状态文件

明确不做：
- 不新建独立文件查看页面
- 不重做文件树和上下文面板

当前状态：
- [x] 已完成（2026-04-14）

完成记录：
- `FileViewerModal` 已改成按 `preview.kind` 选择 `text / markdown / html / image / pdf`
- 查看器已支持 `default / wide / full` 尺寸档位，桌面端保留原生拖拽缩放能力
- 没有重做文件管理面板，只增强了现有预览模态框壳
- 已修正默认模态框下 PDF viewer 高度未吃满的问题，避免默认视图只显示顶部一小段内容

## 任务 4：按格式落 viewer 和工具按钮

目标结果：
做完后，文本、图片、PDF 各有对应 viewer，工具按钮随格式切换，不再所有文件都只有一套按钮。

依赖：
- 任务 2
- 任务 3

主要文件：
- `apps/user-app/src/features/conversation/components/FileViewerModal.tsx`
- 新增 viewer / tool registry 相关文件
- `apps/user-app/src/i18n/zh-CN.ts`
- `apps/user-app/src/i18n/en-US.ts`

明确不做：
- 不实现 Office viewer
- 不把图片和 PDF 拉进文本编辑态

当前状态：
- [x] 已完成（2026-04-14）

完成记录：
- 图片 viewer 已支持内置查看、放大、缩小、适配、原始大小、外部打开
- PDF viewer 已支持内置查看、翻页、缩放、适宽、外部打开
- 工具按钮已按格式切换，文本链路保留代码/编辑/保存
- 已修正 Web 代理访问时外部打开仍跳 `127.0.0.1:3002` 的错误，改为优先使用当前页面 origin + `previewPath`

## 任务 5：补测试、验回归、收口文档

目标结果：
做完后，文本旧链路不回退，新增图片 / PDF / 尺寸调整有测试覆盖，`spec004.1` 可进入实现验收。

依赖：
- 任务 2
- 任务 3
- 任务 4

主要文件：
- 相关前后端测试文件
- `tasks.md`
- `docs/` 下的补充文档（如果需要）

明确不做：
- 不在这一轮顺手加 Office 预览
- 不扩无关文件管理能力

当前状态：
- [x] 已完成（2026-04-14）

完成记录：
- 已补 `FileViewerModal` 前端测试，覆盖文本、HTML、图片、PDF 主要链路
- 已扩后端集成测试，覆盖 HTML / 图片 / PDF 的预览元信息和受控资源访问
- 已执行前后端 TypeScript 类型检查，当前改动可通过编译
