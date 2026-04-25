# 需求文档 - spec001.5.1-OpenCLI接入与适配器裁剪运行时

状态：Draft

## 简介

前面的 `spec001.5` 已经把普通 Skill 的统一管理模型钉住了，但 `OpenCLI` 不是普通 Skill。

基于当前实际测试，已经确认：

- 本机可以正常安装 `OpenCLI`
- `opencli list -f json` 可以正常输出命令目录
- 当前安装版本会在包根目录提供 `cli-manifest.json` 和 `clis/`
- 当前 npm 安装包不包含 `skills/` 目录
- 纯 HTTP 型适配器可以直接运行
- 浏览器型适配器依赖 Browser Bridge 扩展和 daemon 健康状态

这说明两件事：

1. `OpenCLI` 可以被接进来，但它不是只管一个 `SKILL.md`
2. 用户在技能面板里切开关之后，真正要控制的是“CodingNS 管理会话里能看到哪份 OpenCLI 运行时”

如果不把这个边界写死，最后只会出现两种垃圾：

- 面板上能勾选，但 AI 会话里照样能跑全部适配器
- 为了禁用几个适配器，直接去改用户全局 `opencli` 安装，最后把用户本机环境搞烂

这很蠢。

所以这次 Spec 的目标很明确：

- 技能面板里把 OpenCLI 当成独立 provider 管
- 适配器列表可见、可选、可真正生效
- 真正的生效方式不是“隐藏按钮”，而是“生成并切换到裁剪版 OpenCLI 运行时”

## 术语表

- **OpenCLI Provider**：项目里对 `OpenCLI` 这一类能力源的统一称呼
- **OpenCLI 安装根目录**：当前机器上真实安装的 `OpenCLI` 包目录，包含 `package.json`、`dist/`、`cli-manifest.json`、`clis/`
- **适配器目录项**：从 `OpenCLI` 命令目录里读出的单条命令能力，规范标识为 `site/name`
- **站点分组**：同一个 `site` 下的一组适配器目录项
- **裁剪运行时**：CodingNS 根据启用结果生成的独立 OpenCLI 运行时镜像，至少包含裁剪后的 `cli-manifest.json`、保留的 `clis/` 树、可执行入口和必要运行文件
- **运行时配置档**：某个用户当前启用结果对应的裁剪运行时描述，包括版本、允许的适配器、生成时间和输出目录
- **CodingNS 管理会话**：由本项目启动、恢复或托管的 `Codex` / `Claude Code` / 助手沙箱等会话
- **真实 HOME**：用户机器上真实的 home 目录，用于访问 `~/.opencli`

## 范围说明

### In Scope

- 识别当前机器是否已安装 `OpenCLI`
- 读取 `OpenCLI` 的版本、健康状态和适配器目录
- 在技能面板中显示 `OpenCLI` provider 分区
- 支持启用或禁用整个 `OpenCLI`
- 支持按适配器目录项选择性启用
- 生成裁剪版 OpenCLI 运行时，并让 CodingNS 管理会话使用它
- 对浏览器桥状态和适配器可用性给出明确诊断
- 定义隔离会话里 `OpenCLI` 的 HOME 使用策略

### Out of Scope

- 修改用户全局安装目录里的 `cli-manifest.json` 或 `clis/`
- 保证用户在系统终端里手敲 `opencli` 也遵守面板限制
- 自动安装浏览器扩展并完成所有系统授权
- 把 OpenCLI skill 仓库管理和 OpenCLI runtime 管理混成一个页面动作

## 需求

### 需求 1：OpenCLI 必须作为独立 provider 被识别和展示

**用户故事：** 作为维护者，我希望技能面板能把 OpenCLI 当成独立对象展示，而不是冒充普通 Skill，这样我才能看清楚它有没有装好、能不能用。

#### 验收标准

1. WHEN 系统检测本机环境 THEN System SHALL 能判断 `OpenCLI` 是否已安装，并返回 `installState`、`version`、`installPath`。
2. WHEN 技能面板加载 OpenCLI 分区 THEN System SHALL 返回 `healthState`、`lastCheckedAt`、浏览器桥相关诊断和基础说明。
3. WHEN 当前机器未安装 OpenCLI THEN System SHALL 仍然保留 OpenCLI 分区，并给出明确的安装缺失状态，而不是整块消失。

### 需求 2：面板里启用或禁用 OpenCLI 必须真正影响会话环境

**用户故事：** 作为用户，我希望在面板里关闭 OpenCLI 后，CodingNS 管理的 AI 会话里就真的不能再调用 OpenCLI，而不是只是前端不显示。

#### 验收标准

1. WHEN 用户在面板中禁用 OpenCLI THEN System SHALL 让新的 CodingNS 管理会话不再暴露可执行的 OpenCLI 入口。
2. WHEN 用户重新启用 OpenCLI THEN System SHALL 为新的 CodingNS 管理会话恢复 OpenCLI 入口。
3. WHEN 旧会话仍在运行 THEN System SHALL 明确区分“新会话配置已变更”和“旧会话尚未重建”，不得假装即时强切。

### 需求 3：面板必须能列出 OpenCLI 支持的适配器目录，并允许选择性启用

**用户故事：** 作为用户，我希望看到 OpenCLI 当前支持哪些适配器，并只启用我要给 AI 用的那部分能力，避免整个 OpenCLI 全开。

#### 验收标准

1. WHEN 系统读取 OpenCLI 目录 THEN System SHALL 返回结构化适配器目录，最小字段包含 `site`、`name`、`commandId`、`description`、`strategy`、`browser`。
2. WHEN 面板展示适配器目录 THEN System SHALL 支持按站点分组浏览，并支持逐条目录项启用或禁用。
3. WHEN 某个站点下所有目录项都被禁用 THEN System SHALL 把该站点视为整体禁用，不再留半启用假状态。

