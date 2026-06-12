# 任务清单 - spec001.12-更新通道与预览版本更新体验（人话版）

状态：Draft

## 这份文档是干什么的

这份任务清单只回答这几件事：

- 更新通道设置先落哪一层
- 开发版确认弹窗怎么接进现有设置页
- 开发版 tag 规则怎么正式写死
- 更新日志按钮和模态框怎么接到现有更新面板

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

## 阶段 1：先把规则和数据结构定死

- [ ] 1.1 建立 `spec001.12` 文档骨架
  - 状态：TODO
  - 这一步到底做什么：把更新通道、开发版确认、tag 规则和更新日志展示的范围写进正式 Spec。
  - 做完你能看到什么：这件事不再散在聊天记录里，后面实现知道该改哪里、不该改哪里。
  - 先依赖什么：无
  - 开始前先看：
    - `specs/spec001.6-客户端与服务端统一更新机制/design.md`
    - `specs/spec001.1-账户偏好入库与跨客户端同步/README.md`
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
    - `docs/开发设计规范/20260419-模态框与按钮设计规范.md`
  - 主要改哪里：
    - `specs/spec001.12-更新通道与预览版本更新体验/*`
  - 这一步先不做什么：不改前端代码，不改 manifest。
  - 怎么算完成：
    1. `README.md`、`requirements.md`、`design.md`、`tasks.md` 都已创建
    2. 范围、边界、版本规则和 UI 方向说得清楚
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文

- [ ] 1.2 定义更新通道配置和统一更新说明模型
  - 状态：TODO
  - 这一步到底做什么：把客户端运行时配置、开发版同意状态、更新日志展示模型和服务端扩展字段定下来。
  - 做完你能看到什么：后面前端和接口改动不会各长各的字段。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 4、需求 5
    - `design.md` §3.1、§3.2、§3.3
    - `apps/user-app/src/config/client-config-types.ts`
    - `apps/host/src/modules/client/service-update-types.ts`
  - 主要改哪里：
    - `design.md`
    - `apps/user-app/src/config/client-config-types.ts`
    - `apps/host/src/modules/client/service-update-types.ts`
  - 这一步先不做什么：不写设置页 UI。
  - 怎么算完成：
    1. 通道配置和同意状态字段清楚
    2. 桌面端 / Android / 服务端都能映射成统一的更新说明结构
  - 怎么验证：
    - 类型与设计走查
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 4、需求 5
  - 对应设计：`design.md` §3.1、§3.2、§3.3

### 阶段检查

- [ ] 1.3 阶段检查：规则先站稳
  - 状态：TODO
  - 这一步到底做什么：确认第一阶段已经把通道规则、版本规则和数据结构说清楚，避免后面边写边改。
  - 做完你能看到什么：后续实现可以直接按文档推进，不会因为字段和规则反复返工。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：当前 Spec 文档
  - 这一步先不做什么：不扩展第三个通道，不补发布自动化。
  - 怎么算完成：
    1. `stable / beta` 边界已经定死
    2. 开发版 tag 规则已经定死
    3. 更新说明字段已经能覆盖三类更新源
  - 怎么验证：
    - 文档走查
  - 对应需求：`requirements.md` 需求 1、需求 3、需求 4、需求 5
  - 对应设计：`design.md` §2、§3、§5

---

## 阶段 2：把设置页通道切换做出来

