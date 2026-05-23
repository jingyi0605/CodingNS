# Static HTML Preview File Service: Preview HTTP Bridge

## What this document solves

Static HTML tools often need to read and write files in the current workspace: Markdown record libraries, index pages, configuration editors, and report viewers.

The correct entry point is the **Preview HTTP Bridge**. It is not a database and not an arbitrary filesystem backdoor. It is the standard workspace file-service interface for static HTML pages opened under `/preview/files/<token>/...`.

One sentence: **static HTML preview pages should use the Preview HTTP Bridge for current-workspace file access; use the Tauri / Desktop Bridge for desktop-native actions.**

---

## The boundary between the two bridges

CodingNS has two bridge paths. They coexist, but they are for different jobs.

| Capability | Preview HTTP Bridge | Tauri / Desktop Bridge |
| --- | --- | --- |
| Role | Static HTML preview file bridge | Desktop integration bridge |
| Transport | `fetch('/preview/workspace-bridge/...')` | `postMessage` to the desktop preview host page |
| Primary use | Read/write current-workspace files | Open files, reveal files, pick directories, desktop-native capabilities |
| Depends on macOS WebView parent response | No | Yes |
| Failure shape | HTTP status + JSON error | May silently time out |
| Recommended for | Markdown libraries, config pages, index pages, static tools | Finder / Explorer, system dialogs, desktop actions |

Keep the boundary clean:

- **File-service capabilities**: prefer the Preview HTTP Bridge.
- **Desktop-native capabilities**: use `CodingNSDesktop` or the `CodingNSWorkspace.openWorkspaceFile/revealWorkspaceFile` wrappers.

---

## Recommended priority

A static HTML page should choose the transport in this order:

```text
If the current URL is /preview/files/<token>/...
  Use the Preview HTTP Bridge directly
Else if the host has injected window.CodingNSWorkspace
  Use the injected workspace bridge
Else
  Tell the user that direct workspace file access is not available
```

Do not wait for a Tauri `postMessage` timeout before falling back to HTTP when the page already has a preview token. That is bad taste and makes first paint several seconds slower.

---

## URL and authorization model

A static HTML preview URL looks like this:

```text
http://<host>/preview/files/<previewToken>/Tools/example.html?_preview=0&_cns_parent_origin=tauri%3A%2F%2Flocalhost
```

The `<previewToken>` is bound to:

- `workspaceId`
- expiration time
- signature

The Preview HTTP Bridge authorizes with this token. It does not require a Bearer token.

Security rules:

- The token can only access its bound workspace.
- The page only passes workspace-relative paths.
- The Host must reject path traversal.
- The Host must reject paths outside the workspace.
- When the token expires, the preview must be reopened.

---

## HTTP API

All endpoints live under:

```text
/preview/workspace-bridge/*?token=<previewToken>
```

### capabilities

```http
GET /preview/workspace-bridge/capabilities?token=<previewToken>
```

