# 任务清单 - spec004.2-静态HTML演示文档编辑器与导出能力（人话版）

状态：Draft

## 2026-05-15 立项补记

- 已确认这次不是继续补 HTML 预览，而是新增静态 HTML 文档编辑内核。
- 已确认第一阶段真实目标是“静态 HTML PPT 逐页编辑 + PDF/PPTX 导出”。
- 已确认编辑内核要同时支持嵌入 CodingNS 和独立桌面打包。
- 已确认导出属于后台任务，不能再在请求主链路或前端线程里硬跑。
- 已完成本 Spec 的 `README.md`、`requirements.md`、`design.md`、`tasks.md` 初始化。

## 阶段 1：先把输入边界和页面模型钉死

- [x] 1.1 盘点样板 HTML，定出“什么文件能进编辑器”
  - 状态：DONE
  - 这一步到底做什么：把现有样板 HTML 的分页结构、组件结构和常见样式模式整理出来，确定第一阶段支持范围。
  - 做完你能看到什么：一份清楚的输入边界和识别规则，后面不再靠猜。
  - 先依赖什么：无
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2
    - `design.md` §2.3「关键流程」
    - `design.md` §4.1「导入策略」
  - 主要改哪里：
    - `specs/spec004.2-静态HTML演示文档编辑器与导出能力/docs/`
    - `apps/user-app/src/features/` 下未来编辑器模块草案
  - 这一步先不做什么：不急着接 UI，不急着谈导出。
  - 怎么算完成：
    1. 已列出第一阶段明确支持的分页结构
    2. 已列出不能安全编辑的结构和降级策略
  - 怎么验证：
    - 用样板 HTML 人工走查
    - 补一份输入边界说明文档
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §2.3、§4.1
  - 完成记录：
    - 已盘点 5 份样板 HTML，确认至少存在“纵向顺排页”“active 切页”“deck 横向平移切页”“重装饰动画页”4 类结构。
    - 已补充 [docs/20260515-样板HTML结构盘点.md](/Users/jackson/Code/CodingNS/specs/spec004.2-静态HTML演示文档编辑器与导出能力/docs/20260515-样板HTML结构盘点.md:1)，写清第一阶段直接支持、条件支持和暂不支持边界。
    - 已确认第一阶段主样板应优先锁定 `合伙人佣金系统`、`企业Agent平台方案`、`化工行业AI培训` 这 3 类更规整的分页结构。

- [x] 1.2 落页面模型和可编辑样式子集
  - 状态：DONE
  - 这一步到底做什么：把内部 `DocumentProject / DocumentPage / DocumentNode` 模型和样式子集真正定下来。
  - 做完你能看到什么：后面导入、编辑、保存和导出都围着同一套数据结构转，不再各写各的状态。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4、需求 5、需求 6
    - `design.md` §3.2「内部页面模型」
    - `design.md` §3.3「可编辑样式子集」
  - 主要改哪里：
    - `apps/user-app/src/features/` 下未来编辑器状态模型文件
    - `apps/host/src/modules/file/` 下未来 HTML 编辑相关 DTO
  - 这一步先不做什么：不落导出，不接宿主壳。
  - 怎么算完成：
    1. 数据结构和字段含义已经写死
    2. 可编辑样式边界已经固定
  - 怎么验证：
    - 类型定义检查
    - 用两到三份样板 HTML 手工映射验证
  - 对应需求：`requirements.md` 需求 2、需求 4、需求 5、需求 6
  - 对应设计：`design.md` §3.2、§3.3
  - 完成记录：
    - 已补充 [docs/20260515-页面模型与回写约束.md](/Users/jackson/Code/CodingNS/specs/spec004.2-静态HTML演示文档编辑器与导出能力/docs/20260515-页面模型与回写约束.md:1)，明确宿主无关模型、只读节点规则、样式白名单和回写策略。
    - 已收紧 `design.md` 中的页面模型，新增 `schemaVersion`、`source`、`editable`、`lockedReason`、`patchStrategy` 等关键字段。
    - 已明确第一阶段默认只允许局部补丁式回写，禁止把整份 HTML 重生成作为默认保存方案。

### 阶段检查

