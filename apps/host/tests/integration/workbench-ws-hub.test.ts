import type { WebSocket } from "ws";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import type { CodexArchiveWatcher } from "../../src/modules/workbench/codex-archive-watcher.js";
import { WorkbenchWsHub } from "../../src/ws/workbench-ws-hub.js";
import type { AuthContext } from "../../src/modules/auth/auth-service.js";
import type { TerminalService } from "../../src/modules/terminal/terminal-service.js";
import type { WorkbenchService } from "../../src/modules/workbench/workbench-service.js";
import type { WorkspacePanelSnapshotService } from "../../src/modules/workbench/workspace-panel-snapshot-service.js";
import type { WorkspaceFileWatcher } from "../../src/modules/workbench/workspace-file-watcher.js";

function createMockFileWatcher() {
  return {
    setOnChange: vi.fn(),
    subscribeFileTree: vi.fn(),
    unsubscribeFileTree: vi.fn(),
    subscribeGit: vi.fn(),
    unsubscribeGit: vi.fn(),
    dispose: vi.fn()
  } satisfies Pick<
    WorkspaceFileWatcher,
    "setOnChange" | "subscribeFileTree" | "unsubscribeFileTree" | "subscribeGit" | "unsubscribeGit" | "dispose"
  >;
}

function createMockCodexArchiveWatcher() {
  return {
    setOnChange: vi.fn()
  } satisfies Pick<CodexArchiveWatcher, "setOnChange">;
}

function createMockTerminalService() {
  return {
    on: vi.fn()
  } satisfies Pick<TerminalService, "on">;
}