### 需求 4：未启用的适配器在 CodingNS 管理的 CLI 环境里必须无法使用

**用户故事：** 作为维护者，我希望未启用的适配器不是“最好别用”，而是在 CodingNS 管理的 CLI 环境里根本不可用。

#### 验收标准

1. WHEN 用户禁用某个适配器目录项 THEN System SHALL 让该目录项不出现在裁剪版运行时的 `cli-manifest.json` 中。
2. WHEN 用户禁用某个适配器目录项 THEN System SHALL 让该目录项对应的运行时代码不进入裁剪版 `clis/` 树，或者即使保留辅助文件也不能被 CLI 发现和执行。
3. WHEN AI 会话在 CodingNS 管理环境中执行未启用目录项 THEN System SHALL 失败，并返回“当前运行时未提供该命令”的明确结果。

### 需求 5：系统必须生成裁剪版 OpenCLI 运行时，而不是直接污染用户全局安装

**用户故事：** 作为维护者，我希望面板勾选结果落到单独运行时，而不是去改用户全局 OpenCLI 安装，这样回滚和隔离都干净。

#### 验收标准

1. WHEN 用户变更 OpenCLI 启用结果 THEN System SHALL 生成一份新的裁剪运行时，而不是直接修改全局安装目录。
2. WHEN 系统生成裁剪运行时 THEN System SHALL 至少包含可执行入口、裁剪后的 `cli-manifest.json`、保留的 `clis/` 树和必要运行文件。
3. WHEN 裁剪运行时生成失败 THEN System SHALL 保留上一份仍可用的运行时，并把失败状态明确记录出来。

### 需求 6：适配器目录的数据来源必须有稳定优先级

**用户故事：** 作为维护者，我希望系统知道该从哪里读 OpenCLI 目录，而不是今天跑命令、明天猜路径。

#### 验收标准

1. WHEN 本机已安装 OpenCLI 且命令可用 THEN System SHALL 优先通过安装根目录里的 `cli-manifest.json` 或 `opencli list -f json` 读取目录。
2. WHEN 本机未安装 OpenCLI 但存在可解析的本地 OpenCLI 包目录或仓库目录 THEN System SHALL 允许退化读取其中的 `cli-manifest.json`。
3. WHEN 以上来源都不可用 THEN System SHALL 明确返回“目录不可读取”，不得编造空列表冒充正常状态。

### 需求 7：隔离会话里的 HOME 策略必须写死，不能靠运气

**用户故事：** 作为维护者，我希望 `Claude Code`、`Codex` 这类隔离会话在调用 OpenCLI 时，既能读到用户真实的 `~/.opencli`，又不会把整个会话 HOME 污染回真实 home。

#### 验收标准

1. WHEN CodingNS 管理会话执行 OpenCLI THEN System SHALL 允许 OpenCLI 进程读取用户真实 `~/.opencli`，即便会话本身跑在隔离 HOME 下。
2. WHEN OpenCLI 进程需要读取用户真实 `~/.opencli` THEN System SHALL 只对 OpenCLI 进程注入真实 HOME，不得把整个会话环境切回真实 HOME。
3. WHEN 用户明确关闭 OpenCLI 或未授权访问真实 `~/.opencli` THEN System SHALL 阻止相关调用，并返回明确错误。

### 需求 8：健康状态必须能区分“已安装但不能用”的不同故障

**用户故事：** 作为用户，我希望看到的不只是“OpenCLI 有问题”，而是知道到底是没装、桥没通，还是只有浏览器型适配器不可用。

#### 验收标准

1. WHEN 系统执行 OpenCLI 健康检查 THEN System SHALL 至少区分 `not_installed`、`binary_ready`、`bridge_missing`、`runtime_build_failed` 这几类状态。
2. WHEN 纯 HTTP 型适配器可用但浏览器桥不可用 THEN System SHALL 明确展示“部分可用”，而不是一刀切显示全部不可用。
3. WHEN 某个适配器目录项依赖浏览器桥 THEN System SHALL 在目录项或站点分组里标出该依赖信息。

## 非功能需求

### 非功能需求 1：可靠性

1. WHEN OpenCLI 目录刷新失败 THEN System SHALL 保留最近一次成功目录缓存，并标记缓存时间。
2. WHEN 裁剪运行时构建失败 THEN System SHALL 不影响已经在使用上一版运行时的新旧会话恢复逻辑。

### 非功能需求 2：可维护性

1. WHEN 后续需要接第二个类似 OpenCLI 的 CLI Hub THEN System SHALL 尽量复用这次的 provider 状态模型和裁剪运行时框架。
2. WHEN 排查命令缺失问题 THEN System SHALL 能区分“全局 OpenCLI 缺失”“目录项被禁用”“裁剪运行时构建不完整”“会话未切到新运行时”这几种情况。

### 非功能需求 3：安全性

1. WHEN 系统生成裁剪运行时 THEN System SHALL 只在项目自己的托管目录下写文件，不得改写用户全局安装目录。
2. WHEN 系统为 OpenCLI 注入真实 HOME THEN System SHALL 把注入范围限制到 OpenCLI 子进程，不得扩大到整个 AI 会话。

## 成功定义

- 用户能在技能面板看到 OpenCLI 的安装、健康和适配器目录状态
- 用户能按适配器目录项选择性启用 OpenCLI 能力
- CodingNS 管理的会话只会看到裁剪后的 OpenCLI 运行时
- 没启用的适配器在 CodingNS 管理的 CLI 环境里不能被使用
- 裁剪运行时和真实 HOME 策略都不污染用户全局环境
