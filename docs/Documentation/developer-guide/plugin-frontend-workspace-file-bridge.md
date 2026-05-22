# 插件前端如何使用工作区文件桥与桌面包装接口

## 先把话说死

如果你在做 CodingNS 插件前端，尤其是静态 HTML 前端，不要自己再发明一套文件访问协议。

平台已经给了两层现成能力：

- `CodingNSWorkspace`：管 **当前 workspace 范围内** 的文件能力
- `CodingNSDesktop`：管 **桌面壳动作**

正确做法不是二选一，而是按边界用：

- **工作区文件相关**：优先走 `CodingNSWorkspace`
- **打开文件、在系统里定位文件**：优先走 `CodingNSWorkspace` 的包装方法
- **选择本地目录这种系统级动作**：才直接走 `CodingNSDesktop`

别在插件里手写绝对路径，别拼私有 HTTP，别复制一套 Host 校验逻辑。那都是烂路子。

---

## 两个对象分别该干什么

### `CodingNSWorkspace`

它面向的是“这个插件当前所在 workspace 里有什么文件，我要怎么安全地读写它们”。

适合它的事情：

- 列目录
- 读 Markdown / JSON / TXT
- 写配置文件
- 删除工作区文件
- 监听目录变化
- 按 workspace 相对路径打开文件
- 按 workspace 相对路径在文件管理器里定位文件

### `CodingNSDesktop`

它面向的是“桌面系统帮我做一个本地动作”。

适合它的事情：

- 选择本地目录
- 直接打开一个已经拿到的绝对路径
- 在文件管理器里定位一个已经拿到的绝对路径

但插件前端通常**不该自己去拿绝对路径**。所以大多数文件场景都应该先走 `CodingNSWorkspace`。

---

## 最常见的正确用法

### 1) 读当前 workspace 下的文件

```js
const members = await window.CodingNSWorkspace.readTexts([
  "content/articles/a.md",
  "content/articles/b.md"
])
```

### 2) 打开某个工作区文件

```js
await window.CodingNSWorkspace.openWorkspaceFile("content/articles/a.md")
```

不要自己这样搞：

```js
await window.CodingNSDesktop.fs.openFile("/Users/xxx/WorkFile/demo/A.md")
```

原因很简单：你插件前端不该自己决定绝对路径，也不该自己跳过 Host 的工作区边界校验。

### 3) 在系统里定位某个工作区文件

```js
await window.CodingNSWorkspace.revealWorkspaceFile("content/articles/a.md")
```

### 4) 需要系统目录选择器时再走 `CodingNSDesktop`

```js
const picked = await window.CodingNSDesktop?.fs.pickDirectory()
```

这个能力是系统动作，不是工作区文件桥的一部分，所以别硬塞回 `CodingNSWorkspace`。

---

## 推荐决策表

| 场景 | 用什么 |
| --- | --- |
| 读取当前 workspace 文件 | `CodingNSWorkspace.readText/readTexts` |
| 列当前 workspace 目录 | `CodingNSWorkspace.listDir` |
| 写当前 workspace 文件 | `CodingNSWorkspace.writeText` |
| 删除当前 workspace 文件 | `CodingNSWorkspace.deleteFile` |
| 监听当前 workspace 目录 | `CodingNSWorkspace.watchDir` |
| 打开当前 workspace 文件 | `CodingNSWorkspace.openWorkspaceFile` |
| 在文件管理器中定位当前 workspace 文件 | `CodingNSWorkspace.revealWorkspaceFile` |
| 让用户挑一个本地目录 | `CodingNSDesktop.fs.pickDirectory` |

---

## 为什么要这么分

因为这是最不容易烂掉的分层。

### `CodingNSWorkspace` 负责统一输入

业务前端只关心：

- `docs/readme.md`
- `tools/report-viewer.html`
- `content/articles/a.md`

也就是 **workspace-relative path**。

### Host 负责安全校验

Host 会做这些事：

- 拒绝 `..`
- 拒绝跨 workspace
- 拒绝目录假装文件
- 拒绝不存在目标
- 把相对路径安全解析成绝对路径

### `CodingNSDesktop` 负责最后一步执行

真正打开本地文件、定位文件，是桌面壳的事，不是工作区桥自己去乱做。

这三层分开，代码才有品味。全糊成一团，后面就全是特殊情况。

---

## 插件前端示例

下面这个例子是插件前端里一个典型“资料列表 + 打开原文件 + 定位原文件”的写法。

```html
<script>
async function loadDocs() {
  const result = await window.CodingNSWorkspace.listDir("content/articles", {
    includeHidden: true,
    kind: "file"
  });

  return result.items.filter((item) => item.path.endsWith(".md"));
}

async function openDoc(relativePath) {
  await window.CodingNSWorkspace.openWorkspaceFile(relativePath);
}

async function revealDoc(relativePath) {
  await window.CodingNSWorkspace.revealWorkspaceFile(relativePath);
}
</script>
```

如果你还要监听外部编辑器改动：

```html
<script>
let watchHandle = null;

async function startWatch(reload) {
  watchHandle = await window.CodingNSWorkspace.watchDir(
    "content/articles",
    { includeHidden: true },
    async () => {
      await reload();
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

## 明确禁止的写法

### 1) 插件前端自己拼绝对路径

```js
const absolutePath = "/Users/jackson/..."
await window.CodingNSDesktop.fs.openFile(absolutePath)
```

垃圾。  
这等于绕开工作区边界。

### 2) 插件前端自己拼 Host 私有接口

```js
fetch("/api/some-private-endpoint", { ... })
```

垃圾。  
插件应该走平台暴露的标准桥，不要自己猜后端内部协议。

### 3) 把 `pickDirectory()` 塞进 `CodingNSWorkspace`

这也不对。  
选目录是系统动作，不是“当前 workspace 文件桥”。

---

## 和插件系统现有桌面能力的关系

插件系统本来就有“桌面打开文件 / 在文件管理器定位文件”的能力。  
这次不是推翻它，而是把口径统一清楚：

- 插件作者对“当前 workspace 文件”应该优先使用 `CodingNSWorkspace`
- `openWorkspaceFile()` / `revealWorkspaceFile()` 是上层包装
- 底层依然是：
  - Host 校验工作区路径
  - `CodingNSDesktop` 执行桌面动作

也就是说，**统一的是入口规则，不是物理上把对象硬合并。**

---

## 什么时候可以直接用 `CodingNSDesktop`

只有当事情本身就是桌面系统动作，而不是工作区文件动作时，才建议直接用它。

例如：

- 让用户选一个本地目录
- 纯桌面运行时信息查询

如果事情本质上是“操作当前 workspace 里的文件”，那还是先回到 `CodingNSWorkspace`。

---

## 开发时第一眼该看什么

### 文件桥文档

- [CodingNSWorkspace 工作区文件桥与桌面包装接口](/developer-guide/workspace-file-bridge-and-desktop-wrapper)

### 相关代码

- `apps/host/src/modules/file/workspace-file-bridge-service.ts`
- `apps/host/src/modules/file/runtime/codingns-workspace-bridge.js`
- `apps/user-app/src/platform/preview/html-preview-workspace-bridge.ts`
- `apps/user-app/src/platform/desktop/codingns-desktop-bridge.ts`

---

## 一句话结论

插件前端里，凡是“当前 workspace 文件”的事，优先走 `CodingNSWorkspace`；凡是“系统桌面动作”的事，才直接碰 `CodingNSDesktop`。打开和定位工作区文件也一样，走 `CodingNSWorkspace` 的包装接口，不要自己拼绝对路径。
