import { afterEach, describe, expect, it } from "vitest";

import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/storage/sqlite/client.js";

const activeDatabases: DatabaseClient[] = [];

afterEach(() => {
  while (activeDatabases.length > 0) {
    activeDatabases.pop()?.close();
  }
});

describe("session user scope", () => {
  it("会话绑定和列表按 user_id 隔离", () => {
    const database = createDatabaseClient(":memory:");
    activeDatabases.push(database);
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const timestamp = "2026-06-07T10:00:00.000Z";

    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "user-a",
        "user-a",
        "hash-a",
        "admin",
        "active",
        timestamp,
        timestamp,
        "user-b",
        "user-b",
        "hash-b",
        "admin",
        "active",
        timestamp,
        timestamp
      );

    workspaceRepository.create({
      id: "workspace-a",
      ownerUserId: "user-a",
      name: "用户 A 工作区",
      path: "/tmp/codingns-user-a-workspace",
      repoRoot: "/tmp/codingns-user-a-workspace",
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });
    workspaceRepository.create({
      id: "workspace-b",
      ownerUserId: "user-b",
      name: "用户 B 工作区",
      path: "/tmp/codingns-user-b-workspace",
      repoRoot: "/tmp/codingns-user-b-workspace",
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });

    for (const item of [
      {
        sessionId: "session-a",
        userId: "user-a",
        workspaceId: "workspace-a",
        providerSessionId: "provider-session-a",
        rawStoreRef: "codex://session-a",
        title: "用户 A 会话"
      },
      {
        sessionId: "session-b",
        userId: "user-b",
        workspaceId: "workspace-b",
        providerSessionId: "provider-session-b",
        rawStoreRef: "codex://session-b",
        title: "用户 B 会话"
      }
    ] as const) {
      sessionBindingRepository.upsert({
        sessionId: item.sessionId,
        userId: item.userId,
        workspaceId: item.workspaceId,
        provider: "codex",
        providerSessionId: item.providerSessionId,
        rawStoreRef: item.rawStoreRef,
        providerConfigMode: "global-default",
        providerPresetId: null,
        runtimeHomeDir: null,
        selectedModel: item.sessionId === "session-a" ? "gpt-5.4" : "claude-sonnet-4",
        createdAt: timestamp,
        updatedAt: timestamp
      });
      sessionIndexRepository.upsert({
        sessionId: item.sessionId,
        workspaceId: item.workspaceId,
        provider: "codex",
        title: item.title,
        messageCount: 1,
        isArchived: false,
        lastMessageAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    expect(sessionBindingRepository.findBySessionIdForUser("session-a", "user-a")?.sessionId).toBe(
      "session-a"
    );
    expect(sessionBindingRepository.findBySessionIdForUser("session-a", "user-b")).toBeNull();
    expect(sessionBindingRepository.findBySessionIdForUser("session-a", "user-a")?.selectedModel).toBe("gpt-5.4");
    expect(sessionIndexRepository.findBySessionId("session-a", "user-a")?.title).toBe("用户 A 会话");
    expect(sessionIndexRepository.findBySessionId("session-a", "user-b")).toBeNull();
    expect(sessionIndexRepository.listByWorkspace("workspace-a", "user-a").map((item) => item.sessionId)).toEqual([
      "session-a"
    ]);
    expect(sessionIndexRepository.findBySessionId("session-a", "user-a")?.selectedModel).toBe("gpt-5.4");
    expect(sessionIndexRepository.listByWorkspace("workspace-a", "user-b")).toEqual([]);
  });
});
