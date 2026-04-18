# 需求文档 - spec013.4-助手专用Skill隔离与调用身份收口

状态：Draft

## 简介

当前系统把 `codingns-assistant` 当成普通内置 Skill 来管理，这带来了两个直接后果：

1. 它会被同步到公共 CLI home 的 `skills/` 目录里，普通项目工作区会话也能扫到
2. 它描述的是 Butler 助手运行时规则，但底层没有把“只有助手运行时能用”这件事做成正式边界

这不是文案问题，是数据结构和分发边界错了。

真正缺的不是更多提示词，而是两条正式规则：

- 助手专用 Skill 不应再走公共 Skill 分发链
- 助手能力调用不能只靠 Skill 文本约束，必须有调用者身份边界

## 可实现性结论

### 结论

这个能力 **值得做，而且必须尽快做**。

继续把 `codingns-assistant` 塞进公共 Skill 目录，只会让普通项目会话不断误读它，后面所有行为偏差都会反复出现。

### 已确认事实

1. 当前 `codingns-assistant` 被作为内置 Skill 同步到 `codex` 和 `claude-code` 目标目录。
2. 当前 npm `postinstall` 还会把 `codingns-assistant` 直接复制到公共 `~/.codex/skills/codingns-assistant`。
3. 当前 Butler 已经有独立的专用 home 和专用规则注入链路，并不是非要依赖公共 Skill 目录。
4. 当前 `/api/assistant/*` 是正式能力面，但普通工作区会话误读 Skill 后，仍然会被引导去使用助手能力。
5. 当前 `SkillManager` 主要按 `targetCli` 管目标目录，没有“给谁用”的边界维度。
6. 当前项目里已经存在助手专用凭证文件和 Butler 工作区凭证发现机制，说明“助手运行时专用身份”是可落地的。

### 平台判断

- ✅ 值得做：这是把助手能力从“公共文本提示”改成“正式运行时边界”的必要修复
- ✅ 能落地：Butler 专用 home、专用凭证、专用规则文件都已经有基础
- ❌ 不能继续把 `codingns-assistant` 当普通公共 Skill 用
- ❌ 不能继续只靠 prompt 说“只有 Butler 能用”

## 术语表

- **Public Skill（公共 Skill）**：安装到普通 CLI home 的 `skills/` 目录后，默认可被该 CLI 普通会话发现和使用的 Skill
- **Assistant Runtime Asset（助手运行时资产）**：只提供给 Butler 或助手专用运行时的内置资源，可以是 Skill、规则文件或辅助模板，但不属于公共 Skill
- **Assistant Runtime Home（助手专用 Home）**：Butler 为特定运行时准备的隔离 home，里面可注入专用规则、专用登录态和专用运行时资产
- **Assistant Caller（助手调用者）**：通过助手专用凭证或明确的内部身份调用 `codingns assistant ...` / `/api/assistant/*` 的运行时主体
- **Reserved Assistant Skill Name（助手保留 Skill 名）**：保留给助手专用运行时资产使用的目录名，不能再当公共 Skill 导入或同步

## 范围说明

### In Scope

- 定义助手专用运行时资产与公共 Skill 的边界
- 停止 `codingns-assistant` 的公共同步和公共安装
- 保留 Butler 专用 home 内的助手 Skill 注入能力
- 给助手专用目录名增加保留和拦截规则
- 给 `codingns assistant ...` 与 `/api/assistant/*` 增加调用者身份边界
- 定义公共目录旧残留的迁移、清理和诊断策略
- 定义兼容策略，保证 Butler 现有链路不断

### Out of Scope

- 不设计 Skill 市场、远端安装和在线编辑
- 不把所有 Skill 都做成复杂 ACL
- 不重做 Butler 页面结构
- 不把整个 Auth 系统翻新成多租户权限平台
- 不开放普通项目会话直接继承助手专用资产

## 技术边界

### 边界 1：助手专用资产不是公共 Skill

- 只要一个资源的语义是“只给 Butler / 助手运行时用”，它就不能继续落到公共 `skills/` 根目录
- 公共 `SkillManager` 只管公共 Skill，不再替助手专用资产兜底分发

### 边界 2：Skill 文本不是权限系统

- `SKILL.md` 只能描述工作流，不能替代调用者校验
- 是否允许调用 `/api/assistant/*`，必须由服务端根据调用者身份决定

### 边界 3：Butler 专用链路必须保留

- 停掉公共同步后，Butler 现有专用 home、专用规则、专用凭证链路必须继续可用
- 不能因为清理公共 Skill，把助手自己也清废了

### 边界 4：兼容优先于理论完美

- 已上线的 Butler 页面和控制会话不能被这次改动打断
- 已存在的普通公共 Skill 不能因为引入助手专用概念被误杀

### 边界 5：迁移要安全，不能乱删用户东西

- 只有系统能确认是自己同步出来的旧 `codingns-assistant` 副本，才允许自动清理
- 对内容已漂移或用户手改过的目录，只能告警、隔离或显式拒绝，不能静默覆盖

## 需求

### 需求 1：系统必须正式区分“公共 Skill”和“助手专用运行时资产”

**用户故事：** 作为维护者，我希望系统层面就能区分哪些 Skill 是普通会话能见的，哪些资产只能给 Butler 用，而不是全塞进一个目录模型里。

#### 验收标准

1. WHEN 系统处理 `codingns-assistant` 这类助手专用资源 THEN System SHALL 把它归类为助手专用运行时资产，而不是公共 Skill。
2. WHEN 平台扫描或同步公共 Skill THEN System SHALL 不再把助手专用运行时资产混入公共 Skill 结果。
3. WHEN 后续新增同类助手专用资源 THEN System SHALL 有稳定的同类归位方式，而不是继续硬编码塞进公共 Skill 管理。

