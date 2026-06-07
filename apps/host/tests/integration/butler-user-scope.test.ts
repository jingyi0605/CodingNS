import { afterEach, describe, expect, it } from "vitest";

import { ButlerControlSessionRepository } from "../../src/storage/repositories/butler-control-session-repository.js";
import { ButlerProfileRepository } from "../../src/storage/repositories/butler-profile-repository.js";
import { ButlerProjectRepository } from "../../src/storage/repositories/butler-project-repository.js";
import { ButlerSessionRepository } from "../../src/storage/repositories/butler-session-repository.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/storage/sqlite/client.js";

const activeDatabases: DatabaseClient[] = [];

afterEach(() => {
  while (activeDatabases.length > 0) {
    activeDatabases.pop()?.close();
  }
});

describe("butler user scope", () => {
  it("Butler profile、project、session、control session 按 user_id 隔离", () => {
    const database = createDatabaseClient(":memory:");
    activeDatabases.push(database);

    const profileRepository = new ButlerProfileRepository(database.db);
    const workspaceRepository = new WorkspaceRepository(database.db);
    const projectRepository = new ButlerProjectRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const butlerSessionRepository = new ButlerSessionRepository(database.db);
    const controlSessionRepository = new ButlerControlSessionRepository(database.db);
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

    for (const userId of ["user-a", "user-b"]) {
      profileRepository.create({
        id: `default:${userId}`,
        userId,
        displayName: `助手 ${userId}`,
        providerId: "codex",
        workspacePath: `/tmp/codingns-butler-${userId}`,
        agentsMode: "inline",
        agentsFilePath: null,
        agentsContent: "",
        persona: {
          tone: "direct",
          language: "zh-CN",
          summaryStyle: "brief"
        },
        focus: {
          projectIds: [],
          riskPreference: "balanced",
          reportPriority: [],
          summaryDebounceSeconds: 300
        },
        setupCompleted: true,
        initializedAt: timestamp,
        updatedAt: timestamp
      });

      workspaceRepository.create({
        id: `workspace-${userId}`,
        ownerUserId: userId,
        name: `工作区 ${userId}`,
        path: `/tmp/codingns-workspace-${userId}`,
        repoRoot: `/tmp/codingns-workspace-${userId}`,
        favorite: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        removedAt: null
      });

      projectRepository.create({
        id: `project-${userId}`,
        userId,
        workspaceId: `workspace-${userId}`,
        name: `项目 ${userId}`,
        repoRoot: `/tmp/codingns-workspace-${userId}`,
        defaultProvider: null,
        instructionProfileId: null,
        approvalMode: "controlled",
        lifecycleStatus: "active",
        riskLevel: "low",
        config: {},
        lastPatrolAt: null,
        lastVerificationAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null
      });

      sessionBindingRepository.upsert({
        sessionId: `session-${userId}`,
        userId,
        workspaceId: `workspace-${userId}`,
        provider: "codex",
        providerSessionId: `provider-session-${userId}`,
        rawStoreRef: `codex://session-${userId}`,
        providerConfigMode: "global-default",
        providerPresetId: null,
        runtimeHomeDir: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      butlerSessionRepository.create({
        id: `butler-session-${userId}`,
        userId,
        projectId: `project-${userId}`,
        sessionId: `session-${userId}`,
        role: "adhoc",
        ownershipMode: "managed",
        status: "running",
        lastSummary: null,
        lastCheckpointAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      controlSessionRepository.create({
        id: `control-${userId}`,
        userId,
        providerId: "codex",
        sessionId: `session-${userId}`,
        purpose: "chat",
        title: null,
        sourceItemId: null,
        model: null,
        reasoningLevel: null,
        permissionMode: null,
        status: "running",
        lastContextVersion: null,
        lastSummary: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    expect(profileRepository.find("user-a")?.displayName).toBe("助手 user-a");
    expect(profileRepository.find("user-b")?.displayName).toBe("助手 user-b");
    expect(projectRepository.list({ userId: "user-a" }).map((item) => item.id)).toEqual(["project-user-a"]);
    expect(projectRepository.findByIdForUser("project-user-a", "user-b")).toBeNull();
    expect(butlerSessionRepository.listByProject("project-user-a", "user-a").map((item) => item.id)).toEqual([
      "butler-session-user-a"
    ]);
    expect(butlerSessionRepository.listByProject("project-user-a", "user-b")).toEqual([]);
    expect(controlSessionRepository.listByProvider("codex", "user-a").map((item) => item.id)).toEqual([
      "control-user-a"
    ]);
    expect(controlSessionRepository.findByIdForUser("control-user-a", "user-b")).toBeNull();
  });
});
