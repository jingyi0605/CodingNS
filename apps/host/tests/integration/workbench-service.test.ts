import { describe, expect, it, vi } from "vitest";

import { WorkbenchService } from "../../src/modules/workbench/workbench-service.js";

describe("WorkbenchService", () => {
  it("快照会过滤掉 Butler 控制会话", () => {
    const requestWorkspaceDiscovery = vi.fn();
    const service = new WorkbenchService(
      {
        list: vi.fn(() => [
          {
            id: "workspace-1",
            path: "/repo/workspace-1"
          }
        ])
      } as never,
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn(() => [
          {
            sessionId: "session-visible"
          },
          {
            sessionId: "session-butler"
          }
        ]),
        requestWorkspaceDiscovery
      } as never,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => ["session-butler"])
      } as never
    );

    const snapshot = service.getSnapshot("user-1");

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]?.sessions.map((session) => session.sessionId)).toEqual(["session-visible"]);
    expect(requestWorkspaceDiscovery).not.toHaveBeenCalled();
  });

  it("快照会过滤 Butler 工作目录及其子目录工作区", () => {
    const service = new WorkbenchService(
      {
        list: vi.fn(() => [
          {
            id: "workspace-1",
            path: "/repo/workspace-1"
          },
          {
            id: "workspace-butler-root",
            path: "/repo/data/host/butler-workspace"
          },
          {
            id: "workspace-butler-child",
            path: "/repo/data/host/butler-workspace/.butler-follow-up-evaluator"
          }
        ])
      } as never,
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn(() => []),
        requestWorkspaceDiscovery: vi.fn()
      } as never,
      {
        getProfile: vi.fn(() => ({
          workspacePath: "/repo/data/host/butler-workspace"
        }))
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never
    );

    const snapshot = service.getSnapshot("user-1");

    expect(snapshot.items.map((item) => item.workspace.id)).toEqual(["workspace-1"]);
  });

  it("快照会把子工作树挂到根工作区下面，并保留各自会话", () => {
    const service = new WorkbenchService(
      {
        list: vi.fn(() => [
          {
            id: "workspace-root",
            path: "/repo/root"
          },
          {
            id: "workspace-child",
            path: "/repo/root.worktrees/child"
          },
          {
            id: "workspace-grand-child",
            path: "/repo/root.worktrees/grand-child"
          }
        ])
      } as never,
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn((workspaceId: string) => {
          if (workspaceId === "workspace-root") {
            return [{ sessionId: "session-root" }];
          }

          if (workspaceId === "workspace-child") {
            return [{ sessionId: "session-child" }];
          }

          if (workspaceId === "workspace-grand-child") {
            return [{ sessionId: "session-grand-child" }];
          }

          return [];
        }),
        requestWorkspaceDiscovery: vi.fn()
      } as never,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never,
      {
        listWorkspaceIds: vi.fn(() => ["workspace-child", "workspace-grand-child"]),
        listByRootWorkspaceId: vi.fn(() => [
          {
            workspaceId: "workspace-child",
            rootWorkspaceId: "workspace-root",
            parentWorkspaceId: "workspace-root",
            sourceWorkspaceId: "workspace-root",
            mergeTargetWorkspaceId: "workspace-root",
            branchName: "feat/child",
            baseRef: "main",
            baseCommit: "abc123",
            headCommit: "abc123",
            displayName: "feat/child",
            depth: 1,
            lifecycleStatus: "active",
            mergedAt: null,
            removedAt: null,
            createdAt: "2026-04-12T12:00:00.000Z",
            updatedAt: "2026-04-12T12:00:00.000Z"
          },
          {
            workspaceId: "workspace-grand-child",
            rootWorkspaceId: "workspace-root",
            parentWorkspaceId: "workspace-child",
            sourceWorkspaceId: "workspace-child",
            mergeTargetWorkspaceId: "workspace-child",
            branchName: "feat/grand-child",
            baseRef: "feat/child",
            baseCommit: "abc123",
            headCommit: "def456",
            displayName: "feat/grand-child",
            depth: 2,
            lifecycleStatus: "active",
            mergedAt: null,
            removedAt: null,
            createdAt: "2026-04-12T12:10:00.000Z",
            updatedAt: "2026-04-12T12:10:00.000Z"
          }
        ])
      } as never
    );

    const snapshot = service.getSnapshot("user-1");

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]?.workspace.id).toBe("workspace-root");
    expect(snapshot.items[0]?.sessions.map((session) => session.sessionId)).toEqual(["session-root"]);
    expect(snapshot.items[0]?.childWorktrees).toHaveLength(1);
    expect(snapshot.items[0]?.childWorktrees?.[0]).toMatchObject({
      workspace: {
        id: "workspace-child"
      },
      sessions: [
        {
          sessionId: "session-child"
        }
      ]
    });
    expect(snapshot.items[0]?.childWorktrees?.[0]?.children).toHaveLength(1);
    expect(snapshot.items[0]?.childWorktrees?.[0]?.children[0]).toMatchObject({
      workspace: {
        id: "workspace-grand-child"
      },
      sessions: [
        {
          sessionId: "session-grand-child"
        }
      ]
    });
  });

  it("标题同步任务取消后会把 AbortSignal 传给 sessionHistoryService", async () => {
    let receivedSignal: AbortSignal | null = null;
    const service = new WorkbenchService(
      {
        list: vi.fn(() => [
          {
            id: "workspace-1",
            path: "/repo/workspace-1"
          }
        ])
      } as never,
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn(() => []),
        requestWorkspaceDiscovery: vi.fn(),
        syncWorkspaceSessionTitles: vi.fn(async (_workspaceId: string, _userId: string, _concurrency: number, signal?: AbortSignal) => {
          receivedSignal = signal ?? null;

          await new Promise<never>((_resolve, reject) => {
            if (!signal) {
              reject(new Error("missing signal"));
              return;
            }

            signal.addEventListener("abort", () => {
              reject(signal.reason ?? new Error("aborted"));
            }, { once: true });
          });
        })
      } as never,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never
    );

    const handle = service.scheduleSessionTitleSync("user-1");
    await flushMicrotasks();

    expect(receivedSignal).not.toBeNull();
    expect(receivedSignal?.aborted).toBe(false);

    handle.cancel("manual abort");

    await expect(handle.promise).rejects.toThrow("manual abort");
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("显式刷新才会调度工作区 discovery", async () => {
    const requestWorkspaceDiscovery = vi.fn();
    const service = new WorkbenchService(
      {
        list: vi.fn(() => [
          {
            id: "workspace-1",
            path: "/repo/workspace-1"
          }
        ])
      } as never,
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn(() => []),
        requestWorkspaceDiscovery
      } as never,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never
    );

    service.getSnapshot("user-1");
    expect(requestWorkspaceDiscovery).not.toHaveBeenCalled();

    await service.refreshSnapshot("user-1");

    expect(requestWorkspaceDiscovery).toHaveBeenCalledWith("workspace-1", "user-1", {
      maxAgeMs: 15_000,
      force: true,
      refreshStateMode: "deferred"
    });
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
