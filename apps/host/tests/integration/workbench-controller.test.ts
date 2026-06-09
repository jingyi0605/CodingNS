import { describe, expect, it, vi } from "vitest";

import { WorkbenchController } from "../../src/modules/workbench/workbench-controller.js";

describe("WorkbenchController", () => {
  it("HTTP 工作台刷新即使带 await-discovery header，也只触发后台刷新并立即返回缓存", async () => {
    const refreshSnapshot = vi.fn(async () => ({
      revision: "rev-1",
      items: []
    }));
    const controller = new WorkbenchController({
      refreshSnapshot,
      getSnapshot: vi.fn()
    } as never);
    const reply = {
      send: vi.fn()
    };

    await controller.getSnapshot(
      {
        headers: {
          "x-codingns-workbench-refresh": "true",
          "x-codingns-workbench-await-discovery": "true"
        },
        auth: {
          user: {
            userId: "user-1"
          }
        }
      } as never,
      reply as never
    );

    expect(refreshSnapshot).toHaveBeenCalledWith("user-1", {
      force: true,
      awaitDiscovery: false
    });
    expect(reply.send).toHaveBeenCalledWith({
      revision: "rev-1",
      items: []
    });
  });
});
