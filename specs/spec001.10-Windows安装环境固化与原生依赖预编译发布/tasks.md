# 任务清单 - spec001.10-Windows安装环境固化与原生依赖预编译发布（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单是为了把 Windows 安装这件事，从“靠用户机器环境赌一把”改成“我们自己把环境和原生依赖控制住”。

它要回答的是：

- 先把哪一层收口
- 私有 Node 怎么落地
- `node-pty` fork 怎么发布
- 最后怎么确认真能在没有 Build Tools 的机器上装起来

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经有结果，等复核
- `DONE`：已经完成，并且已经回写状态
- `CANCELLED`：取消，不做了，但要写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- `BLOCKED` 必须写清楚卡在哪里
- `CANCELLED` 必须写清楚为什么不做
- 每做完一个任务，必须立刻更新这里

---

## 阶段 1：把 Spec 和边界先钉死

- [x] 1.1 建立 `spec001.10` 文档骨架
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md`、`docs/README.md`，把这次 Windows 安装治理的范围和目标先落盘。
  - 做完你能看到什么：这件事不再停留在聊天记录里，而是变成可持续推进的正式 Spec。
  - 先依赖什么：当前需求确认
  - 开始前先看：
    - `specs/spec011-单包安装与统一服务发布/requirements.md`
    - `specs/spec011-单包安装与统一服务发布/design.md`
    - `specs/spec001.6-客户端与服务端统一更新机制/design.md`
  - 主要改哪里：
    - `specs/spec001.10-Windows安装环境固化与原生依赖预编译发布/*`
  - 这一步先不做什么：不改安装脚本和 CI。
  - 怎么算完成：
    1. 五个主文件已建立
    2. 需求、设计、任务三份主文档已经能读懂
  - 怎么验证：
    - 手工检查目录和文档内容
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

- [x] 1.2 盘点当前 Windows 安装链路和原生依赖支持矩阵
  - 状态：DONE
  - 这一步到底做什么：把当前 `install.sh`、服务包依赖、`better-sqlite3` 与 `node-pty` 的现状、命中条件、已知失败点整理成一份补充文档。
  - 做完你能看到什么：后面做脚本和发布链路时，不再靠记忆猜条件。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 6
    - `design.md` §2.3、§3.2、§3.3
  - 主要改哪里：
    - `install.sh`
    - `packages/codingns/package.json`
    - `apps/host/package.json`
    - `spec001.10/docs/*`
  - 这一步先不做什么：不决定最终 fork 包结构。
  - 怎么算完成：
    1. 当前安装失败路径有明确清单
    2. 受管依赖支持矩阵初稿已列出
  - 怎么验证：
    - 文档走查
    - 依赖元数据核对
  - 本次产出：
    - `docs/20260515-Windows安装链路与原生依赖现状盘点.md`
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 6
  - 对应设计：`design.md` §2.3、§3.2、§3.3

### 阶段检查

- [x] 1.3 阶段检查：边界和现实约束确认
  - 状态：DONE
  - 这一步到底做什么：确认第一阶段已经把“不做什么”和“先做什么”钉死，避免后面范围失控。
  - 做完你能看到什么：后续实现能直接按文档推进，而不是边做边改方向。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本 Spec 文档
  - 这一步先不做什么：不写 CI 文件，不改正式包依赖。
  - 怎么算完成：
    1. 当前支持矩阵和非目标范围清楚
    2. 已知风险和待确认项已回写
  - 怎么验证：
    - 文档走查
  - 本次回写：
    - `design.md` §8.3 第一阶段现实边界确认
    - `docs/20260515-Windows安装链路与原生依赖现状盘点.md` §8
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` §8

---

## 阶段 2：先把私有 Node 22 安装路径做出来

- [x] 2.1 给安装脚本增加 Windows 受管依赖矩阵判断与目标运行时决策
  - 状态：DONE
  - 这一步到底做什么：在真正执行 npm 安装前，先固定 Windows 正式运行时为私有 Node 22，并判断目标运行时是否命中 `better-sqlite3` 和 `@codingns/node-pty` 的预编译支持。
  - 做完你能看到什么：安装脚本会在安装前就知道目标环境能不能装，以及哪个依赖还没被预编译覆盖。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §3.2、§3.3
  - 主要改哪里：
    - `install.sh`
    - 受管支持矩阵定义文件（如新增）
  - 这一步先不做什么：不下载私有 Node，不改 npm 前缀。
  - 怎么算完成：
    1. 安装脚本能输出系统 Node 诊断信息和目标运行时决策
    2. 哪个依赖未命中会被明确指出
  - 怎么验证：
    - Windows 模拟输入验证
    - 不同 Node 版本分支测试
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §3.2、§3.3
  - 本次产出：
    - `install.sh`

- [x] 2.2 给安装脚本增加私有 Node 22 下载、校验和复用逻辑
  - 状态：DONE
  - 这一步到底做什么：为 CodingNS 单独下载并复用一份私有 Node 22 LTS，让 Windows 正式安装不再依赖系统 Node。
  - 做完你能看到什么：即使系统 Node 不合适，CodingNS 也能切到自己的受控运行时。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 6
    - `design.md` §3.1、§3.3、§4.1
    - `docs/20260515-Windows私有运行时目录与环境约定.md`
  - 主要改哪里：
    - `install.sh`
    - 可选新增 `packages/codingns` 运行时帮助脚本
  - 这一步先不做什么：不安装正式服务包。
  - 怎么算完成：
    1. 私有 Node 目录结构稳定
    2. 重复安装时能复用已有运行时
    3. 下载失败时会明确报错
  - 怎么验证：
    - Windows 真机/Runner 安装演练
    - `bash -n install.sh`
  - 对应需求：`requirements.md` 需求 1、需求 6
  - 对应设计：`design.md` §3.1、§3.3、§4.1、§5
  - 本次产出：
    - `install.sh`

- [x] 2.3 切换安装脚本到私有 npm 前缀和私有运行时
  - 状态：DONE
  - 这一步到底做什么：让 CodingNS 的 npm 安装、PM2 启动和后续管理都使用私有 Node 运行时，而不是系统默认 Node。
  - 做完你能看到什么：CodingNS 自己用 Node 22，但不影响系统里其他 npm 包。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 1、需求 6
    - `design.md` §2.1、§3.1、§4.1
    - `docs/20260515-Windows私有运行时目录与环境约定.md`
  - 主要改哪里：
    - `install.sh`
    - PM2 启动参数与命令生成逻辑
  - 这一步先不做什么：不切换 `node-pty` 包来源。
  - 怎么算完成：
    1. `codingns` 安装在私有 npm 前缀下
    2. 系统默认 Node 未被修改
    3. 启动总结会打印实际使用的私有 Node 路径和私有 PM2 HOME
  - 怎么验证：
    - 安装后检查 PATH 与执行路径
    - `bash -n install.sh`
  - 对应需求：`requirements.md` 需求 1、需求 6
  - 对应设计：`design.md` §2.1、§3.1、§4.1
  - 本次产出：
    - `install.sh`

### 阶段检查

- [ ] 2.4 阶段检查：私有 Node 安装链路验收
  - 状态：IN_PROGRESS
  - 这一步到底做什么：确认在不修改系统 Node 的前提下，CodingNS 已经能稳定准备自己的运行时。
  - 做完你能看到什么：后续再接 `@codingns/node-pty` 时，环境底座已经站稳。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/20260515-Windows私有运行时目录与环境约定.md`
    - `docs/20260515-Windows安装升级回滚执行序列.md`
  - 主要改哪里：安装脚本和补充文档
  - 这一步先不做什么：不发布 `@codingns/node-pty`
  - 怎么算完成：
    1. CodingNS 实际运行在私有 Node 22
    2. 系统 Node 和其他 npm 包不受影响
  - 怎么验证：
    - Windows 真机或 Runner 完整安装回放
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 6
  - 对应设计：`design.md` §2.3.1、§3.3、§4.1
  - 当前进展：
    - `bash -n install.sh` 已通过
    - 安装完成总结已补实际运行时 Node、私有 npm 前缀、私有 PM2 HOME 输出
    - 私有运行时状态文件已补 `ptyPackageName`、`ptyPackageVersion`
    - 已新增 `scripts/run-windows-install-replay.sh` 和 `scripts/verify-windows-install-replay.mjs`，用于 Windows 下回放 `install.sh` 并校验私有 Node 22 是否真正生效
    - 仍缺 Windows 真机或 Runner 的完整安装回放，确认系统 Node 和其他 npm 包确实未受影响

- [x] 2.0 细化私有运行时目录、环境变量与状态切换规则
  - 状态：DONE
  - 这一步到底做什么：把私有 Node 22 的目录结构、环境变量注入、私有 npm prefix、私有 PM2 HOME、安装状态文件和升级回滚顺序写到可实现粒度。
  - 做完你能看到什么：第二阶段实现不再需要临场决定路径、命令来源和状态切换顺序。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 6
    - `design.md` §3.1、§3.3、§4、§5
  - 主要改哪里：
    - `design.md`
    - `spec001.10/docs/*`
  - 这一步先不做什么：不修改 `install.sh` 正式逻辑。
  - 怎么算完成：
    1. 私有运行时目录职责清楚
    2. 环境变量和命令入口约定清楚
    3. 安装、升级、回滚的状态切换顺序清楚
  - 怎么验证：
    - 文档走查
  - 本次产出：
    - `docs/20260515-Windows私有运行时目录与环境约定.md`
    - `docs/20260515-Windows安装升级回滚执行序列.md`
    - `design.md` §3.1、§3.3、§4.2、§5.4
  - 对应需求：`requirements.md` 需求 1、需求 6
  - 对应设计：`design.md` §3.1、§3.3、§4.2、§5.4

---

## 阶段 3：做自维护 `@codingns/node-pty` 预编译链路

- [x] 3.0 细化 `@codingns/node-pty` 包边界、CI 与 tarball 验收规则
  - 状态：DONE
  - 这一步到底做什么：把 fork 包的正式支持矩阵、版本策略、包结构、CI 流程、tarball 验收和阻断发布条件写到可实现粒度。
  - 做完你能看到什么：第三阶段实现不会再停留在“先 fork 一个包看看”的模糊状态。
  - 先依赖什么：2.4 之前的文档收口
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4、需求 5
    - `design.md` §3.4、§3.5、§4.3、§5
  - 主要改哪里：
    - `design.md`
    - `spec001.10/docs/*`
  - 这一步先不做什么：不创建真实 fork 仓库，不写正式 CI 文件。
  - 怎么算完成：
    1. fork 包名、版本边界和支持矩阵清楚
    2. tarball 必需内容和发布阻断条件清楚
    3. CI 最小闭环和 smoke test 规则清楚
  - 怎么验证：
    - 文档走查
  - 本次产出：
    - `docs/20260515-@codingns-node-pty包结构与发布边界.md`
    - `docs/20260515-@codingns-node-pty-CI与tarball验收约定.md`
    - `design.md` §3.4、§3.5、§4.4
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 5
  - 对应设计：`design.md` §3.4、§3.5、§4.4

- [x] 3.1 建立 `node-pty` fork 包和版本策略
  - 状态：DONE
  - 这一步到底做什么：fork 官方 `node-pty@1.0.0`，建立 `@codingns/node-pty` 包名、版本号和发布边界。
  - 做完你能看到什么：我们有一个正式可维护的原生依赖 fork，而不是临时拷文件。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 3、需求 5
    - `design.md` §3.4、§4.2
    - `docs/20260515-@codingns-node-pty包结构与发布边界.md`
  - 主要改哪里：
    - 新 fork 仓库或子目录
    - 发布说明文档
  - 这一步先不做什么：不改主仓依赖。
  - 怎么算完成：
    1. 包名、版本策略、支持矩阵已定
    2. API 兼容边界已写清楚
  - 怎么验证：
    - fork 包 `README/package.json` 检查
    - `node -e "JSON.parse(require('node:fs').readFileSync('packages/node-pty-fork/package.json','utf8'))"`
  - 对应需求：`requirements.md` 需求 3、需求 5
  - 对应设计：`design.md` §3.4、§4.2
  - 本次产出：
    - `packages/node-pty-fork/package.json`
    - `packages/node-pty-fork/README.md`
    - `packages/node-pty-fork/scripts/fetch-upstream.mjs`
    - `packages/node-pty-fork/scripts/sync-upstream.mjs`
    - `packages/node-pty-fork/vendor/upstream/`

- [ ] 3.2 在 CI 中产出 Windows x64 + Node 22 原生文件并随包发布
  - 状态：IN_PROGRESS
  - 这一步到底做什么：把 `@codingns/node-pty` 的 Windows Node 22 预编译产物稳定地编进发布包里。
  - 做完你能看到什么：`npm pack` 后能看到真正可运行的原生文件，不再要求用户本机编译。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4
    - `design.md` §3.4、§3.5、§5
    - `docs/20260515-@codingns-node-pty-CI与tarball验收约定.md`
  - 主要改哪里：
    - fork 包 CI
    - fork 包 `package.json`
    - fork 包发布脚本
  - 这一步先不做什么：不支持多平台矩阵。
  - 怎么算完成：
    1. CI 可稳定产出 Windows x64 + Node 22 包
    2. tarball 内含 `build/Release` 必需文件
  - 怎么验证：
    - CI 成功
    - `npm pack` 内容检查
  - 对应需求：`requirements.md` 需求 3、需求 4
  - 对应设计：`design.md` §3.4、§3.5、§5
  - 当前进展：
    - 已拆到独立仓库 `jingyi0605/codingns-node-pty`
    - 已补 `windows-prebuilt` workflow 和 `build:native`、`verify:runtime`、`verify:tarball`、`smoke:install` 脚本链
    - 最新成功记录：GitHub Actions `windows-prebuilt` run `25896731471`
    - 已确认产物上传：`codingns-node-pty-build-release`、`codingns-node-pty-tarball`

- [ ] 3.3 切换正式服务包依赖到 `@codingns/node-pty`
  - 状态：IN_PROGRESS
  - 这一步到底做什么：让 `@jingyi0605/codingns` 和 Host 正式依赖 `@codingns/node-pty`。
  - 做完你能看到什么：Windows 安装时不再直接走官方 `node-pty` 的本机编译链。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.3、§3.4
  - 主要改哪里：
    - `packages/codingns/package.json`
    - `apps/host/package.json`
    - 可能涉及 import 路径的兼容调整
  - 这一步先不做什么：不重构终端业务逻辑。
  - 怎么算完成：
    1. 服务包依赖已切换
    2. 终端主链路保持兼容
  - 怎么验证：
    - 终端集成测试
    - Windows 安装验证
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.3、§3.4
  - 当前进展：
    - 已给 Host 终端运行时增加 `node-pty` 分流加载器
    - 已让发布包 `packages/codingns` 在 Windows Node 22 优先要求 `@codingns/node-pty`
    - 已让 `postinstall` 前置校验 PTY 依赖，并直接打印实际命中的 PTY 包名和版本
    - 已确认发布暂存会把 `@codingns/node-pty: workspace:*` 改写成真实版本 `1.0.0-cns.1`
    - 仍需补 Windows 安装验证，确认正式包实装时不再落回官方 `node-pty` 本机编译链

- [ ] 3.4 阶段检查：原生依赖安装链路验收
  - 状态：TODO
  - 这一步到底做什么：确认 Windows x64 + Node 22 环境下，`@codingns/node-pty` 安装已不依赖本机编译。
  - 做完你能看到什么：最脆的安装链真正被收回来了。
  - 先依赖什么：3.1、3.2、3.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/20260515-@codingns-node-pty包结构与发布边界.md`
    - `docs/20260515-@codingns-node-pty-CI与tarball验收约定.md`
  - 主要改哪里：必要时补发布说明和日志
  - 这一步先不做什么：不扩平台支持
  - 怎么算完成：
    1. 不安装 Visual Studio Build Tools 也能装上 `@codingns/node-pty`
    2. 终端能力可正常运行
  - 怎么验证：
    - Windows 真机或 Runner 从零安装
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 5
  - 对应设计：`design.md` §3.4、§3.5、§6.2
  - 当前进展：
    - 已新增 `.github/workflows/windows-install-replay.yml`
    - 已新增 `scripts/prepare-windows-install-replay.sh`，会先用 Node 22 准备本地 `@codingns/node-pty` 预编译产物和 CodingNS 回放包
    - 已补 `install.sh` 对本地目录 / `file:` / `.tgz` 安装规格的 registry 探测兼容
    - 仍待 GitHub Actions 真跑一次，确认 Windows Runner 下没有触发 `node-gyp rebuild`

---

## 阶段 4：收口文档、回滚和最终验收

- [ ] 4.1 补充私有 Node 与 `@codingns/node-pty` 的运维文档
  - 状态：TODO
  - 这一步到底做什么：把运行时目录、版本查看、常见失败、回滚方式写清楚。
  - 做完你能看到什么：安装不只是“能跑”，而是后续能维护。
  - 先依赖什么：3.4
  - 开始前先看：
    - `requirements.md` 需求 6
    - `design.md` §5、§8
  - 主要改哪里：
    - `spec001.10/docs/*`
    - `README.md`
    - 安装文档
  - 这一步先不做什么：不扩展新的功能范围。
  - 怎么算完成：
    1. 有私有 Node 说明
    2. 有 `@codingns/node-pty` 发布/回滚说明
    3. 有日志和故障定位说明
  - 怎么验证：
    - 按文档手工走查
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §5、§8

- [ ] 4.2 最终检查：Windows 无本机编译安装验收
  - 状态：TODO
  - 这一步到底做什么：完整验证从安装脚本到终端运行的正式链路，确认这次 Spec 真解决了 Windows 安装的主痛点。
  - 做完你能看到什么：可以明确说“Windows x64 + Node 22 路径已收口”。
  - 先依赖什么：4.1
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件
  - 这一步先不做什么：不再增加新支持矩阵。
  - 怎么算完成：
    1. 无 Build Tools 环境可完成安装
    2. CodingNS 使用私有 Node 22 运行
    3. 终端能力正常
    4. 回滚说明可执行
  - 怎么验证：
    - Windows 真机或干净 Runner 全链路验收
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
