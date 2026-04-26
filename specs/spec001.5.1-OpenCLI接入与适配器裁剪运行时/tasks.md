# 任务清单 - spec001.5.1-OpenCLI接入与适配器裁剪运行时（人话版）

状态：Done

## 2026-04-25 立项补记

- 已确认这次不是“把 OpenCLI 当普通 Skill 导入”，而是把它作为独立 provider 管理
- 已确认用户要求的核心结果是：技能面板能按适配器选择性启用，并且未启用的适配器在 CodingNS 管理的 CLI 环境里不能使用
- 已确认主方案是“生成裁剪版 OpenCLI 运行时”，而不是改用户全局安装目录
- 已确认当前机器上 `OpenCLI` 已可安装、可列目录、可区分纯 HTTP 与浏览器桥依赖命令
- 已完成 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化

## 这份文档是干什么的

这份任务清单只回答这些问题：

- 先把什么立起来，不然整个方案就是空话
- 哪一步是在做 provider 状态，哪一步是在做裁剪运行时
- 哪一步会真正影响会话环境
- 怎么验证不是“前端能勾选，实际没效果”

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，等复核
- `DONE`：已经完成，并且已经回写
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾成 `[x]`
- 每做完一个任务，必须立刻回写本文件

## 阶段 0：先把现实边界钉死

- [x] 0.1 确认 OpenCLI 的真实安装产物和可用性边界
  - 状态：DONE
  - 这一步到底做什么：直接在当前机器上安装并跑 OpenCLI，确认包目录、版本、命令目录、浏览器桥依赖这些基础事实。
  - 做完你能看到什么：Spec 不再靠 README 猜，知道什么东西真在安装包里，什么东西根本不在。
  - 先依赖什么：无
  - 开始前先看：
    - OpenCLI 本机安装结果
    - OpenCLI 命令输出
  - 主要改哪里：
    - `specs/spec001.5.1-OpenCLI接入与适配器裁剪运行时/*`
  - 这一步先不做什么：不写接入代码。
  - 怎么算完成：
    1. 已确认 `opencli --version`
    2. 已确认 `cli-manifest.json` 和 `clis/` 是否存在
    3. 已确认纯 HTTP 和浏览器型命令的差异
  - 怎么验证：
    - `opencli --version`
    - `opencli list -f json`
    - `opencli doctor`
  - 对应需求：`requirements.md` 需求 1、需求 6、需求 8
  - 对应设计：`design.md` §1.3、§5.1

- [x] 0.2 建立 spec001.5.1 初稿并锁定主方案
  - 状态：DONE
  - 这一步到底做什么：把“OpenCLI provider + 裁剪运行时”写成正式 Spec，明确不碰全局安装，只切会话运行时。
  - 做完你能看到什么：后续实现不会再跑去做“改全局 manifest”这种脏方案。
  - 先依赖什么：0.1
  - 开始前先看：
    - `spec001.5`
    - `spec010`
  - 主要改哪里：
    - `specs/spec001.5.1-OpenCLI接入与适配器裁剪运行时/*`
  - 这一步先不做什么：不开始建表，不改页面。
  - 怎么算完成：
    1. 主文档齐全
    2. 已明确裁剪运行时是主方案
    3. 已明确真实 HOME 注入边界
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

## 阶段 1：先把 provider 状态和目录缓存立起来

