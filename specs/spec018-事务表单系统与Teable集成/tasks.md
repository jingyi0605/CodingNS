# 任务清单 - spec018-事务表单系统与Teable集成（人话版）

状态：In Progress

## 这份文档是干什么的

这份任务清单只服务一个目标：

**把 `Teable` 正式接成事务工作台里的表单能力，同时把 `CodingNS` 的标签、会话、代办同步成 `Teable` 可引用的数据表。**

这次主线只有四块：

- 工作台级全局 `Teable` 连接
- 镜像同步配置
- 字段映射配置
- 已有表单接入和工作台显示

> 注意：当前不再把“在 CodingNS 里创建 Teable 表单”当成正式主线。

---

## 阶段 0：先把边界写死，避免继续走错路

- [x] 0.1 启动 `spec018` 文档骨架
  - 状态：DONE
  - 这一步到底做什么：先把 `spec018` 文档骨架挂起来，锁住编号和范围。
  - 做完你能看到什么：仓库里出现完整 `spec018` 目录。
  - 先依赖什么：无
  - 主要改哪里：`specs/spec018-事务表单系统与Teable集成/*`
  - 这一步先不做什么：不改实现代码。
  - 怎么验证：文档走查

- [x] 0.2 把工作台全局绑定写清楚
  - 状态：DONE
  - 这一步到底做什么：明确 `Teable` 实例是工作台级全局绑定，不和单个工作区绑死。
  - 做完你能看到什么：后面所有配置都围绕一个全局 `Teable` 实例展开。
  - 先依赖什么：0.1
  - 主要改哪里：`requirements.md`、`design.md`
  - 这一步先不做什么：不提前决定具体 UI 细节。
  - 怎么验证：文档走查

- [x] 0.3 纠正“Teable 由 CodingNS 创建表单”的错误路线
  - 状态：DONE
  - 这一步到底做什么：正式改写 Spec，明确 `CodingNS` 当前阶段做的是“接入 Teable 已有表单”，不是“替 Teable 造表单后台”。
  - 做完你能看到什么：Spec 里不再把“创建 Teable 表单”写成主链路。
  - 先依赖什么：0.2
  - 主要改哪里：`requirements.md`、`design.md`、`tasks.md`
  - 这一步先不做什么：不立刻删代码。
  - 怎么验证：文档走查

---

## 阶段 1：先把全局连接和镜像同步框架站稳

- [x] 1.1 落工作台级全局 `Teable` 配置和状态入口
  - 状态：DONE
  - 这一步到底做什么：补工作台级全局 `Teable` 配置存储、读取和状态总览接口。
  - 做完你能看到什么：事务工作台先能知道“当前有没有正式接 Teable”。
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-global-binding-service.ts`
    - `apps/host/src/modules/workspace/teable-global-binding-controller.ts`
    - 对应路由和测试文件
  - 怎么验证：Host 定向测试 + `tsc --noEmit`

- [x] 1.2 落镜像同步高层配置入口
  - 状态：DONE（第一版骨架）
  - 这一步到底做什么：让 Host 能保存“哪个 sourceType 开启、推到哪张表、范围怎么配”的高层配置。
  - 做完你能看到什么：标签、会话、代办三类同步不再写死在服务里。
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-workbench-sync-config-service.ts`
    - 对应 controller、路由和测试文件
  - 这一步先不做什么：这一版还没把图形化字段映射做完。
  - 怎么验证：Host 定向测试

- [x] 1.3 落镜像同步后台任务主链路
  - 状态：DONE（任务主链路）
  - 这一步到底做什么：把镜像同步接进正式 `TaskManager`，让同步状态和错误可追踪。
  - 做完你能看到什么：用户能看到“已入队 / 运行中 / 成功 / 部分失败 / 失败”。
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-mirror-sync-service.ts`
    - `apps/host/src/modules/tasks/task-types.ts`
    - 对应路由和测试文件
  - 这一步先不做什么：不解决字段映射 UI。
  - 怎么验证：Host 定向测试

---

## 阶段 2：把镜像同步配置改成真正可用的业务配置

- [x] 2.1 把会话同步改成“全部工作区 / 指定工作区”两种模式
  - 状态：DONE
  - 这一步到底做什么：把会话同步范围从模糊的 workspaceIds 变成清楚的两种模式。
  - 做完你能看到什么：用户能明确选“全部会话”还是“只同步这几个工作区的会话”。
  - 先依赖什么：1.3
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-workbench-sync-config-service.ts`
    - `apps/host/src/modules/workspace/teable-mirror-sync-service.ts`
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
  - 这一步明确不做什么：不把“当前页面工作区”再偷偷当默认范围。
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/modules/workspace/teable-mirror-sync-service.test.ts tests/modules/workspace/teable-mirror-sync-run.test.ts`
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`

