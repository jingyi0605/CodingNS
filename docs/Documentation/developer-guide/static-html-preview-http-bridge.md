# 静态 HTML 预览文件服务：Preview HTTP Bridge

## 这篇文档解决什么问题

静态 HTML 工具页经常需要读写当前 workspace 里的文件：例如 Markdown 记录库、索引页、配置编辑器、报表工具。

正确入口是 **Preview HTTP Bridge**。它不是数据库，也不是任意文件系统后门。它是给 `/preview/files/<token>/...` 静态 HTML 预览页使用的工作区文件服务标准接口。

一句话：**静态 HTML 预览页读写当前 workspace 文件，优先走 Preview HTTP Bridge；桌面原生动作才走 Tauri / Desktop Bridge。**

---

## 两种 Bridge 的边界

CodingNS 现在有两条桥接链路，它们并行存在，但用途不同。

| 能力 | Preview HTTP Bridge | Tauri / Desktop Bridge |
| --- | --- | --- |
| 定位 | 静态 HTML 预览文件桥 | 桌面集成桥 |
| 通信方式 | `fetch('/preview/workspace-bridge/...')` | `postMessage` 到桌面预览宿主页 |
| 主要用途 | 读写当前 workspace 文件 | 打开文件、定位文件、选择目录、桌面原生能力 |
| 是否依赖 macOS WebView 父页响应 | 否 | 是 |
| 失败形态 | HTTP 状态码 + JSON 错误 | 可能沉默超时 |
| 推荐场景 | Markdown 库、配置页、索引页、静态工具 | Finder / Explorer、系统对话框、桌面动作 |

别混用边界：

- **文件服务能力**：优先 Preview HTTP Bridge。
- **桌面原生能力**：使用 `CodingNSDesktop` 或 `CodingNSWorkspace.openWorkspaceFile/revealWorkspaceFile` 包装入口。

---

## 推荐优先级

静态 HTML 页面启动时按这个顺序判断：

```text
如果当前 URL 是 /preview/files/<token>/...
  直接使用 Preview HTTP Bridge
否则如果宿主已经注入 window.CodingNSWorkspace
  使用宿主注入的 workspace bridge
否则
  提示用户当前环境不支持直接读写 workspace 文件
```

不要在 `/preview/files/<token>/...` 页面里先等 Tauri `postMessage` 超时，再回退 HTTP。那是坏味道，会把页面首屏加载硬拖慢几秒。

---

## URL 与授权模型

静态 HTML 预览 URL 形态：

```text
http://<host>/preview/files/<previewToken>/Tools/example.html?_preview=0&_cns_parent_origin=tauri%3A%2F%2Flocalhost
```

其中 `<previewToken>` 绑定：

- `workspaceId`
- 过期时间
- 签名

Preview HTTP Bridge 使用这个 token 授权，不需要 Bearer token。

安全规则：

- token 只能访问它绑定的 workspace。
- 页面只能传 workspace 相对路径。
- Host 必须拒绝路径穿越。
- Host 必须拒绝 workspace 外路径。
- token 过期后必须重新打开预览。

---

## HTTP API

所有接口都挂在：

```text
/preview/workspace-bridge/*?token=<previewToken>
```

### capabilities

```http
GET /preview/workspace-bridge/capabilities?token=<previewToken>
```

返回：

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

### list-dir

```http
POST /preview/workspace-bridge/list-dir?token=<previewToken>
Content-Type: application/json

{
  "path": "重要信息/会员信息",
  "options": {
    "includeHidden": true,
    "kind": "file"
  }
}
```

返回：

```json
{
  "path": "重要信息/会员信息",
  "items": [
    {
      "name": "ChatGPT Plus.md",
      "path": "重要信息/会员信息/ChatGPT Plus.md",
      "kind": "file",
      "size": 512,
      "mtime": 1779500000000,
      "hidden": false
    }
  ]
}
```

### read-text

```http
POST /preview/workspace-bridge/read-text?token=<previewToken>
Content-Type: application/json

{
  "path": "重要信息/会员信息/ChatGPT Plus.md"
}
```

### read-texts

```http
POST /preview/workspace-bridge/read-texts?token=<previewToken>
Content-Type: application/json

{
  "paths": [
    "重要信息/会员信息/ChatGPT Plus.md",
    "重要信息/会员信息/Infuse.md"
  ]
}
```

批量读 Markdown 时优先用 `read-texts`，不要在页面里循环打几十个 `read-text`。

### write-text

```http
POST /preview/workspace-bridge/write-text?token=<previewToken>
Content-Type: application/json

{
  "path": "重要信息/会员信息/.会员索引.json",
  "content": "{\n  \"files\": []\n}\n",
  "options": {
    "createIfMissing": true,
    "overwrite": true,
    "ifMtime": 1779500000000
  }
}
```

`ifMtime` 用于乐观并发控制。编辑已有记录时建议带上，避免覆盖用户在外部编辑器里的修改。

### delete-file

