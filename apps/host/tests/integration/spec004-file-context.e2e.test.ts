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

describe("spec004 文件上下文能力", () => {
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
        content: "先把文件上下文挂起来\n"
      }
    });
    expect(createFile.statusCode).toBe(200);

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
      "文件上下文"
    );

    const search = await hosted.app.inject({
      method: "GET",
      url: `/api/files/search?workspaceId=${workspaceId}&keyword=${encodeURIComponent("todo")}`,
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toHaveLength(1);
    expect(search.json().items[0].path).toBe("docs/todo-renamed.md");

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

  it("打通文件上下文挂载、查询、解绑，并保持只存元数据", async () => {
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
  mkdirSync(path.join(workspaceDir, "docs"), { recursive: true });
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