- [x] 2.2 把标签同步改成“按根标签树”配置
  - 状态：DONE
  - 这一步到底做什么：让标签同步不是选零散标签，而是选一个根标签，把整棵子树同步出去。
  - 做完你能看到什么：用户选的是一棵标签树入口，不是一堆分散节点。
  - 先依赖什么：2.1
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-mirror-sync-service.ts`
    - 标签相关 Host 服务
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
  - 这一步明确不做什么：不做无限深性能优化黑科技，先把正确逻辑立住。
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/modules/workspace/teable-mirror-sync-service.test.ts`
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`

- [x] 2.3 把代办同步改成“工作区代办 + 事务代办”双来源
  - 状态：DONE
  - 这一步到底做什么：让代办同步能同时覆盖普通工作区代办和事务模式代办，并且带来源字段。
  - 做完你能看到什么：`Teable` 目标表里能看出每条代办来自哪里。
  - 先依赖什么：2.2
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-mirror-sync-service.ts`
    - 代办相关 Host 仓储 / 服务
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
  - 这一步明确不做什么：不在这一轮顺手大改代办真源架构。
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/modules/workspace/teable-mirror-sync-service.test.ts tests/modules/workspace/teable-mirror-sync-run.test.ts`
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`

---

## 阶段 3：补图形化字段映射，让同步真正可控

- [x] 3.1 增加目标表和字段目录读取接口
  - 状态：DONE
  - 这一步到底做什么：先让 Host 能读到 `Teable` 已有表和字段目录，给前端做映射选择器。
  - 做完你能看到什么：设置页里不再靠手填 tableId / fieldId 瞎猜。
  - 先依赖什么：2.3
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-catalog-service.ts`（新增）
    - 对应 controller、路由和测试文件
  - 这一步明确不做什么：不接入表单目录之前先不做工作台块。
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/integration/teable-global-routes.test.ts`
    - `pnpm --dir apps/host exec tsc --noEmit`

- [x] 3.2 增加字段映射配置存储和校验
  - 状态：DONE
  - 这一步到底做什么：给每类同步配置补正式字段映射存储，并校验冲突和类型不兼容。
  - 做完你能看到什么：同步不再靠写死字段名。
  - 先依赖什么：3.1
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-field-mapping-service.ts`（新增）
    - SQLite 表结构
    - 对应测试文件
  - 这一步明确不做什么：不做复杂可视化拖拽，只做清楚可用的映射表单。
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/integration/teable-global-routes.test.ts tests/modules/workspace/teable-mirror-sync-service.test.ts`
    - `pnpm --dir apps/host exec tsc --noEmit`

- [x] 3.3 设置页增加“字段映射”标签页
  - 状态：DONE
  - 这一步到底做什么：把字段映射正式做成一个独立标签页，而不是塞进镜像页里糊弄过去。
  - 做完你能看到什么：用户能用图形化方式把源字段和目标字段对应起来。
  - 先依赖什么：3.2
  - 主要改哪里：
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
    - i18n 文案
    - 对应测试文件
  - 这一步明确不做什么：不把高级映射表达式一起做掉。
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app exec tsc --noEmit`

---

## 阶段 4：把“已有表单接入”和“工作台显示”接起来

- [x] 4.1 新增 Teable 已有表单目录读取和接入关系保存
  - 状态：DONE
  - 这一步到底做什么：读取 `Teable` 已有表单目录，并允许用户选择哪些表单接入 `CodingNS`。
  - 做完你能看到什么：设置页表单标签里显示的是 `Teable` 已有表单，而不是“由 CodingNS 创建的表单”。
  - 先依赖什么：3.3
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-form-binding-service.ts`（新增）
    - `apps/host/src/modules/workspace/teable-catalog-service.ts`
    - 对应 controller、路由和测试文件
  - 这一步明确不做什么：不继续扩 `createTeableForm` 这条旧路线。
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/integration/teable-global-routes.test.ts`
    - `pnpm --dir apps/host exec tsc --noEmit`

- [x] 4.2 重写设置页“表单”标签页
  - 状态：DONE
  - 这一步到底做什么：把现在这个“已创建表单 / 去工作台新建表单”的错误页面，改成真正的“表单接入管理”页。
  - 做完你能看到什么：用户能看到 Teable 已有表单列表、接入状态、本地显示名和可用性开关。
  - 先依赖什么：4.1
  - 主要改哪里：
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
    - `apps/user-app/src/i18n/*`
    - `apps/user-app/src/shared/i18n/index.ts`
    - 对应测试文件
  - 这一步明确不做什么：不再出现“新建表单”“已创建的表单”这类错误文案。
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app exec tsc --noEmit`

- [x] 4.3 新建真正的工作台 `Teable` 表单块
  - 状态：DONE
  - 这一步到底做什么：新增一个真正显示表单的块，而不是继续用当前概览面板冒充表单块。
  - 做完你能看到什么：工作台里的 `Teable` 块可以选择一个已接入表单并显示它。
  - 先依赖什么：4.2
  - 主要改哪里：
    - `apps/user-app/src/features/workbench/components/AffairsTeableFormBlock.tsx`（新增）
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - 对应测试文件
  - 这一步明确不做什么：不把连接设置和镜像管理继续塞进画布里。
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app exec tsc --noEmit`

---

## 阶段 5：收回当前错误实现，避免后面继续污染

- [x] 5.1 把“在 CodingNS 里创建 Teable 表单”降级成兼容过渡能力
  - 状态：DONE（旧公开建表入口已降级为废弃提示）
  - 这一步到底做什么：把当前 `createTeableForm` 相关服务和弹窗从正式主链路里拿掉，避免继续误导产品方向。
  - 做完你能看到什么：新前端不再调用这条线，旧接口只保兼容。
  - 先依赖什么：4.3
  - 主要改哪里：
    - `apps/host/src/routes/affairs.ts`
    - `apps/host/src/server/create-server.ts`
    - `apps/user-app/src/features/workbench/components/AffairsTeableFormModal.tsx`
    - 对应测试文件
  - 这一步明确不做什么：不再保留任何还能真的创建表单的旧主链路。
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`
    - `rg -n "createTeableForm\\(|listTeableForms\\(" apps/user-app/src -g '!**/*.test.tsx'`

