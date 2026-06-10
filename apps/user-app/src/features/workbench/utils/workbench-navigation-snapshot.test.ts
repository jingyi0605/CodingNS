import { describe, expect, it } from "vitest";

import {
  buildScopedWorkspaceKey,
  buildScopedWorkspaceKeyFromRef
} from "./workbench-navigation-snapshot";

describe("workbench-navigation-snapshot scoped key", () => {
  it("同 workspaceId 在不同 hostId 下不会冲突", () => {
    const currentKey = buildScopedWorkspaceKey("current", "workspace-1");
    const peerKey = buildScopedWorkspaceKey("peer-host-1", "workspace-1");

    expect(currentKey).not.toBe(peerKey);
    expect(currentKey).toBe("current:workspace-1");
    expect(peerKey).toBe("peer-host-1:workspace-1");
  });

  it("会编码 key 片段，避免分隔符和特殊字符导致串线", () => {
    expect(
      buildScopedWorkspaceKeyFromRef({
        hostId: "peer:host/1",
        workspaceId: "workspace:1/child"
      })
    ).toBe("peer%3Ahost%2F1:workspace%3A1%2Fchild");
  });
});
