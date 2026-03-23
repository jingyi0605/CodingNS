# 任务清单 - spec004-文件上下文能力（人话版）

状态：DONE

## 这份文档是干什么的

这份任务清单的目标很简单：让接手的人不用猜，按顺序就能把文件上下文能力做出来。

每一步都要回答七个问题：

1. 这一步到底做什么
2. 做完后能看到什么
3. 依赖什么
4. 开始前看哪些文档
5. 主要改哪些文件
6. 这一步明确不做什么
7. 怎么验证

## 状态说明

- `TODO`：还没开始
- `IN_PROGRESS`：正在做
- `BLOCKED`：被外部问题卡住
- `IN_REVIEW`：已经做完，等复核
- `DONE`：完成并验证通过
- `CANCELLED`：取消并写明原因

规则：

- 只有 `状态：DONE` 的任务可以勾选 `[x]`
- 每完成一个任务，必须立刻回写状态
- `BLOCKED` 和 `CANCELLED` 必须记录原因和下一步处理

---

## 阶段 1：先把安全边界和基础模型钉死

- [x] 1.1 建立文件访问守卫和路径边界校验
  - 状态：DONE
  - 这一步到底做什么：实现工作区白名单校验、路径规范化、path traversal 防护，并挂到文件 API 入口。
  - 做完你能看到什么：越界路径和未授权访问都被统一拦截。
  - 先依赖什么：`spec001` 鉴权中间件可复用。
  - 开始前先看：
    - `requirements.md` 需求 1、需求 7
    - `design.md` §1.3、§2.2、§6.1
  - 主要改哪里：
    - `apps/host/src/modules/file/file-access-guard.ts`
    - `apps/host/src/modules/file/path-normalizer.ts`
    - `apps/host/src/routes/files.ts`
  - 这一步先不做什么：不实现具体文件树和搜索逻辑。
  - 怎么算完成：
    1. 所有文件接口统一经过 guard
    2. 越界与 traversal 请求被拒绝
  - 怎么验证：
    - 单元测试：路径校验函数
    - 集成测试：未登录/越界访问
  - 对应需求：`requirements.md` 需求 1、需求 7
  - 对应设计：`design.md` §2.2、§3.3、§6.1

- [x] 1.2 建立文件与上下文绑定基础数据模型
  - 状态：DONE
  - 这一步到底做什么：创建 `RecentFileRecord` 和 `FileContextBinding` 的仓储与基础迁移，明确只存元数据。
  - 做完你能看到什么：系统能记录最近打开与上下文挂载关系，但不会存会话原文。
  - 先依赖什么：1.1
  - 开始前先看：
    - `requirements.md` 需求 5、需求 6
    - `design.md` §3.2、§4.1、§6.2
  - 主要改哪里：
    - `apps/host/src/modules/file/repositories/recent-file-repo.ts`
    - `apps/host/src/modules/file/repositories/file-context-repo.ts`
    - `apps/host/src/storage/sqlite/schema-file-context.sql`
  - 这一步先不做什么：不把文件正文写进上下文绑定表。
  - 怎么算完成：
    1. 最近打开和上下文绑定可增删查
    2. 数据模型无“会话原文副本”字段
  - 怎么验证：
    - 仓储层单元测试
    - schema 审查清单
  - 对应需求：`requirements.md` 需求 5、需求 6
  - 对应设计：`design.md` §3.2、§4.1、§6.2

- [x] 1.3 阶段检查：边界和模型一致性检查
  - 状态：DONE
  - 这一步到底做什么：检查“鉴权 + 边界 + 数据模型”是否一致，避免后面返工。
  - 做完你能看到什么：可以安全进入文件能力开发阶段。
  - 先依赖什么：1.1、1.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
  - 主要改哪里：本阶段相关代码与文档
  - 这一步先不做什么：不加新范围。
  - 怎么算完成：
    1. 文件接口入口全部受保护
    2. 上下文绑定数据边界无歧义
  - 怎么验证：
    - 人工走查 + 测试报告核对
  - 对应需求：`requirements.md` 需求 1、需求 6、需求 7
  - 对应设计：`design.md` §1.3、§4.1、§6

