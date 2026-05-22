# CodingNSWorkspace 工作区文件桥与桌面包装接口

## 这篇文档解决什么问题

如果你在 CodingNS 里预览一个静态 HTML 页面，这个页面现在不只是“看看自己”。它可以通过 `window.CodingNSWorkspace` 去读写当前 workspace 里的文件。

这套接口的目标很简单：

- 页面只传 **workspace 相对路径**
- Host 负责做安全校验
- 页面只能碰当前 workspace 里的文件
- 需要打开本地文件或在文件管理器里定位时，先走 Host 校验，再委托桌面壳

别把它理解成“给 HTML 页开了宿主机文件系统后门”。不是这回事。它还是工作区沙箱里的正式接口。

---

## `CodingNSWorkspace` 和 `CodingNSDesktop` 的边界

这两个东西不是一回事。

### `CodingNSWorkspace`

它负责 **工作区范围内的标准文件能力**：

- 列目录
- 读文件
- 写文件
- 删文件
- 查状态
- 监听目录变化
- 按 workspace 相对路径包装桌面打开动作

它的输入统一是：

- `content/articles/demo.md`
- `tools/report-viewer.html`

也就是 **workspace-relative path**。

### `CodingNSDesktop`

它负责 **桌面壳动作**，比如：

- 打开本地文件
- 在 Finder / Explorer 里定位文件
- 选择本地目录

它接收的是桌面侧要执行的参数，典型就是绝对路径。

### 两者怎么配合

新增的：

- `CodingNSWorkspace.openWorkspaceFile(relativePath)`
- `CodingNSWorkspace.revealWorkspaceFile(relativePath)`

不是把 `CodingNSDesktop` 并进来，而是在 `CodingNSWorkspace` 上包一层统一入口：

1. HTML / 插件只传 workspace 相对路径
2. Host 先校验路径是不是当前 workspace 内的真实文件
3. Host 返回已校验的绝对路径
4. 预览宿主页再调用 `CodingNSDesktop`

这样做的好处是：**业务侧始终只面对工作区路径，桌面壳细节被收口到平台层。**

---

## 适用场景

这套接口适合下面这些静态 HTML 或插件前端：

- Markdown 索引页
- 本地知识库检索页
- 目录浏览器
- 静态报表页
- 配置编辑页
- 需要“打开原文件”“在系统里定位文件”的本地工具页

不适合的场景也要说清：

- 不是跨 workspace 文件访问接口
- 不是任意绝对路径访问接口
- 不是系统级文件对话框替代品
- 不是把 `.json` 缓存当数据库的借口

---

## 可用接口总览

当前 `window.CodingNSWorkspace` 暴露这些方法：

```js
window.CodingNSWorkspace = {
  capabilities,
  requestPermission,
  listDir,
  readText,
  readTexts,
  writeText,
  writeTexts,
  deleteFile,
  stat,
  exists,
  watchDir,
  unwatch,
  openWorkspaceFile,
  revealWorkspaceFile
}
```

其中：

- `writeTexts` 现在还没正式实现
- `openWorkspaceFile` 和 `revealWorkspaceFile` 是新加的桌面包装接口

---

## 路径规则

页面侧只传 workspace 相对路径，不传绝对路径。

### 正确示例

```js
"content/articles/demo.md"
"tools/report-viewer.html"
".index.json"
```

### 错误示例

```js
"/Users/jackson/WorkFile/demo/readme.md"
"../secret.txt"
"C:\\Users\\jackson\\Desktop\\a.txt"
```

平台会拒绝这些越界路径。

---

## 核心接口说明

### 1) `capabilities()`

看当前运行环境支持什么。

```js
const caps = await CodingNSWorkspace.capabilities()
```

返回示例：

```json
{
  "read": true,
  "write": true,
  "delete": true,
  "watch": true,
  "batchRead": true,
  "batchWrite": false,
  "workspaceRootAccessible": true
}
```

---

### 2) `listDir(relativePath, options?)`

读取目录内容。

```js
const result = await CodingNSWorkspace.listDir("content/articles", {
  includeHidden: true,
  kind: "file"
})
```

返回示例：

```json
{
  "path": "content/articles",
  "items": [
    {
      "name": "demo.md",
      "path": "content/articles/demo.md",
      "kind": "file",
      "size": 194,
      "mtime": 1747815060000,
      "hidden": false
    }
  ]
}
```

---

### 3) `readText(relativePath)`

读取单个 UTF-8 文本文件。

```js
const file = await CodingNSWorkspace.readText("content/articles/demo.md")
```

---

### 4) `readTexts(relativePaths)`