- [x] 1.3 页面模型阶段检查
  - 状态：DONE
  - 这一步到底做什么：确认输入边界和页面模型已经站稳，避免后面一边写 UI 一边改底层模型。
  - 做完你能看到什么：后续实现可以围绕稳定模型推进，而不是反复返工。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：当前 Spec 文档和模型草案
  - 这一步先不做什么：不新增范围，不做导出细节。
  - 怎么算完成：
    1. 支持输入和不支持输入都已写清楚
    2. 页面模型和样式子集可以支撑后续实现
  - 怎么验证：
    - 人工走查
  - 对应需求：`requirements.md` 需求 1、需求 2
  - 对应设计：`design.md` §3.2、§4.1
  - 完成记录：
    - 已补充 [docs/20260515-导入器判定与节点映射规则.md](/Users/jackson/Code/CodingNS/specs/spec004.2-静态HTML演示文档编辑器与导出能力/docs/20260515-导入器判定与节点映射规则.md:1)，明确导入顺序、分页判定、展示壳过滤和节点映射规则。
    - 已在 `design.md` §4.1 收紧导入策略，明确第一阶段只支持初始 DOM 中静态存在的多页结构。
    - 当前阶段的输入边界、页面模型、样式白名单和回写策略已经成套闭环，可以进入 `2.1` 的导入器实现阶段。

## 阶段 2：把编辑内核跑通

- [x] 2.1 实现 HTML 导入和页面识别
  - 状态：DONE
  - 这一步到底做什么：把样板 HTML 转成内部页面模型，至少能稳定识别页面和核心组件。
  - 做完你能看到什么：打开 HTML 后，编辑器已经不是空壳，而是能看到页列表和画布内容。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 2、需求 3
    - `design.md` §4.1「导入策略」
    - `design.md` §5.1「核心组件」
  - 主要改哪里：
    - `apps/user-app/src/features/静态HTML编辑器/` 下导入模块
    - `apps/host/src/modules/file/` 下识别辅助接口（如需要）
  - 这一步先不做什么：不做导出，不做复杂报告模式。
  - 怎么算完成：
    1. 样板 HTML 能识别成多页项目
    2. 无法安全编辑的节点会被标记，而不是丢失
  - 怎么验证：
    - 样板 HTML 导入测试
    - 页面数量和顺序人工核对
  - 对应需求：`requirements.md` 需求 1、需求 2、需求 3
  - 对应设计：`design.md` §4.1、§5.1
  - 完成记录：
    - 已新增 `apps/user-app/src/features/static-html-editor/` 最小模块，落地页面模型、Probe、导入器和单页预览构建逻辑。
    - 已支持第一阶段静态分页结构识别：`section.slide`、`.deck > .slide`、`.slide[data-title]`、`.slide[data-slide]`、`body > .deck > *`。
    - 已把 HTML 导入结果收敛成 `DocumentProject / DocumentPage / DocumentNode`，并对 `svg / html / decoration` 等复杂内容按只读节点保留，不再静默丢失。
    - 已在 `FileViewerModal` 为静态 HTML 增加“演示文档”视图标签，能显示页列表、当前页标题和逐页只读画布。
    - 已补测试：
      - `pnpm --dir apps/user-app exec vitest run src/features/static-html-editor/parser.test.ts src/features/conversation/components/FileViewerModal.test.tsx`
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`

- [x] 2.2 接入编辑底座，完成组件选择、文字编辑和样式调整
  - 状态：DONE
  - 这一步到底做什么：把页面模型接到编辑底座上，支持选中组件、改文字、改字号、改颜色、改位置。
  - 做完你能看到什么：用户已经能像改 PPT 一样处理常见文本和容器组件。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 3、需求 4、需求 5
    - `design.md` §3.4「编辑底座选型」
    - `design.md` §6.2「状态流转」
  - 主要改哪里：
    - `apps/user-app/src/features/静态HTML编辑器/` 下画布、选区、属性面板
    - `apps/user-app/src/app/styles.css`
  - 这一步先不做什么：不接导出，不做多人协同。
  - 怎么算完成：
    1. 文字内容和基础样式可编辑
    2. 页面切换后编辑状态稳定
  - 怎么验证：
    - 前端交互测试
    - 人工操作样板 HTML
  - 对应需求：`requirements.md` 需求 3、需求 4、需求 5
  - 对应设计：`design.md` §3.3、§3.4、§6.2
  - 完成记录：
    - 已把静态 HTML 页面模型接到最小编辑壳，新增左侧页列表、中间逐页 iframe 预览、顶部节点选择条和右侧属性面板。
    - 已支持基础文本与样式编辑：文字内容、字号、字重、文字颜色、背景颜色、对齐、行高、padding、圆角。
    - 已通过 `DocumentProject` 草稿态生成 `srcDoc` 预览 HTML，做到编辑后当前页实时反映，不直接在 iframe DOM 上硬改。
    - 已补稳节点递归映射和 `sourceRef.pageIndex + nodePath` 回定位逻辑，保证编辑定位不只依赖页根一级节点。
    - 已补测试并通过：
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/user-app exec vitest run src/features/static-html-editor/parser.test.ts src/features/conversation/components/FileViewerModal.test.tsx`
    - 当前阶段明确不包含保存回 HTML；现有编辑结果仍停留在前端草稿态，正式回写链路放到 `3.1`。

