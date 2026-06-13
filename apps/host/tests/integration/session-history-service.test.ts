import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostConfig } from "../../src/config/env.js";
import { AppError } from "../../src/shared/errors/app-error.js";
import { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../src/modules/tasks/task-types.js";
import { SessionSourceIndexRepository } from "../../src/storage/repositories/session-source-index-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

const dbList: Array<ReturnType<typeof createDatabaseClient>> = [];

describe("SessionHistoryService", () => {
  afterEach(() => {
    while (dbList.length > 0) {
      dbList.pop()?.close();
    }
  });

  it("removed 工作区不会创建后台 discovery 任务", () => {
    const taskManager = createTaskManager();
    const service = createService({
      taskManager,
      workspaceRepository: {
        findById: vi.fn(() => ({
          id: "workspace-removed",
          ownerUserId: "user-1",
          name: "旧工作区",
          path: "/repo/removed",
          repoRoot: "/repo/removed",
          favorite: false,
          sortOrder: 0,
          createdAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
          removedAt: "2026-06-10T01:00:00.000Z"
        }))
      }
    });

    service.requestWorkspaceDiscovery("workspace-removed", "user-1");

    expect(taskManager.peek(HOST_TASK_TYPES.workspaceDiscovery, "workspace-removed")).toBeNull();
  });

  it("removed 工作区会拒绝显式 discovery", async () => {
    const service = createService({
      workspaceRepository: {
        findById: vi.fn(() => ({
          id: "workspace-removed",
          ownerUserId: "user-1",
          name: "旧工作区",
          path: "/repo/removed",
          repoRoot: "/repo/removed",
          favorite: false,
          sortOrder: 0,
          createdAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
          removedAt: "2026-06-10T01:00:00.000Z"
        }))
      }
    });

    await expect(service.discoverWorkspaceSessions("workspace-removed", "user-1"))
      .rejects
      .toMatchObject<AppError>({
        errorCode: "WORKSPACE_NOT_FOUND",
        statusCode: 404
      });
  });

  it("discovery 已在 running 时只追加脏原因，不重复入队", () => {
    const taskManager = createTaskManager();
    const service = createService({
      taskManager,
      workspaceRepository: {
        findById: vi.fn(() => ({
          id: "workspace-1",
          ownerUserId: "user-1",
          name: "正常工作区",
          path: "/repo/workspace-1",
          repoRoot: "/repo/workspace-1",
          favorite: false,
          sortOrder: 0,
          createdAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
          removedAt: null
        }))
      }
    });

    const statuses = (service as unknown as {
      workspaceDiscoveryStatuses: Map<string, {
        phase: string;
        dirtyReasons: Set<string>;
        refreshedAt: number;
        isComplete: boolean;
        partialCooldownUntil: number | null;
        lastRequestedAt: number | null;
        lastStartedAt: number | null;
        lastCompletedAt: number | null;
        lastFailedAt: number | null;
        nextAllowedAt: number | null;
        runningTaskId: string | null;
      }>;
    }).workspaceDiscoveryStatuses;

    statuses.set("workspace-1", {
      phase: "running",
      dirtyReasons: new Set(["existing"]),
      refreshedAt: Date.now(),
      isComplete: false,
      partialCooldownUntil: null,
      lastRequestedAt: null,
      lastStartedAt: Date.now(),
      lastCompletedAt: null,
      lastFailedAt: null,
      nextAllowedAt: null,
      runningTaskId: "task-1"
    });

    service.requestWorkspaceDiscovery("workspace-1", "user-1");

    expect(taskManager.peek(HOST_TASK_TYPES.workspaceDiscovery, "workspace-1")).toBeNull();
    expect([...statuses.get("workspace-1")!.dirtyReasons]).toContain("session_history.request_workspace_discovery");
  });

  it("knownSessions 会合并 source index 里的来源摘要", () => {
    const service = createService();
    const repository = new SessionSourceIndexRepository(getServiceDatabase(service));

    repository.upsert({
      sourceKey: "codex:raw:/tmp/codex/session-1.jsonl",
      provider: "codex",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "provider-session-1",
      rawStoreRef: "/tmp/codex/session-1.jsonl",
      workspacePath: "/tmp/codex",
      fingerprintMtimeMs: 1718000000000,
      fingerprintSizeBytes: 4096,
      fingerprintInode: null,
      fingerprintVersion: null,
      title: "来源缓存会话",
      messageCount: 12,
      lastMessageAt: "2026-06-10T10:00:00.000Z",
      isArchivedHint: true,
      lastParsedAt: "2026-06-10T10:01:00.000Z",
      lastVerifiedAt: "2026-06-10T10:02:00.000Z",
      sampleDueAt: null,
      deletedAt: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:02:00.000Z"
    });

    const knownSessions = (
      service as unknown as {
        buildKnownSessionSummaries: (
          sessions: Array<{
            provider: string;
            providerSessionId: string;
            rawStoreRef: string;
            title: string;
            isArchived: boolean;
            messageCount: number;
            lastMessageAt: string | null;
          }>,
          sourceIndexes: ReturnType<SessionSourceIndexRepository["listByWorkspaceId"]>,
          workspacePath: string
        ) => Array<{
          provider: string;
          providerSessionId: string;
          rawStoreRef: string;
          title: string;
          isArchived?: boolean;
          messageCount: number;
          lastMessageAt: string | null;
          sourceMtimeMs?: number;
          sourceSizeBytes?: number;
        }>;
      }
    ).buildKnownSessionSummaries([], repository.listByWorkspaceId("workspace-1"), "/tmp/fallback");

    expect(knownSessions).toEqual([
      expect.objectContaining({
        provider: "codex",
        providerSessionId: "provider-session-1",
        rawStoreRef: "/tmp/codex/session-1.jsonl",
        title: "来源缓存会话",
        isArchived: true,
        messageCount: 12,
        lastMessageAt: "2026-06-10T10:00:00.000Z",
        sourceMtimeMs: 1718000000000,
        sourceSizeBytes: 4096
      })
    ]);
  });

  it("repairSessionSourceIndex 可以只修复指定来源，不会把整个工作区全删掉", async () => {
    const service = createService({
      workspaceRepository: {
        findById: vi.fn(() => ({
          id: "workspace-1",
          ownerUserId: "user-1",
          name: "正常工作区",
          path: "/repo/workspace-1",
          repoRoot: "/repo/workspace-1",
          favorite: false,
          sortOrder: 0,
          createdAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T00:00:00.000Z",
          removedAt: null
        }))
      }
    });
    const repository = new SessionSourceIndexRepository(getServiceDatabase(service));
    const requestWorkspaceDiscovery = vi
      .spyOn(service, "requestWorkspaceDiscovery")
      .mockImplementation(() => {});

    repository.upsert({
      sourceKey: "codex:raw:/tmp/codex/a.jsonl",
      provider: "codex",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "codex-a",
      rawStoreRef: "/tmp/codex/a.jsonl",
      workspacePath: "/repo/workspace-1",
      fingerprintMtimeMs: 1,
      fingerprintSizeBytes: 1,
      fingerprintInode: null,
      fingerprintVersion: null,
      title: "codex-a",
      messageCount: 1,
      lastMessageAt: null,
      isArchivedHint: false,
      lastParsedAt: "2026-06-10T10:00:00.000Z",
      lastVerifiedAt: "2026-06-10T10:00:00.000Z",
      sampleDueAt: null,
      deletedAt: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z"
    });
    repository.upsert({
      sourceKey: "claude-code:raw:/tmp/claude/b.jsonl",
      provider: "claude-code",
      sourceKind: "jsonl",
      workspaceId: "workspace-1",
      providerSessionId: "claude-b",
      rawStoreRef: "/tmp/claude/b.jsonl",
      workspacePath: "/repo/workspace-1",
      fingerprintMtimeMs: 1,
      fingerprintSizeBytes: 1,
      fingerprintInode: null,
      fingerprintVersion: null,
      title: "claude-b",
      messageCount: 1,
      lastMessageAt: null,
      isArchivedHint: false,
      lastParsedAt: "2026-06-10T10:00:00.000Z",
      lastVerifiedAt: "2026-06-10T10:00:00.000Z",
      sampleDueAt: null,
      deletedAt: null,
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z"
    });

    const result = await service.repairSessionSourceIndex({
      workspaceId: "workspace-1",
      userId: "user-1",
      rawStoreRefs: ["/tmp/codex/a.jsonl"],
      awaitDiscovery: false
    });

    expect(result).toMatchObject({
      workspaceId: "workspace-1",
      provider: null,
      rawStoreRefCount: 1,
      clearedSourceCount: 1,
      awaitDiscovery: false
    });
    expect(repository.listByWorkspaceId("workspace-1").map((item) => item.provider)).toEqual(["claude-code"]);
    expect(requestWorkspaceDiscovery).toHaveBeenCalledWith("workspace-1", "user-1", {
      force: true,
      refreshStateMode: "deferred"
    });
  });

  it("Claude 原生 fork 切到新运行时文件后，历史消息序号会接在继承消息后面", () => {
    const service = Object.create(SessionHistoryService.prototype) as SessionHistoryService;
    Object.assign(service as unknown as {
      sessionForkRepository: {
        findBySessionId: ReturnType<typeof vi.fn>;
      };
      sessionIndexRepository: {
        findIndexRecordBySessionId: ReturnType<typeof vi.fn>;
      };
    }, {
      sessionForkRepository: {
        findBySessionId: vi.fn(() => ({
          sessionId: "child-session",
          parentSessionId: "parent-session",
          provider: "claude-code",
          forkSourceType: "message",
          forkSourceSessionId: "parent-session",
          forkSourceMessageId: "parent-message-1",
          inheritedPrefixMessageCount: 9,
          providerParentSessionId: "parent-provider-session",
          providerSourceMessageId: "parent-provider-message",
          forkMethod: "native_message_fork",
          createdAt: "2026-06-13T08:19:35.000Z"
        }))
      },
      sessionIndexRepository: {
        findIndexRecordBySessionId: vi.fn(() => ({
          sessionId: "child-session",
          createdAt: "2026-06-13T08:19:35.000Z"
        }))
      }
    });

    const page = (service as unknown as {
      offsetClaudeNativeForkRuntimePage: (sessionId: string, page: {
        messages: Array<{
          messageId: string;
          provider: string;
          providerSessionId: string;
          role: "user" | "assistant";
          kind: "text";
          content: string;
          toolCall: null;
          timestamp: string;
          sequence: number;
          rawRef: string;
        }>;
        cursor: string | null;
        nextCursor: string | null;
        total: number;
      }) => {
        messages: Array<{ sequence: number }>;
      };
    }).offsetClaudeNativeForkRuntimePage("child-session", {
      messages: [
        {
          messageId: "new-user",
          provider: "claude-code",
          providerSessionId: "new-provider-session",
          role: "user",
          kind: "text",
          content: "总结成200字",
          toolCall: null,
          timestamp: "2026-06-13T08:19:40.000Z",
          sequence: 1,
          rawRef: "claude-code://new#1"
        },
        {
          messageId: "new-assistant",
          provider: "claude-code",
          providerSessionId: "new-provider-session",
          role: "assistant",
          kind: "text",
          content: "这是总结",
          toolCall: null,
          timestamp: "2026-06-13T08:19:45.000Z",
          sequence: 2,
          rawRef: "claude-code://new#2"
        }
      ],
      cursor: null,
      nextCursor: null,
      total: 2
    });

    expect(page.messages.map((message) => message.sequence)).toEqual([10, 11]);
  });
});

function createService(overrides?: {
  workspaceRepository?: {
    findById: ReturnType<typeof vi.fn>;
  };
  taskManager?: ReturnType<typeof createTaskManager>;
}): SessionHistoryService {
  const database = createDatabaseClient(":memory:");
  const db = database.db;
  dbList.push(database);
  seedBaseData(db);

  const config: HostConfig = {
    host: "127.0.0.1",
    port: 3002,
    allowedCorsOrigins: [],
    webUiDir: null,
    webUiPort: 3000,
    databasePath: "/tmp/codingns-host-test.sqlite",
    pluginRootDir: "/tmp/codingns-plugins",
    filePreviewTokenSecret: "test",
    gitCredentialSecret: "test",
    teableCredentialSecret: "test",
    geminiHomeDir: "/tmp/gemini",
    geminiCliPath: "gemini",
    kimiHomeDir: "/tmp/kimi",
    kimiCliPath: "kimi",
    kimiConfigPath: "/tmp/kimi/config.toml",
    kimiDefaultModel: null,
    opencodeBaseUrl: "",
    opencodeCliPath: "opencode",
    opencodeBaseUrlResolver: undefined,
    opencodeDataDir: "/tmp/opencode",
    opencodeDbPath: "/tmp/opencode/opencode.db",
    releaseChannel: "stable",
    releaseManifestRoot: "/tmp/releases",
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 3600,
    terminalIdleTimeoutSeconds: 900,
    claudeCodeHomeDir: "/tmp/claude",
    legnaCodeHomeDir: "/tmp/legna",
    codexHomeDir: "/tmp/codex",
    tailscaleCliPath: "tailscale",
    ccSwitchCliPath: "cc-switch",
    ccSwitchDbPath: "/tmp/cc-switch.db",
    codexCliPath: "codex",
    legnaCodeCliPath: "legna",
    chromeExecutablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    edgeExecutablePath: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    doctCliPath: "doct",
    claudeHookBridgeToken: "test",
    serverUpdatePackageName: "@codingns/test",
    npmRegistryBaseUrl: "https://registry.npmjs.org",
    pm2ProcessName: "codingns-test",
    demoMode: false
  };

  return new SessionHistoryService(
    db,
    (overrides?.workspaceRepository ?? {
      findById: vi.fn(() => null)
    }) as never,
    {
      findBySessionId: vi.fn(() => null),
      findBySessionIdForUser: vi.fn(() => null),
      findByProviderSession: vi.fn(() => null),
      findByRawStoreRef: vi.fn(() => null),
      upsert: vi.fn()
    } as never,
    {
      recordMessages: vi.fn()
    } as never,
    {
      listByWorkspace: vi.fn(() => []),
      findIndexRecordBySessionId: vi.fn(() => null),
      findBySessionId: vi.fn(() => null),
      upsert: vi.fn(),
      renameTitle: vi.fn()
    } as never,
    {
      attachToMessages: vi.fn(async (_sessionId: string, messages: unknown[]) => messages)
    } as never,
    {
      findBySessionIdForUser: vi.fn(() => null),
      upsert: vi.fn(),
      deleteBySessionId: vi.fn(),
      updateFavorite: vi.fn()
    } as never,
    {
      findBySessionId: vi.fn(() => null),
      upsert: vi.fn()
    } as never,
    config,
    undefined,
    null,
    {
      upsert: vi.fn(),
      findBySessionId: vi.fn(() => null)
    },
    {},
    overrides?.taskManager
  );
}

function getServiceDatabase(service: SessionHistoryService) {
  return (service as unknown as { db: ReturnType<typeof createDatabaseClient>["db"] }).db;
}

function seedBaseData(db: ReturnType<typeof createDatabaseClient>["db"]): void {
  db.exec(`
    INSERT INTO auth_users (
      id,
      username,
      password_hash,
      role,
      status,
      created_at,
      updated_at
    ) VALUES (
      'user-1',
      'admin',
      'hash',
      'admin',
      'active',
      '2026-06-10T00:00:00.000Z',
      '2026-06-10T00:00:00.000Z'
    );

    INSERT INTO workspaces (
      id,
      owner_user_id,
      name,
      path,
      repo_root,
      favorite,
      sort_order,
      created_at,
      updated_at,
      removed_at
    ) VALUES (
      'workspace-1',
      'user-1',
      '测试工作区',
      '/tmp/workspace-1',
      '/tmp/workspace-1',
      0,
      0,
      '2026-06-10T00:00:00.000Z',
      '2026-06-10T00:00:00.000Z',
      NULL
    );
  `);
}
