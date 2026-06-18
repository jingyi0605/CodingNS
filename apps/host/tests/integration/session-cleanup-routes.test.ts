import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionSourceIndexRepository } from "../../src/storage/repositories/session-source-index-repository.js";
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

describe("session cleanup routes", () => {
  it("可以触发扫描并读取最近扫描结果", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const user = hosted.services.repositories.authUserRepository.findByUsername("tester");
    expect(user).not.toBeNull();
    const userId = user!.id;
    const timestamp = "2026-06-15T10:00:00.000Z";

    hosted.services.repositories.workspaceRepository.create({
      id: "workspace-1",
      ownerUserId: userId,
      name: "Cleanup Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });

    const sessionBindingRepository = new SessionBindingRepository(hosted.services.database.db);
    const sessionIndexRepository = new SessionIndexRepository(hosted.services.database.db);
    const sessionSourceIndexRepository = new SessionSourceIndexRepository(hosted.services.database.db);

    sessionBindingRepository.upsert({
      sessionId: "session-1",
      userId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/codex/session-1.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-15T10:00:00.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      sessionVisibility: "workspace",
      parentSessionId: null,
      sessionKind: "default",
      annotationSourceMessageId: null,
      annotationSourceText: null,
      isSubagent: false,
      subagentLabel: null,
      title: "路由测试会话",
      messageCount: 7,
      isArchived: false,
      lastMessageAt: "2026-06-15T10:00:00.000Z",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-15T10:00:00.000Z"
    });
    sessionSourceIndexRepository.upsert({
      sourceKey: "codex:/tmp/codex/session-1.jsonl",
      provider: "codex",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/codex/session-1.jsonl",
      workspacePath: fixture.workspaceDir,
      fingerprintMtimeMs: 1718000000000,
      fingerprintSizeBytes: 2048,
      fingerprintInode: null,
      fingerprintVersion: null,
      title: "路由测试会话",
      messageCount: 7,
      lastMessageAt: "2026-06-15T10:00:00.000Z",
      isArchivedHint: false,
      lastParsedAt: "2026-06-15T10:00:00.000Z",
      lastVerifiedAt: "2026-06-15T10:00:00.000Z",
      sampleDueAt: null,
      deletedAt: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-15T10:00:00.000Z"
    });

    const trigger = await hosted.app.inject({
      method: "POST",
      url: "/api/settings/session-cleanup/scans",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        providers: ["codex"],
        startAt: "2026-06-14T00:00:00.000Z",
        endAt: "2026-06-16T00:00:00.000Z",
        force: true
      }
    });

    expect(trigger.statusCode).toBe(200);
    expect(trigger.json()).toMatchObject({
      taskType: "session_cleanup.scan"
    });

    const latest = await hosted.app.inject({
      method: "GET",
      url: "/api/settings/session-cleanup/scans/latest?provider=codex&startAt=2026-06-14T00:00:00.000Z",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({
      latestScan: {
        candidateCount: 1,
        summary: {
          candidates: [
            expect.objectContaining({
              provider: "codex",
              title: "路由测试会话",
              estimatedBytes: 2048
            })
          ]
        }
      }
    });
  });

  it("可以读取备份包清单并发起恢复任务", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const user = hosted.services.repositories.authUserRepository.findByUsername("tester");
    expect(user).not.toBeNull();
    const userId = user!.id;
    const timestamp = "2026-06-15T10:00:00.000Z";
    const rawStoreRef = path.join(fixture.workspaceDir, ".codex", "session-route-restore-1.jsonl");
    mkdirSync(path.dirname(rawStoreRef), { recursive: true });
    writeFileSync(rawStoreRef, "{\"route\":true}\n", "utf8");

    hosted.services.repositories.workspaceRepository.create({
      id: "workspace-1",
      ownerUserId: userId,
      name: "Cleanup Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });

    const sessionBindingRepository = new SessionBindingRepository(hosted.services.database.db);
    const sessionIndexRepository = new SessionIndexRepository(hosted.services.database.db);
    const sessionSourceIndexRepository = new SessionSourceIndexRepository(hosted.services.database.db);

    sessionBindingRepository.upsert({
      sessionId: "session-route-restore-1",
      userId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-route-restore-1",
      rawStoreRef,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    sessionIndexRepository.upsert({
      sessionId: "session-route-restore-1",
      workspaceId: "workspace-1",
      provider: "codex",
      sessionVisibility: "workspace",
      parentSessionId: null,
      sessionKind: "default",
      annotationSourceMessageId: null,
      annotationSourceText: null,
      isSubagent: false,
      subagentLabel: null,
      title: "路由恢复会话",
      messageCount: 4,
      isArchived: false,
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    sessionSourceIndexRepository.upsert({
      sourceKey: `codex:${rawStoreRef}`,
      provider: "codex",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "provider-session-route-restore-1",
      rawStoreRef,
      workspacePath: fixture.workspaceDir,
      fingerprintMtimeMs: 1718000000000,
      fingerprintSizeBytes: 14,
      fingerprintInode: null,
      fingerprintVersion: null,
      title: "路由恢复会话",
      messageCount: 4,
      lastMessageAt: timestamp,
      isArchivedHint: false,
      lastParsedAt: timestamp,
      lastVerifiedAt: timestamp,
      sampleDueAt: null,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const scanTrigger = await hosted.app.inject({
      method: "POST",
      url: "/api/settings/session-cleanup/scans",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        providers: ["codex"],
        force: true
      }
    });
    expect(scanTrigger.statusCode).toBe(200);

    const latest = await hosted.app.inject({
      method: "GET",
      url: "/api/settings/session-cleanup/scans/latest",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const candidateId = latest.json().latestScan.summary.candidates[0].candidateId as string;
    const archivePath = path.join(fixture.workspaceDir, "backups", "route-backup.cns-session-cleanup");

    const backupTrigger = await hosted.app.inject({
      method: "POST",
      url: "/api/settings/session-cleanup/backups",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        candidateIds: [candidateId],
        archivePath
      }
    });
    expect(backupTrigger.statusCode).toBe(200);
    await waitForCondition(async () => {
      const fs = await import("node:fs");
      return fs.existsSync(archivePath);
    });

    databaseDeleteVisibleRecords(hosted);

    const inspect = await hosted.app.inject({
      method: "POST",
      url: "/api/settings/session-cleanup/backup-inspections",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        archivePath
      }
    });

    expect(inspect.statusCode).toBe(200);
    expect(inspect.json()).toMatchObject({
      manifest: {
        summary: {
          sessionCount: 1
        }
      },
      restorableEntries: [
        expect.objectContaining({
          title: "路由恢复会话",
          restorable: true
        })
      ]
    });

    const entryId = inspect.json().manifest.entries[0].entryId as string;
    const restoreTrigger = await hosted.app.inject({
      method: "POST",
      url: "/api/settings/session-cleanup/restores",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        archivePath,
        entryIds: [entryId]
      }
    });

    expect(restoreTrigger.statusCode).toBe(200);
    expect(restoreTrigger.json()).toMatchObject({
      taskType: "session_cleanup.restore"
    });
  });

  it("可以发起批量删除任务", async () => {
    const fixture = createEmptyFixture();
    activeFixtures.push(fixture);

    const hosted = createTestApp(fixture);
    activeServers.push(hosted);
    await hosted.app.ready();

    const accessToken = await bootstrapAndLogin(hosted);
    const user = hosted.services.repositories.authUserRepository.findByUsername("tester");
    expect(user).not.toBeNull();
    const userId = user!.id;
    const timestamp = "2026-06-15T10:00:00.000Z";

    hosted.services.repositories.workspaceRepository.create({
      id: "workspace-1",
      ownerUserId: userId,
      name: "Cleanup Workspace",
      path: fixture.workspaceDir,
      repoRoot: fixture.workspaceDir,
      favorite: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      removedAt: null
    });

    const sessionBindingRepository = new SessionBindingRepository(hosted.services.database.db);
    const sessionIndexRepository = new SessionIndexRepository(hosted.services.database.db);

    sessionBindingRepository.upsert({
      sessionId: "session-delete-route-1",
      userId,
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-delete-route-1",
      rawStoreRef: "/tmp/codex/session-delete-route-1.jsonl",
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    sessionIndexRepository.upsert({
      sessionId: "session-delete-route-1",
      workspaceId: "workspace-1",
      provider: "codex",
      sessionVisibility: "workspace",
      parentSessionId: null,
      sessionKind: "default",
      annotationSourceMessageId: null,
      annotationSourceText: null,
      isSubagent: false,
      subagentLabel: null,
      title: "路由删除会话",
      messageCount: 1,
      isArchived: false,
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    const scanTrigger = await hosted.app.inject({
      method: "POST",
      url: "/api/settings/session-cleanup/scans",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        providers: ["codex"],
        force: true
      }
    });
    expect(scanTrigger.statusCode).toBe(200);

    const latest = await hosted.app.inject({
      method: "GET",
      url: "/api/settings/session-cleanup/scans/latest",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    const candidateId = latest.json().latestScan.summary.candidates[0].candidateId as string;

    const deleteTrigger = await hosted.app.inject({
      method: "POST",
      url: "/api/settings/session-cleanup/deletions",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        candidateIds: [candidateId]
      }
    });

    expect(deleteTrigger.statusCode).toBe(200);
    expect(deleteTrigger.json()).toMatchObject({
      taskType: "session_cleanup.delete"
    });

    await waitForCondition(async () => {
      const latestDeleteTask = await hosted.app.inject({
        method: "GET",
        url: "/api/settings/session-cleanup/tasks/latest-delete",
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      });

      if (latestDeleteTask.statusCode !== 200) {
        return false;
      }

      const payload = latestDeleteTask.json().latestDeleteTask;
      return payload?.taskId === deleteTrigger.json().taskId && payload.totalCount > 0;
    });

    const latestDeleteTask = await hosted.app.inject({
      method: "GET",
      url: "/api/settings/session-cleanup/tasks/latest-delete",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(latestDeleteTask.statusCode).toBe(200);
    expect(latestDeleteTask.json()).toMatchObject({
      latestDeleteTask: {
        taskType: "session_cleanup.delete",
        totalCount: 1,
        successCount: 1,
        failedCount: 0
      }
    });
  });
});

function databaseDeleteVisibleRecords(hosted: ReturnType<typeof createTestApp>): void {
  hosted.services.database.db.prepare("DELETE FROM session_source_index").run();
  hosted.services.database.db.prepare("DELETE FROM session_indices").run();
  hosted.services.database.db.prepare("DELETE FROM session_bindings").run();
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("wait_for_condition_timeout");
}

async function bootstrapAndLogin(hosted: ReturnType<typeof createTestApp>): Promise<string> {
  await hosted.app.inject({
    method: "POST",
    url: "/api/public/setup",
    payload: {
      username: "tester",
      password: "password123"
    }
  });

  const loginResponse = await hosted.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: {
      username: "tester",
      password: "password123"
    }
  });

  return loginResponse.json().accessToken as string;
}
