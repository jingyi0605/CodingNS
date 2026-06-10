import { describe, expect, it, vi } from "vitest";

import { WorkbenchService } from "../../src/modules/workbench/workbench-service.js";

describe("WorkbenchService", () => {
  it("快照会过滤掉 Butler 控制会话", () => {
    const requestWorkspaceDiscovery = vi.fn();
    const service = new WorkbenchService(
      createWorkspaceRepositoryStub([
        {
          id: "workspace-1",
          path: "/repo/workspace-1",
          favorite: false
        }
      ]),
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
      createWorkspaceRepositoryStub([
        {
          id: "workspace-1",
          path: "/repo/workspace-1",
          favorite: false
        },
        {
          id: "workspace-butler-root",
          path: "/repo/data/host/butler-workspace",
          favorite: false
        },
        {
          id: "workspace-butler-child",
          path: "/repo/data/host/butler-workspace/.butler-follow-up-evaluator",
          favorite: false
        }
      ]),
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
      createWorkspaceRepositoryStub([
        {
          id: "workspace-root",
          path: "/repo/root",
          favorite: false
        },
        {
          id: "workspace-child",
          path: "/repo/root.worktrees/child",
          favorite: false
        },
        {
          id: "workspace-grand-child",
          path: "/repo/root.worktrees/grand-child",
          favorite: false
        }
      ]),
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

  it("快照会直接使用 sessionHistoryService 过滤后的会话列表", () => {
    const service = new WorkbenchService(
      createWorkspaceRepositoryStub([
        {
          id: "workspace-1",
          path: "/repo/workspace-1",
          favorite: false
        }
      ]),
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn(() => [
          {
            sessionId: "session-claude",
            provider: "claude-code"
          }
        ]),
        requestWorkspaceDiscovery: vi.fn()
      } as never,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never
    );

    const snapshot = service.getSnapshot("user-1");

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]?.sessions).toMatchObject([
      {
        sessionId: "session-claude",
        provider: "claude-code"
      }
    ]);
  });

  it("标题同步任务取消后会把 AbortSignal 传给 sessionHistoryService", async () => {
    let receivedSignal: AbortSignal | null = null;
    const service = new WorkbenchService(
      createWorkspaceRepositoryStub([
        {
          id: "workspace-1",
          path: "/repo/workspace-1",
          favorite: false
        }
      ]),
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
      createWorkspaceRepositoryStub([
        {
          id: "workspace-1",
          path: "/repo/workspace-1",
          favorite: false
        }
      ]),
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

  it("显式要求等待 discovery 时，会先跑完工作区刷新再返回快照", async () => {
    const requestWorkspaceDiscovery = vi.fn();
    const discoverWorkspaceSessions = vi.fn(async () => []);
    const service = new WorkbenchService(
      createWorkspaceRepositoryStub([
        {
          id: "workspace-1",
          path: "/repo/workspace-1",
          favorite: false
        }
      ]),
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn(() => []),
        requestWorkspaceDiscovery,
        discoverWorkspaceSessions
      } as never,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never
    );

    await service.refreshSnapshot("user-1", {
      force: true,
      awaitDiscovery: true
    });

    expect(discoverWorkspaceSessions).toHaveBeenCalledWith("workspace-1", "user-1", {
      maxAgeMs: 15_000,
      force: true,
      refreshStateMode: "deferred"
    });
    expect(requestWorkspaceDiscovery).not.toHaveBeenCalled();
  });

  it("事务助手会话列表刷新默认只调度后台任务，不阻塞返回现有快照", async () => {
    const scheduleRefresh = vi.fn();
    const refreshNow = vi.fn(async () => {
      throw new Error("不应该同步等待刷新任务");
    });
    const service = new WorkbenchService(
      createWorkspaceRepositoryStub([]),
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn(() => []),
        requestWorkspaceDiscovery: vi.fn()
      } as never,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never,
      undefined,
      undefined,
      undefined,
      {
        readSnapshot: vi.fn(() => ({
          workspaceId: "workspace-1",
          userId: "user-1",
          projectId: "project-1",
          projectWorkspaceId: "agent-workspace-1",
          agentWorkspacePath: "/repo",
          sessions: [
            {
              sessionId: "session-cached",
              title: "缓存里的会话"
            }
          ],
          updatedAt: "2026-06-06T10:00:00.000Z"
        })),
        refreshNow,
        scheduleRefresh,
        shouldRefresh: vi.fn(() => true)
      } as never
    );

    const snapshot = await service.refreshAffairsAssistantSessionsSnapshot("workspace-1", "user-1", {
      force: true
    });

    expect(snapshot.sessions).toMatchObject([
      {
        sessionId: "session-cached",
        title: "缓存里的会话"
      }
    ]);
    expect(scheduleRefresh).toHaveBeenCalledWith("workspace-1", "user-1", {
      force: true,
      source: "workbench.refresh_affairs_assistant_sessions.background"
    });
    expect(refreshNow).not.toHaveBeenCalled();
  });

  it("事务助手会话列表只有显式要求等待时才同步刷新", async () => {
    const scheduleRefresh = vi.fn();
    const refreshNow = vi.fn(async () => ({
      workspaceId: "workspace-1",
      userId: "user-1",
      projectId: "project-1",
      projectWorkspaceId: "agent-workspace-1",
      agentWorkspacePath: "/repo",
      sessions: [
        {
          sessionId: "session-refreshed",
          title: "刷新后的会话"
        }
      ],
      updatedAt: "2026-06-06T10:00:10.000Z"
    }));
    const service = new WorkbenchService(
      createWorkspaceRepositoryStub([]),
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn(() => []),
        requestWorkspaceDiscovery: vi.fn()
      } as never,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never,
      undefined,
      undefined,
      undefined,
      {
        readSnapshot: vi.fn(() => null),
        refreshNow,
        scheduleRefresh,
        shouldRefresh: vi.fn(() => true)
      } as never
    );

    const snapshot = await service.refreshAffairsAssistantSessionsSnapshot("workspace-1", "user-1", {
      force: true,
      awaitRefresh: true
    });

    expect(snapshot.sessions).toMatchObject([
      {
        sessionId: "session-refreshed",
        title: "刷新后的会话"
      }
    ]);
    expect(refreshNow).toHaveBeenCalledWith("workspace-1", "user-1", {
      force: true,
      source: "workbench.refresh_affairs_assistant_sessions"
    });
    expect(scheduleRefresh).not.toHaveBeenCalled();
  });

  it("workbench 刷新会优先调度可见根工作区，并限制单轮 discovery 数量", async () => {
    const requestWorkspaceDiscovery = vi.fn();
    const workspaces = Array.from({ length: 8 }, (_, index) => ({
      id: `workspace-${index + 1}`,
      path: `/repo/workspace-${index + 1}`,
      favorite: false
    }));
    const service = new WorkbenchService(
      createWorkspaceRepositoryStub(workspaces),
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn(() => []),
        requestWorkspaceDiscovery,
        needsWorkspaceDiscovery: vi.fn(() => true),
        getWorkspaceDiscoveryStatusSummary: vi.fn(() => null)
      } as never,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never
    );

    await service.refreshSnapshot("user-1", {
      force: true
    });

    expect(requestWorkspaceDiscovery).toHaveBeenCalledTimes(6);
    expect(requestWorkspaceDiscovery.mock.calls.map((call) => call[0])).toEqual([
      "workspace-1",
      "workspace-2",
      "workspace-3",
      "workspace-4",
      "workspace-5",
      "workspace-6"
    ]);
  });

  it("冷工作区会用更大的 maxAgeMs，热工作树会优先刷新", async () => {
    const requestWorkspaceDiscovery = vi.fn();
    const service = new WorkbenchService(
      createWorkspaceRepositoryStub([
        {
          id: "workspace-root",
          path: "/repo/root",
          favorite: false
        },
        {
          id: "workspace-child-hot",
          path: "/repo/root.worktrees/hot",
          favorite: false
        },
        {
          id: "workspace-child-cold",
          path: "/repo/root.worktrees/cold",
          favorite: false
        }
      ]),
      {
        listByUserId: vi.fn(() => [])
      } as never,
      {
        listWorkspaceSessions: vi.fn((workspaceId: string) => {
          if (workspaceId === "workspace-child-hot") {
            return [{
              sessionId: "session-hot",
              activityState: "running",
              runningState: "running",
              updatedAt: "2026-06-10T10:00:00.000Z"
            }];
          }

          return [];
        }),
        requestWorkspaceDiscovery,
        needsWorkspaceDiscovery: vi.fn(() => true),
        getWorkspaceDiscoveryStatusSummary: vi.fn(() => null)
      } as never,
      {
        getProfile: vi.fn(() => null)
      } as never,
      {
        listSessionIds: vi.fn(() => [])
      } as never,
      {
        listWorkspaceIds: vi.fn(() => ["workspace-child-hot", "workspace-child-cold"]),
        listByRootWorkspaceId: vi.fn(() => [])
      } as never
    );

    await service.refreshSnapshot("user-1", {
      force: false
    });

    expect(requestWorkspaceDiscovery.mock.calls).toEqual([
      [
        "workspace-root",
        "user-1",
        {
          maxAgeMs: 15_000,
          force: false,
          refreshStateMode: "deferred"
        }
      ],
      [
        "workspace-child-hot",
        "user-1",
        {
          maxAgeMs: 60_000,
          force: false,
          refreshStateMode: "deferred"
        }
      ],
      [
        "workspace-child-cold",
        "user-1",
        {
          maxAgeMs: 120_000,
          force: false,
          refreshStateMode: "deferred"
        }
      ]
    ]);
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createWorkspaceRepositoryStub(
  workspaces: Array<{
    id: string;
    path: string;
    favorite: boolean;
  }>
) {
  return {
    listByOwnerUserId: vi.fn(() => workspaces)
  } as never;
}