```http
POST /preview/workspace-bridge/delete-file?token=<previewToken>
Content-Type: application/json

{
  "path": "重要信息/会员信息/旧记录.md",
  "options": {
    "ifMtime": 1779500000000
  }
}
```

### stat / exists

```http
GET /preview/workspace-bridge/stat?token=<previewToken>&path=重要信息/会员信息/ChatGPT%20Plus.md
GET /preview/workspace-bridge/exists?token=<previewToken>&path=重要信息/会员信息/ChatGPT%20Plus.md
```

### watch-dir

```http
POST /preview/workspace-bridge/watch-dir?token=<previewToken>
Content-Type: application/json

{
  "path": "重要信息/会员信息",
  "options": {
    "includeHidden": true
  }
}
```

注意：静态 HTML 页面可以使用平台封装后的 `CodingNSWorkspace.watchDir(...)`。如果页面自己裸调 HTTP，轮询 watch events 的实现也必须遵循 Host 当前返回格式，不要私自发明协议。

---

## 推荐页面封装

静态 HTML 页面不应该到处散落 `fetch`。封装成一个 workspace bridge 对象：

```js
function readPreviewTokenFromUrl() {
  const url = new URL(location.href);
  const prefix = "/preview/files/";
  if (!url.pathname.startsWith(prefix)) return "";
  return url.pathname.slice(prefix.length).split("/")[0] || "";
}

function createPreviewHttpWorkspaceBridge() {
  const token = readPreviewTokenFromUrl();
  if (!token) return null;

  async function request(path, body) {
    const url = new URL(`/preview/workspace-bridge/${path}`, location.origin);
    url.searchParams.set("token", token);
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || `HTTP ${response.status}`);
    }
    return data;
  }

  return {
    capabilities: () => request("capabilities"),
    listDir: (path, options = {}) => request("list-dir", { path, options }),
    readText: path => request("read-text", { path }),
    readTexts: paths => request("read-texts", { paths }),
    writeText: (path, content, options = {}) => request("write-text", { path, content, options }),
    deleteFile: (path, options = {}) => request("delete-file", { path, options })
  };
}

const workspace = createPreviewHttpWorkspaceBridge() || window.CodingNSWorkspace;
```

平台 runtime 最好统一暴露 `window.CodingNSWorkspace`。实现细节可以是 HTTP，也可以是 Tauri，但业务页只应该面对统一对象。

---

## Markdown 文档库的标准做法

如果工具页管理的是 Markdown 文档库，规则很简单：

```text
MD 文件是唯一事实源。
索引 JSON 只能是缓存。
```

推荐流程：

1. `listDir(basePath, { includeHidden: true, kind: "file" })`
2. 过滤 `.md`
3. `readTexts(paths)`
4. 解析 MD 并渲染
5. 新增/编辑/删除时直接写对应 `.md`
6. 成功后重建 `.index.json` 之类的缓存
7. 外部改动通过 `watchDir` 或手动刷新重新扫描 MD

不要让 `.json` 成为主数据源。文档库不是数据库。

---

## 错误处理与调试

页面内建议记录这些字段：

- 当前 URL
- preview token 是否存在
- 使用的 transport：`preview-http` / `tauri-post-message`
- 每个请求的 action、URL、HTTP status、错误 detail
- 当前记录数
- 最近一次失败文件路径

错误时不要只显示“请求失败”。至少显示：

```text
HTTP status
error_code
detail
path
```

Tauri Bridge 的典型坏失败是“等待宿主响应超时”；HTTP Bridge 的优势就是能给出明确状态码和后端错误。

---

## 什么时候仍然需要 Tauri / Desktop Bridge

下面这些仍然是桌面桥的职责：

- 打开本地文件
- 在 Finder / Explorer 定位文件
- 选择本地目录
- 调用系统剪贴板或通知
- 需要桌面端 UI 参与的交互

对于当前 workspace 文件，业务页仍然不要自己拼绝对路径。正确入口是：

```js
await CodingNSWorkspace.openWorkspaceFile("content/demo.md");
await CodingNSWorkspace.revealWorkspaceFile("content/demo.md");
```

Host 先校验 workspace 相对路径，再交给桌面壳执行。

---

## 实现入口

维护这套能力时先看这些文件：

### Host

- `apps/host/src/modules/file/file-preview-link-service.ts`
- `apps/host/src/modules/file/file-controller.ts`
- `apps/host/src/modules/file/workspace-file-bridge-service.ts`
- `apps/host/src/routes/files.ts`

### Runtime / 桌面预览桥

- `apps/host/src/modules/file/runtime/codingns-workspace-bridge.js`
- `apps/user-app/src/platform/preview/html-preview-workspace-bridge.ts`

---

## 一句话总结

Preview HTTP Bridge 是静态 HTML 预览页的标准文件服务入口；Tauri / Desktop Bridge 是桌面集成入口。读写当前 workspace 文件走 HTTP，打开/定位/选择这类桌面动作走桌面桥。边界别搞反。
