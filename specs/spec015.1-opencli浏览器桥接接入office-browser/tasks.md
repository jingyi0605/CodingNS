# 任务清单 - spec015.1-opencli浏览器桥接接入office-browser（人话版）

状态：Draft

## 这份文档是干什么的

这份清单只做一件事：

把“`office.browser` 增加 `opencli` 真实浏览器桥接支线”拆成能落地的任务，不让它变成“顺手改着改着把原有浏览器能力搞坏”的事故现场。

这份任务清单优先回答：

1. 这条支线到底先改哪里
2. 做完以后用户能看到什么变化
3. 哪些现有能力必须保持不动
4. 如何证明这次接入没有破坏原有无头浏览器链路

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已有结果，待复核
- `DONE`：已经完成，并且已回写状态
- `CANCELLED`：取消，不做了，但必须写原因

规则：

- 只有 `状态：DONE` 的任务才能勾选成 `[x]`
- 每完成一个任务，必须立刻回写本文件
- `BLOCKED` 和 `CANCELLED` 必须写清原因

---

## 阶段 0：先把规格说死，别直接开改

- [x] 0.1 建立 `spec015.1` 文档骨架并锁定主问题
  - 状态：DONE
  - 这一步到底做什么：创建 `README.md`、`requirements.md`、`design.md`、`tasks.md`，把这次需求从聊天结论变成正式子规格。
  - 做完以后能看到什么结果：仓库里出现完整 `spec015.1` 目录，范围、边界、依赖和落地顺序都已明确。
  - 先依赖什么：`spec015`、`spec001.5.1`
  - 主要改哪里：
    - `specs/spec015.1-opencli浏览器桥接接入office-browser/*`
    - `specs/README.md`
  - 这一步明确不做什么：不改实现代码，不动现有浏览器任务链。
  - 怎么验证：
    1. 子规格目录完整
    2. 已明确“双执行支线”而不是“替换旧内核”
    3. 已明确保留现有 Profile / 实例模型
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

---

## 阶段 1：先把执行器抽象出来

- [ ] 1.1 为 `office.browser` 增加执行后端抽象
  - 状态：TODO
  - 这一步到底做什么：把当前只认 `PlaywrightBrowserExecutor` 的执行链改成“按后端选择执行器”的结构。
  - 做完以后能看到什么结果：浏览器任务不再写死只能走 `playwright`。
  - 先依赖什么：阶段 0
  - 主要改哪里：
    - `apps/host/src/modules/browser-runtime/browser-runtime-service.ts`
    - `apps/host/src/modules/browser-runtime/`
    - 浏览器任务 DTO / 类型定义
  - 这一步明确不做什么：不接 `opencli`，只先把执行器插槽留出来。
  - 怎么验证：
    1. 现有 `playwright` 任务继续可执行
    2. 浏览器任务输入可记录执行后端
    3. 默认后端仍然是 `playwright`
  - 对应需求：`requirements.md` 需求 1、2、6、8
  - 对应设计：`design.md` §3、§4、§5.1、§5.2

- [ ] 1.2 补浏览器任务执行后端的落库与回执字段
  - 状态：TODO
  - 这一步到底做什么：让浏览器任务、步骤或回执里能看见“本次到底走的是哪个后端”。
  - 做完以后能看到什么结果：后续排障时不会再出现“任务失败了但不知道走的是无头还是桥接”的情况。
  - 先依赖什么：1.1
  - 主要改哪里：
    - `apps/host/src/storage/sqlite/schema.sql`
    - 相关 repository / receipt / step 服务
  - 这一步明确不做什么：不新增第二套任务表。
  - 怎么验证：
    1. 新任务能记录 `executionBackend`
    2. 任务详情或回执能返回执行后端
  - 对应需求：`requirements.md` 需求 6
  - 对应设计：`design.md` §4.1、§4.3、§5.1

---

## 阶段 2：接入 opencli 桥接状态

- [ ] 2.1 新增 `office.browser` 视角的 opencli 桥接健康服务
  - 状态：TODO
  - 这一步到底做什么：把 `opencli` 现有健康状态映射成 `office.browser` 能直接消费的桥接状态。
  - 做完以后能看到什么结果：`office.browser` 不用再直接理解完整 `opencli provider` 模型，也能知道桥接可不可用。
  - 先依赖什么：1.1
  - 主要改哪里：
    - `apps/host/src/modules/opencli/`
    - `apps/host/src/modules/browser-runtime/`
    - 新增 `/api/office/browser/bridge-status`
  - 这一步明确不做什么：不改现有 OpenCLI 管理面板，不重写 opencli health service。
  - 怎么验证：
    1. daemon 缺失、扩展缺失、ready 三种状态可区分
    2. `office.browser` 可读取统一桥接状态 DTO
  - 对应需求：`requirements.md` 需求 3、5、8
  - 对应设计：`design.md` §4.3、§6