- [x] 5.2 清理错误文案和错误交互
  - 状态：DONE（现网主链路）
  - 这一步到底做什么：把所有“新建表单”“已创建的表单”“先到工作台块里继续创建”之类的错误文案清掉。
  - 做完你能看到什么：前端话术和真实产品逻辑一致。
  - 先依赖什么：5.1
  - 主要改哪里：
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/user-app/src/i18n/*`
    - 对应前端页面和测试文件
  - 这一步明确不做什么：不顺手大改别的模块文案。
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`
    - 文案走查：设置页不再出现“先进入工作区”“去工作台创建表单”“已创建的表单”主链路提示

---

## 阶段 6：回流边界单独收口，不再绑在主链路上

- [x] 6.1 把回流能力明确成独立后台任务
  - 状态：DONE
  - 这一步到底做什么：保留回流后台任务和单独接口，但不再把它塞进设置页和工作台块主流程里。
  - 做完你能看到什么：主链路只讲连接、表单接入、镜像和字段映射；回流只作为独立后台任务存在。
  - 先依赖什么：5.2
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-inbound-sync-service.ts`
    - 对应设计文档和测试文件
  - 这一步明确不做什么：不在这一轮强行做全动作大全。
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/modules/workspace/teable-inbound-sync-service.test.ts tests/integration/teable-inbound-sync-routes.test.ts`

- [x] 6.2 最终检查点
  - 状态：DONE
  - 这一步到底做什么：确认 `Teable` 集成已经回到正确产品模型上，而不是继续沿着错误路线打补丁。
  - 做完你能看到什么：设置页负责配置，工作台块负责显示，镜像同步负责供数，回流独立存在。
  - 先依赖什么：6.1
  - 主要改哪里：当前 Spec 全部文件 + 定向实现文件
  - 这一步明确不做什么：不再追加新范围。
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc --noEmit`
    - `pnpm --dir apps/user-app exec tsc --noEmit`
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`

- [x] 6.3 再次纠正设置页和工作台块的职责边界
  - 状态：DONE
  - 这一步到底做什么：把设置页从“接入表单”改回“按表配置同步和字段映射”，同时把工作台里的 Teable 块改成直接读取 Teable 表单目录来选表单。
  - 做完你能看到什么：
    - 设置页“表单”标签里显示的是当前 Base 下有哪些表、有哪些字段、这张表下有没有表单视图
    - 工作台里的 Teable 块不再依赖全局“已接入表单”记录，而是直接从 Teable 表单目录里选择要展示的表单
  - 先依赖什么：6.2
  - 主要改哪里：
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
    - `apps/user-app/src/features/workbench/components/AffairsTeableFormBlock.tsx`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
    - `apps/user-app/src/shared/i18n/index.ts`
    - 对应前端测试文件
  - 这一步明确不做什么：不重做 Host 路由，不把同步配置再绑回表单视图。
  - 怎么验证：
    - `pnpm --dir apps/user-app exec tsc --noEmit`
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`


- [x] 6.4 按最新交互重构 Teable 设置弹窗
  - 状态：DONE
  - 这一步到底做什么：把 Teable 设置从“连接 / 表单 / 镜像 / 字段映射”四个标签页，改成“连接设置 / 表单设置”两个标签页。
  - 做完你能看到什么：
    - 连接设置里只保留连接参数，底部按钮是“测试连接 / 保存连接 / 取消”
    - “认证引用”不再显示给用户，但保存时仍使用默认 `secret://teable/main` 保持 Host 兼容
    - 表单设置变成左右分栏：左侧添加 Teable 已有表单，右侧选择会话记录、代办、文档库标签并做字段映射
    - 会话记录和代办可以选择全部工作区或指定工作区；文档库标签只选根标签，不再提示先进入工作区
  - 先依赖什么：6.3
  - 主要改哪里：
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
    - `apps/user-app/src/app/styles.css`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
    - `apps/user-app/src/features/settings/pages/SettingsPage.test.tsx`
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.test.tsx`
  - 这一步明确不做什么：不新建 Host 同步任务，不改 Teable 数据模型，不把 Teable 再绑回单个 Workspace。
  - 怎么验证：
    - `pnpm --dir apps/user-app exec tsc --noEmit`
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`

- [x] 6.5 把“表单设置”纠正为“表同步设置”
  - 状态：DONE
  - 这一步到底做什么：设置页不再把 Teable 表单当同步目标。同步目标必须是 Teable 表；表单只留给工作台画布里的 Teable 块展示。
  - 做完你能看到什么：
    - 第二个标签页叫“表同步设置”
    - 左侧只提供 Teable 表选择器和“添加同步表”按钮，不再把表单或表单视图列出来
    - 右侧显示“同步表列表”，只有添加过的表才出现在这里
    - 选中右侧表以后，再配置同步内容、工作区范围、标签根节点和字段映射
  - 先依赖什么：6.4
  - 主要改哪里：
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
    - `apps/user-app/src/app/styles.css`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
    - `apps/user-app/src/features/settings/pages/SettingsPage.test.tsx`
  - 这一步明确不做什么：
    - 不在设置页管理 Teable 表单
    - 不把同步配置绑到 Teable 表单视图
    - 不改工作台画布里的 Teable 表单块职责
  - 怎么验证：
    - `pnpm --dir apps/user-app exec tsc --noEmit`
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`

- [x] 6.6 优化表同步设置交互并支持自动建字段
  - 状态：DONE
  - 这一步到底做什么：
    - 左侧负责添加和选择同步表，已添加的表也留在左侧列表里
    - 右侧只显示当前选中表的配置，不再堆一遍同步表列表
    - 会话记录和代办的工作区范围改成普通单选：全部工作区 / 指定工作区
    - 字段映射旁边新增“添加字段并自动映射”，通过 Host 调 Teable API 给目标表添加字段
  - 做完你能看到什么：
    - 添加后的表记录在左侧列表区域
    - 范围选择不再显示成抽象的大号控件
    - 点击“添加字段并自动映射”会打开单独弹窗，勾选字段后自动创建 Teable 字段并写入映射草稿
  - 先依赖什么：6.5
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-catalog-service.ts`
    - `apps/host/src/modules/workspace/teable-catalog-controller.ts`
    - `apps/host/src/routes/affairs.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
    - `apps/user-app/src/app/styles.css`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
    - `apps/user-app/src/features/settings/pages/SettingsPage.test.tsx`
  - 这一步明确不做什么：
    - 不自动替用户保存同步配置，自动建字段只更新映射草稿，仍由用户点保存
    - 不把所有 Teable 字段类型都做复杂映射，当前只按文本和日期做基础字段
    - 不改变工作台 Teable 表单块的显示逻辑
  - 怎么验证：
    - `pnpm --dir apps/host exec vitest run tests/integration/teable-global-routes.test.ts`
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app exec tsc --noEmit`

- [x] 6.7 修正文档库标签同步入口和选择样式
  - 状态：DONE
  - 这一步到底做什么：
    - Teable 设置页选择“文档库根标签”时，只从事务模式的全局文档库标签入口读取一次
    - Teable 镜像同步执行时，也只读取全局事务文档库标签，不再遍历每个代码工作区
    - 把全局弹窗里的可见复选框改回正常小方框，避免表单输入框样式把 checkbox 拉成大长方形
  - 做完你能看到什么：
    - 文档库根标签不再按工作区重复出现
    - 标签同步配置和实际同步执行都不再依赖代码工作区循环
    - 复选框显示为普通 16px 小方框，文字按行排列
  - 先依赖什么：6.6
  - 主要改哪里：
    - `apps/host/src/modules/workspace/affairs-tag-service.ts`
    - `apps/host/src/modules/workspace/affairs-tag-controller.ts`
    - `apps/host/src/modules/workspace/teable-mirror-sync-service.ts`
    - `apps/host/src/modules/workspace/teable-field-mapping-service.ts`
    - `apps/host/src/routes/affairs.ts`
    - `apps/host/src/server/create-server.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
    - `apps/user-app/src/app/styles.css`
    - `apps/user-app/src/features/settings/pages/SettingsPage.test.tsx`
  - 这一步明确不做什么：
    - 不再保留“从每个工作区读一遍标签”的兼容分支
    - 不改会话记录和代办的工作区范围语义
    - 不改工作台 Teable 表单块
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
    - `pnpm --dir apps/host exec vitest run tests/integration/teable-global-routes.test.ts tests/modules/workspace/teable-mirror-sync-run.test.ts tests/modules/workspace/teable-mirror-sync-task-service.test.ts`
    - `pnpm --dir apps/user-app exec tsc --noEmit`
    - `pnpm --dir apps/host exec tsc --noEmit`

- [x] 6.8 增加本地变化触发同步和同步日志
  - 状态：DONE
  - 这一步到底做什么：
    - 本地标签、会话、代办发生变化时，不在业务主链路里直接推 Teable，只把镜像同步任务放进 `TaskManager`
    - 同步任务开始、完成、失败时写入 `user_teable_sync_logs`
    - Teable 设置弹窗新增“同步日志”标签页，用户可以看到手动同步和本地变化触发的记录
  - 做完你能看到什么：
    - 连接设置里选择“本地变化自动同步”后，本地数据变化会自动触发 Teable 镜像同步任务
    - 设置页能看到同步时间、触发方式、同步内容、成功/失败状态和新增/更新/删除/跳过数量
  - 先依赖什么：
    - Teable 全局连接
    - 表同步配置
    - 字段映射配置
    - `TaskManager` 后台任务体系
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-mirror-sync-service.ts`
    - `apps/host/src/storage/repositories/user-teable-sync-log-repository.ts`
    - `apps/host/src/storage/sqlite/schema.sql`
    - `apps/host/src/modules/workspace/affairs-tag-service.ts`
    - `apps/host/src/modules/workspace/affairs-lightweight-session-service.ts`
    - `apps/host/src/modules/butler/butler-inbox-service.ts`
    - `apps/host/src/modules/butler/butler-follow-up-service.ts`
    - `apps/user-app/src/settings/TeableSettingsModal.tsx`
    - `apps/user-app/src/i18n/zh-CN.ts`
    - `apps/user-app/src/i18n/en-US.ts`
  - 这一步明确不做什么：
    - 不新增私有定时器、私有 inflight 或私有重试队列
    - 不做严格的数据库 `updatedAt` 游标增量；当前增量判断仍使用现有 fingerprint 和镜像记录映射，未变化记录会跳过
    - 不在本地数据保存请求里等待 Teable 推送完成
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc --noEmit`
    - `pnpm --dir apps/user-app exec tsc --noEmit`
    - `pnpm --dir apps/host exec vitest run tests/integration/teable-mirror-sync-routes.test.ts tests/integration/user-teable-sync-log-repository.test.ts tests/modules/workspace/teable-mirror-sync-task-service.test.ts`
    - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
    - `pnpm check:sqlite-runtime`

- [x] 6.9 工作台 Teable 块支持选择表格和视图
  - 状态：DONE
  - 这一步到底做什么：
    - 工作台添加块时，选择 `Teable 块` 后先选 Teable 表格，再选这张表里的视图
    - 支持显示表格、表单、看板、日历视图，不再只读表单目录
    - Host 增加按表读取视图目录接口，前端块创建时把表格和视图信息写进块配置
    - 嵌入到工作台 iframe 时不再直连 Teable 原始地址，统一走 Host 签名代理 `/api/public/teable-view/...`
    - Host 代理会转发 Teable 页面、静态资源和页面里的接口请求，浏览器只访问 CodingNS Host
    - 前端把 Host 返回的代理地址转成 Host 绝对 URL，避免 iframe 把 `/preview/...` 打到前端页面 origin
    - Host 把 Teable 预览代理拆成独立 public route，在静态前端 fallback 之前注册，避免被前端壳吃成 404 页面
    - Teable 表单提交如果逃逸到 `/share/{shareId}/view/form-submit`，Host 会用代理页面下发的预览 cookie 找回 token 并继续转发，不再要求浏览器直接访问 Teable
    - Teable 表单提交转发到 Teable 时会改成 `/api/share/{shareId}/view/form-submit`，不再把展示页路径 `/share/{shareId}/view/form-submit` 当成提交接口
    - Teable 块发现已保存的代理链接快过期或已过期时，会自动重新签发代理链接；块标题栏在“新建记录”左侧新增“刷新”按钮，用户可以手动刷新当前视图链接
  - 做完你能看到什么：
    - 添加块面板里选中 `Teable 块` 后，会出现“Teable 表格”和“显示视图”两个下拉框
    - 添加后工作台块直接嵌入所选视图
    - 块标题默认使用所选视图名
    - 已保存的旧分享链接也会在前端渲染 iframe 前自动换成 Host 代理链接
    - iframe 的 `src` 应该是 `http://Host/api/public/teable-view/...` 或同等 Host 代理地址，不应该再出现 `10.255.0.42` 这类 Teable 原始地址
    - iframe 里不应该再显示 `Route GET:/preview/teable-view/... not found` 这类 JSON 404
    - 在工作台块里打开“新建记录”表单并提交时，请求可以被 Host 接住并转发到 Teable，不应该再报 `Cannot POST /share/.../view/form-submit`
    - Teable 后端收到的提交请求路径应该是 `/api/share/.../view/form-submit`
    - 已过期的 Teable 块不会继续显示 `TEABLE_PREVIEW_TOKEN_EXPIRED`，会自动换成新的 Host 代理链接
  - 先依赖什么：
    - Teable 全局连接可用
    - Teable API 能读取当前 Base 的表和视图
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-catalog-service.ts`
    - `apps/host/src/modules/workspace/teable-catalog-controller.ts`
    - `apps/host/src/routes/affairs.ts`
    - `apps/host/src/routes/public.ts`
    - `apps/host/src/routes/teable-preview.ts`
    - `apps/host/src/server/create-server.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `apps/user-app/src/features/workbench/components/AffairsTeableFormBlock.tsx`
    - `apps/user-app/src/app/workbench-native.css`
    - `apps/user-app/src/shared/i18n/index.ts`
    - `apps/host/tests/integration/teable-global-routes.test.ts`
    - `apps/host/tests/integration/teable-preview-routes.test.ts`
    - `apps/host/tests/integration/public-teable-preview-routes.test.ts`
    - `apps/host/tests/modules/workspace/teable-catalog-service.test.ts`
  - 这一步明确不做什么：
    - 不在工作台块里做同步配置
    - 不把字段映射、镜像同步设置放回画布
    - 不强行替用户创建 Teable 表或视图
    - 不让浏览器直接访问 Teable 内网地址
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc --noEmit`
    - `pnpm --dir apps/host test -- --run tests/integration/public-teable-preview-routes.test.ts tests/modules/workspace/teable-catalog-service.test.ts`
    - `pnpm --dir apps/user-app exec tsc --noEmit`
    - `pnpm --dir apps/host exec vitest run tests/integration/teable-preview-routes.test.ts tests/integration/teable-global-routes.test.ts tests/integration/teable-form-routes.test.ts tests/integration/teable-mirror-sync-routes.test.ts tests/integration/teable-inbound-sync-routes.test.ts tests/integration/affairs-library-global-routes.test.ts`
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`

- [x] 6.10 Teable 新建记录成功后自动关闭并提示
  - 状态：DONE
  - 这一步到底做什么：
    - Host 代理注入脚本监听 Teable 表单提交请求
    - 当 `/view/form-submit` 返回 2xx 时，通过 `postMessage` 通知工作台页面
    - 工作台收到成功消息后关闭“新建记录”弹窗，刷新 Teable 块，并显示成功提示
  - 做完你能看到什么：
    - 在 Teable 块里点击“新建记录”打开表单
    - 提交成功后弹窗会自动关闭
    - 页面会提示“新记录已创建”
    - 当前 Teable 块会触发刷新，不需要用户手动关闭表单再点刷新
  - 先依赖什么：
    - Teable 表单提交已经能通过 Host 代理转发成功
    - 工作台 Teable 块已经使用 Host 代理地址嵌入
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-catalog-service.ts`
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.test.tsx`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步明确不做什么：
    - 不在 CodingNS 里重写 Teable 表单页
    - 不改变 Teable 的记录创建接口
    - 不把表单提交结果写入本地镜像日志，镜像日志仍只记录镜像同步任务
  - 怎么验证：
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`
    - `pnpm --dir apps/user-app exec tsc --noEmit`
    - `pnpm --dir apps/host test -- --run tests/modules/workspace/teable-catalog-service.test.ts`
    - `pnpm --dir apps/host exec tsc --noEmit`

- [x] 6.11 修复 Teable 关联记录触发的 React hydration 报错
  - 状态：DONE
  - 这一步到底做什么：
    - 收窄 Host 代理对 Teable 页面内容的改写范围
    - HTML 只改 `src`、`href`、CSS `url(...)` 这类资源入口
    - CSS 只改资源 `url(...)`
    - JavaScript bundle 和 inline script 不再做全文路径替换
  - 做完你能看到什么：
    - Teable 表格里加载关联记录时，不应该再因为代理层改写 Next/React 初始化数据而出现 React #418 / #423
    - Teable 的 API 请求仍然通过注入脚本走 Host 代理
    - 表单提交代理和成功回传不受影响
  - 先依赖什么：
    - Teable iframe 已经统一走 Host 代理
    - Host 代理已能处理静态资源和表单提交
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-catalog-service.ts`
    - `apps/host/tests/modules/workspace/teable-catalog-service.test.ts`
  - 这一步明确不做什么：
    - 不在 CodingNS 里解析或重写 Teable 关联记录数据
    - 不改 Teable 数据结构
    - 不继续用正则改写压缩后的 React / Next 运行时代码
  - 怎么验证：
    - `pnpm --dir apps/host test -- --run tests/modules/workspace/teable-catalog-service.test.ts`
    - `pnpm --dir apps/host test -- --run tests/integration/public-teable-preview-routes.test.ts tests/integration/teable-preview-routes.test.ts`
    - `pnpm --dir apps/host exec tsc --noEmit`

- [x] 6.12 修复不改写 JS 后 Teable 页面白屏
  - 状态：DONE
  - 这一步到底做什么：
    - 保持 6.11 的原则：不再改写 Teable 的 JavaScript bundle
    - 增加 `/_next/*` 逃逸静态资源代理入口
    - 当 Teable 的 JS 运行时继续请求 `/_next/static/...` 时，Host 通过 referer 或代理 cookie 找回预览 token，再把请求转发给 Teable
  - 做完你能看到什么：
    - Teable 页面不需要靠改写 JS bundle 也能加载动态 chunk
    - 页面不应该再因为 `/_next/static/...` 没有走 Host 代理而白屏
    - 没有 Teable 代理来源的 `/_next/*` 请求会返回 404，不会把 CodingNS 自己的前端资源和 Teable 资源混在一起
  - 先依赖什么：
    - 6.11 已经停止改写 Teable JS
    - Teable iframe 页面已经能设置代理 token cookie
  - 主要改哪里：
    - `apps/host/src/modules/workspace/teable-catalog-controller.ts`
    - `apps/host/src/routes/public.ts`
    - `apps/host/src/middlewares/auth-guard.ts`
    - `apps/host/tests/integration/public-teable-preview-routes.test.ts`
  - 这一步明确不做什么：
    - 不恢复对 Teable JS 的全文替换
    - 不把所有根路径都开放成 Teable 代理，只接 `/_next/*` 这个已知 Next 静态资源入口
    - 不让没有 referer/cookie 的静态资源请求穿透到 Teable
  - 怎么验证：
    - `pnpm --dir apps/host test -- --run tests/integration/public-teable-preview-routes.test.ts tests/modules/workspace/teable-catalog-service.test.ts`
    - `pnpm --dir apps/host exec tsc --noEmit`

---

## 本轮已经完成的最小可交付验证

- Host
  - `pnpm --dir apps/host exec vitest run tests/integration/teable-mirror-sync-routes.test.ts tests/integration/user-teable-sync-log-repository.test.ts tests/modules/workspace/teable-mirror-sync-task-service.test.ts`
  - `pnpm --dir apps/host exec vitest run tests/modules/workspace/teable-mirror-sync-service.test.ts tests/modules/workspace/teable-mirror-sync-run.test.ts tests/modules/workspace/teable-mirror-sync-task-service.test.ts tests/modules/workspace/teable-global-binding-service.test.ts tests/integration/teable-global-routes.test.ts`
  - `pnpm --dir apps/host exec tsc --noEmit`
  - `pnpm --dir apps/host test -- --run tests/modules/workspace/teable-catalog-service.test.ts`
  - `pnpm --dir apps/host test -- --run tests/integration/public-teable-preview-routes.test.ts tests/integration/teable-preview-routes.test.ts`
  - `pnpm --dir apps/host test -- --run tests/integration/public-teable-preview-routes.test.ts tests/modules/workspace/teable-catalog-service.test.ts`
  - `pnpm check:sqlite-runtime`
- User App
  - `pnpm --dir apps/user-app exec tsc --noEmit`
  - `pnpm --dir apps/user-app test -- --run src/features/settings/pages/SettingsPage.test.tsx -t "Teable"`
  - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable"`

---

## 阶段 7：放弃 Teable 分享页嵌入路线，只保留同步配置能力

> 说明：6.9、6.10、6.11、6.12 是已经做过的 iframe / 分享页代理尝试。实际联调证明这条路体验差、稳定性差、UI 不可控。后续不再沿这条路继续修补。

- [x] 7.1 移除事务工作台 Teable 嵌入块
  - 状态：DONE
  - 这一步到底做什么：从事务工作台移除 Teable 块类型、iframe 展示、新建记录弹窗、刷新分享链接和提交成功监听。
  - 做完以后能看到什么：
    - 添加块面板不再出现 Teable 嵌入块
    - 旧本地快照里的 Teable 块会在状态归一化时被丢弃
    - 工作台画布不再加载 Teable 分享页，也不再出现 Teable 新建记录弹窗
  - 这一步依赖什么：已有 Teable 设置和同步配置仍然保留。
  - 主要改哪些文件：
    - `apps/user-app/src/features/workbench/components/AffairsWorkbenchView.tsx`
    - `apps/user-app/src/features/workbench/types/workbench-mode.ts`
    - `apps/user-app/src/features/workbench/utils/affairs-dashboard-state.ts`
    - `apps/user-app/src/features/conversation/api/conversation-api.ts`
    - `apps/user-app/src/app/workbench-native.css`
    - `apps/user-app/src/app/styles.css`
    - `apps/user-app/src/shared/i18n/index.ts`
  - 这一步明确不做什么：不实现新的 CodingNS 自定义 Teable 前端；不继续修 iframe、分享链接或 Teable 页面代理。
  - 怎么验证：
    - `pnpm --dir apps/user-app exec tsc --noEmit`
    - `pnpm --dir apps/user-app test -- --run src/features/workbench/components/AffairsWorkbenchView.test.tsx -t "Teable|添加块"`

- [x] 7.2 移除 Host Teable 分享页代理和表单接入入口
  - 状态：DONE
  - 这一步到底做什么：删除 Host 里围绕 Teable 分享页、表单接入、表单结果回流的路由和服务，只保留连接、表目录、字段、同步配置、字段映射、镜像同步和同步日志。
  - 做完以后能看到什么：
    - Host 不再注册 `/api/public/teable-view/*` 这类代理路由
    - Host 不再提供 `form-catalog`、`form-bindings`、`view-proxy-link`、`inbound-sync` 这些旧入口
    - Teable API 能力只服务设置页和同步任务
  - 这一步依赖什么：Teable 同步设置主链路已经存在。
  - 主要改哪些文件：
    - `apps/host/src/routes/affairs.ts`
    - `apps/host/src/routes/public.ts`
    - `apps/host/src/middlewares/auth-guard.ts`
    - `apps/host/src/server/create-server.ts`
    - `apps/host/src/modules/tasks/task-types.ts`
    - `apps/host/src/modules/workspace/teable-catalog-controller.ts`
    - `apps/host/src/modules/workspace/teable-catalog-service.ts`
    - `apps/host/src/types/domain.ts`
  - 这一步明确不做什么：不删除旧 SQLite 表兼容建表逻辑，避免旧库升级失败；这些旧表不再有运行入口。
  - 怎么验证：
    - `pnpm --dir apps/host exec tsc --noEmit`
    - `pnpm --dir apps/host test -- --run tests/integration/teable-global-routes.test.ts tests/integration/teable-mirror-sync-routes.test.ts tests/modules/workspace/teable-catalog-service.test.ts tests/modules/workspace/teable-mirror-sync-service.test.ts`

- [x] 7.3 更新 Spec 口径，防止后续复活错误路线
  - 状态：DONE
  - 这一步到底做什么：把 `requirements.md` 和 `design.md` 改成当前事实：Teable 只保留连接、表同步、字段映射和同步日志；工作台嵌入 Teable 分享页路线废弃。
  - 做完以后能看到什么：
    - Spec 不再要求工作台显示 Teable iframe
    - Spec 明确后续如果要展示或编辑 Teable 数据，走 CodingNS 自定义前端 + Teable API
    - 任务文档保留历史尝试，但标明 6.9～6.12 后续废弃
  - 这一步依赖什么：7.1 和 7.2 的实现方向。
  - 主要改哪些文件：
    - `specs/spec018-事务表单系统与Teable集成/requirements.md`
    - `specs/spec018-事务表单系统与Teable集成/design.md`
    - `specs/spec018-事务表单系统与Teable集成/tasks.md`
  - 这一步明确不做什么：不重写整个历史任务清单；历史任务只作为过程记录存在。
  - 怎么验证：文档走查 + `rg -n "AffairsTeable|teable-view|view-proxy|form-catalog|form-bindings|inbound-sync|TeableInbound|TeableFormOpenMode" apps specs`。