Response:

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
  "path": "Important/member-info",
  "options": {
    "includeHidden": true,
    "kind": "file"
  }
}
```

Response:

```json
{
  "path": "Important/member-info",
  "items": [
    {
      "name": "ChatGPT Plus.md",
      "path": "Important/member-info/ChatGPT Plus.md",
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
  "path": "Important/member-info/ChatGPT Plus.md"
}
```

### read-texts

```http
POST /preview/workspace-bridge/read-texts?token=<previewToken>
Content-Type: application/json

{
  "paths": [
    "Important/member-info/ChatGPT Plus.md",
    "Important/member-info/Infuse.md"
  ]
}
```

When reading many Markdown files, prefer `read-texts`. Do not fire dozens of `read-text` requests in a loop.

### write-text

```http
POST /preview/workspace-bridge/write-text?token=<previewToken>
Content-Type: application/json

{
  "path": "Important/member-info/.member-index.json",
  "content": "{\n  \"files\": []\n}\n",
  "options": {
    "createIfMissing": true,
    "overwrite": true,
    "ifMtime": 1779500000000
  }
}
```

Use `ifMtime` for optimistic concurrency control when editing existing records, so an external editor change is not overwritten silently.

### delete-file

```http
POST /preview/workspace-bridge/delete-file?token=<previewToken>
Content-Type: application/json

{
  "path": "Important/member-info/old-record.md",
  "options": {
    "ifMtime": 1779500000000
  }
}
```

### stat / exists

```http
GET /preview/workspace-bridge/stat?token=<previewToken>&path=Important/member-info/ChatGPT%20Plus.md
GET /preview/workspace-bridge/exists?token=<previewToken>&path=Important/member-info/ChatGPT%20Plus.md
```

### watch-dir

```http
POST /preview/workspace-bridge/watch-dir?token=<previewToken>
Content-Type: application/json

{
  "path": "Important/member-info",
  "options": {
    "includeHidden": true
  }
}
```

Static HTML pages should normally use the platform wrapper `CodingNSWorkspace.watchDir(...)`. If a page calls the HTTP API directly, its watch-event polling must follow the current Host response shape. Do not invent another protocol.

---

## Recommended page wrapper

Do not scatter raw `fetch` calls across a static HTML page. Wrap them as a workspace bridge object:

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

The platform runtime should ideally expose one `window.CodingNSWorkspace` object. The underlying transport can be HTTP or Tauri, but business pages should face one object.

---

## Standard pattern for Markdown libraries

If a tool manages a Markdown document library, keep the data model simple:

```text
Markdown files are the single source of truth.
Index JSON files are cache only.
```

Recommended flow:

1. `listDir(basePath, { includeHidden: true, kind: "file" })`
2. filter `.md` files
3. `readTexts(paths)`
4. parse Markdown and render the UI
5. create/edit/delete the corresponding `.md` file directly
6. rebuild `.index.json` or similar cache after success
7. rescan Markdown files on external changes via `watchDir` or manual refresh

Do not promote `.json` cache files into the primary data source. A document library is not a database.

---

## Error handling and debugging

A page should log these fields:

- current URL
- whether a preview token exists
- transport in use: `preview-http` / `tauri-post-message`
- each request action, URL, HTTP status, and error detail
- current record count
- last failed file path

Do not show only “request failed”. At minimum show:

```text
HTTP status
error_code
detail
path
```

A common bad failure mode of the Tauri Bridge is “waiting for host response timed out”. The HTTP Bridge is easier to debug because it returns explicit HTTP status and backend errors.

---

## When Tauri / Desktop Bridge is still required

The following remain desktop bridge responsibilities:

- opening a local file
- revealing a file in Finder / Explorer
- picking a local directory
- clipboard or notification integration
- interactions that need the desktop UI

For current-workspace files, business pages still must not build absolute paths themselves. Use:

```js
await CodingNSWorkspace.openWorkspaceFile("content/demo.md");
await CodingNSWorkspace.revealWorkspaceFile("content/demo.md");
```

The Host validates the workspace-relative path first, then delegates to the desktop shell.

---

## Implementation entry points

Maintainers should start here:

### Host

- `apps/host/src/modules/file/file-preview-link-service.ts`
- `apps/host/src/modules/file/file-controller.ts`
- `apps/host/src/modules/file/workspace-file-bridge-service.ts`
- `apps/host/src/routes/files.ts`

### Runtime / desktop preview bridge

- `apps/host/src/modules/file/runtime/codingns-workspace-bridge.js`
- `apps/user-app/src/platform/preview/html-preview-workspace-bridge.ts`

---

## One-sentence summary

The Preview HTTP Bridge is the standard file-service entry point for static HTML preview pages. The Tauri / Desktop Bridge is the desktop integration entry point. Use HTTP for current-workspace file read/write, and use the desktop bridge for open/reveal/pick desktop actions. Do not swap the boundary.