---

## 阶段 2：实现文件核心能力（树、读写、搜索、预览、最近打开）

- [x] 2.1 实现文件树与文件读取接口
  - 状态：DONE
  - 这一步到底做什么：实现 `GET /api/files/tree` 和 `GET /api/files/content`。
  - 做完你能看到什么：用户能浏览目录树并打开文件内容。
  - 先依赖什么：1.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3
    - `design.md` §2.2、§3.3.1、§3.3.2
  - 主要改哪里：
    - `apps/host/src/modules/file/file-tree-service.ts`
    - `apps/host/src/modules/file/file-content-service.ts`
    - `apps/host/src/routes/files.ts`
  - 这一步先不做什么：不做重型编辑器行为。
  - 怎么算完成：
    1. 文件树可分页或按层加载
    2. 文件读取可返回内容和版本信息
  - 怎么验证：
    - 集成测试：tree/content
    - 目录层级和大目录冒烟测试
  - 对应需求：`requirements.md` 需求 2、需求 3
  - 对应设计：`design.md` §2.2、§3.3.1、§3.3.2

- [x] 2.2 实现基础编辑与文件操作接口
  - 状态：DONE
  - 这一步到底做什么：实现保存、创建、删除、重命名、移动，带版本冲突保护。
  - 做完你能看到什么：用户可进行基础改动，冲突时不会被盲目覆盖。
  - 先依赖什么：2.1
  - 开始前先看：
    - `requirements.md` 需求 2、需求 4
    - `design.md` §2.3.2、§3.3.3、§3.3.4、§6.3
  - 主要改哪里：
    - `apps/host/src/modules/file/file-content-service.ts`
    - `apps/host/src/modules/file/file-version-checker.ts`
    - `apps/host/src/routes/files.ts`
  - 这一步先不做什么：不做复杂三方合并算法。
  - 怎么算完成：
    1. 基础文件操作可用
    2. 版本不一致时返回冲突错误
  - 怎么验证：
    - 集成测试：保存成功/冲突/非法输入
    - 回归测试：重命名/移动边界
  - 对应需求：`requirements.md` 需求 2、需求 4
  - 对应设计：`design.md` §2.3.2、§3.3.3、§3.3.4、§6.3

- [x] 2.3 实现搜索、最近打开和预览
  - 状态：DONE
  - 这一步到底做什么：实现文件搜索、最近打开列表、预览接口与不支持类型提示。
  - 做完你能看到什么：用户能快速定位文件并得到稳定预览体验。
  - 先依赖什么：2.2
  - 开始前先看：
    - `requirements.md` 需求 3
    - `design.md` §2.2、§3.3.5、§3.3.6
  - 主要改哪里：
    - `apps/host/src/modules/file/file-search-service.ts`
    - `apps/host/src/modules/file/recent-file-service.ts`
    - `apps/host/src/modules/file/file-preview-service.ts`
    - `apps/host/src/routes/files.ts`
  - 这一步先不做什么：不做全文语义搜索和大文件高级分析。
  - 怎么算完成：
    1. 搜索支持文件名/路径查询
    2. 最近打开记录可查询且排序正确
    3. 预览不支持类型有明确提示
  - 怎么验证：
    - 集成测试：search/recent/preview
    - 性能基线测试：中等仓库
  - 对应需求：`requirements.md` 需求 3
  - 对应设计：`design.md` §2.2、§3.3.5、§3.3.6