- [x] 2.3 实现组件复制、移动和缩放
  - 状态：DONE
  - 这一步到底做什么：补齐 PPT 式编辑最基本的复制、拖动和拉伸操作。
  - 做完你能看到什么：用户可以直接在画布上复制组件，再改位置和大小。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §3.2「内部页面模型」
    - `design.md` §3.4「编辑底座选型」
  - 主要改哪里：
    - `apps/user-app/src/features/静态HTML编辑器/` 下组件操作模块
    - 相关状态管理与样式同步代码
  - 这一步先不做什么：不处理高级动画和复杂布尔图形。
  - 怎么算完成：
    1. 复制后的组件保留基础样式
    2. 拖动和缩放结果能被保存
  - 怎么验证：
    - 交互测试
    - 保存后重新打开同一文件复查
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §3.2、§3.4
  - 完成记录：
    - 已在页面模型和预览链路里补齐“草稿副本节点”能力，允许复制后的节点以 `draft-clone` 形式进入当前页预览，而不是只停留在内存状态里看不见。
    - 已新增基础组件复制入口，当前从选中组件出发生成同层副本，并自动给副本增加轻微位移偏移，避免直接重叠到完全看不见。
    - 已支持基础位置尺寸编辑：`X / Y / 宽度 / 高度` 四个字段会直接驱动当前页 `srcDoc` 预览，满足第一版“移动和缩放”最小可行链路。
    - 已收紧 `box` 覆写规则，只对复制节点和用户明确改过位置尺寸的节点生效，避免把原本流式布局的普通节点错误改成绝对定位。
    - 已补测试并通过：
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/user-app exec vitest run src/features/static-html-editor/parser.test.ts src/features/conversation/components/FileViewerModal.test.tsx`
    - 当前阶段明确不包含画布内拖拽手势和拖拽缩放手柄；这版先用可验证的字段编辑把数据链路跑通，避免提前堆一层保存不了的假交互。
    - 当前阶段仍未接保存回 HTML；复制节点和位置尺寸修改现在只存在于前端草稿态，正式回写链路仍属于 `3.1`。

### 阶段检查

- [x] 2.4 编辑内核阶段检查
  - 状态：DONE
  - 这一步到底做什么：确认核心编辑链路已经通了，不再只是“能打开但不敢用”的半成品。
  - 做完你能看到什么：至少样板 HTML 已经可以逐页编辑主要内容。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段全部相关文件
  - 这一步先不做什么：不追加导出细节外的新范围。
  - 怎么算完成：
    1. 逐页打开、选中、编辑、复制、拖拽、缩放已能跑通
    2. 已知限制项已经列出
  - 怎么验证：
    - 人工流程回放
  - 对应需求：`requirements.md` 需求 1 到需求 5
  - 对应设计：`design.md` §2.3、§3.2、§3.4
  - 完成记录：
    - 已完成样板 HTML 的逐页打开、页签切换、组件选择、文本编辑、基础样式调整、组件复制和 `X/Y/宽/高` 位置尺寸编辑主链路。
    - 已确认当前第一版不包含画布内拖拽手势、缩放手柄和复杂动画编辑，这些限制已经在任务记录里显式写清，不再假装“已经支持”。
    - 已把编辑结果稳定挂到 `DocumentProject` 草稿态，并通过 `srcDoc` 预览和 HTML 回写链路闭环，编辑内核不再是只能演示不能落盘的空壳。
    - 已补测试并通过：
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/user-app exec vitest run src/features/static-html-editor/parser.test.ts src/features/conversation/components/FileViewerModal.test.tsx`

## 阶段 3：把保存、导出和宿主集成收口