- [x] 1.1 建 OpenCLI provider 状态表和仓储
  - 状态：DONE
  - 这一步到底做什么：落 OpenCLI 的安装状态、健康状态、当前运行时配置档和最近错误记录。
  - 做完你能看到什么：Host 不再只能临时现场检查，前端能读到稳定 provider 状态。
  - 先依赖什么：0.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 8
    - `design.md` §3.1、§4.1
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/storage/repositories/`
    - `apps/host/src/modules/opencli/`
  - 这一步先不做什么：先不构建裁剪运行时。
  - 怎么算完成：
    1. 能持久化 provider 状态
    2. 能记录最近检查结果和当前生效运行时
  - 怎么验证：
    - `pnpm --dir apps/host test -- opencli-repositories.test.ts sqlite-bootstrap.test.ts`
    - `pnpm --dir apps/host build`
  - 对应需求：`requirements.md` 需求 1、需求 8
  - 对应设计：`design.md` §3.1、§4.1
  - 2026-04-26 完成补记：
    - 已新增 `opencli_providers`、`opencli_catalog_entries` 两张表
    - 已新增 `OpenCliProviderRepository`、`OpenCliCatalogEntryRepository`
    - 已补 SQLite 兼容逻辑，旧表缺少 `catalog_refreshed_at`、`catalog_source`、`module_path`、`source_file` 时会自动补齐
    - 已补测试：
      - `apps/host/tests/integration/opencli-repositories.test.ts`
      - `apps/host/tests/integration/sqlite-bootstrap.test.ts`

- [x] 1.2 建命令目录读取与缓存主链路
  - 状态：DONE
  - 这一步到底做什么：实现安装发现、manifest 读取、`opencli list -f json` 退化和目录缓存。
  - 做完你能看到什么：技能面板第一次能稳定拿到 OpenCLI 目录项。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 6
    - `design.md` §3.2、§5.1
  - 主要改哪里：
    - `apps/host/src/modules/opencli/opencli-catalog-service.ts`
    - `apps/host/src/modules/opencli/opencli-install-discovery.ts`
  - 这一步先不做什么：先不处理会话 PATH。
  - 怎么算完成：
    1. 已安装时能读取目录
    2. 读失败时能回退或报明确错误
    3. 能输出按站点分组的数据
  - 怎么验证：
    - `pnpm --dir apps/host test -- opencli-repositories.test.ts opencli-catalog-service.test.ts sqlite-bootstrap.test.ts`
    - `pnpm --dir apps/host build`
    - 本机回放：
      - `opencli --version`
      - `opencli list -f json`
  - 对应需求：`requirements.md` 需求 3、需求 6
  - 对应设计：`design.md` §3.2、§5.1
  - 2026-04-26 完成补记：
    - 已新增 `apps/host/src/modules/opencli/opencli-install-discovery.ts`
    - 已新增 `apps/host/src/modules/opencli/opencli-catalog-service.ts`
    - 已实现目录来源优先级：
      1. 已安装时优先读安装根目录 `cli-manifest.json`
      2. manifest 失败时退化执行 `opencli list -f json`
      3. 未安装时可退化到本地候选目录的 `cli-manifest.json`
    - 已实现目录归一化、按站点分组、`catalog count` / `enabled count` / `browser-dependent count` 分离统计
    - 已实现失败保留最近一次成功缓存，不再用空列表伪装成功
    - 已补测试：
      - `apps/host/tests/integration/opencli-catalog-service.test.ts`

## 阶段 2：把裁剪运行时做出来

- [x] 2.1 建运行时配置档和内容哈希逻辑
  - 状态：DONE
  - 这一步到底做什么：把“当前启用了哪些 `site/name`”固化成运行时配置档，给后面的构建和切换一个稳定主键。
  - 做完你能看到什么：同一份启用结果不会重复无意义重建。
  - 先依赖什么：1.2
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §4.3、§5.3
  - 主要改哪里：
    - `apps/host/src/modules/opencli/opencli-runtime-profile-service.ts`
    - `apps/host/src/storage/repositories/`
  - 这一步先不做什么：先不接前端。
  - 怎么算完成：
    1. 运行时配置能持久化
    2. 配置变化能产出稳定 hash
  - 怎么验证：
    - 单元测试
    - 仓储测试
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §4.3、§5.3
  - 2026-04-26 完成补记：
    - 已新增 `opencli_runtime_profiles` 表与 `idx_opencli_runtime_profiles_status` 索引
    - 已新增 `OpenCliRuntimeProfileRepository`
    - 已新增 `apps/host/src/modules/opencli/opencli-runtime-profile-service.ts`
    - 已实现：
      1. 按 `version + sourceInstallPath + enabledCommandIds` 生成稳定 `contentHash`
      2. 同一份启用结果复用同一配置档，不重复造新记录
      3. 安装版本变化时，把旧配置档标记为 `stale`
    - 已补测试：
      - `apps/host/tests/integration/opencli-runtime-profile-service.test.ts`
      - `apps/host/tests/integration/opencli-repositories.test.ts`
      - `apps/host/tests/integration/sqlite-bootstrap.test.ts`

- [x] 2.2 实现裁剪运行时构建器
  - 状态：DONE
  - 这一步到底做什么：根据启用目录项生成独立运行时根目录，包括过滤 manifest、复制或链接必要文件、生成 shim。
  - 做完你能看到什么：项目已经真的拥有一份可执行的裁剪 OpenCLI，不再只是数据库里保存了勾选结果。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §3.3、§5.3
  - 主要改哪里：
    - `apps/host/src/modules/opencli/opencli-runtime-builder.ts`
    - `apps/host/src/modules/opencli/opencli-runtime-layout.ts`
  - 这一步先不做什么：先不接会话启动链路。
  - 怎么算完成：
    1. 能生成独立 runtimeRoot
    2. 过滤后的 manifest 正确
    3. 未启用命令不会出现在新 runtime 里
  - 怎么验证：
    - 文件系统集成测试
    - 使用 shim 跑真实命令验证
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §3.3、§5.3
  - 2026-04-26 完成补记：
    - 已新增 `apps/host/src/modules/opencli/opencli-runtime-layout.ts`
    - 已新增 `apps/host/src/modules/opencli/opencli-runtime-builder.ts`
    - 已实现裁剪运行时产物：
      1. 复制 `package.json`
      2. 重写过滤后的 `cli-manifest.json`
      3. 软链接 `dist/` 与 `node_modules/`
      4. 复制启用站点整站目录与 `_shared/` 目录
      5. 生成 `bin/opencli` shim 与 `opencli.cmd`
    - 已确认关键实现点：
      - 不能直接执行软链接后的 `dist/src/main.js`
      - shim 必须用 `--preserve-symlinks-main` 启动，才能让 OpenCLI 把 runtime 根目录当成自己的包根
    - 已补测试：
      - `apps/host/tests/integration/opencli-runtime-builder.test.ts`

- [x] 2.3 阶段检查：禁用命令是不是已经真禁用了
  - 状态：DONE
  - 这一步到底做什么：验证“前端勾选变化 -> 新 runtime 生成 -> 未启用命令执行失败”这一整条链路。
  - 做完你能看到什么：不会再出现 UI 能关，CLI 还照样能用的假完成。
  - 先依赖什么：2.2
  - 开始前先看：
    - 当前阶段所有实现
  - 主要改哪里：
    - 测试和验收文档
  - 这一步先不做什么：先不碰会话 HOME。
  - 怎么算完成：
    1. 禁用命令不再出现在新运行时
    2. 启用命令仍可执行
  - 怎么验证：
    - 真实 shim 调用测试
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §5.3
  - 2026-04-26 完成补记：
    - 已在测试桩里验证：
      1. `list -f json` 只返回启用命令
      2. 启用命令可执行
      3. 禁用命令返回 `COMMAND_NOT_FOUND`
    - 已做本机真实 OpenCLI 回放：
      - 过滤后 runtime 的 `list -f json` 只返回 1 条 `hackernews/top`
      - `hackernews top --limit 1 -f json` 可执行
      - `twitter trending -f json` 返回 `unknown command 'twitter'`

## 阶段 3：把新运行时接进会话环境

- [x] 3.1 把裁剪运行时接到新会话 PATH
  - 状态：DONE
  - 这一步到底做什么：让新的 CodingNS 管理会话优先命中裁剪版 `opencli` shim。
  - 做完你能看到什么：新建会话里执行 `opencli`，用的已经不是用户全局安装入口。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4
    - `design.md` §3.4、§5.4
  - 主要改哪里：
    - `apps/host/src/modules/sessions/`
    - `packages/session-sync-core/src/runtime/`
  - 这一步先不做什么：先不解决真实 HOME。
  - 怎么算完成：
    1. 新会话 PATH 能命中 shim
    2. OpenCLI 关闭时不会暴露 shim
  - 怎么验证：
    - 新会话环境变量测试
    - 运行时定向测试
  - 对应需求：`requirements.md` 需求 2、需求 4
  - 对应设计：`design.md` §3.4、§5.4
  - 2026-04-26 完成补记：
    - 已新增 `apps/host/src/modules/opencli/opencli-runtime-resolver.ts`
    - 已把 `OpenCliRuntimeResolver` 接入 `SessionProviderConfigService`
    - 已实现：
      1. provider 总开关关闭时不注入
      2. provider 启用时自动解析或构建目标 runtime
      3. 会话 launch context 的 `PATH` 前置 `<runtimeRoot>/bin`
      4. 成功解析后回写 `activeRuntimeId`
    - 已补测试：
      - `apps/host/tests/integration/opencli-runtime-resolver.test.ts`
      - `apps/host/tests/integration/session-provider-config-service.test.ts`
  - 2026-04-26 会话可调用性补记：
    - 已新增 `apps/host/src/modules/opencli/opencli-session-prompt-service.ts`
    - 已把 OpenCLI 会话提示接入 `SessionLiveRuntimeService`
    - 当前逻辑改成：
      1. 只有当前会话真的注入了裁剪版 OpenCLI runtime，才把提示追加到 provider prompt
      2. 提示里只暴露当前启用的 `site/name` 命令，不把目录里未启用项当成可用能力
      3. 明确区分“目录存在”和“当前环境一定可运行”，浏览器依赖命令会单独标注
    - 这一步没有把 OpenCLI 重新伪装成普通 Skill，也没有去改用户全局 home
    - 已补测试：
      - `apps/host/tests/integration/opencli-session-prompt-service.test.ts`
      - `apps/host/tests/integration/opencli-runtime-resolver.test.ts`
      - `apps/host/tests/integration/session-provider-config-service.test.ts`
  - 2026-04-26 桥接 Skill 补记：
    - 已新增 `apps/host/src/modules/opencli/opencli-bridge-skill-service.ts`
    - 已把 OpenCLI 桥接 Skill 接入普通会话 runtime，而不是只靠 prompt 提示
    - 当前实现改成：
      1. OpenCLI runtime ready 且存在已启用命令时，`global-default` 的 Codex / Claude Code 会话也会分到受控 runtime home
      2. 受控 runtime home 会自动生成 `skills/codingns-opencli/SKILL.md`
      3. 这个桥接 Skill 只暴露当前启用的 CLI技能，不把未启用命令伪装成可用入口
      4. OpenCLI runtime 不可用时，会自动移除桥接 Skill，避免会话继续误判能力
    - 这一步仍然保持主方案不变：
      - OpenCLI 继续是独立 provider
      - 没有改用户全局 `~/.codex` / `~/.claude`
      - 没有把 OpenCLI 错纳进普通 Skill 管理表
    - 已补测试：
      - `apps/host/tests/integration/opencli-bridge-skill-service.test.ts`
      - `apps/host/tests/integration/session-provider-config-service.test.ts`

- [x] 3.2 实现 OpenCLI 子进程真实 HOME 注入
  - 状态：DONE
  - 这一步到底做什么：只给 OpenCLI 子进程注入用户真实 HOME，让它读到 `~/.opencli`，同时不污染整个会话。
  - 做完你能看到什么：隔离会话里 OpenCLI 能用，其他命令继续隔离。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 7
    - `design.md` §2.2 原则 4、§5.5
  - 主要改哪里：
    - OpenCLI shim
    - 会话运行时环境注入逻辑
  - 这一步先不做什么：先不做扩展自动安装。
  - 怎么算完成：
    1. OpenCLI 进程能拿真实 HOME
    2. 会话主进程仍是隔离 HOME
  - 怎么验证：
    - 子进程环境测试
    - 本机 doctor 回放测试
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §5.5
  - 2026-04-26 完成补记：
    - 已在 shim 中固定使用：
      - `CODINGNS_OPENCLI_REAL_HOME`
      - `CODINGNS_OPENCLI_REAL_USERPROFILE`
    - 已确认：
      1. 会话环境本身不写入 `HOME` / `USERPROFILE`
      2. 只有 shim 拉起的 OpenCLI 子进程会改用真实 home
    - 已补测试：
      - `apps/host/tests/integration/opencli-runtime-builder.test.ts`
      - `apps/host/tests/integration/session-provider-config-service.test.ts`
    - 已做本机真实回放：
      - 在父进程 `HOME=/tmp/codingns-isolated-home` 的前提下，通过 shim 执行 `doctor`
      - `doctor` 正常读到真实用户环境并返回：
        - daemon `OK`
        - extension `MISSING`
        - connectivity `FAIL`

## 阶段 4：补技能面板和运维入口

- [x] 4.1 在技能面板增加 OpenCLI 分区
  - 状态：DONE
  - 这一步到底做什么：把安装状态、健康状态、总开关、目录刷新入口和适配器目录拉到技能面板里。
  - 做完你能看到什么：用户不用记命令，也能管理 OpenCLI。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3、需求 8
    - `design.md` §3.6
  - 主要改哪里：
    - `apps/user-app/src/settings/`
    - OpenCLI 专用 API 文件
  - 这一步先不做什么：先不做工作台入口。
  - 怎么算完成：
    1. 能展示 provider 卡片
    2. 能展示目录列表和勾选状态
    3. 能触发保存与重建
  - 怎么验证：
    - `pnpm --dir apps/user-app exec vitest run src/settings/OpenCliManagementPanel.test.tsx src/settings/SkillManagementPanel.test.tsx`
    - `pnpm --dir packages/codingns build`
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 8
  - 对应设计：`design.md` §3.6
  - 2026-04-26 完成补记：
    - 已新增 `apps/user-app/src/features/settings/api/opencli-api.ts`
    - 已新增 `apps/user-app/src/settings/OpenCliManagementPanel.tsx`
    - 已把 OpenCLI 分区接入 `apps/user-app/src/settings/SkillManagementPanel.tsx`
    - 已实现：
      1. 展示安装状态、健康状态、目录总数、启用数、浏览器依赖数
      2. 展示版本、目录来源、最近检查时间、最近刷新时间
      3. 支持 provider 总开关
      4. 支持按站点分组勾选和按命令逐条勾选
      5. 支持“刷新状态”和“保存并重建”
    - 已补前端文案和样式：
      - `apps/user-app/src/shared/i18n/index.ts`
      - `apps/user-app/src/app/styles.css`
    - 已补测试：
      - `apps/user-app/src/settings/OpenCliManagementPanel.test.tsx`
      - `apps/user-app/src/settings/SkillManagementPanel.test.tsx`
  - 2026-04-26 继续收口补记：
    - 已把技能管理弹层拆成 `SKILL` 和 `OpenCLI` 两个标签页，避免两套配置混在一页里滚长列表
    - 已把 OpenCLI 目录改成“标签筛选 + 站点小卡片 + 命令详情”结构
    - 已给站点卡片补本地生成的视觉封面，不依赖远程 logo，也不引入全局资源污染
    - 已补验证：
      - `pnpm --dir apps/user-app exec vitest run src/settings/OpenCliManagementPanel.test.tsx src/settings/SkillManagementPanel.test.tsx`
      - `pnpm --dir apps/user-app build`
  - 2026-04-26 交互优化补记：
    - 已移除技能面板顶部和 OpenCLI 面板里的多余说明文案，减少噪音
    - 已把 OpenCLI 页面里“适配器”相关措辞统一成“CLI技能”
    - 已把站点命令明细从页内展示改成“查看命令”模态框，不再在下方拉长整页
  - 2026-04-26 本轮收口补记：
    - 已把 OpenCLI 总开关移到顶部操作栏，位置在“刷新状态”左侧；页内 provider 调试块已移除
    - 已新增“详情”按钮，安装状态、健康状态、运行时状态、版本、目录来源、安装目录、最近检查与最近刷新统一收进弹窗
    - 已给 OpenCLI 命令模态框补上：
      1. 搜索
      2. 按状态排序
      3. 浏览器优先排序
      4. 名称排序
    - 已继续压平 CLI技能 标签页样式：
      - 去掉重背景、渐变和阴影
      - 收紧容器间距
      - 保留站点小卡片，但改成更轻的设置面板风格
    - 已顺手清掉这轮 `apps/user-app build` 的旧类型阻塞：
      - `src/features/butler/pages/ButlerPage.tsx`
      - `src/features/conversation/components/SessionButlerActionButton.tsx`
      - `src/features/conversation/components/ConversationSelectionActions.tsx`
    - 本轮验证：
      - `pnpm --dir apps/user-app exec vitest run src/settings/OpenCliManagementPanel.test.tsx src/settings/SkillManagementPanel.test.tsx`
      - `pnpm --dir apps/user-app build`
  - 2026-04-26 顶部布局继续收口补记：
    - 已参考 `SKILL` 管理页，把 OpenCLI 顶部操作顺序调整为：启用、刷新、详情、保存
    - 已把按钮文案改短，减少操作栏横向噪音
    - 已继续压缩标签栏上方和下方空白，以及 OpenCLI 顶部区块的无效间隔
    - 本轮验证：
      - `pnpm --dir apps/user-app exec vitest run src/settings/OpenCliManagementPanel.test.tsx src/settings/SkillManagementPanel.test.tsx`
      - `pnpm --dir apps/user-app build`
  - 2026-04-26 模态框顶部结构补记：
    - 已移除技能配置弹窗默认 header，避免“标题 + 右上角关闭按钮”再占一整行
    - 已把 `SKILL / OpenCLI` 标签切换提到弹窗最顶部，改成更接近 macOS 的分段切换样式
    - 已把 `SKILL` 页顶部操作按钮一并收进新的顶部工具区，和 `CLI技能` 页按钮风格对齐
    - 已顺手补回缺失的 `ProviderManagementPanel` 最小实现，恢复 `apps/user-app build` 对 `SettingsPage` 的组件引用
    - 本轮验证：
      - `pnpm --dir apps/user-app exec vitest run src/settings/ProviderManagementPanel.test.tsx src/settings/SkillManagementPanel.test.tsx src/settings/OpenCliManagementPanel.test.tsx src/components/DesktopModal.test.tsx`
      - `pnpm --dir apps/user-app build`
  - 2026-04-26 顶栏与会话提示继续收口补记：
    - 已彻底移除 OpenCLI 页内部的独立标题/按钮区，不再保留 `OpenCLI 接入` 那一整块历史 heading
    - 已把 `CLI技能` 页按钮真正提升到和标签页同一行，顺序固定为：启用、刷新、详情、保存
    - 已把 `SKILL` 页指标卡、按钮尺寸和间距继续向 `CLI技能` 页对齐，压掉多余背景和空白
    - 已修掉一个真实状态 bug：
      - 之前工具栏 `save` 闭包会吃到旧的 `enabledCommandIds`
      - 现在按钮状态和保存载荷都跟当前勾选保持一致
    - 本轮验证：
      - `pnpm --dir apps/user-app exec vitest run src/settings/ProviderManagementPanel.test.tsx src/settings/SkillManagementPanel.test.tsx src/settings/OpenCliManagementPanel.test.tsx src/components/DesktopModal.test.tsx`
      - `pnpm --dir apps/host exec vitest run tests/integration/opencli-session-prompt-service.test.ts tests/integration/session-provider-config-service.test.ts tests/integration/opencli-runtime-builder.test.ts tests/integration/opencli-runtime-resolver.test.ts`
      - `pnpm --dir apps/user-app build`
  - 2026-04-26 CLI技能卡片一致性补记：
    - 已把站点卡片说明区收成固定两行，超出内容省略，避免不同站点把卡片高度撑乱
    - 已把站点卡片底部标签收成两排固定节奏：
      1. 启用数量
      2. 浏览器依赖状态
      3. CLI技能类型标签
    - 已把完整站点说明补进“查看命令”模态框，列表页只保留可快速扫描的摘要
    - 已补前端测试，覆盖：
      1. 卡片说明节点存在
      2. 标签分区结构存在
      3. 模态框能看到完整站点说明
    - 本轮验证：
      - `pnpm --dir apps/user-app exec vitest run src/settings/OpenCliManagementPanel.test.tsx src/settings/SkillManagementPanel.test.tsx`
      - `pnpm --dir apps/user-app build`
  - 2026-04-26 CLI技能卡片动作与类型标签补记：
    - 已移除站点卡片里的命令数量标签，不再显示 `x/x 已启用`
    - 已把站点级开关移到标题行右侧，和“查看”按钮并排，卡片底部只保留浏览器状态与类型标签
    - 已把“查看命令”按钮缩成“查看”，减小按钮尺寸，避免标题行过重
    - 已把 `cookie / header / intercept / local / public / ui` 类型标签改成彩色标准标签
    - 已补中英文文案：
      1. 中文显示 `拦截 / 公开 / 请求头 / 本地 / 界面`
      2. 英文显示 `Intercept / Public / Header / Local / UI`
    - 已补前端测试，确认：
      1. 数量标签不再出现
      2. 卡片标题行动作存在
      3. 类型标签带正确语义属性
    - 本轮验证：
      - `pnpm --dir apps/user-app exec vitest run src/settings/OpenCliManagementPanel.test.tsx src/settings/SkillManagementPanel.test.tsx`
      - `pnpm --dir apps/user-app build`
  - 2026-04-26 CLI技能卡片紧凑度继续收口：
    - 已彻底移除站点卡片里的“x 条依赖浏览器 / 无需浏览器桥”这一行，避免重复噪音
    - 已去掉卡片内部多余的强制最小高度，简介下方空白改成随内容自适应，不再用大块留白撑版面
    - 已把“查看”和“启用”按钮尺寸进一步统一到同一高度、同一圆角和同一字号
    - 已把类型标签收成更小号的彩色标签，并提高样式选择器优先级，避免 `Cookie` 之类标签继续退回灰色默认态
    - 已补前端测试，确认：
      1. 站点卡片不再显示浏览器依赖标签
      2. 站点卡片只保留一排类型标签
    - 本轮验证：
      - `pnpm --dir apps/user-app exec vitest run src/settings/OpenCliManagementPanel.test.tsx src/settings/SkillManagementPanel.test.tsx`
      - `pnpm --dir apps/user-app build`
  - 2026-04-26 CLI技能操作按钮尺寸修正补记：
    - 已确认“查看”按钮仍被模态层里的 `.ghost-button` 通用规则刷回 `34px` 高，不是真正跟“启用”同尺寸
    - 已在模态作用域下补更高优先级的定向规则，把“查看”和“启用”统一到同一套盒模型：
      1. `min-height: 30px`
      2. `padding: 0 10px`
      3. `border-radius: 999px`
      4. `font-size: 12px`
    - 已把“查看”按钮的边框、背景和 hover 也拉回和“启用”一致的轻量 pill 风格
    - 本轮验证：
      - `pnpm --dir apps/user-app exec vitest run src/settings/OpenCliManagementPanel.test.tsx src/settings/SkillManagementPanel.test.tsx`
      - `pnpm --dir apps/user-app build`

- [x] 4.2 提供 Host API 和 `codingns` CLI 最小入口
  - 状态：DONE
  - 这一步到底做什么：让前端和本地维护入口都能读状态、刷新目录、保存启用结果。
  - 做完你能看到什么：OpenCLI provider 不再只能靠手工调试。
  - 先依赖什么：4.1
  - 开始前先看：
    - `design.md` §6
  - 主要改哪里：
    - `apps/host/src/routes/`
    - `apps/host/src/modules/opencli/`
    - `packages/codingns`
  - 这一步先不做什么：先不做 MCP 暴露。
  - 怎么算完成：
    1. API 可读写
    2. CLI 可读状态与触发刷新
  - 怎么验证：
    - `pnpm --dir apps/host test -- opencli-routes.test.ts`
    - `node --test --test-reporter=tap packages/codingns/tests/opencli-cli.test.mjs`
    - `pnpm --dir apps/host build`
    - `pnpm --dir packages/codingns build`
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 6、需求 8
  - 对应设计：`design.md` §6
  - 2026-04-26 完成补记：
    - Host 已提供：
      - `GET /api/opencli/overview`
      - `GET /api/opencli/catalog`
      - `POST /api/opencli/check`
      - `POST /api/opencli/config`
    - 已新增 `codingns opencli` 最小入口：
      - `codingns opencli overview`
      - `codingns opencli catalog`
      - `codingns opencli check`
      - `codingns opencli config --enabled true|false --command-id <site/name>`
    - 已补 CLI 帮助文本和定向调用测试
    - 本轮额外修正：
      1. CLI 测试原先用 `spawnSync` 配合同进程 HTTP server 会死锁，已改成异步 `spawn`
      2. CLI 请求统一加 `Connection: close`，避免一次性命令残留长连接句柄
      3. `apps/host build` 中的 Claude hook provider 联合类型守卫已修正