- [x] 2.4 阶段检查：文件核心能力检查
  - 状态：DONE
  - 这一步到底做什么：串起“浏览 -> 打开 -> 编辑保存 -> 搜索/最近打开”主链路。
  - 做完你能看到什么：文件能力已经不是零散接口，而是一条完整可用链路。
  - 先依赖什么：2.1、2.2、2.3
  - 开始前先看：
    - `requirements.md` 需求 2、需求 3、需求 4
    - `design.md` §2.3、§3.3、§7
  - 主要改哪里：本阶段相关服务、路由和测试文件
  - 这一步先不做什么：不加入会话上下文挂载。
  - 怎么算完成：
    1. 主链路回放通过
    2. 错误场景可复现且错误码稳定
  - 怎么验证：
    - 端到端回放测试
    - 集成测试报告
  - 对应需求：`requirements.md` 需求 2、需求 3、需求 4
  - 对应设计：`design.md` §2.3、§3.3、§7

---

## 阶段 3：打通会话文件上下文并完成验收

- [x] 3.1 实现会话文件上下文挂载与解绑接口
  - 状态：DONE
  - 这一步到底做什么：实现 `POST/DELETE /api/sessions/{sessionId}/contexts/files...` 并落绑定元数据。
  - 做完你能看到什么：会话里可挂载和移除文件上下文。
  - 先依赖什么：2.4
  - 开始前先看：
    - `requirements.md` 需求 5、需求 6
    - `design.md` §2.3.3、§3.3.7、§3.3.8、§6.2
  - 主要改哪里：
    - `apps/host/src/modules/file/file-context-service.ts`
    - `apps/host/src/modules/file/file-context-controller.ts`
    - `apps/host/src/routes/session-contexts.ts`
  - 这一步先不做什么：不把挂载内容转存为会话原始消息。
  - 怎么算完成：
    1. 挂载、解绑、查询接口可用
    2. 绑定记录包含文件版本和 hash
  - 怎么验证：
    - 集成测试：attach/detach/list
    - 数据核验：无消息正文副本
  - 对应需求：`requirements.md` 需求 5、需求 6
  - 对应设计：`design.md` §2.3.3、§3.3.7、§3.3.8、§6.2

- [x] 3.2 对接 spec003 会话运行时展示
  - 状态：DONE
  - 这一步到底做什么：联调会话页上下文区域，显示文件挂载状态并支持移除。
  - 做完你能看到什么：会话页能看到文件上下文列表，且与后端记录一致。
  - 先依赖什么：3.1
  - 开始前先看：
    - `requirements.md` 需求 5
    - `design.md` §2.3.3、§4.1
    - `spec003` 的会话运行时接口约定
  - 主要改哪里：
    - `apps/user-app/src/features/conversation/components/FileContextPanel.tsx`
    - `apps/user-app/src/features/conversation/api/session-context-api.ts`
    - `apps/user-app/src/features/conversation/runtime/session-runtime-store.ts`
  - 这一步先不做什么：不扩展复杂片段批量管理。
  - 怎么算完成：
    1. 会话页上下文挂载状态可见
    2. 挂载/移除后视图实时更新
  - 怎么验证：
    - 前后端联调回放
    - UI 冒烟测试
  - 对应需求：`requirements.md` 需求 5
  - 对应设计：`design.md` §2.3.3、§4.1

- [x] 3.3 最终检查：边界与验收收口
  - 状态：DONE
  - 这一步到底做什么：确认文件能力完整交付，同时不越界到重型 IDE 和消息真相篡改。
  - 做完你能看到什么：`spec004` 达到可交付状态，后续可安全推进 `spec009` 移动端轻操作。
  - 先依赖什么：3.1、3.2
  - 开始前先看：
    - `requirements.md`
    - `design.md`
    - `tasks.md`
    - `docs/`
  - 主要改哪里：当前 Spec 全部相关代码与文档
  - 这一步先不做什么：不追加新能力范围。
  - 怎么算完成：
    1. 七条需求均有对应实现和验证证据
    2. 安全边界、消息真相边界、非 IDE 边界都可追溯
    3. 文档和任务状态回写完整
  - 怎么验证：
    - 验收清单逐项核对
    - 回归测试与安全测试报告
  - 对应需求：`requirements.md` 全部需求
  - 对应设计：`design.md` 全文
