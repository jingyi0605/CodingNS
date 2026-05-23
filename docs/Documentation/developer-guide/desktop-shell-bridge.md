# CodingNSDesktop 桌面壳能力接口规范

## 一句话边界

`CodingNSDesktop` 只管**当前客户端桌面环境**里的系统动作：打开本地文件、在文件管理器中定位、选择本地目录、读取平台信息。

它不等于 Host 文件桥，也不保存业务配置。页面如果要做“客户端本地镜像资料库”，正确模型是：

1. 用户在当前客户端选择本地镜像根目录
2. 页面把镜像根目录保存到当前浏览器的 `localStorage` 或自己的配置里
3. 页面用索引里的安全相对路径拼出客户端本地绝对路径
4. 页面调用 `CodingNSDesktop.fs.openFile()` 或 `revealInFileManager()`

Host 不应该替你猜客户端本地镜像根目录。HTML 运行在 Host 预览 URL 下，不代表它要拿 Host 的绝对路径去打开客户端文件。

---

## 和 `CodingNSWorkspace` 的分工

| 场景 | 标准入口 | 路径含义 |
| --- | --- | --- |
| 读写当前 workspace 文件 | `CodingNSWorkspace.readText/writeText/listDir/...` | workspace 相对路径 |
| 打开当前 workspace 内的真实文件 | `CodingNSWorkspace.openWorkspaceFile(relativePath)` | workspace 相对路径，Host 校验后执行 |
| 在文件管理器中定位当前 workspace 文件 | `CodingNSWorkspace.revealWorkspaceFile(relativePath)` | workspace 相对路径，Host 校验后执行 |
| 选择客户端本地镜像根目录 | `CodingNSDesktop.fs.pickDirectory()` | 客户端本地目录 |
| 打开客户端本地镜像文件 | `CodingNSDesktop.fs.openFile(absolutePath)` | 客户端本地绝对路径 |
| 定位客户端本地镜像文件 | `CodingNSDesktop.fs.revealInFileManager(absolutePath)` | 客户端本地绝对路径 |
| 获取桌面平台信息 | `CodingNSDesktop.runtime.getPlatformInfo()` | 无路径 |

不要把这两类路径混在一起：

- workspace 相对路径属于 Host 工作区边界
- 客户端本地镜像绝对路径属于当前桌面客户端边界

---

## 全局对象接口

桌面壳能力通过全局对象暴露：

```ts
interface CodingNSDesktopBridge {
  runtime: {
    isAvailable(): boolean;
    getPlatformInfo(): Promise<DesktopBridgeResult<DesktopPlatformInfo>>;
  };
  fs: {
    openFile(path: string): Promise<DesktopBridgeResult<void>>;
    revealInFileManager(path: string): Promise<DesktopBridgeResult<void>>;
    pickDirectory(): Promise<DesktopBridgeResult<string | null>>;
  };
}

interface DesktopBridgeResult<T = void> {
  ok: boolean;
  value?: T;
  errorCode?: string;
  detail?: string;
}

interface DesktopPlatformInfo {
  platform: "macos" | "windows" | "linux" | "unknown";
  isDesktop: boolean;
  fileManager: "finder" | "explorer" | "xdg" | "unknown";
}
```

成功示例：

```json
{ "ok": true, "value": null }
```

平台信息示例：

```json
{
  "ok": true,
  "value": {
    "platform": "macos",
    "isDesktop": true,
    "fileManager": "finder"
  }
}
```

失败示例：

```json
{
  "ok": false,
  "errorCode": "FILE_NOT_FOUND",
  "detail": "目标路径不存在：/Users/demo/missing.pdf"
}
```

---

## 直接调用方式

如果当前页面能直接拿到 `window.CodingNSDesktop`，就直接调用：

```js
const desktop = window.CodingNSDesktop;

if (!desktop?.runtime?.isAvailable?.()) {
  throw new Error("当前环境没有可用的 CodingNSDesktop 桌面能力");
}

const platform = await desktop.runtime.getPlatformInfo();
const picked = await desktop.fs.pickDirectory();

if (picked.ok && picked.value) {
  const path = `${picked.value}/docs/readme.md`;
  await desktop.fs.openFile(path);
}
```

---

## 预览 iframe 中的中继调用方式

静态 HTML 通过文件预览打开时，常见 URL 形态是：

```text
http://<host>/preview/files/<token>/index.html?_preview=0&_cns_parent_origin=tauri%3A%2F%2Flocalhost
```

这里的关键点是 `_cns_parent_origin`。它告诉 iframe 子页面：桌面宿主页的 origin 是什么。不要依赖 `document.referrer`，很多场景 referrer 会为空。

当 iframe 子页没有直接注入 `window.CodingNSDesktop` 时，可以把请求中继给父页：

