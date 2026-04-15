import { afterEach, describe, expect, it } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionActivityAuthorityService } from "../../src/modules/sessions/session-activity-authority-service.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../../src/storage/repositories/session-changed-file-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionMessageAttachmentRepository } from "../../src/storage/repositories/session-message-attachment-repository.js";
import { SessionStateRepository } from "../../src/storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../../src/storage/repositories/session-status-snapshot-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import { destroyFixture, createEmptyFixture, type EmptyFixture } from "../helpers/test-app.js";

const activeFixtures: EmptyFixture[] = [];
const activeClosers: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (activeClosers.length > 0) {
    const close = activeClosers.pop();
    await close?.();
  }

  while (activeFixtures.length > 0) {
    const fixture = activeFixtures.pop();

    if (fixture) {
      destroyFixture(fixture);
    }
  }
});

describe("SessionHistoryService 恢复缺失索引", () => {
  it("binding 仍在时，getSession 会补建缺失的 index、snapshot 和 state", () => {
    const fixture = createEmptyFixture();
    const database = createDatabaseClient(":memory:");
    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: fixture.claudeHomeDir,
      codexHomeDir: fixture.codexHomeDir
    });
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const sessionStateRepository = new SessionStateRepository(database.db);
    const sessionStatusSnapshotRepository = new SessionStatusSnapshotRepository(database.db);
    const sessionChangedFileService = new SessionChangedFileService(
      new SessionChangedFileRepository(database.db)
    );
    const sessionMessageAttachmentService = new SessionMessageAttachmentService(
      new SessionMessageAttachmentRepository(database.db),
      config
    );
    const service = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      sessionChangedFileService,
      sessionIndexRepository,
      sessionMessageAttachmentService,
      sessionStateRepository,
      sessionStatusSnapshotRepository,
      config,
      new SessionActivityAuthorityService()
    );

    activeFixtures.push(fixture);
    activeClosers.push(() => database.close());

    workspaceRepository.create({
      id: "workspace-1",
      name: "Fixture Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: "2026-04-16T08:00:00.000Z",
      updatedAt: "2026-04-16T08:00:00.000Z",
      removedAt: null
    });
    database.db
      .prepare(
        `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        "user-1",
        "tester",
        "hash",
        "admin",
        "2026-04-16T08:00:00.000Z",
        "2026-04-16T08:00:00.000Z"
      );

    sessionBindingRepository.upsert({
      sessionId: "session-missing-index",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "pending://codex/session-missing-index",
      rawStoreRef: "pending://codex/session-missing-index",
      createdAt: "2026-04-16T08:01:00.000Z",
      updatedAt: "2026-04-16T08:01:00.000Z"
    });

    const session = service.getSession("session-missing-index", "user-1");

    expect(session.sessionId).toBe("session-missing-index");
    expect(session.provider).toBe("codex");
    expect(session.title).toBe("新会话");
    expect(session.runningState).toBe("starting");
    expect(session.activitySource).toBe("runtime");
    expect(sessionIndexRepository.findIndexRecordBySessionId("session-missing-index")).toMatchObject({
      sessionId: "session-missing-index",
      workspaceId: "workspace-1",
      provider: "codex",
      title: "新会话",
      messageCount: 0,
      isArchived: false
    });
    expect(
      sessionStatusSnapshotRepository.findBySessionId("session-missing-index")
    ).toMatchObject({
      sessionId: "session-missing-index",
      syncStatus: "idle"
    });
    expect(
      sessionStateRepository.findBySessionAndUser("session-missing-index", "user-1")
    ).toMatchObject({
      sessionId: "session-missing-index",
      userId: "user-1",
      runningState: "starting",
      activitySource: "runtime"
    });
  });
});
