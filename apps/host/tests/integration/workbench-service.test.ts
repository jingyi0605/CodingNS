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
        listWorkspaceSessions: vi.fn(() => [
          {
            sessionId: "session-visible"
          },
          {
            sessionId: "session-butler"
          }
        ])
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
});
