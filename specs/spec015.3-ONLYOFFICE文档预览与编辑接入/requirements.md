# 需求文档 - ONLYOFFICE 文档预览与编辑接入

状态：Draft

## 简介

当前 `CodingNS` 的文件查看器已经能稳定处理 `HTML / 图片 / PDF`，但 Office 文件还是断档：用户在工作区文件树和事务文档库里点开 `docx / xlsx / pptx` 时，只能下载或外部打开。

这次要把 ONLYOFFICE 作为一个**可选集成能力**接进来。不开启时，现有安装保持原样；开启后，用户可以在设置页填写 ONLYOFFICE 地址和 CodingNS 自己的对外地址，让 Office 文件在现有查看器里直接打开，且在配置允许时把编辑结果回写到原文件。

## 术语表

- **CodingNS Host**：当前提供 API、文件访问和回调落盘的本地 Host 服务。
- **ONLYOFFICE 服务**：单独部署的 ONLYOFFICE Docs / Document Server，用来渲染和编辑 Office 文件。
- **对外地址**：ONLYOFFICE 服务能访问到的 CodingNS 地址，用来生成文件 URL 和回调 URL。
- **回调地址**：ONLYOFFICE 在保存文档后调用的 CodingNS 地址。

## 范围说明

### In Scope

- 设置页里启用 / 关闭 ONLYOFFICE 集成
- 保存 ONLYOFFICE 服务地址、CodingNS 对外地址、回调地址、可选 JWT 密钥
- 对配置做基础可用性检测
- `docx / xlsx / pptx` 在工作区文件查看器里嵌入 ONLYOFFICE
- `docx / xlsx / pptx` 在事务文档库查看器里嵌入 ONLYOFFICE
- Host 回调保存编辑结果到原始文件

### Out of Scope

- 自动安装或自动升级 ONLYOFFICE
- 多人同时编辑冲突合并
- 批量导入、批量转换、Office 模板引擎整合
- `doc / xls / ppt / odt / ods / odp` 等更多格式的正式支持

## 需求

### 需求 1：ONLYOFFICE 集成配置

**用户故事：** 作为私有部署管理员，我希望在 CodingNS 里手动填写 ONLYOFFICE 服务地址和回调相关地址，以便按自己机器的部署方式启用 Office 集成。

#### 验收标准

1. WHEN 用户打开 `office` 设置页 THEN System SHALL 显示 ONLYOFFICE 开关、服务地址、CodingNS 对外地址、回调地址和可选 JWT 密钥输入项。
2. WHEN 用户保存配置 THEN System SHALL 持久化配置，并在重新打开设置页后还能读回当前状态。
3. WHEN 用户没有启用 ONLYOFFICE THEN System SHALL 保持现有文件预览行为，不因为新能力报错。

### 需求 2：配置检测与错误提示

**用户故事：** 作为部署者，我希望保存后能立刻看到 ONLYOFFICE 是否真的可用，以便尽快发现地址填错或服务没起来。

#### 验收标准

1. WHEN 用户执行检测或保存配置 THEN System SHALL 检查 ONLYOFFICE `healthcheck` 和 `api.js` 是否可访问。
2. WHEN ONLYOFFICE 地址为空、格式错误或检测失败 THEN System SHALL 返回可读错误，而不是只报通用失败。
3. WHEN 用户把外部 ONLYOFFICE 地址和 `localhost` 回调地址混用 THEN System SHALL 给出明确警告，提醒回调地址可能无法被外部服务访问。

### 需求 3：工作区文件的 Office 预览与编辑

**用户故事：** 作为用户，我希望在工作区里直接打开 `docx / xlsx / pptx`，必要时还能直接编辑保存，以便不用频繁切出 CodingNS。

#### 验收标准

1. WHEN 用户打开已启用 ONLYOFFICE 的工作区 Office 文件 THEN System SHALL 在现有 `FileViewerPanel` 中嵌入 ONLYOFFICE 编辑器。
2. WHEN ONLYOFFICE 未启用或当前配置不可用 THEN System SHALL 返回明确原因，并保持旧的外部打开 / 不支持提示，不得让查看器白屏。
3. WHEN ONLYOFFICE 保存文档 THEN System SHALL 通过回调把修改后的文件写回工作区原路径。

### 需求 4：事务文档库的 Office 预览与编辑

**用户故事：** 作为事务视图用户，我希望事务文档库里的 Office 文件也能用同一套查看器打开，而不是又长一套专用页面。

#### 验收标准

1. WHEN 用户在事务文档库里打开 `docx / xlsx / pptx` THEN System SHALL 继续复用现有 `FileViewerPanel` 外壳。
2. WHEN 事务文档库 Office 文件进入预览 THEN System SHALL 生成独立于 workspace 文件路径语义的受控文件 URL 和回调上下文。
3. WHEN ONLYOFFICE 保存事务文档库文件 THEN System SHALL 把结果写回事务文档库对应文件，而不是写到错误目录。

## 非功能需求

### 非功能需求 1：兼容性

1. WHEN 用户不配置 ONLYOFFICE THEN System SHALL 不破坏现有 `HTML / 图片 / PDF / 文本` 预览链路。
2. WHEN 现有文件查看器和事务文档库继续使用原预览链路 THEN System SHALL 保持 `previewLoader` 复用方式，不额外复制一套 viewer 壳。

### 非功能需求 2：安全性

1. WHEN Host 生成 ONLYOFFICE 文件 URL 与回调 URL THEN System SHALL 使用受控 token，不直接暴露真实磁盘路径。
2. WHEN ONLYOFFICE 回调写回文件 THEN System SHALL 只允许写回 token 绑定的目标文件。

### 非功能需求 3：可维护性

1. WHEN 后续扩展更多 Office 格式 THEN System SHALL 在同一套 ONLYOFFICE 集成服务里扩展，不再散落到各个 controller 里拼判断。
2. WHEN 部署者排障 THEN System SHALL 提供独立状态接口和清晰错误提示，方便判断是服务没起、地址没配，还是回调路径不可达。

## 成功定义

- 工作区和事务文档库里的 `docx / xlsx / pptx` 可以在现有查看器里直接打开。
- 保存 ONLYOFFICE 配置后，用户能看到明确的可用 / 不可用状态。
- ONLYOFFICE 保存回调能把修改结果写回原文件，且不影响已有非 Office 预览格式。
