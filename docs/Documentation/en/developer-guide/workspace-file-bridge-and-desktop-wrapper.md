# CodingNSWorkspace Workspace File Bridge and Desktop Wrapper

## What this document solves

When you preview a static HTML page in CodingNS, that page is no longer limited to reading itself. It can use `window.CodingNSWorkspace` to read and write files inside the current workspace.

The goal is simple:

- the page only passes **workspace-relative paths**
- the Host does the security validation
- the page only touches files inside the current workspace
- when a file must be opened locally or revealed in the file manager, Host validation still runs first and the desktop shell runs second

This is not a backdoor into the host machine file system. It is still a workspace-scoped platform interface.

---

## The boundary between `CodingNSWorkspace` and `CodingNSDesktop`

These two objects are not the same thing.

### `CodingNSWorkspace`

It owns **standard file capabilities inside the workspace scope**:

- list directories
- read files
- write files
- delete files
- inspect file state
- watch directory changes
- wrap desktop open/reveal actions with workspace-relative paths

Its input is always something like:

- `content/articles/demo.md`
- `tools/report-viewer.html`

That means **workspace-relative paths**, not machine paths.

### `CodingNSDesktop`

It owns **desktop shell actions**, such as:

- opening a local file
- revealing a file in Finder or Explorer
- picking a local directory

It receives desktop-side execution parameters, typically absolute paths.

### How they work together

The new methods are:

- `CodingNSWorkspace.openWorkspaceFile(relativePath)`
- `CodingNSWorkspace.revealWorkspaceFile(relativePath)`

This is not a merge of `CodingNSDesktop` into `CodingNSWorkspace`. It is a managed wrapper on top of `CodingNSWorkspace`:

1. the HTML page or plugin only passes a workspace-relative path
2. the Host validates that the path is a real file inside the current workspace
3. the Host returns a validated absolute path
4. the preview host page calls `CodingNSDesktop`

The benefit is straightforward: **business code only deals with workspace paths, while desktop shell details stay inside the platform layer.**

---

## Supported scenarios

This interface is a good fit for static HTML pages or plugin frontends such as:

- Markdown index pages
- local knowledge-base search pages
- directory browsers
- static report pages
- configuration editors
- local tools that need “open source file” or “reveal source file”

It is not meant to be:

- a cross-workspace file access interface
- an arbitrary absolute-path access interface
- a replacement for system-level file dialogs
- an excuse to treat `.json` cache files as the database

---

## Available API surface

`window.CodingNSWorkspace` currently exposes:

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

Notes:

- `writeTexts` is not implemented yet
- `openWorkspaceFile` and `revealWorkspaceFile` are the new desktop-wrapper methods

---

## Path rules

The page side only passes workspace-relative paths, never absolute paths.

### Valid examples

```js
"content/articles/demo.md"
"tools/report-viewer.html"
".index.json"
```

### Invalid examples

```js
"/Users/jackson/WorkFile/demo/readme.md"
"../secret.txt"
"C:\\Users\\jackson\\Desktop\\a.txt"
```

The platform rejects those invalid paths.

---

## Core API details

### 1) `capabilities()`

Check what the current runtime supports.

```js
const caps = await CodingNSWorkspace.capabilities()
```

Example result:

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

Read directory contents.

```js
const result = await CodingNSWorkspace.listDir("content/articles", {
  includeHidden: true,
  kind: "file"
})
```

Example result:

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

Read a single UTF-8 text file.

```js
const file = await CodingNSWorkspace.readText("content/articles/demo.md")
```

---

### 4) `readTexts(relativePaths)`

Read multiple files in one call. Use this for dozens of Markdown files instead of hammering the bridge one request at a time.

```js
const batch = await CodingNSWorkspace.readTexts([
  "content/articles/a.md",
  "content/articles/b.md"
])
```

One failure does not kill the whole batch.

---

### 5) `writeText(relativePath, content, options?)`

Write a single text file.

```js
await CodingNSWorkspace.writeText(
  "content/articles/new-note.md",
  "# New Document\\n\\nTitle: New Document\\n",
  {
    createIfMissing: true,
    overwrite: true,
    ensureParentDir: true
  }
)
```

Supported behaviors:

- create new files
- overwrite existing files
- `ifMtime` optimistic conflict checks
- atomic writes

---

### 6) `deleteFile(relativePath, options?)`

Delete a single file.

```js
await CodingNSWorkspace.deleteFile("content/articles/old-note.md")
```

---

### 7) `stat(relativePath)` / `exists(relativePath)`

Inspect file state or check existence.

```js
const stat = await CodingNSWorkspace.stat("content/articles/demo.md")
const exists = await CodingNSWorkspace.exists("content/articles/demo.md")
```

---

### 8) `watchDir(relativePath, options?, callback?)`

Watch directory changes.

```js
const handle = await CodingNSWorkspace.watchDir(
  "content/articles",
  { includeHidden: true },
  (event) => {
    console.log("directory changed", event)
  }
)
```

The returned handle contains at least:

```js
{
  watchId,
  unsubscribe()
}
```

Stop watching:

```js
await handle.unsubscribe()
// or
await CodingNSWorkspace.unwatch(handle)
// or
await CodingNSWorkspace.unwatch(handle.watchId)
```