- [ ] 2.2 前端和 CLI 暴露桥接状态
  - 状态：TODO
  - 这一步到底做什么：在浏览器任务创建入口和相关 CLI 命令里展示真实浏览器桥接当前是否可用。
  - 做完以后能看到什么结果：用户在执行前就能知道桥接能不能用。
  - 先依赖什么：2.1
  - 主要改哪里：
    - `apps/user-app`
    - `packages/codingns`
  - 这一步明确不做什么：不做大规模设置页重构。
  - 怎么验证：
    1. 前端可显示桥接状态
    2. CLI 可查询桥接状态
  - 对应需求：`requirements.md` 需求 5、8
  - 对应设计：`design.md` §6、§7、§8

---

## 阶段 3：接入真实浏览器桥接执行器

- [ ] 3.1 实现 `OpenCliBridgeBrowserExecutor`
  - 状态：TODO
  - 这一步到底做什么：基于 `opencli BrowserBridge/Page` 实现真实浏览器桥接执行器。
  - 做完以后能看到什么结果：`office.browser` 第一次拥有正式的真实浏览器调试执行后端。
  - 先依赖什么：1.1、2.1
  - 主要改哪里：
    - `apps/host/src/modules/browser-runtime/`
    - 新增桥接执行器和适配层
  - 这一步明确不做什么：不调用 opencli 站点命令，不把 opencli 目录和 office.browser 动作混在一起。
  - 怎么验证：
    1. 能建立桥接连接
    2. 能执行最小动作链
    3. 执行失败能正确落库
  - 对应需求：`requirements.md` 需求 1、3、6、7、8
  - 对应设计：`design.md` §5.3、§5.4、§5.5

- [ ] 3.2 第一阶段接通最小动作集
  - 状态：TODO
  - 这一步到底做什么：接通 `goto`、`click`、`fill`、`press`、`read_dom`、`extract_text`、`screenshot`、`wait`，必要时加 `upload`。
  - 做完以后能看到什么结果：真实浏览器调试已经能覆盖最常见的调试和页面操作链。
  - 先依赖什么：3.1
  - 主要改哪里：
    - `apps/host/src/modules/browser-runtime/opencli-bridge-browser-executor.ts`
    - 动作映射和产物处理逻辑
  - 这一步明确不做什么：不承诺 `download`、复杂多标签和所有 Playwright 事件能力全兼容。
  - 怎么验证：
    1. 最小动作集有集成测试
    2. 不支持动作返回明确错误
  - 对应需求：`requirements.md` 需求 7
  - 对应设计：`design.md` §5.4

- [ ] 3.3 桥接失败错误统一映射
  - 状态：TODO
  - 这一步到底做什么：把 daemon 未启动、扩展未连接、动作不支持、桥接断连这些错误统一翻译成浏览器任务可理解的错误。
  - 做完以后能看到什么结果：用户和维护者都能看懂失败原因。
  - 先依赖什么：3.1
  - 主要改哪里：
    - `apps/host/src/modules/browser-runtime/`
    - `apps/host/src/modules/opencli/`
  - 这一步明确不做什么：不做自动回退到 `playwright`。
  - 怎么验证：
    1. 常见桥接错误都能映射
    2. 失败时任务状态和错误详情正确
  - 对应需求：`requirements.md` 需求 3、5、6、8
  - 对应设计：`design.md` §5.5、§9.2

---

## 阶段 4：补前端与回归

- [ ] 4.1 浏览器任务创建入口增加“无头 / 真实浏览器调试”选项
  - 状态：TODO
  - 这一步到底做什么：在用户创建浏览器任务时，允许明确选择执行方式。
  - 做完以后能看到什么结果：双执行支线真正暴露给用户，而不是只有后端暗中支持。
  - 先依赖什么：2.2、3.1
  - 主要改哪里：
    - `apps/user-app`
  - 这一步明确不做什么：不重写现有浏览器 Profile / 实例主视图。
  - 怎么验证：
    1. 默认还是无头浏览器
    2. 可手动选真实浏览器调试
    3. 桥接不可用时有明确提示
  - 对应需求：`requirements.md` 需求 1、2、5
  - 对应设计：`design.md` §7

- [ ] 4.2 做零破坏回归
  - 状态：TODO
  - 这一步到底做什么：证明新增桥接支线后，原有无头浏览器链、Profile、实例、任务和回执都没坏。
  - 做完以后能看到什么结果：这次接入不会破坏用户空间。
  - 先依赖什么：全部前置任务
  - 主要改哪里：
    - `apps/host/tests/`
    - `apps/user-app/tests/`
    - `packages/codingns/tests/`
  - 这一步明确不做什么：不扩大功能范围。
  - 怎么验证：
    1. 原有无头浏览器测试继续通过
    2. 新增桥接执行测试通过
    3. 旧 Profile / 实例数据无需迁移也可继续使用
  - 对应需求：`requirements.md` 需求 2、4、8
  - 对应设计：`design.md` §10、§11