批量读取多个文件。适合一口气读几十个 Markdown，别自己在页面里循环打一百次请求。

```js
const batch = await CodingNSWorkspace.readTexts([
  "content/articles/a.md",
  "content/articles/b.md"
])
```

单个失败不会拖死整批结果。

---

### 5) `writeText(relativePath, content, options?)`

写入单个文本文件。

```js
await CodingNSWorkspace.writeText(
  "content/articles/new-note.md",
  "# 新文档\\n\\n标题：新文档\\n",
  {
    createIfMissing: true,
    overwrite: true,
    ensureParentDir: true
  }
)
```

支持：

- 新建文件
- 覆盖文件
- `ifMtime` 冲突保护
- 原子写入

---

### 6) `deleteFile(relativePath, options?)`

删除单个文件。

```js
await CodingNSWorkspace.deleteFile("content/articles/old-note.md")
```

---

### 7) `stat(relativePath)` / `exists(relativePath)`

查状态和判断存在性。

```js
const stat = await CodingNSWorkspace.stat("content/articles/demo.md")
const exists = await CodingNSWorkspace.exists("content/articles/demo.md")
```

---

### 8) `watchDir(relativePath, options?, callback?)`

监听目录变化。

```js
const handle = await CodingNSWorkspace.watchDir(
  "content/articles",
  { includeHidden: true },
  (event) => {
    console.log("目录有变化", event)
  }
)
```

返回的 `handle` 至少有：

```js
{
  watchId,
  unsubscribe()
}
```

取消监听：

```js
await handle.unsubscribe()
// 或
await CodingNSWorkspace.unwatch(handle)
// 或
await CodingNSWorkspace.unwatch(handle.watchId)
```

事件示例：

```json
{
  "seq": 3,
  "type": "changed",
  "path": "content/articles/demo.md",
  "kind": "file",
  "mtime": 1747835800000
}
```

---

## 新增桌面包装接口

这部分是本次新增。

### 9) `openWorkspaceFile(relativePath)`

按 workspace 相对路径打开本地文件。

```js
await CodingNSWorkspace.openWorkspaceFile("content/articles/demo.md")
```

返回示例：

```json
{
  "workspaceId": "workspace_xxx",
  "relativePath": "content/articles/demo.md",
  "absolutePath": "/Users/jackson/WorkFile/.../content/articles/demo.md"
}
```

注意两点：

1. 页面传入的仍然只能是相对路径
2. `absolutePath` 是 Host 校验后的执行结果，不是让业务侧倒过来继续拿它到处乱用

### 10) `revealWorkspaceFile(relativePath)`

在系统文件管理器里定位该文件。

```js
await CodingNSWorkspace.revealWorkspaceFile("content/articles/demo.md")
```

返回结构和 `openWorkspaceFile()` 一样。

---

## Host 侧执行顺序

`openWorkspaceFile()` / `revealWorkspaceFile()` 的执行顺序固定是：

1. 页面传 `relativePath`
2. Host 调 `FileAccessGuard.resolvePath(...)`
3. 确认：
   - 路径合法
   - 没有 `..` 逃逸
   - 文件存在
   - 目标确实是 file，不是 directory
4. Host 产出：
   - `workspaceId`
   - `relativePath`
   - `absolutePath`
5. 预览宿主页调用 `CodingNSDesktop.fs.openFile(...)` 或 `revealInFileManager(...)`

这层包装的意义就在这里：**安全校验先发生，桌面动作后发生。**

---

## 错误码

常见错误码包括：

- `INVALID_PATH`
- `PATH_TRAVERSAL_BLOCKED`
- `PATH_OUT_OF_WORKSPACE`
- `FILE_NOT_FOUND`
- `DIRECTORY_NOT_FOUND`
- `NOT_A_FILE`
- `NOT_A_DIRECTORY`
- `PERMISSION_DENIED`
- `CONFLICT`
- `UNSUPPORTED_ENCODING`
- `WRITE_FAILED`
- `DELETE_FAILED`
- `WATCH_NOT_FOUND`
- `WATCH_NOT_SUPPORTED`
- `DESKTOP_OPEN_UNAVAILABLE`
- `DESKTOP_REVEAL_UNAVAILABLE`
- `INTERNAL_ERROR`

错误对象形状：

```json
{
  "code": "FILE_NOT_FOUND",
  "message": "文件不存在",
  "path": "content/articles/missing.md"
}
```

---

## 安全边界

这部分别偷懒，规则很硬。

### 只允许当前 workspace

- 不允许跨 workspace
- 不允许绝对路径直传
- 不允许 `..` 逃逸
- 不允许借符号链接绕出去