Example event:

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

## New desktop-wrapper methods

This is the new part.

### 9) `openWorkspaceFile(relativePath)`

Open a local file using a workspace-relative path.

```js
await CodingNSWorkspace.openWorkspaceFile("content/articles/demo.md")
```

Example result:

```json
{
  "workspaceId": "workspace_xxx",
  "relativePath": "content/articles/demo.md",
  "absolutePath": "/Users/jackson/WorkFile/.../content/articles/demo.md"
}
```

Two important points:

1. the page still passes only a relative path
2. `absolutePath` is the Host-validated execution result, not a new input format for business code

### 10) `revealWorkspaceFile(relativePath)`

Reveal the file inside the system file manager.

```js
await CodingNSWorkspace.revealWorkspaceFile("content/articles/demo.md")
```

The return structure is the same as `openWorkspaceFile()`.

---

## Host-side execution order

`openWorkspaceFile()` and `revealWorkspaceFile()` always follow this order:

1. the page passes `relativePath`
2. the Host calls `FileAccessGuard.resolvePath(...)`
3. it verifies:
   - the path is valid
   - there is no `..` escape
   - the file exists
   - the target is really a file, not a directory
4. the Host produces:
   - `workspaceId`
   - `relativePath`
   - `absolutePath`
5. the preview host page calls `CodingNSDesktop.fs.openFile(...)` or `revealInFileManager(...)`

That is the whole point of the wrapper: **security validation happens first, desktop execution happens second.**

---

## Error codes

Common error codes include:

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

Suggested error shape:

```json
{
  "code": "FILE_NOT_FOUND",
  "message": "File not found",
  "path": "content/articles/missing.md"
}
```

---

## Security boundary

Do not relax this part.

### Only the current workspace is allowed

- no cross-workspace access
- no absolute-path input
- no `..` escapes
- no symlink tricks to walk out

### Open / reveal must pass through Host first

The page must not build an absolute path on its own and call the desktop shell directly.

Correct:

```js
await CodingNSWorkspace.openWorkspaceFile("docs/readme.md")
```

Wrong:

```js
await window.CodingNSDesktop.fs.openFile("/Users/xxx/secret.txt")
```

### The iframe bridge does not use `targetOrigin="*"`

The preview page and host page validate message origins. No wildcard target origin is allowed.

---

## Example for static HTML pages

### Read a directory and batch-read Markdown files

```html
<script>
async function loadDocuments() {
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

### Open the source file or reveal it

```html
<script>
async function openSourceFile(relativePath) {
  try {
    await window.CodingNSWorkspace.openWorkspaceFile(relativePath);
  } catch (error) {
    alert(error.message || "Failed to open file");
  }
}

async function revealSourceFile(relativePath) {
  try {
    await window.CodingNSWorkspace.revealWorkspaceFile(relativePath);
  } catch (error) {
    alert(error.message || "Failed to reveal file");
  }
}
</script>
```

### Watch external file changes

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
      await reloadDocuments();
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

## Recommended pattern for local document tools

If your page uses Markdown as the main source of truth, keep the rule simple: the files are the source of truth, and any index file is only cache.

Recommended flow:

1. `listDir("content/articles")`
2. filter all `.md` files
3. `readTexts(...)`
4. parse records and render the UI
5. call `openWorkspaceFile(path)` when the original file should open
6. call `revealWorkspaceFile(path)` when the system file manager should highlight it
7. use `watchDir(...)` to reload on external changes

Files such as `.index.json` are only cache, not the primary data source.

---

## Guidance for plugin authors

If you are writing a CodingNS plugin frontend, the rule should stay the same:

- use workspace-scoped interfaces first for workspace file operations
- when you need desktop actions, still go through “relative path -> Host validation -> desktop shell”
- do not clone your own absolute-path logic inside plugin code

In other words, **what gets unified is the entry rule, not a single giant merged object.**

---

## Explicit non-goals

This interface deliberately does not do the following:

- accept absolute paths as page input
- provide cross-workspace file access
- move `pickDirectory()` into `CodingNSWorkspace`
- promote `.json` cache files to the source of truth
- pretend `writeTexts()` is already production-ready

Those non-goals are intentional. They keep the boundary from turning into garbage.

---

## Where maintainers should look first

If you maintain this capability later, start here:

### Host

- `apps/host/src/modules/file/workspace-file-bridge-service.ts`
- `apps/host/src/modules/file/workspace-file-bridge-watch-service.ts`
- `apps/host/src/modules/file/file-controller.ts`
- `apps/host/src/routes/files.ts`

### HTML preview bridge

- `apps/host/src/modules/file/runtime/codingns-workspace-bridge.js`
- `apps/user-app/src/platform/preview/codingns-workspace-bridge.ts`
- `apps/user-app/src/platform/preview/html-preview-workspace-bridge.ts`

### Desktop bridge

- `apps/user-app/src/platform/desktop/codingns-desktop-bridge.ts`

---

## One-sentence summary

`CodingNSWorkspace` now covers workspace file read/write/watch operations and also provides standard wrappers for “open local file” and “reveal in file manager” using **workspace-relative paths**, while the real security boundary still lives in the Host, not in the HTML page.