```js
const REQUEST_EVENT = "codingns-desktop-bridge-request";
const RESPONSE_EVENT = "codingns-desktop-bridge-response";

function getDesktopParentOrigin() {
  const currentUrl = new URL(window.location.href);
  return currentUrl.searchParams.get("_cns_parent_origin") || window.location.origin;
}

function invokeDesktopViaParent(command, args = {}) {
  const parentOrigin = getDesktopParentOrigin();
  const requestId = `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({
        ok: false,
        errorCode: "SHELL_BRIDGE_TIMEOUT",
        detail: "等待宿主页响应桌面 bridge 超时。",
      });
    }, 5000);

    function onMessage(event) {
      if (event.origin !== parentOrigin) return;
      const payload = event.data;
      if (!payload || payload.type !== RESPONSE_EVENT || payload.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(payload.result || {
        ok: false,
        errorCode: "SHELL_BRIDGE_ERROR",
        detail: "桌面 bridge 响应为空。",
      });
    }

    window.addEventListener("message", onMessage);
    window.parent.postMessage({
      type: REQUEST_EVENT,
      requestId,
      command,
      args,
    }, parentOrigin);
  });
}
```

当前父页支持的 `command`：

| command | 等价直接接口 | args |
| --- | --- | --- |
| `get_platform_info` | `CodingNSDesktop.runtime.getPlatformInfo()` | `{}` |
| `open_local_file` | `CodingNSDesktop.fs.openFile(path)` | `{ path: string }` |
| `reveal_in_file_manager` | `CodingNSDesktop.fs.revealInFileManager(path)` | `{ path: string }` |
| `pick_directory` | `CodingNSDesktop.fs.pickDirectory()` | `{}` |

---

## 推荐封装：先直连，失败再中继

业务页不要到处散落 `postMessage`。封一层就够：

```js
async function invokeDesktop(command, args = {}) {
  const desktop = window.CodingNSDesktop;

  if (desktop?.runtime?.isAvailable?.()) {
    if (command === "get_platform_info") return desktop.runtime.getPlatformInfo();
    if (command === "open_local_file") return desktop.fs.openFile(args.path);
    if (command === "reveal_in_file_manager") return desktop.fs.revealInFileManager(args.path);
    if (command === "pick_directory") return desktop.fs.pickDirectory();
  }

  if (window.parent && window.parent !== window) {
    return invokeDesktopViaParent(command, args);
  }

  return {
    ok: false,
    errorCode: "PLATFORM_NOT_SUPPORTED",
    detail: "当前环境不支持桌面壳能力。",
  };
}
```

---

## 客户端本地镜像资料库的正确写法

这类页面的路径来源不是 Host workspace 根目录，而是当前客户端本地目录。

```js
const SETTINGS_KEY = "docBrowserSettings";

function loadMirrorRoot() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}").mirrorRoot || "";
  } catch (_) {
    return "";
  }
}

function isSafeRelativePath(path) {
  const value = String(path || "").replace(/\\/g, "/");
  return !!value && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.split("/").includes("..");
}

function joinMirrorPath(root, relativePath) {
  if (!root) throw new Error("请先选择本地镜像根目录");
  if (!isSafeRelativePath(relativePath)) throw new Error("拒绝打开不安全的相对路径");
  return `${root.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
}

async function openMirrorFile(relativePath) {
  const absolutePath = joinMirrorPath(loadMirrorRoot(), relativePath);
  const result = await invokeDesktop("open_local_file", { path: absolutePath });
  if (!result.ok) throw new Error(result.detail || "打开本地文件失败");
}
```

这不是绕过 Host 工作区边界。它操作的是用户明确选择的**当前客户端本地镜像目录**。

---

## 安全规则

1. `CodingNSDesktop.fs.openFile()` 和 `revealInFileManager()` 只接受本地绝对路径。
2. 不接受 URL / scheme。
3. 目标路径必须存在。
4. 本地镜像页面必须只用安全相对路径拼接镜像根目录，拒绝 `..`、绝对路径、盘符路径逃逸。
5. 预览 iframe 中继必须使用 `_cns_parent_origin` 或可信来源，不能用 `targetOrigin="*"`。
6. Host workspace 路径和客户端本地镜像路径是两套边界，不要互相替代。

---

## 常见错误

### 1. 把客户端镜像根目录当成 Host 配置

错。镜像根目录是当前客户端自己的路径，应该保存在当前页面/客户端侧配置里。

### 2. 在 iframe 里只看 `document.referrer`

错。referrer 可能为空。预览 URL 已经带 `_cns_parent_origin`，应该优先读它。

### 3. 用 `CodingNSWorkspace` 打开客户端镜像文件

错。`CodingNSWorkspace` 面向 Host 当前 workspace。客户端镜像文件要走 `CodingNSDesktop`。

### 4. 对 workspace 文件自己拼绝对路径

也错。当前 workspace 文件应使用 `CodingNSWorkspace.openWorkspaceFile(relativePath)`，让 Host 先校验。
