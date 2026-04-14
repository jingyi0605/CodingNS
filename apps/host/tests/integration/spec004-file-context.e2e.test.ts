import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createId } from "../../src/shared/utils/id.js";
import { nowIso } from "../../src/shared/utils/time.js";
import {
  createEmptyFixture,
  createTestApp,
  destroyFixture,
  type EmptyFixture
} from "../helpers/test-app.js";

const activeServers: Array<ReturnType<typeof createTestApp>> = [];
const activeFixtures: EmptyFixture[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();

    if (server) {
      server.app.server.closeAllConnections?.();
      await server.app.close();
    }
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("spec004 文件管理能力", () => {
  it("打通受保护文件树、读取、保存、文件操作、搜索、最近打开和预览", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    seedWorkspaceFiles(fixture.workspaceDir);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);

    const unauthorized = await hosted.app.inject({
      method: "GET",
      url: `/api/files/tree?workspaceId=${workspaceId}`
    });
    expect(unauthorized.statusCode).toBe(401);

    const traversal = await hosted.app.inject({
      method: "GET",
      url: `/api/files/content?workspaceId=${workspaceId}&path=${encodeURIComponent("../secret.txt")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json().error_code).toBe("PATH_TRAVERSAL_BLOCKED");

    const tree = await hosted.app.inject({
      method: "GET",
      url: `/api/files/tree?workspaceId=${workspaceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(tree.statusCode).toBe(200);
    expect(tree.json().items.map((item: { name: string }) => item.name)).toEqual(
      expect.arrayContaining(["docs", "src"])
    );

    const content = await hosted.app.inject({
      method: "GET",
      url: `/api/files/content?workspaceId=${workspaceId}&path=${encodeURIComponent("src/app.ts")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(content.statusCode).toBe(200);
    expect(content.json().content).toContain("spec004");
    expect(content.json().version).toBeTruthy();

    const saved = await hosted.app.inject({
      method: "PUT",
      url: "/api/files/content",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        path: "src/app.ts",
        content: "export const value = 'spec004 saved';\n",
        expectedVersion: content.json().version
      }
    });
    expect(saved.statusCode).toBe(200);

    const conflict = await hosted.app.inject({
      method: "PUT",
      url: "/api/files/content",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        path: "src/app.ts",
        content: "export const value = 'stale';\n",
        expectedVersion: content.json().version
      }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error_code).toBe("FILE_VERSION_CONFLICT");

    const createDirectory = await hosted.app.inject({
      method: "POST",
      url: "/api/files/ops",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        opType: "create_directory",
        dstPath: "notes"
      }
    });
    expect(createDirectory.statusCode).toBe(200);

    const createFile = await hosted.app.inject({
      method: "POST",
      url: "/api/files/ops",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        opType: "create_file",
        dstPath: "notes/todo.md",
        content: "先把文件管理挂起来\n"
      }
    });
    expect(createFile.statusCode).toBe(200);

    const uploadBinary = await hosted.app.inject({
      method: "POST",
      url: "/api/files/upload",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        path: "docs/upload.bin",
        contentBase64: Buffer.from([8, 6, 7, 5, 3, 0, 9]).toString("base64")
      }
    });
    expect(uploadBinary.statusCode).toBe(201);
    expect(readFileSync(path.join(fixture.workspaceDir, "docs", "upload.bin"))).toEqual(
      Buffer.from([8, 6, 7, 5, 3, 0, 9])
    );

    const downloadBinary = await hosted.app.inject({
      method: "GET",
      url: `/api/files/download?workspaceId=${workspaceId}&path=${encodeURIComponent("docs/upload.bin")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(downloadBinary.statusCode).toBe(200);
    expect(downloadBinary.json()).toMatchObject({
      workspaceId,
      path: "docs/upload.bin",
      fileName: "upload.bin",
      size: 7
    });
    expect(Buffer.from(downloadBinary.json().contentBase64, "base64")).toEqual(
      Buffer.from([8, 6, 7, 5, 3, 0, 9])
    );

    const renameFile = await hosted.app.inject({
      method: "POST",
      url: "/api/files/ops",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        opType: "rename",
        srcPath: "notes/todo.md",
        dstPath: "notes/todo-renamed.md"
      }
    });
    expect(renameFile.statusCode).toBe(200);

    const moveFile = await hosted.app.inject({
      method: "POST",
      url: "/api/files/ops",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        opType: "move",
        srcPath: "notes/todo-renamed.md",
        dstPath: "docs/todo-renamed.md"
      }
    });
    expect(moveFile.statusCode).toBe(200);
    expect(readFileSync(path.join(fixture.workspaceDir, "docs", "todo-renamed.md"), "utf8")).toContain(
      "文件管理"
    );

    const copyFile = await hosted.app.inject({
      method: "POST",
      url: "/api/files/ops",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        opType: "copy",
        srcPath: "docs/todo-renamed.md",
        dstPath: "notes/todo-copy.md"
      }
    });
    expect(copyFile.statusCode).toBe(200);
    expect(readFileSync(path.join(fixture.workspaceDir, "notes", "todo-copy.md"), "utf8")).toContain(
      "文件管理"
    );

    const copyDirectory = await hosted.app.inject({
      method: "POST",
      url: "/api/files/ops",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        opType: "copy",
        srcPath: "docs",
        dstPath: "docs-copy"
      }
    });
    expect(copyDirectory.statusCode).toBe(200);
    expect(readFileSync(path.join(fixture.workspaceDir, "docs-copy", "readme.md"), "utf8")).toContain(
      "spec004"
    );

    mkdirSync(path.join(fixture.workspaceDir, "docs", "nested"), {
      recursive: true
    });

    const nestedCopyRejected = await hosted.app.inject({
      method: "POST",
      url: "/api/files/ops",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        opType: "copy",
        srcPath: "docs",
        dstPath: "docs/nested/docs"
      }
    });
    expect(nestedCopyRejected.statusCode).toBe(400);
    expect(nestedCopyRejected.json().error_code).toBe("INVALID_FILE_OPERATION");

    const search = await hosted.app.inject({
      method: "GET",
      url: `/api/files/search?workspaceId=${workspaceId}&keyword=${encodeURIComponent("todo")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().items.map((item: { path: string }) => item.path)).toEqual(
      expect.arrayContaining([
        "docs/todo-renamed.md",
        "notes/todo-copy.md",
        "docs-copy/todo-renamed.md"
      ])
    );

    const previewBinary = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview?workspaceId=${workspaceId}&path=${encodeURIComponent("binary.bin")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewBinary.statusCode).toBe(200);
    expect(previewBinary.json().supported).toBe(false);
    expect(previewBinary.json().kind).toBe("binary");

    const previewHtmlMeta = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview?workspaceId=${workspaceId}&path=${encodeURIComponent("site/index.html")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewHtmlMeta.statusCode).toBe(200);
    expect(previewHtmlMeta.json().kind).toBe("html");
    expect(previewHtmlMeta.json().content).toContain("HTML 预览页面");
    expect(previewHtmlMeta.json().previewUrl).toContain("/preview/files/");
    expect(previewHtmlMeta.json().capabilities.canEdit).toBe(true);

    const previewImageMeta = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview?workspaceId=${workspaceId}&path=${encodeURIComponent("assets/diagram.png")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewImageMeta.statusCode).toBe(200);
    expect(previewImageMeta.json().kind).toBe("image");
    expect(previewImageMeta.json().previewUrl).toContain("/preview/files/");
    expect(previewImageMeta.json().capabilities.canZoom).toBe(true);

    const previewPdfMeta = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview?workspaceId=${workspaceId}&path=${encodeURIComponent("docs/spec.pdf")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewPdfMeta.statusCode).toBe(200);
    expect(previewPdfMeta.json().kind).toBe("pdf");
    expect(previewPdfMeta.json().previewUrl).toContain("/preview/files/");
    expect(previewPdfMeta.json().capabilities.canPaginate).toBe(true);

    const previewLink = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview-link?workspaceId=${workspaceId}&path=${encodeURIComponent("site/index.html")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewLink.statusCode).toBe(200);
    expect(previewLink.json().previewPath).toContain("/preview/files/");
    expect(previewLink.json().previewUrl).toContain("/preview/files/");

    const previewHtml = await hosted.app.inject({
      method: "GET",
      url: previewLink.json().previewPath
    });
    expect(previewHtml.statusCode).toBe(200);
    expect(previewHtml.headers["content-type"]).toContain("text/html");
    expect(previewHtml.body).toContain("<title>Spec004 Preview</title>");

    const previewCssPath = new URL(
      "./site.css",
      `http://preview.local${previewLink.json().previewPath}`
    ).pathname;
    const previewCss = await hosted.app.inject({
      method: "GET",
      url: previewCssPath
    });
    expect(previewCss.statusCode).toBe(200);
    expect(previewCss.headers["content-type"]).toContain("text/css");
    expect(previewCss.body).toContain("background");

    const previewScriptPath = new URL(
      "./app.js",
      `http://preview.local${previewLink.json().previewPath}`
    ).pathname;
    const previewScript = await hosted.app.inject({
      method: "GET",
      url: previewScriptPath
    });
    expect(previewScript.statusCode).toBe(200);
    expect(previewScript.headers["content-type"]).toContain("text/javascript");
    expect(previewScript.body).toContain("preview-ready");

    const previewLinkRejected = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview-link?workspaceId=${workspaceId}&path=${encodeURIComponent("src/app.ts")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewLinkRejected.statusCode).toBe(400);
    expect(previewLinkRejected.json().error_code).toBe("FILE_PREVIEW_NOT_SUPPORTED");

    const previewLinkChinese = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview-link?workspaceId=${workspaceId}&path=${encodeURIComponent("化工行业AI培训/index.html")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewLinkChinese.statusCode).toBe(200);

    const previewChinese = await hosted.app.inject({
      method: "GET",
      url: previewLinkChinese.json().previewPath
    });
    expect(previewChinese.statusCode).toBe(200);
    expect(previewChinese.body).toContain("中文路径预览");

    const previewImageLink = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview-link?workspaceId=${workspaceId}&path=${encodeURIComponent("assets/diagram.png")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewImageLink.statusCode).toBe(200);
    expect(previewImageLink.json().previewPath).toContain("/preview/files/");

    const previewImage = await hosted.app.inject({
      method: "GET",
      url: previewImageLink.json().previewPath
    });
    expect(previewImage.statusCode).toBe(200);
    expect(previewImage.headers["content-type"]).toContain("image/png");

    const previewPdfLink = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview-link?workspaceId=${workspaceId}&path=${encodeURIComponent("docs/spec.pdf")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewPdfLink.statusCode).toBe(200);

    const previewPdf = await hosted.app.inject({
      method: "GET",
      url: previewPdfLink.json().previewPath
    });
    expect(previewPdf.statusCode).toBe(200);
    expect(previewPdf.headers["content-type"]).toContain("application/pdf");

    const previewLargePdfMeta = await hosted.app.inject({
      method: "GET",
      url: `/api/files/preview?workspaceId=${workspaceId}&path=${encodeURIComponent("docs/large-preview.pdf")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(previewLargePdfMeta.statusCode).toBe(200);
    expect(previewLargePdfMeta.json().kind).toBe("pdf");
    expect(previewLargePdfMeta.json().supported).toBe(true);
    expect(previewLargePdfMeta.json().previewUrl).toContain("/preview/files/");

    const recent = await hosted.app.inject({
      method: "GET",
      url: `/api/files/recent?workspaceId=${workspaceId}&limit=10`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(recent.statusCode).toBe(200);
    expect(recent.json().items.map((item: { path: string }) => item.path)).toEqual(
      expect.arrayContaining(["src/app.ts"])
    );

    const deleteMovedFile = await hosted.app.inject({
      method: "POST",
      url: "/api/files/ops",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        opType: "delete",
        srcPath: "docs/todo-renamed.md"
      }
    });
    expect(deleteMovedFile.statusCode).toBe(200);

    const deletedRead = await hosted.app.inject({
      method: "GET",
      url: `/api/files/content?workspaceId=${workspaceId}&path=${encodeURIComponent("docs/todo-renamed.md")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(deletedRead.statusCode).toBe(404);
  });

  it("打通文件管理挂载、查询、解绑，并保持只存元数据", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);
    seedWorkspaceFiles(fixture.workspaceDir);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const workspaceId = await importWorkspace(hosted, accessToken, fixture.workspaceDir);
    const sessionId = createSession(hosted, workspaceId);

    const attach = await hosted.app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/contexts/files`,
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        workspaceId,
        path: "docs/readme.md",
        rangeStart: 1,
        rangeEnd: 2
      }
    });
    expect(attach.statusCode).toBe(201);
    expect(attach.json()).toMatchObject({
      sessionId,
      workspaceId,
      path: "docs/readme.md",
      displayName: "readme.md"
    });
    expect(attach.json().contentHash).toBeTruthy();
    expect(attach.json().fileVersion).toBeTruthy();
    expect(attach.json().content).toBeUndefined();

    const list = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/contexts/files`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0].rangeStart).toBe(1);

    const schemaColumns = hosted.services.database.db
      .prepare("PRAGMA table_info(session_file_context_bindings)")
      .all() as Array<{ name: string }>;
    expect(schemaColumns.map((column) => column.name)).not.toContain("content");
    expect(schemaColumns.map((column) => column.name)).not.toContain("message");
    expect(schemaColumns.map((column) => column.name)).not.toContain("raw_body");

    const detach = await hosted.app.inject({
      method: "DELETE",
      url: `/api/sessions/${sessionId}/contexts/files/${attach.json().id}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(detach.statusCode).toBe(200);
    expect(detach.json()).toEqual({ success: true });

    const listAfterDetach = await hosted.app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/contexts/files`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(listAfterDetach.statusCode).toBe(200);
    expect(listAfterDetach.json().items).toHaveLength(0);
  });
});

function seedWorkspaceFiles(workspaceDir: string): void {
  mkdirSync(path.join(workspaceDir, "assets"), { recursive: true });
  mkdirSync(path.join(workspaceDir, "docs"), { recursive: true });
  mkdirSync(path.join(workspaceDir, "site"), { recursive: true });
  mkdirSync(path.join(workspaceDir, "src"), { recursive: true });

  writeFileSync(
    path.join(workspaceDir, "docs", "readme.md"),
    "# spec004\n把文件变成会话上下文，而不是第二套消息真相。\n",
    "utf8"
  );
  writeFileSync(
    path.join(workspaceDir, "src", "app.ts"),
    "export const value = 'spec004';\n",
    "utf8"
  );
  writeFileSync(
    path.join(workspaceDir, "site", "index.html"),
    [
      "<!doctype html>",
      "<html lang=\"zh-CN\">",
      "  <head>",
      "    <meta charset=\"utf-8\" />",
      "    <title>Spec004 Preview</title>",
      "    <link rel=\"stylesheet\" href=\"./site.css\" />",
      "  </head>",
      "  <body>",
      "    <main id=\"app\">HTML 预览页面</main>",
      "    <script src=\"./app.js\"></script>",
      "  </body>",
      "</html>"
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    path.join(workspaceDir, "site", "site.css"),
    "body { background: #f8fafc; color: #0f172a; }\n",
    "utf8"
  );
  writeFileSync(
    path.join(workspaceDir, "site", "app.js"),
    "document.body.dataset.previewState = 'preview-ready';\n",
    "utf8"
  );
  writeFileSync(
    path.join(workspaceDir, "assets", "diagram.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2NkYGD4DwABBAEAAPrL7QAAAABJRU5ErkJggg==",
      "base64"
    )
  );
  writeFileSync(
    path.join(workspaceDir, "docs", "spec.pdf"),
    Buffer.from(
      [
        "%PDF-1.1",
        "1 0 obj",
        "<< /Type /Catalog /Pages 2 0 R >>",
        "endobj",
        "2 0 obj",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "endobj",
        "3 0 obj",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        "endobj",
        "4 0 obj",
        "<< /Length 44 >>",
        "stream",
        "BT /F1 18 Tf 40 120 Td (Spec004 PDF Preview) Tj ET",
        "endstream",
        "endobj",
        "5 0 obj",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "endobj",
        "xref",
        "0 6",
        "0000000000 65535 f ",
        "0000000010 00000 n ",
        "0000000060 00000 n ",
        "0000000117 00000 n ",
        "0000000243 00000 n ",
        "0000000338 00000 n ",
        "trailer",
        "<< /Root 1 0 R /Size 6 >>",
        "startxref",
        "408",
        "%%EOF"
      ].join("\n"),
      "utf8"
    )
  );
  writeFileSync(
    path.join(workspaceDir, "docs", "large-preview.pdf"),
    Buffer.concat([
      Buffer.from("%PDF-1.4\n", "utf8"),
      Buffer.alloc(1024 * 1024, 0x20),
      Buffer.from("\n%%EOF", "utf8")
    ])
  );
  mkdirSync(path.join(workspaceDir, "化工行业AI培训"), { recursive: true });
  writeFileSync(
    path.join(workspaceDir, "化工行业AI培训", "index.html"),
    "<!doctype html><html><body>中文路径预览</body></html>",
    "utf8"
  );
  writeFileSync(path.join(workspaceDir, "binary.bin"), Buffer.from([0, 1, 2, 3]));
}

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  const login = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "admin",
      password: "admin1234"
    }
  });

  return login.json().accessToken as string;
}