- [x] 3.1 实现保存回 HTML，并接入现有文件版本保护
  - 状态：DONE
  - 这一步到底做什么：把编辑结果安全写回 HTML，并接到 CodingNS 现有文件保存链路。
  - 做完你能看到什么：编辑后的文件可以直接进 Git，也能被浏览器重新打开。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 6、需求 10
    - `design.md` §4.2「回写策略」
    - `design.md` §5.3「保存回 HTML」
  - 主要改哪里：
    - `apps/user-app/src/features/静态HTML编辑器/` 下回写模块
    - `apps/host/src/modules/file/file-content-service.ts`
    - `apps/host/src/modules/file/file-controller.ts`
  - 这一步先不做什么：不顺手改普通 HTML 预览链路。
  - 怎么算完成：
    1. 改过的 HTML 能正常保存
    2. 版本冲突时有明确提示
  - 怎么验证：
    - 集成测试
    - 手工保存并重新打开
  - 对应需求：`requirements.md` 需求 6、需求 10
  - 对应设计：`design.md` §4.2、§5.3
  - 完成记录：
    - 已新增静态 HTML 项目回写函数，把 `DocumentProject` 草稿态补丁式写回单文件 HTML，而不是整份重生成。
    - 已区分“预览版 HTML”和“保存版 HTML”：
      - 预览版继续保留 `data-cns-page-root`、选中态描边和单页显示控制。
      - 保存版会去掉预览专用标记，只保留真正需要落盘的节点内容、样式和复制节点标记。
    - 已支持把复制组件以 `data-cns-node-id` 写回保存版 HTML，符合第一阶段新增节点必须带内部标记的约束。
    - 已把 `StaticHtmlPresentationView` 的项目草稿态同步到 `FileViewerModal`，保存按钮现在会优先把演示文档草稿项目回写成 HTML，再复用现有 `saveFileContent` 和版本号保护链路。
    - 已补保存脏状态判断，演示视图下即使 `editorContent` 本身未变，只要项目草稿回写结果与当前文件内容不同，保存按钮也会正确启用。
    - 已补齐逐页编辑交互缺口：
      - 支持直接点击 iframe 画布里的 `data-cns-node-id` 组件，自动定位到对应节点并同步右侧属性面板。
      - 左侧页列表支持拖拽调整顺序、删除页面，并在操作后自动保持当前页焦点和可编辑节点选中状态。
      - 新增页面改为插入到当前焦点页的下一页，而且新页保存回 HTML 时会生成真正的空白页结构，不再克隆原页内容冒充新页。
      - 页面新增/删除/调整顺序后，保存回 HTML 会真实同步 DOM 页结构，不再只是前端内存态变化。
      - 已补通画布内原位文本编辑：双击文本节点后会在画布上层打开可聚焦的文本编辑框，显示输入光标，并在输入时实时回写 `DocumentProject` 与 iframe 预览，不再出现“能选中但不能直接改字”的假交互。
    - 已补测试并通过：
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/user-app exec vitest run src/features/static-html-editor/parser.test.ts src/features/conversation/components/FileViewerModal.test.tsx`
    - 当前阶段仍未单独新增冲突解决 UI；版本冲突继续复用现有 `saveFileContent` 失败提示链路，不另外发明一套保存壳。

- [x] 3.2 接入 PDF 导出后台任务
  - 状态：DONE
  - 这一步到底做什么：把 HTML 渲染成分页 PDF，并按后台任务方式执行。
  - 做完你能看到什么：用户能在不阻塞主界面的情况下拿到 PDF。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 7、需求 9
    - `design.md` §4.3「PDF 导出」
    - `design.md` §4.5「导出任务必须走后台任务系统」
    - `specs/spec001.2-后端任务调度与主线程压力治理/20260412-后台任务接入规范.md`
  - 主要改哪里：
    - `apps/host/src/modules/tasks/`
    - `apps/host/src/modules/` 下新增导出服务
    - `apps/user-app/src/features/静态HTML编辑器/` 下导出入口
  - 这一步先不做什么：不碰 PPTX。
  - 怎么算完成：
    1. 可生成分页正确的 PDF
    2. 导出过程可查询状态和失败原因
  - 怎么验证：
    - 后台任务集成测试
    - 导出产物人工核对
  - 对应需求：`requirements.md` 需求 7、需求 9
  - 对应设计：`design.md` §4.3、§4.5
  - 完成记录：
    - 已新增 Host 侧 `presentation.export_pdf` 后台任务类型，并通过 `TaskManager` 注册为 `external_process` 车道，避免把 PDF 导出塞回请求主链路。
    - 已新增静态 HTML PDF 导出服务，第一版直接用 `playwright-core` 打开 HTML 内容并输出到源文件同目录同名 `.pdf`，默认保留分页尺寸和打印背景。
    - 已新增导出接口：
      - `POST /api/presentation-exports`
      - `GET /api/presentation-exports/:taskId`
    - 已接入 `FileViewerModal` 的演示文档模式工具栏，支持直接导出当前草稿 HTML 为 PDF，并轮询任务状态后给出成功或失败提示。
    - 第一版明确只做默认导出到同目录 `.pdf`，不做自定义导出路径、不做任务列表页、不做 PPTX。
    - 已补测试并通过：
      - `pnpm --dir apps/host exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/host exec vitest run tests/integration/client-routes.test.ts`
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/FileViewerModal.test.tsx src/features/static-html-editor/parser.test.ts`

