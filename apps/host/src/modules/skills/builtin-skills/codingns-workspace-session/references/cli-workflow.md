# CodingNS Workspace Session CLI Workflow

## 1. 总原则

- 先确认当前工作区会话开放了哪些能力，再决定调用哪一组命令。
- 不自己拼私有 HTTP。
- 不跨工作区、不跨项目。
- 不知道参数时先查 help，不要硬猜。
- 不要回答“当前环境没有浏览器能力”；真实站点浏览器任务默认先走下面这组 `codingns assistant office ...` 命令。

## 2. 先查哪些 help

全局入口：

```bash
codingns assistant --help
codingns assistant help workspaces
codingns assistant help projects
codingns assistant help sessions
codingns assistant help terminals
codingns assistant help office
```

按动作查询：

```bash
codingns assistant capabilities list --help
codingns assistant terminals create --help
codingns assistant office browser-profile-list --help
codingns assistant office browser-profile-create --help
codingns assistant office browser-task-create --help
codingns assistant office browser-task-get --help
codingns assistant office document-create --help
codingns assistant office ops-target-create --help
codingns assistant office ops-ssh-task-create --help
```

## 3. 浏览器类正式工作流

先看有没有可复用 Profile：

```bash
codingns assistant office browser-profile-list [--workspace-id <workspaceId>] [--token <token>]
```

没有合适 Profile 时再创建：

```bash
codingns assistant office browser-profile-create --engine chrome --mode persistent --display-name "办公 Chrome" [--workspace-id <workspaceId>] [--token <token>]
```

随后创建并执行浏览器任务：

```bash
codingns assistant office browser-task-create --profile-id <profileId> --execute true --input-json '{"startUrl":"https://example.invalid","actions":[{"type":"read_dom"},{"type":"screenshot","fullPage":true}]}' [--token <token>]
codingns assistant office browser-task-get <taskId> [--token <token>]
```

如果是登录、验证码、复杂真实站点、必须复用现有浏览器登录态，优先显式指定真实浏览器调试后端：

```bash
codingns assistant office browser-task-create --profile-id <profileId> --execution-backend opencli_bridge --execute true --input-json '{"startUrl":"https://target.example/login","actions":[{"type":"read_dom"},{"type":"screenshot","fullPage":true}]}' [--token <token>]
```

`browser-task-create --input-json` 的最小格式不要猜，直接按这个对象写：

```json
{
  "startUrl": "https://example.invalid",
  "actions": [
    { "type": "read_dom" }
  ]
}
```

支持动作：

- `goto`：打开指定 URL，需要 `url`
- `click`：点击元素，需要 `selector`
- `fill`：填写输入框，需要 `selector` 和 `value`
- `press`：按键，需要 `key`，可选 `selector`
- `select`：下拉选择，需要 `selector` 和 `value` 或 `values`
- `upload`：上传文件，需要 `selector` 和 `filePath` 或 `filePaths`
- `download`：点击后下载，需要 `selector`，可选 `fileName`
- `wait`：等待指定毫秒数，常用 `timeoutMs`
- `read_dom`：读取页面 body 文本并生成 DOM 快照
- `extract_text`：提取页面 body 文本
- `screenshot`：截图，常用 `fullPage: true`

常用模板：

```bash
# 1. 打开网页并读 DOM
codingns assistant office browser-task-create --profile-id <profileId> --execute true --input-json '{"startUrl":"https://www.zhihu.com/signin","actions":[{"type":"read_dom"}]}' [--token <token>]

# 2. 打开网页并截图
codingns assistant office browser-task-create --profile-id <profileId> --execute true --input-json '{"startUrl":"https://www.zhihu.com/signin","actions":[{"type":"screenshot","fullPage":true}]}' [--token <token>]

# 3. 等页面稳定后再读取
codingns assistant office browser-task-create --profile-id <profileId> --execute true --input-json '{"startUrl":"https://www.zhihu.com/signin","actions":[{"type":"wait","timeoutMs":3000},{"type":"read_dom"}]}' [--token <token>]

# 4. 点击按钮后截图
codingns assistant office browser-task-create --profile-id <profileId> --execute true --input-json '{"startUrl":"https://target.example","actions":[{"type":"click","selector":"button[type=\\"submit\\"]"},{"type":"screenshot"}]}' [--token <token>]

# 5. 填表单
codingns assistant office browser-task-create --profile-id <profileId> --execute true --input-json '{"startUrl":"https://target.example/login","actions":[{"type":"fill","selector":"input[name=\\"username\\"]","value":"demo"},{"type":"fill","selector":"input[name=\\"password\\"]","value":"secret"},{"type":"screenshot"}]}' [--token <token>]

# 6. 登录页 / 验证码 / 复杂真实站点：优先真实浏览器调试
codingns assistant office browser-task-create --profile-id <profileId> --execution-backend opencli_bridge --execute true --input-json '{"startUrl":"https://target.example/login","actions":[{"type":"read_dom"},{"type":"wait","timeoutMs":3000},{"type":"screenshot","fullPage":true}]}' [--token <token>]

# 7. 已登录浏览器里继续点按钮、截图、保留真人登录态
codingns assistant office browser-task-create --profile-id <profileId> --execution-backend opencli_bridge --execute true --input-json '{"startUrl":"https://target.example/console","actions":[{"type":"click","selector":"button[data-testid=\\"next-step\\"]"},{"type":"wait","timeoutMs":1500},{"type":"screenshot","fullPage":true}]}' [--token <token>]
```

遇到真实站点浏览器任务，先查这里或 `--help`，不要退回去扫描源码和编译产物找 API 路径。

浏览器意图分流规则：

- 真实站点、企业后台、内网网页、网页控制台、需要沉淀截图/下载产物/回执：优先 `office.browser.*`
- 其中只要涉及登录、验证码、复杂交互、必须复用当前 Chrome/Edge 登录态：优先在 `browser-task-create` 里显式传 `--execution-backend opencli_bridge`
- 如果当前会话里同时存在 `$codingns-opencli`，只把它当成公开数据抓取兜底，不要拿它里面 browser-dependent 的站点命令替代 `office.browser.*`
- 订单、购物车、个人账户、后台页面、表单提交、下载文件、点击页面控件这类任务，即使 `codingns-opencli` 里有 `taobao/*`、`jd/*` 之类命令，也一律不要直接调用
- 本地预览、`localhost` / `127.0.0.1` / `::1` 页面检查、前端热更新验证：优先 Codex 自带 Browser
- 如果用户明确要求当前 in-app browser，也按用户要求走 Codex Browser

## 4. 什么时候优先用什么

- 需要看当前会话真实开放了哪些能力：优先 `capabilities list`
- 需要当前工作区终端：优先 `terminals create` / `terminals list`
- 需要打开网页、登录网站、抓页面、截图、点按钮、填表单、下载文件：优先 `office browser-task-create`
- 只有本地 `localhost` / `127.0.0.1` / `::1` 调试，才优先 Codex 自带 Browser
- 需要正式文档产物：优先 `office document-create`
- 需要 SSH 运维：优先 `office ops-target-create` 和 `office ops-ssh-task-create`
