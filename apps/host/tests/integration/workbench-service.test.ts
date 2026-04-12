import { describe, expect, it, vi } from "vitest";

import { WorkbenchService } from "../../src/modules/workbench/workbench-service.js";

describe("WorkbenchService", () => {
  it("快照会过滤掉 Butler 控制会话", () => {
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
        requestWorkspaceDiscovery: vi.fn()
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
});