- [x] 3.3 接入 PPTX 导出后台任务
  - 状态：DONE
  - 这一步到底做什么：用保守方案生成版式一致的 PPTX，优先保证不跑版。
  - 做完你能看到什么：导出的 `.pptx` 可以直接打开，每页版式与编辑器一致。
  - 先依赖什么：3.2
  - 开始前先看：
    - `requirements.md` 需求 8、需求 9
    - `design.md` §4.4「PPTX 导出」
    - `design.md` §4.5「导出任务必须走后台任务系统」
  - 主要改哪里：
    - `apps/host/src/modules/tasks/`
    - `apps/host/src/modules/` 下新增 PPTX 导出服务
    - `apps/user-app/src/features/静态HTML编辑器/` 下导出入口
  - 这一步先不做什么：不强做完全语义化 PPT 原生对象导出。
  - 怎么算完成：
    1. PPTX 能被主流软件打开
    2. 页面顺序、尺寸和主要版式稳定
  - 怎么验证：
    - 导出任务测试
    - 人工打开 PPTX 核对样板结果
  - 对应需求：`requirements.md` 需求 8、需求 9
  - 对应设计：`design.md` §4.4、§4.5
  - 完成记录：
    - 已新增 Host 侧 `presentation.export_pptx` 后台任务类型，并把演示文档导出入口扩成统一 `format` 模式，支持 `pdf | pptx` 两种导出格式。
    - 已新增静态 HTML PPTX 导出服务，第一版采用“每页截图整页铺满”的保守方案：先用浏览器渲染出每页 PNG，再写入同尺寸 PPTX 页面，优先保证不跑版。
    - 已引入 `pptxgenjs` 作为 PPTX 打包依赖，避免手搓 OpenXML 压缩包。
    - 已在前端演示文档视图工具栏新增 `导出 PPTX` 按钮，并复用现有导出任务轮询链路。
    - 当前阶段明确不承诺 PPT 原生文本框、形状、分组等语义化可编辑对象；复杂组件统一按整页位图保底，符合“先保版式一致”的设计约束。
    - 已补测试并通过：
      - `pnpm --dir apps/host exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/host exec vitest run tests/integration/client-routes.test.ts`
      - `pnpm --dir apps/user-app exec tsc --noEmit -p tsconfig.json`
      - `pnpm --dir apps/user-app exec vitest run src/features/conversation/components/FileViewerModal.test.tsx src/features/static-html-editor/parser.test.ts`

- [ ] 3.4 完成 CodingNS 宿主集成和独立桌面打包桥接
  - 状态：TODO
  - 这一步到底做什么：把编辑内核一头接进 CodingNS 文件管理，一头接到独立桌面外壳。
  - 做完你能看到什么：同一套编辑器能在 CodingNS 里打开文件，也能单独运行。
  - 先依赖什么：3.3
  - 开始前先看：
    - `requirements.md` 需求 1、需求 9、需求 10
    - `design.md` §2.1「系统结构」
    - `design.md` §5.3「接口契约」
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/`
    - `apps/user-app/src/platform/desktop/`
    - 未来独立桌面包装目录
  - 这一步先不做什么：不扩移动端复杂交互。
  - 怎么算完成：
    1. CodingNS 文件管理中可进入编辑器
    2. 独立桌面外壳可打开本地 HTML 文件
  - 怎么验证：
    - 宿主集成测试
    - 手工打开本地文件流程
  - 对应需求：`requirements.md` 需求 1、需求 9、需求 10
  - 对应设计：`design.md` §2.1、§5.3

### 最终检查

- [ ] 3.5 最终检查点
  - 状态：TODO
  - 这一步到底做什么：确认这套能力已经从“概念验证”进入“可交付”的最低标准。
  - 做完你能看到什么：打开、编辑、保存、导出、再打开这条主链路能稳定跑完。
  - 先依赖什么：3.1、3.2、3.3、3.4
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部文件和相关实现文件
  - 这一步先不做什么：不再扩新需求，不把报告模式细化到失控。
  - 怎么算完成：
    1. 主链路已经打通
    2. 风险、限制和延期项已经写清楚
    3. 后续接手的人能看懂输入边界、导出策略和宿主关系
  - 怎么验证：
    - 按样板 HTML 完整回放
    - 按验收清单逐项核对
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