describe("WorkbenchWsHub", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("Git 面板刷新超时只记录错误，不会留下未处理拒绝", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;
    const workspacePanelSnapshotService = {
      getGitPanelSnapshot: vi.fn(async () => {
        throw new AppError({
          statusCode: 504,
          errorCode: "GIT_COMMAND_TIMEOUT",
          detail: "Git 命令执行超时：git rev-parse --show-toplevel"
        });
      })
    } satisfies Pick<WorkspacePanelSnapshotService, "getGitPanelSnapshot">;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      workspacePanelSnapshotService as unknown as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "git.subscribe",
          workspaceId: "workspace-1"
        },
        authContext
      )
    ).toBe(true);

    await Promise.resolve();
    await new Promise<void>((resolve) => {
      setImmediate(() => resolve());
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[workbench-ws-error]",
      expect.objectContaining({
        scope: "refreshGitSubscription",
        workspaceId: "workspace-1",
        errorCode: "GIT_COMMAND_TIMEOUT"
      })
    );
    expect((client.send as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    hub.cleanupClient(client);
  });

  it("Git 订阅在没有脏标记时不会因为后台计时器自动重跑", async () => {
    vi.useFakeTimers();

    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;
    const workspacePanelSnapshotService = {
      invalidateGit: vi.fn(),
      getGitPanelSnapshot: vi.fn(async () => ({
        workspaceId: "workspace-1",
        status: {
          snapshot: {
            workspaceId: "workspace-1",
            repoRoot: "/repo",
            branch: "main",
            ahead: 0,
            behind: 0,
            hasRemote: true,
            isDirty: false,
            lastFetchedAt: null
          },
          changes: []
        },
        history: [],
        historyTotalCount: 0,
        historyNextCursor: null,
        branches: {
          currentBranch: "main",
          local: [],
          remote: []
        }
      }))
    } satisfies Pick<WorkspacePanelSnapshotService, "getGitPanelSnapshot">;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      workspacePanelSnapshotService as unknown as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "git.subscribe",
          workspaceId: "workspace-1"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(1);

    hub.cleanupClient(client);
  });

  it("重新订阅同一工作区的 Git 面板时，即使快照未变化也会重新下发当前数据", async () => {
    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;
    const workspacePanelSnapshotService = {
      getGitPanelSnapshot: vi.fn(async () => ({
        workspaceId: "workspace-1",
        status: {
          snapshot: {
            workspaceId: "workspace-1",
            repoRoot: "/repo",
            branch: "main",
            ahead: 0,
            behind: 0,
            hasRemote: true,
            isDirty: false,
            lastFetchedAt: null
          },
          changes: []
        },
        history: [],
        historyTotalCount: 0,
        historyNextCursor: null,
        branches: {
          currentBranch: "main",
          local: [],
          remote: []
        }
      }))
    } satisfies Pick<WorkspacePanelSnapshotService, "getGitPanelSnapshot">;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      workspacePanelSnapshotService as unknown as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "git.subscribe",
          workspaceId: "workspace-1"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    expect(client.send).toHaveBeenCalledTimes(1);
    vi.mocked(client.send).mockClear();

    expect(
      hub.handleMessage(
        client,
        {
          type: "git.subscribe",
          workspaceId: "workspace-1"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(2);
    expect(client.send).toHaveBeenCalledTimes(1);

    hub.cleanupClient(client);
  });

  it("Git 手动刷新在快照未变化时也会返回当前快照，避免前端卡死在 loading", async () => {
    const snapshot = {
      revision: "git-rev-1",
      workspaceId: "workspace-1",
      status: {
        snapshot: {
          workspaceId: "workspace-1",
          repoRoot: "/repo",
          branch: "main",
          ahead: 0,
          behind: 0,
          hasRemote: true,
          isDirty: false,
          lastFetchedAt: null
        },
        changes: []
      },
      history: [],
      historyTotalCount: 0,
      historyNextCursor: null,
      branches: {
        currentBranch: "main",
        local: [],
        remote: []
      }
    };
    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;
    const workspacePanelSnapshotService = {
      invalidateGit: vi.fn(),
      getGitPanelSnapshot: vi.fn(async () => snapshot)
    } satisfies Pick<WorkspacePanelSnapshotService, "getGitPanelSnapshot" | "invalidateGit">;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      workspacePanelSnapshotService as unknown as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "git.subscribe",
          workspaceId: "workspace-1",
          knownRevision: "git-rev-1"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    vi.mocked(client.send).mockClear();

    expect(
      hub.handleMessage(
        client,
        {
          type: "git.refresh",
          workspaceId: "workspace-1",
          knownRevision: "git-rev-1"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();

    expect(workspacePanelSnapshotService.invalidateGit).toHaveBeenCalledWith("workspace-1");
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(client.send).mock.calls[0]?.[0] as string)).toEqual({
      type: "git.snapshot",
      revision: "git-rev-1",
      unchanged: false,
      snapshot
    });

    hub.cleanupClient(client);
  });

  it("Git watcher 事件会经过 quiet window 合并，并在最小间隔后补跑一次", async () => {
    vi.useFakeTimers();

    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const fileWatcher = createMockFileWatcher();
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;
    const workspacePanelSnapshotService = {
      invalidateGit: vi.fn(),
      getGitPanelSnapshot: vi.fn(async () => ({
        workspaceId: "workspace-1",
        status: {
          snapshot: {
            workspaceId: "workspace-1",
            repoRoot: "/repo",
            branch: "main",
            ahead: 0,
            behind: 0,
            hasRemote: true,
            isDirty: false,
            lastFetchedAt: null
          },
          changes: []
        },
        history: [],
        historyTotalCount: 0,
        historyNextCursor: null,
        branches: {
          currentBranch: "main",
          local: [],
          remote: []
        }
      }))
    } satisfies Pick<WorkspacePanelSnapshotService, "getGitPanelSnapshot" | "invalidateGit">;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      workspacePanelSnapshotService as unknown as WorkspacePanelSnapshotService,
      fileWatcher as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "git.subscribe",
          workspaceId: "workspace-1"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(1);

    const onChange = vi.mocked(fileWatcher.setOnChange).mock.calls[0]?.[0];
    expect(typeof onChange).toBe("function");

    onChange?.({
      workspaceId: "workspace-1",
      scope: "git"
    });
    onChange?.({
      workspaceId: "workspace-1",
      scope: "git"
    });

    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(799);
    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14_200);
    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(2);

    hub.cleanupClient(client);
  });

  it("侧边栏定时刷新不会再顺带同步会话标题", async () => {
    vi.useFakeTimers();

    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;
    const workspacePanelSnapshotService = {
      getGitPanelSnapshot: vi.fn(async () => ({
        workspaceId: "workspace-1",
        status: {
          snapshot: {
            workspaceId: "workspace-1",
            repoRoot: "/repo",
            branch: "main",
            ahead: 0,
            behind: 0,
            hasRemote: true,
            isDirty: false,
            lastFetchedAt: null
          },
          changes: []
        },
        history: [],
        historyTotalCount: 0,
        historyNextCursor: null,
        branches: {
          currentBranch: "main",
          local: [],
          remote: []
        }
      }))
    } satisfies Pick<WorkspacePanelSnapshotService, "getGitPanelSnapshot">;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      workspacePanelSnapshotService as unknown as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "git.subscribe",
          workspaceId: "workspace-1"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    expect(workbenchService.syncSessionTitles).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    await flushAsyncTasks();

    expect(workbenchService.syncSessionTitles).not.toHaveBeenCalled();

    hub.cleanupClient(client);
  });

  it("侧边栏定时刷新不会再主动轮询文件树订阅", async () => {
    vi.useFakeTimers();

    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;
    const workspacePanelSnapshotService = {
      getFileTreeSnapshot: vi.fn(async () => ({
        workspaceId: "workspace-1",
        path: "",
        items: []
      })),
      getGitPanelSnapshot: vi.fn(async () => ({
        workspaceId: "workspace-1",
        status: {
          snapshot: {
            workspaceId: "workspace-1",
            repoRoot: "/repo",
            branch: "main",
            ahead: 0,
            behind: 0,
            hasRemote: true,
            isDirty: false,
            lastFetchedAt: null
          },
          changes: []
        },
        history: [],
        historyTotalCount: 0,
        historyNextCursor: null,
        branches: {
          currentBranch: "main",
          local: [],
          remote: []
        }
      }))
    } satisfies Pick<WorkspacePanelSnapshotService, "getFileTreeSnapshot" | "getGitPanelSnapshot">;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      workspacePanelSnapshotService as unknown as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "fileTree.subscribe",
          workspaceId: "workspace-1",
          paths: [""]
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getFileTreeSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await flushAsyncTasks();

    expect(workspacePanelSnapshotService.getFileTreeSnapshot).toHaveBeenCalledTimes(1);

    hub.cleanupClient(client);
  });

  it("侧边栏定时刷新发现会话过期时也只广播缓存，不触发 discovery", async () => {
    vi.useFakeTimers();

    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const workbenchService = {
      getSnapshot: vi.fn(() => ({
        revision: "rev-1",
        items: []
      })),
      shouldRefreshSnapshot: vi.fn(() => true),
      refreshSnapshot: vi.fn(async () => ({
        revision: "rev-2",
        items: []
      })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      {} as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "workbench.subscribe"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    expect(workbenchService.refreshSnapshot).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await flushAsyncTasks();
    await vi.advanceTimersByTimeAsync(120);
    await flushAsyncTasks();

    expect(workbenchService.shouldRefreshSnapshot).toHaveBeenCalled();
    expect(workbenchService.refreshSnapshot).not.toHaveBeenCalled();
    expect(workbenchService.getSnapshot).toHaveBeenCalledTimes(2);

    hub.cleanupClient(client);
  });

  it("实时会话广播会在短时间内合并，避免每条消息都全量刷新工作台", async () => {
    vi.useFakeTimers();

    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const workbenchService = {
      getSnapshot: vi
        .fn()
        .mockReturnValueOnce({
          revision: "rev-1",
          items: [
            {
              workspace: {
                id: "workspace-1",
                name: "Workspace",
                path: "/workspace",
                repoRoot: "/workspace",
                favorite: false,
                createdAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-01T00:00:00.000Z"
              },
              sessions: []
            }
          ]
        })
        .mockReturnValue({
          revision: "rev-2",
          items: [
            {
              workspace: {
                id: "workspace-1",
                name: "Workspace",
                path: "/workspace",
                repoRoot: "/workspace",
                favorite: false,
                createdAt: "2026-04-01T00:00:00.000Z",
                updatedAt: "2026-04-01T00:00:00.000Z"
              },
              sessions: [
                {
                  sessionId: "session-1",
                  workspaceId: "workspace-1",
                  provider: "codex",
                  providerSessionId: "provider-session-1",
                  rawStoreRef: "raw://session-1",
                  isArchived: false,
                  isFavorite: false,
                  title: "新消息来了",
                  messageCount: 1,
                  lastMessageAt: "2026-04-01T10:00:00.000Z",
                  createdAt: "2026-04-01T00:00:00.000Z",
                  updatedAt: "2026-04-01T10:00:00.000Z",
                  syncStatus: "idle",
                  syncCursor: null,
                  lastSyncAt: "2026-04-01T10:00:00.000Z",
                  lastErrorCode: null,
                  lastErrorDetail: null,
                  resumedAt: null,
                  runningState: "running",
                  activitySource: "runtime",
                  lastEventAt: "2026-04-01T10:00:00.000Z",
                  completedAt: null,
                  lastSeenAt: null,
                  activityState: "running"
                }
              ]
            }
          ]
        }),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      {} as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "workbench.subscribe"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    expect(workbenchService.getSnapshot).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledTimes(1);
    vi.mocked(client.send).mockClear();

    void hub.broadcastSnapshot("user-1");
    void hub.broadcastSnapshot("user-1");
    void hub.broadcastSnapshot("user-1");

    await flushAsyncTasks();
    expect(workbenchService.getSnapshot).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(120);
    await flushAsyncTasks();

    expect(workbenchService.getSnapshot).toHaveBeenCalledTimes(2);
    expect(client.send).toHaveBeenCalledTimes(1);

    hub.cleanupClient(client);
  });

  it("workbench.subscribe 只发送缓存快照，不再触发 discovery", async () => {
    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const refreshSnapshot = vi.fn(async () => ({
      revision: "rev-2",
      items: [
        {
          workspace: {
            id: "workspace-1",
            name: "CodingNS",
            path: "/Users/jackson/Code/CodingNS"
          },
          sessions: [
            {
              sessionId: "session-1",
              workspaceId: "workspace-1",
              provider: "codex",
              isArchived: false,
              isFavorite: false,
              title: "来自原生 Codex 的会话",
              messageCount: 5,
              lastMessageAt: "2026-04-29T10:00:00.000Z",
              createdAt: "2026-04-29T09:55:00.000Z",
              updatedAt: "2026-04-29T10:00:00.000Z",
              syncStatus: "idle",
              lastErrorCode: null,
              lastErrorDetail: null,
              runningState: "idle",
              activitySource: "inferred",
              activityResolutionSource: "history_refresh",
              lastEventAt: "2026-04-29T10:00:00.000Z",
              completedAt: null,
              lastSeenAt: null,
              activityState: "idle"
            }
          ],
          collapsed: false
        }
      ]
    }));
    const workbenchService = {
      getSnapshot: vi.fn(() => ({
        revision: "rev-1",
        items: []
      })),
      shouldRefreshSnapshot: vi.fn(() => true),
      refreshSnapshot,
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      {} as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "workbench.subscribe"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();

    expect(workbenchService.getSnapshot).toHaveBeenCalledWith("user-1");
    expect(refreshSnapshot).not.toHaveBeenCalled();

    const sentPayloads = (client.send as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => JSON.parse(call[0] as string));

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toEqual(
      expect.objectContaining({
        type: "workbench.snapshot",
        revision: "rev-1"
      })
    );

    hub.cleanupClient(client);
  });

  it("fileTree.subscribe 会把 watcher 收缩到当前展开路径，并在关闭时释放", async () => {
    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const fileWatcher = createMockFileWatcher();
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;
    const workspacePanelSnapshotService = {
      getFileTreeSnapshot: vi.fn(async () => ({
        workspaceId: "workspace-1",
        path: "src",
        items: []
      }))
    } satisfies Pick<WorkspacePanelSnapshotService, "getFileTreeSnapshot">;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      workspacePanelSnapshotService as unknown as WorkspacePanelSnapshotService,
      fileWatcher as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "fileTree.subscribe",
          workspaceId: "workspace-1",
          paths: ["src", "src/components"]
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();

    expect(fileWatcher.subscribeFileTree).toHaveBeenCalledWith("workspace-1", ["src", "src/components"]);

    hub.cleanupClient(client);

    expect(fileWatcher.unsubscribeFileTree).toHaveBeenCalledWith("workspace-1", ["src", "src/components"]);
  });

  it("fileTree.subscribe 遇到不存在的工作区时只记录错误，不会抛出导致 Host 崩溃", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const fileWatcher = createMockFileWatcher();
    vi.mocked(fileWatcher.subscribeFileTree).mockImplementation(() => {
      throw new AppError({
        statusCode: 404,
        errorCode: "WORKSPACE_NOT_FOUND",
        detail: "指定工作区不存在"
      });
    });
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      {} as WorkspacePanelSnapshotService,
      fileWatcher as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "fileTree.subscribe",
          workspaceId: "missing-workspace",
          paths: [""]
        },
        authContext
      )
    ).toBe(true);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[workbench-ws-error]",
      expect.objectContaining({
        scope: "handleMessage",
        userId: "user-1",
        workspaceId: "missing-workspace",
        errorCode: "WORKSPACE_NOT_FOUND",
        detail: "指定工作区不存在"
      })
    );
    expect(fileWatcher.unsubscribeFileTree).not.toHaveBeenCalled();
  });

  it("workbench.refresh 只刷新工作台快照，不再顺带触发标题同步", async () => {
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const refreshSnapshot = vi.fn(async () => ({ items: [] }));
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot,
      syncSessionTitles: vi.fn(async () => ({ items: [] })),
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      {} as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        { send: vi.fn() } as unknown as WebSocket,
        {
          type: "workbench.refresh"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();

    expect(refreshSnapshot).toHaveBeenCalledWith("user-1", {
      force: true,
      awaitDiscovery: false
    });
    expect(workbenchService.syncSessionTitles).not.toHaveBeenCalled();
  });

  it("Codex 归档目录变化只广播缓存快照，不再触发 discovery", async () => {
    vi.useFakeTimers();
    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const refreshSnapshot = vi.fn(async () => ({
      revision: "rev-2",
      items: [
        {
          workspace: {
            id: "workspace-1",
            name: "项目一",
            path: "/repo/workspace-1"
          },
          sessions: [
            {
              sessionId: "session-1",
              workspaceId: "workspace-1",
              provider: "codex",
              isArchived: true,
              isFavorite: false,
              title: "已归档会话",
              messageCount: 3,
              lastMessageAt: "2026-04-23T12:00:00.000Z",
              createdAt: "2026-04-23T11:59:00.000Z",
              updatedAt: "2026-04-23T12:01:00.000Z",
              syncStatus: "idle",
              lastErrorCode: null,
              lastErrorDetail: null,
              runningState: "idle",
              activitySource: "inferred",
              activityResolutionSource: "history_refresh",
              lastEventAt: "2026-04-23T12:01:00.000Z",
              completedAt: null,
              lastSeenAt: null,
              activityState: "idle"
            }
          ],
          collapsed: false
        }
      ]
    }));
    const workbenchService = {
      getSnapshot: vi.fn(() => ({
        revision: "rev-1",
        items: [
          {
            workspace: {
              id: "workspace-1",
              name: "项目一",
              path: "/repo/workspace-1"
            },
            sessions: [
              {
                sessionId: "session-1",
                workspaceId: "workspace-1",
                provider: "codex",
                isArchived: false,
                isFavorite: false,
                title: "活跃会话",
                messageCount: 3,
                lastMessageAt: "2026-04-23T12:00:00.000Z",
                createdAt: "2026-04-23T11:59:00.000Z",
                updatedAt: "2026-04-23T12:00:00.000Z",
                syncStatus: "idle",
                lastErrorCode: null,
                lastErrorDetail: null,
                runningState: "idle",
                activitySource: "inferred",
                activityResolutionSource: "history_refresh",
                lastEventAt: "2026-04-23T12:00:00.000Z",
                completedAt: null,
                lastSeenAt: null,
                activityState: "idle"
              }
            ],
            collapsed: false
          }
        ]
      })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot,
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;
    const codexArchiveWatcher = createMockCodexArchiveWatcher();

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      {} as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher,
      undefined,
      codexArchiveWatcher as unknown as CodexArchiveWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "workbench.subscribe"
        },
        authContext
      )
    ).toBe(true);

    const onChange = (codexArchiveWatcher.setOnChange as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as (() => void) | undefined;

    expect(onChange).toBeTypeOf("function");
    onChange?.();
    await flushAsyncTasks();
    expect(refreshSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(120);
    await flushAsyncTasks();

    const sentPayloads = (client.send as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => JSON.parse(call[0] as string));

    expect(sentPayloads.at(-1)).toEqual(
      expect.objectContaining({
        type: "workbench.snapshot",
        revision: "rev-1"
      })
    );
    expect(sentPayloads.at(-1)?.snapshot?.items?.[0]?.sessions?.[0]?.isArchived).toBe(false);
  });

  it("Terminal 面板刷新改成事件驱动，状态抖动会经过 quiet window 合并", async () => {
    vi.useFakeTimers();

    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const terminalService = createMockTerminalService();
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] }))
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles"
    >;
    const workspacePanelSnapshotService = {
      invalidateTerminalManager: vi.fn(),
      getTerminalManagerSnapshot: vi.fn(async () => ({
        workspaceId: "workspace-1",
        terminals: [],
        templates: [],
        templateStatuses: [],
        shellOptions: []
      }))
    } satisfies Pick<
      WorkspacePanelSnapshotService,
      "getTerminalManagerSnapshot" | "invalidateTerminalManager"
    >;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      workspacePanelSnapshotService as unknown as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher,
      terminalService
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "terminalManager.subscribe",
          workspaceId: "workspace-1"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getTerminalManagerSnapshot).toHaveBeenCalledTimes(1);

    const statusListener = vi.mocked(terminalService.on).mock.calls.find(
      ([event]) => event === "status"
    )?.[1] as ((terminal: { workspaceId: string }) => void) | undefined;

    expect(statusListener).toBeDefined();

    statusListener?.({ workspaceId: "workspace-1" });
    statusListener?.({ workspaceId: "workspace-1" });

    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getTerminalManagerSnapshot).toHaveBeenCalledTimes(1);
    expect(workspacePanelSnapshotService.invalidateTerminalManager).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(299);
    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getTerminalManagerSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getTerminalManagerSnapshot).toHaveBeenCalledTimes(2);

    hub.cleanupClient(client);
  });

  it("侧边栏定时刷新默认不会自动触发 workspaceManagement A/B 刷新", async () => {
    vi.useFakeTimers();

    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
      callerKind: "interactive_user",
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin"
      }
    };
    const workbenchService = {
      getSnapshot: vi.fn(() => ({ items: [] })),
      shouldRefreshSnapshot: vi.fn(() => false),
      refreshSnapshot: vi.fn(async () => ({ items: [] })),
      syncSessionTitles: vi.fn(async () => ({ items: [] })),
      scheduleSessionTitleSync: vi.fn()
    } satisfies Pick<
      WorkbenchService,
      "getSnapshot" | "shouldRefreshSnapshot" | "refreshSnapshot" | "syncSessionTitles" | "scheduleSessionTitleSync"
    >;
    const workspacePanelSnapshotService = {
      getWorkspaceManagementSnapshot: vi.fn(async () => ({
        workspaceId: "workspace-1",
        name: "workspace",
        path: "/workspace",
        git: {
          isRepository: false,
          repoRoot: null,
          currentBranch: null,
          commitCount: null,
          remotes: [],
          error: null
        },
        codeComposition: {
          scannedFileCount: 0,
          truncated: false,
          items: [],
          error: null
        }
      }))
    } satisfies Pick<WorkspacePanelSnapshotService, "getWorkspaceManagementSnapshot">;

    const hub = new WorkbenchWsHub(
      workbenchService as unknown as WorkbenchService,
      workspacePanelSnapshotService as unknown as WorkspacePanelSnapshotService,
      createMockFileWatcher() as unknown as WorkspaceFileWatcher
    );

    expect(
      hub.handleMessage(
        client,
        {
          type: "workspaceManagement.subscribe",
          workspaceId: "workspace-1"
        },
        authContext
      )
    ).toBe(true);

    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getWorkspaceManagementSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await flushAsyncTasks();

    expect(workspacePanelSnapshotService.getWorkspaceManagementSnapshot).toHaveBeenCalledTimes(1);

    hub.cleanupClient(client);
  });
});

async function flushAsyncTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