### 打开 / 定位文件前必须先过 Host

页面不能自己拼绝对路径然后直接调桌面壳。

正确做法是：

```js
await CodingNSWorkspace.openWorkspaceFile("docs/readme.md")
```

不要这样：

```js
await window.CodingNSDesktop.fs.openFile("/Users/xxx/secret.txt")
```

### iframe 桥接不会用 `targetOrigin="*"`

预览页和宿主页之间的消息桥接会校验来源，不允许用 `*` 乱发。

---

## 给静态 HTML 页的接入示例

### 读目录 + 批量读 Markdown

```html
<script>
async function loadMembers() {
  const dir = await window.CodingNSWorkspace.listDir("content/articles", {
    includeHidden: true,
    kind: "file"
  });

  const mdPaths = dir.items
    .filter((item) => item.path.endsWith(".md"))
    .map((item) => item.path);

  const batch = await window.CodingNSWorkspace.readTexts(mdPaths);
  const files = batch.items.filter((item) => !item.error);

  return files.map((item) => ({
    path: item.path,
    content: item.content,
    mtime: item.mtime
  }));
}
</script>
```

### 打开原文件 / 定位文件

```html
<script>
async function openSourceFile(relativePath) {
  try {
    await window.CodingNSWorkspace.openWorkspaceFile(relativePath);
  } catch (error) {
    alert(error.message || "打开文件失败");
  }
}

async function revealSourceFile(relativePath) {
  try {
    await window.CodingNSWorkspace.revealWorkspaceFile(relativePath);
  } catch (error) {
    alert(error.message || "定位文件失败");
  }
}
</script>
```

### 监听外部修改

```html
<script>
let watchHandle = null;

async function startWatch() {
  watchHandle = await window.CodingNSWorkspace.watchDir(
    "content/articles",
    { includeHidden: true },
    async (event) => {
      if (!event.path.endsWith(".md") && !event.path.endsWith(".json")) {
        return;
      }
      await reloadMembers();
    }
  );
}

async function stopWatch() {
  if (watchHandle) {
    await watchHandle.unsubscribe();
    watchHandle = null;
  }
}
</script>
```

---

## 给本地文档工具的建议接法

这类页面如果以 Markdown 为主数据源，推荐保持“文件是真源，索引只是缓存”的做法。

推荐流程：

1. `listDir("content/articles")`
2. 过滤所有 `.md`
3. `readTexts(...)`
4. 解析记录并渲染
5. 需要打开原文时调 `openWorkspaceFile(path)`
6. 需要在 Finder / Explorer 里找源文件时调 `revealWorkspaceFile(path)`
7. 用 `watchDir(...)` 监听外部改动，自动重载

`.index.json` 这类文件只能当缓存，不是主数据源。

---

## 给插件作者的建议

如果你做的是 CodingNS 插件前端，口径也应该一致：

- 对工作区文件操作，优先使用工作区范围接口
- 需要桌面动作时，仍然先走“相对路径 -> Host 校验 -> 桌面壳”
- 不要在插件里自己复制一套绝对路径逻辑

换句话说，**统一管理的是入口规则，不是把所有能力揉成一个对象。**

---

## 当前范围内明确不做什么

这次接口故意没做下面这些事：

- 不接受绝对路径作为页面输入
- 不提供跨 workspace 文件访问
- 不把 `pickDirectory()` 塞进 `CodingNSWorkspace`
- 不把 `.json` 缓存提升为真数据源
- 不承诺 `writeTexts()` 已可用

这些不做，不是偷懒，是为了别把边界做烂。

---

## 开发者落地时先看哪里

如果你要继续维护这套能力，先看这几层：

### Host

- `apps/host/src/modules/file/workspace-file-bridge-service.ts`
- `apps/host/src/modules/file/workspace-file-bridge-watch-service.ts`
- `apps/host/src/modules/file/file-controller.ts`
- `apps/host/src/routes/files.ts`

### HTML 预览桥

- `apps/host/src/modules/file/runtime/codingns-workspace-bridge.js`
- `apps/user-app/src/platform/preview/codingns-workspace-bridge.ts`
- `apps/user-app/src/platform/preview/html-preview-workspace-bridge.ts`

### 桌面桥

- `apps/user-app/src/platform/desktop/codingns-desktop-bridge.ts`

---

## 一句话总结

`CodingNSWorkspace` 现在既能管工作区文件读写监听，也能用 **workspace 相对路径** 包一层“打开本地文件 / 在文件管理器里定位文件”的标准入口，但最终的安全边界仍然在 Host，而不是交给 HTML 页面自己乱来。
