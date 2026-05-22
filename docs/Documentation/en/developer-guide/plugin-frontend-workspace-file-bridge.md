# How Plugin Frontends Should Use the Workspace File Bridge and Desktop Wrapper

## The short version first

If you are building a CodingNS plugin frontend, especially a static HTML frontend, do not invent another file access protocol.

The platform already gives you two layers:

- `CodingNSWorkspace`: for **workspace-scoped file capabilities**
- `CodingNSDesktop`: for **desktop shell actions**

The correct rule is not “pick one forever”. It is:

- **workspace file work**: use `CodingNSWorkspace` first
- **open file / reveal file in the system**: still prefer the `CodingNSWorkspace` wrapper methods
- **system-level actions such as picking a local directory**: use `CodingNSDesktop` directly

Do not hardcode absolute paths in plugin code. Do not guess private Host APIs. Do not clone Host validation logic in the frontend.

---

## What each object should own

### `CodingNSWorkspace`

It is for “what files exist inside this plugin’s current workspace, and how do I read or write them safely”.

Good uses:

- list directories
- read Markdown / JSON / TXT
- write configuration files
- delete workspace files
- watch directory changes
- open a file by workspace-relative path
- reveal a file in the file manager by workspace-relative path

### `CodingNSDesktop`

It is for “ask the desktop system to do a local action”.

Good uses:

- pick a local directory
- open an absolute path that you already have for a valid reason
- reveal an absolute path that you already have for a valid reason

But plugin frontends usually **should not create or own absolute paths by themselves**. That is why most file-related cases should start from `CodingNSWorkspace`.

---

## The most common correct usage

### 1) Read files inside the current workspace

```js
const documents = await window.CodingNSWorkspace.readTexts([
  "content/articles/a.md",
  "content/articles/b.md"
])
```

### 2) Open a workspace file

```js
await window.CodingNSWorkspace.openWorkspaceFile("content/articles/a.md")
```

Do not do this:

```js
await window.CodingNSDesktop.fs.openFile("/Users/xxx/WorkFile/demo/A.md")
```

The reason is simple: the plugin frontend should not decide absolute paths by itself, and it should not skip Host workspace-boundary validation.

### 3) Reveal a workspace file in the system file manager

```js
await window.CodingNSWorkspace.revealWorkspaceFile("content/articles/a.md")
```

### 4) Use `CodingNSDesktop` only when the action is really system-level

```js
const picked = await window.CodingNSDesktop?.fs.pickDirectory()
```

That is a system action, not part of the workspace file bridge. Do not push it into `CodingNSWorkspace`.

---

## Recommended decision table

| Scenario | Use this |
| --- | --- |
| Read files in the current workspace | `CodingNSWorkspace.readText/readTexts` |
| List a directory in the current workspace | `CodingNSWorkspace.listDir` |
| Write a file in the current workspace | `CodingNSWorkspace.writeText` |
| Delete a file in the current workspace | `CodingNSWorkspace.deleteFile` |
| Watch a directory in the current workspace | `CodingNSWorkspace.watchDir` |
| Open a file in the current workspace | `CodingNSWorkspace.openWorkspaceFile` |
| Reveal a file in the file manager | `CodingNSWorkspace.revealWorkspaceFile` |
| Ask the user to pick a local directory | `CodingNSDesktop.fs.pickDirectory` |

---

## Why the split matters

Because this is the least fragile split.

### `CodingNSWorkspace` standardizes the input

Business code should only care about paths like:

- `docs/readme.md`
- `tools/report-viewer.html`
- `content/articles/a.md`

That means **workspace-relative paths**.

### The Host owns security validation

The Host is responsible for:

- rejecting `..`
- rejecting cross-workspace access
- rejecting directories pretending to be files
- rejecting missing targets
- safely resolving relative paths into absolute paths

### `CodingNSDesktop` owns the last execution step

Actually opening or revealing a local file is the desktop shell’s job, not the workspace bridge’s job.

Keep these three layers separate and the code stays clean. Smash them together and you get endless special cases.

---

## Example for a plugin frontend

This is a typical pattern for “list documents + open source file + reveal source file”.

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

If you also need to reload on external editor changes:

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

## Explicitly bad patterns

### 1) Building absolute paths in the plugin frontend

```js
const absolutePath = "/Users/jackson/..."
await window.CodingNSDesktop.fs.openFile(absolutePath)
```

Bad idea.  
That is basically a workspace-boundary bypass.

### 2) Calling guessed private Host APIs from the plugin frontend

```js
fetch("/api/some-private-endpoint", { ... })
```

Also bad.  
Plugin code should use the platform’s standard bridge, not reverse-engineer backend internals.

### 3) Shoving `pickDirectory()` into `CodingNSWorkspace`

That is also wrong.  
Picking a directory is a system action, not a workspace file bridge action.

---

## How this relates to the existing plugin desktop capability

The plugin system already has “open file on desktop” and “reveal in file manager” capabilities.  
This change does not replace them. It clarifies the rule:

- for files inside the current workspace, plugin authors should prefer `CodingNSWorkspace`
- `openWorkspaceFile()` and `revealWorkspaceFile()` are the higher-level wrappers
- the lower-level flow is still:
  - Host validates the workspace path
  - `CodingNSDesktop` executes the desktop action

In other words, **what gets unified is the entry rule, not the physical object model.**

---

## When direct `CodingNSDesktop` usage is acceptable

Only use it directly when the action is really a desktop-system action, not a workspace-file action.

Examples:

- ask the user to pick a local directory
- query desktop runtime information

If the real task is “operate on files inside the current workspace”, go back to `CodingNSWorkspace`.

---

## What maintainers should read first

### File bridge document

- [CodingNSWorkspace Workspace File Bridge and Desktop Wrapper](/en/developer-guide/workspace-file-bridge-and-desktop-wrapper)

### Relevant code

- `apps/host/src/modules/file/workspace-file-bridge-service.ts`
- `apps/host/src/modules/file/runtime/codingns-workspace-bridge.js`
- `apps/user-app/src/platform/preview/html-preview-workspace-bridge.ts`
- `apps/user-app/src/platform/desktop/codingns-desktop-bridge.ts`

---

## One-sentence conclusion

Inside a plugin frontend, whenever the task is about files in the current workspace, start from `CodingNSWorkspace`; whenever the task is really a desktop-system action, use `CodingNSDesktop` directly. Opening or revealing workspace files still belongs to the `CodingNSWorkspace` wrapper methods, not hand-built absolute-path calls.