async function importWorkspace(
  hosted: ReturnType<typeof createTestApp>,
  accessToken: string,
  workspacePath: string
): Promise<string> {
  const imported = await hosted.app.inject({
    method: "POST",
    url: "/api/workspaces/import",
    headers: {
      authorization: `Bearer ${accessToken}`
    },
    payload: {
      path: workspacePath,
      name: "Spec004 Workspace"
    }
  });

  return imported.json().id as string;
}

function createSession(hosted: ReturnType<typeof createTestApp>, workspaceId: string): string {
  const sessionId = createId();
  const timestamp = nowIso();

  hosted.services.repositories.sessionBindingRepository.upsert({
    sessionId,
    workspaceId,
    provider: "codex",
    providerSessionId: `provider-${sessionId}`,
    rawStoreRef: `codex://${sessionId}`,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  hosted.services.repositories.sessionIndexRepository.upsert({
    sessionId,
    workspaceId,
    provider: "codex",
    title: "spec004 上下文会话",
    messageCount: 0,
    isArchived: false,
    lastMessageAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  });
  hosted.services.repositories.sessionStatusSnapshotRepository.upsert({
    sessionId,
    syncStatus: "idle",
    syncCursor: null,
    lastSyncAt: timestamp,
    lastErrorCode: null,
    lastErrorDetail: null,
    resumedAt: null,
    updatedAt: timestamp
  });

  return sessionId;
}
