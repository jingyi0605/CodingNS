# 任务清单 - spec001.5.1-OpenCLI接入与适配器裁剪运行时（人话版）

状态：Draft

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

- [ ] 1.1 建 OpenCLI provider 状态表和仓储
  - 状态：TODO
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
    - Host 仓储测试
    - SQLite bootstrap 测试
  - 对应需求：`requirements.md` 需求 1、需求 8
  - 对应设计：`design.md` §3.1、§4.1

- [ ] 1.2 建命令目录读取与缓存主链路
  - 状态：TODO
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
    - 定向集成测试
    - 本机回放测试
  - 对应需求：`requirements.md` 需求 3、需求 6
  - 对应设计：`design.md` §3.2、§5.1

## 阶段 2：把裁剪运行时做出来

- [ ] 2.1 建运行时配置档和内容哈希逻辑
  - 状态：TODO
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

- [ ] 2.2 实现裁剪运行时构建器
  - 状态：TODO
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

- [ ] 2.3 阶段检查：禁用命令是不是已经真禁用了
  - 状态：TODO
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

## 阶段 3：把新运行时接进会话环境

- [ ] 3.1 把裁剪运行时接到新会话 PATH
  - 状态：TODO
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

- [ ] 3.2 实现 OpenCLI 子进程真实 HOME 注入
  - 状态：TODO
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

## 阶段 4：补技能面板和运维入口

- [ ] 4.1 在技能面板增加 OpenCLI 分区
  - 状态：TODO
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
    - 前端组件测试
    - API 集成测试
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 8
  - 对应设计：`design.md` §3.6

- [ ] 4.2 提供 Host API 和 `codingns` CLI 最小入口
  - 状态：TODO
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
    - Host API 测试
    - `codingns` CLI help 和定向调用
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3、需求 6、需求 8
  - 对应设计：`design.md` §6
