import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import { SessionChangedFileService } from "../../src/modules/sessions/session-changed-file-service.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { SessionMessageAttachmentService } from "../../src/modules/sessions/session-message-attachment-service.js";
import { runTaskHelperProcessHandler } from "../../src/modules/tasks/task-helper-process-handlers.js";
import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../src/modules/tasks/task-types.js";
import type { ProviderSessionDiscoveryHelperConfig } from "../../src/modules/provider/provider-discovery-helper-client.js";
import { SessionBindingRepository } from "../../src/storage/repositories/session-binding-repository.js";
import { SessionChangedFileRepository } from "../../src/storage/repositories/session-changed-file-repository.js";
import { SessionIndexRepository } from "../../src/storage/repositories/session-index-repository.js";
import { SessionMessageAttachmentRepository } from "../../src/storage/repositories/session-message-attachment-repository.js";
import { SessionStateRepository } from "../../src/storage/repositories/session-state-repository.js";
import { SessionStatusSnapshotRepository } from "../../src/storage/repositories/session-status-snapshot-repository.js";
import { WorkspaceRepository } from "../../src/storage/repositories/workspace-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("session.history_delta_read helper handler", () => {
  it("在 helper runtime 中复用 Codex checkpoint，并只返回追加消息", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "codingns-session-history-helper-"));
    tempDirs.push(rootDir);
    const workspacePath = join(rootDir, "workspace");
    const codexHomeDir = join(rootDir, "codex");
    const sessionFile = join(codexHomeDir, "sessions", "2026", "08", "15", "session.jsonl");
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(join(codexHomeDir, "sessions", "2026", "08", "15"), { recursive: true });

    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: join(rootDir, "claude"),
      codexHomeDir,
      legnaCodeHomeDir: join(rootDir, "legna"),
      geminiHomeDir: join(rootDir, "gemini"),
      kimiHomeDir: join(rootDir, "kimi"),
      opencodeDataDir: join(rootDir, "opencode"),
      opencodeDbPath: join(rootDir, "opencode", "opencode.db")
    });
    const helperConfig: ProviderSessionDiscoveryHelperConfig = {
      claudeCodeHomeDir: config.claudeCodeHomeDir,
      legnaCodeHomeDir: config.legnaCodeHomeDir,
      codexCliPath: config.codexCliPath,
      codexHomeDir: config.codexHomeDir,
      legnaCodeCliPath: config.legnaCodeCliPath,
      geminiCliPath: config.geminiCliPath,
      geminiHomeDir: config.geminiHomeDir,
      kimiDefaultModel: config.kimiDefaultModel,
      kimiHomeDir: config.kimiHomeDir,
      opencodeBaseUrl: config.opencodeBaseUrl,
      opencodeDataDir: config.opencodeDataDir,
      opencodeDbPath: config.opencodeDbPath
    };
    const providerSessionId = "session-helper-read";
    const initial = JSON.stringify({
      timestamp: "2026-08-15T08:00:00.000Z",
      type: "response_item",
      payload: {
        id: "initial-message",
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "初始消息" }]
      }
    });
    writeFileSync(sessionFile, `${initial}\n`, "utf8");

    const pageResult = await runTaskHelperProcessHandler("session.history_delta_read", {
      rootDir: workspacePath,
      config: helperConfig,
      provider: "codex",
      providerSessionId,
      rawStoreRef: sessionFile,
      cursor: null,
      limit: 20,
      direction: "backward",
      readMode: "page"
    }) as {
      readMode: "page";
      page: { messages: Array<{ content: string }> };
    };

    expect(pageResult.readMode).toBe("page");
    expect(pageResult.page.messages.map((message) => message.content)).toEqual(["初始消息"]);

    const appended = JSON.stringify({
      timestamp: "2026-08-15T08:00:01.000Z",
      type: "response_item",
      payload: {
        id: "appended-message",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "新增消息" }]
      }
    }).concat("\n");
    appendFileSync(sessionFile, appended, "utf8");

    const deltaResult = await runTaskHelperProcessHandler("session.history_delta_read", {
      rootDir: workspacePath,
      config: helperConfig,
      provider: "codex",
      providerSessionId,
      rawStoreRef: sessionFile,
      cursor: null,
      limit: 20,
      direction: "backward",
      readMode: "delta"
    }) as {
      readMode: "delta";
      delta: {
        bytesRead: number;
        messages: Array<{ content: string }>;
      };
    };

    expect(deltaResult.readMode).toBe("delta");
    expect(deltaResult.delta.bytesRead).toBe(Buffer.byteLength(appended, "utf8"));
    expect(deltaResult.delta.messages.map((message) => message.content)).toEqual(["新增消息"]);
  });

  it("来源协调器会把 Codex 脏标记变成一次 helper delta 并在关闭时释放来源", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "codingns-session-history-subscription-"));
    tempDirs.push(rootDir);
    const workspacePath = join(rootDir, "workspace");
    const codexHomeDir = join(rootDir, "codex");
    const sessionFile = join(codexHomeDir, "sessions", "2026", "08", "15", "session.jsonl");
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(join(codexHomeDir, "sessions", "2026", "08", "15"), { recursive: true });

    const config = resolveHostConfig({
      databasePath: ":memory:",
      claudeCodeHomeDir: join(rootDir, "claude"),
      codexHomeDir,
      legnaCodeHomeDir: join(rootDir, "legna"),
      geminiHomeDir: join(rootDir, "gemini"),
      kimiHomeDir: join(rootDir, "kimi"),
      opencodeDataDir: join(rootDir, "opencode"),
      opencodeDbPath: join(rootDir, "opencode", "opencode.db")
    });
    const initial = JSON.stringify({
      timestamp: "2026-08-15T08:00:00.000Z",
      type: "response_item",
      payload: {
        id: "initial-message",
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "初始消息" }]
      }
    });
    writeFileSync(sessionFile, `${initial}\n`, "utf8");

    const database = createDatabaseClient(":memory:");
    const workspaceRepository = new WorkspaceRepository(database.db);
    const sessionBindingRepository = new SessionBindingRepository(database.db);
    const sessionIndexRepository = new SessionIndexRepository(database.db);
    const helperLaneExecute = vi.fn(async (definition, input, context) => {
      if (definition.taskType !== HOST_TASK_TYPES.sessionHistoryDeltaRead) {
        return await definition.run(input, context);
      }

      return await runTaskHelperProcessHandler(
        "session.history_delta_read",
        input,
        context.signal
      );
    });
    const service = new SessionHistoryService(
      database.db,
      workspaceRepository,
      sessionBindingRepository,
      new SessionChangedFileService(new SessionChangedFileRepository(database.db)),
      sessionIndexRepository,
      new SessionMessageAttachmentService(new SessionMessageAttachmentRepository(database.db), config),
      new SessionStateRepository(database.db),
      new SessionStatusSnapshotRepository(database.db),
      config,
      undefined,
      null,
      null,
      {},
      createTaskManager(null, {
        helper_process: {
          execute: helperLaneExecute
        }
      })
    );
    vi.spyOn(service as never, "syncSessionTitleFromProvider" as never)
      .mockResolvedValue(undefined);

    database.db.prepare(
      `INSERT INTO auth_users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "user-1",
      "tester",
      "hash",
      "admin",
      "2026-08-15T08:00:00.000Z",
      "2026-08-15T08:00:00.000Z"
    );
    workspaceRepository.create({
      id: "workspace-1",
      ownerUserId: "user-1",
      name: "Workspace",
      path: workspacePath,
      repoRoot: workspacePath,
      favorite: false,
      createdAt: "2026-08-15T08:00:00.000Z",
      updatedAt: "2026-08-15T08:00:00.000Z",
      removedAt: null
    });
    sessionBindingRepository.upsert({
      sessionId: "session-1",
      userId: "user-1",
      workspaceId: "workspace-1",
      provider: "codex",
      providerSessionId: "provider-session-1",
      rawStoreRef: sessionFile,
      providerConfigMode: "global-default",
      providerPresetId: null,
      runtimeHomeDir: null,
      createdAt: "2026-08-15T08:00:00.000Z",
      updatedAt: "2026-08-15T08:00:00.000Z"
    });
    sessionIndexRepository.upsert({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      provider: "codex",
      title: "会话",
      messageCount: 1,
      isArchived: false,
      lastMessageAt: "2026-08-15T08:00:00.000Z",
      createdAt: "2026-08-15T08:00:00.000Z",
      updatedAt: "2026-08-15T08:00:00.000Z"
    });

    const envelopes: Array<{ type: string; messages: Array<{ content: string }> }> = [];
    const subscription = await service.subscribeSession(
      "session-1",
      null,
      20,
      (envelope) => {
        envelopes.push(envelope);
      },
      "user-1"
    );
    const appended = JSON.stringify({
      timestamp: "2026-08-15T08:00:01.000Z",
      type: "response_item",
      payload: {
        id: "appended-message",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "新增消息" }]
      }
    }).concat("\n");
    appendFileSync(sessionFile, appended, "utf8");
    const sourceKey = `codex:raw:${sessionFile}`;
    (service as unknown as {
      sessionHistorySourceCoordinator: { markDirty(source: string): void; getSourceCount(): number };
    }).sessionHistorySourceCoordinator.markDirty(sourceKey);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (envelopes.some((envelope) => envelope.type === "session.delta")) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(envelopes[0]).toMatchObject({
      type: "session.backfill",
      messages: [{ content: "初始消息" }]
    });
    expect(envelopes).toContainEqual(expect.objectContaining({
      type: "session.delta",
      messages: [expect.objectContaining({ content: "新增消息" })]
    }));
    expect(helperLaneExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: HOST_TASK_TYPES.sessionHistoryDeltaRead,
        executionLane: "helper_process",
        helperProcessHandler: "session.history_delta_read"
      }),
      expect.any(Object),
      expect.any(Object)
    );

    subscription.close();
    expect((service as unknown as {
      sessionHistorySourceCoordinator: { getSourceCount(): number };
    }).sessionHistorySourceCoordinator.getSourceCount()).toBe(0);
    database.close();
  });
});
