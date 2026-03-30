import type { WebSocket } from "ws";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { WorkbenchWsHub } from "../../src/ws/workbench-ws-hub.js";
import type { AuthContext } from "../../src/modules/auth/auth-service.js";
import type { WorkbenchService } from "../../src/modules/workbench/workbench-service.js";
import type { WorkspacePanelSnapshotService } from "../../src/modules/workbench/workspace-panel-snapshot-service.js";
import type { WorkspaceFileWatcher } from "../../src/modules/workbench/workspace-file-watcher.js";

function createMockFileWatcher() {
  return {
    setOnChange: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    dispose: vi.fn()
  } satisfies Pick<WorkspaceFileWatcher, "setOnChange" | "subscribe" | "unsubscribe" | "dispose">;
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

  it("Git 订阅刷新会按最小间隔节流，避免高频触发 Git 命令", async () => {
    vi.useFakeTimers();

    const client = {
      send: vi.fn()
    } as unknown as WebSocket;
    const authContext: AuthContext = {
      accessToken: "token",
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
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await flushAsyncTasks();
    expect(workspacePanelSnapshotService.getGitPanelSnapshot).toHaveBeenCalledTimes(2);

    hub.cleanupClient(client);
  });
});

async function flushAsyncTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
