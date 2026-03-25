# spec009 补充文档目录

本目录放 `spec009-移动端体验与通知` 的补充材料。

现在这个 Spec 的重点已经不是“轻操作”，而是：

- 业务能力与 PC 对齐
- iOS / Android 分平台 UI
- 系统能力走适配层

所以补充文档也要围着这三件事写，别再写成旧版本思路。

建议优先补这些文档：

- `capability-matrix.md`
  - 列 PC 端现有能力、移动端对应入口、当前完成度、缺口
- `platform-adapter.md`
  - 列通知、分享、文件导入、权限、生物识别、触感反馈、后台恢复等适配接口
- `ios-ui-guidelines.md`
  - 记录 iOS 的导航、sheet、safe area、手势返回、分组列表、表单和系统能力约束
- `android-ui-guidelines.md`
  - 记录 Android 的 Top App Bar、Bottom Navigation、Bottom Sheet、返回栈、通知渠道、权限流程
- `integration.md`
  - 记录和 `spec003/004/005/006/007/008` 的联调说明
- `acceptance-checklist.md`
  - 按“功能对齐 + 平台 UI + 系统能力 + 构建验证”列验收项
- `acceptance-result.md`
  - 验收结果、问题记录、回退策略

补充要求：

- 只写和 `spec009` 直接相关的内容
- 不重复定义前置 Spec 已确定的核心协议
- 所有示例都默认建立在登录态保护前提下
- 平台差异只写在 `platform adapter` 或 `platform ui`，不要把业务逻辑分叉写进补充文档