### 需求 2：系统必须停止把 `codingns-assistant` 默认同步或安装到公共 CLI home

**用户故事：** 作为维护者，我希望普通项目工作区会话默认看不到 `codingns-assistant`，这样它们就不会再被助手规则带偏。

#### 验收标准

1. WHEN Host 启动同步内置 Skill THEN System SHALL 不再把 `codingns-assistant` 同步到普通 `codex` 或 `claude-code` 公共 Skill 根目录。
2. WHEN npm `postinstall` 执行 THEN System SHALL 不再把 `codingns-assistant` 复制到公共 `~/.codex/skills`。
3. WHEN 普通项目工作区会话扫描本地 Skill THEN System SHALL 默认看不到系统官方分发的 `codingns-assistant`。

### 需求 3：系统必须继续为 Butler 专用运行时注入 `codingns-assistant`

**用户故事：** 作为 Butler 维护者，我希望拆掉公共同步以后，助手专用运行时还能照常看到 `codingns-assistant`，不把自己链路打断。

#### 验收标准

1. WHEN Butler 为 `codex` 或 `claude-code` 准备专用 home THEN System SHALL 仍然把 `codingns-assistant` 注入该专用 home。
2. WHEN Butler 专用 home 初始化完成 THEN System SHALL 让该运行时能发现并使用 `codingns-assistant`。
3. WHEN 助手专用 Skill 缺失或损坏 THEN System SHALL 返回明确诊断，而不是静默退回公共 home 查找。

### 需求 4：系统必须为助手专用目录名建立保留和拦截规则

**用户故事：** 作为维护者，我希望 `codingns-assistant` 这类目录名不能再被用户当普通 Skill 导入、同步或纳管，不然问题还会再长回来。

#### 验收标准

1. WHEN 用户尝试通过 `SkillManager` 导入、添加或同步保留目录名 THEN System SHALL 明确拒绝。
2. WHEN 公共 Skill 扫描发现保留目录名 THEN System SHALL 把它标记为保留冲突或助手专用残留，而不是当成普通 Skill。
3. WHEN 设置页或 CLI 展示这类冲突 THEN System SHALL 说明它不是普通 Skill，不能继续公共同步。

### 需求 5：系统必须为助手能力调用增加正式的调用者身份边界

**用户故事：** 作为维护者，我希望 `codingns assistant ...` 和相关能力面不是谁看到了 Skill 就能乱用，而是只有助手运行时或显式允许的调用者能用。

#### 验收标准

1. WHEN 调用 `codingns assistant ...` 或对应 `/api/assistant/*` 能力 THEN System SHALL 能识别调用者是不是助手运行时。
2. WHEN 调用者不是助手运行时，且也不是显式允许的交互式用户入口 THEN System SHALL 拒绝该调用。
3. WHEN 调用被接受 THEN System SHALL 记录调用者类型，便于审计和排错。

### 需求 6：系统必须保留用户显式交互入口，不把 Butler 页面一起锁死

**用户故事：** 作为用户，我希望正常从产品界面使用 Butler 时不受影响，而不是因为加了运行时边界把页面功能全封死。

#### 验收标准

1. WHEN 用户通过正常登录态在 Butler 页面执行显式操作 THEN System SHALL 继续允许这些交互式请求。
2. WHEN 同一能力由助手专用 CLI 或助手专用运行时触发 THEN System SHALL 走助手调用者身份链路，而不是和页面路径混成一套黑箱。
3. WHEN 交互式用户入口和助手运行时入口都访问同一能力 THEN System SHALL 能区分两类来源。

### 需求 7：系统必须处理公共目录中的旧 `codingns-assistant` 残留

**用户故事：** 作为维护者，我希望老机器上已经留下的公共 `codingns-assistant` 也能被识别和处理，不然停掉新同步也没用。

#### 验收标准

1. WHEN 系统在公共 Skill 根目录发现历史残留 `codingns-assistant` THEN System SHALL 能识别其是否为系统已知旧副本。
2. WHEN 残留副本可安全确认是系统旧副本 THEN System SHALL 提供自动清理或自动禁用路径。
3. WHEN 残留目录已被用户修改或内容漂移 THEN System SHALL 不静默删除，而是给出明确诊断和处理建议。

### 需求 8：系统必须保证普通公共 Skill 管理能力不被这次调整打断

**用户故事：** 作为维护者，我希望修这个边界问题时，不把 `spec001.5` 本来已经正常工作的公共 Skill 管理一起砸坏。

#### 验收标准

1. WHEN 用户管理普通公共 Skill THEN System SHALL 保持原有扫描、导入、同步行为不变。
2. WHEN 平台处理普通内置 Skill THEN System SHALL 仍然能通过现有 `SkillManager` 完成受管和同步。
3. WHEN 用户完全不用 Butler 和助手专用能力 THEN System SHALL 继续表现得像普通本地 Skill 管理系统。

### 需求 9：系统必须提供最小诊断和回归验证能力

**用户故事：** 作为维护者，我希望能快速确认“公共 home 里没有官方 `codingns-assistant` 了，但 Butler 专用 home 里还有”，不靠猜。

#### 验收标准

1. WHEN 维护者检查当前环境 THEN System SHALL 能区分公共 Skill 状态和助手专用运行时资产状态。
2. WHEN 回归 Butler 初始化链路 THEN System SHALL 能验证专用 home 仍能发现 `codingns-assistant`。
3. WHEN 回归普通项目工作区链路 THEN System SHALL 能验证默认不会再发现官方分发的 `codingns-assistant`。