- [ ] 2.1 在运行时配置里接入更新通道切换和开发版同意状态
  - 状态：TODO
  - 这一步到底做什么：补客户端配置字段、持久化逻辑和更新通道更新方法。
  - 做完你能看到什么：前端真的能保存当前通道和已同意状态，而不是只改本地临时 state。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §2.3.1、§3.1
    - `apps/user-app/src/config/client-config-service.ts`
    - `apps/user-app/src/config/client-config-store.ts`
  - 主要改哪里：
    - `apps/user-app/src/config/client-config-types.ts`
    - `apps/user-app/src/config/client-config-service.ts`
    - `apps/user-app/src/config/client-config-store.ts`
  - 这一步先不做什么：不做 UI，不改更新检查面板。
  - 怎么算完成：
    1. 默认仍是稳定版
    2. 配置里能持久化通道和开发版同意时间
    3. 后续更新检查仍统一读 `releaseChannel`
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/config/client-config-service.ts apps/user-app/src/config/client-config-store.ts`
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §2.3.1、§3.1

- [ ] 2.2 在设置—更新管理里补更新通道入口和开发版说明模态框
  - 状态：TODO
  - 这一步到底做什么：把通道切换 UI 接到设置页，并用规范里的模态框承载开发版风险说明和同意动作。
  - 做完你能看到什么：用户能正式看到“稳定版 / 开发版”，切到开发版前会先弹说明。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §4.1、§4.2、§4.4
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `docs/开发设计规范/20260419-前端页面与样式设计规范.md`
    - `docs/开发设计规范/20260419-模态框与按钮设计规范.md`
  - 主要改哪里：
    - `apps/user-app/src/features/settings/pages/SettingsPage.tsx`
    - `apps/user-app/src/settings/*新增通道说明模态框*`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步先不做什么：不接更新日志展示。
  - 怎么算完成：
    1. 设置页出现更新通道入口
    2. 切开发版必须先同意
    3. 切回稳定版可以直接完成
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/features/settings/pages/SettingsPage.tsx`
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §4.1、§4.2、§4.4

### 阶段检查

- [ ] 2.3 阶段检查：通道切换主链路可用
  - 状态：TODO
  - 这一步到底做什么：检查用户从稳定版切到开发版、再切回稳定版的完整链路是不是已经通了。
  - 做完你能看到什么：不是只有一个开关，而是一条真正能用的设置主链路。
  - 先依赖什么：2.1、2.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关前端文件和测试
  - 这一步先不做什么：不做发布 tag 自动校验。
  - 怎么算完成：
    1. 默认稳定版成立
    2. 开发版确认弹窗成立
    3. 切换后后续更新检查读取的新通道成立
  - 怎么验证：
    - 相关单测 + 人工走查
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §2.3.1、§4.1、§4.2

---

## 阶段 3：把更新日志入口和版本规则收口

- [ ] 3.1 给更新结果补统一更新日志入口和模态框
  - 状态：TODO
  - 这一步到底做什么：把桌面端、Android、服务端的更新说明整理成统一展示数据，并在更新面板里补“查看更新内容”按钮和模态框。
  - 做完你能看到什么：用户检查到新版本以后，能直接看到这次更新改了什么。
  - 先依赖什么：2.3
  - 开始前先看：
    - `requirements.md` 需求 4、需求 5
    - `design.md` §3.2、§3.3、§4.3
    - `apps/user-app/src/settings/ReleasePanel.tsx`
    - `apps/user-app/src/settings/AndroidReleasePanel.tsx`
    - `apps/user-app/src/settings/ServiceUpdatePanel.tsx`
    - `docs/开发设计规范/20260419-模态框与按钮设计规范.md`
  - 主要改哪里：
    - `apps/user-app/src/settings/ReleasePanel.tsx`
    - `apps/user-app/src/settings/AndroidReleasePanel.tsx`
    - `apps/user-app/src/settings/ServiceUpdatePanel.tsx`
    - `apps/user-app/src/settings/*新增更新日志模态框*`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步先不做什么：不重写更新下载 / 安装逻辑。
  - 怎么算完成：
    1. 有更新说明时显示查看按钮
    2. 点开后能看到版本、时间、正文
    3. 无说明时不会弹空白框
  - 怎么验证：
    - `pnpm test:related -- apps/user-app/src/settings/ReleasePanel.tsx apps/user-app/src/settings/AndroidReleasePanel.tsx apps/user-app/src/settings/ServiceUpdatePanel.tsx`
  - 对应需求：`requirements.md` 需求 4、需求 5
  - 对应设计：`design.md` §3.2、§3.3、§4.3

- [ ] 3.2 把开发版 tag / 版本号规则写进发布文档和相关脚本约束
  - 状态：TODO
  - 这一步到底做什么：把 `vX.Y.Z-beta.N` 的规则正式写进仓库文档，必要时补最小校验，避免后面 tag 乱发。
  - 做完你能看到什么：维护者知道开发版该怎么发，稳定版用户也不会误吃测试版本。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §5.1、§5.2、§5.3
    - `specs/spec001.6-客户端与服务端统一更新机制/*`
    - `scripts/sync-version.mjs`
    - 现有发布说明文档
  - 主要改哪里：
    - `specs/spec001.12-更新通道与预览版本更新体验/docs/*`
    - 相关发布说明文档
    - 如有必要，最小校验脚本
  - 这一步先不做什么：不整套重构 GitHub Release 流程。
  - 怎么算完成：
    1. 稳定版与开发版 tag 规则有正式文档
    2. 维护者知道什么时候发 `beta.N`、什么时候转正
    3. 如有脚本校验，不会误伤现有稳定版流程
  - 怎么验证：
    - 文档走查
    - 如新增脚本则跑定向命令
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §5.1、§5.2、§5.3

### 最终检查

- [ ] 3.3 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认这个 Spec 真正达到交付标准，而不是只做了几个零散控件。
  - 做完你能看到什么：更新通道、风险确认、tag 规则、更新日志展示都能一一对上。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件和本次相关实现文件
  - 这一步先不做什么：不再加新范围。
  - 怎么算完成：
    1. 用户可切稳定版 / 开发版
    2. 开发版确认链路成立
    3. 更新日志入口成立
    4. 开发版 tag 规则已经正式定死
  - 怎么验证：
    - 本轮最小必要测试 + 人工验收
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
