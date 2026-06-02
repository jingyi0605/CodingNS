import { describe, expect, it } from "vitest";

import { resolveTaskHelperScheduling } from "../../../src/modules/tasks/task-helper-scheduling.js";

describe("resolveTaskHelperScheduling", () => {
  it("同一个 rootDir 的事务文档库重任务会落到同一个串行 bucket", () => {
    const indexTask = resolveTaskHelperScheduling("affairs.library_index", {
      rootDir: "/tmp/demo"
    });
    const exportTask = resolveTaskHelperScheduling("affairs.library_export", {
      rootDir: "/tmp/demo"
    });

    expect(indexTask).toEqual({
      bucket: "affairs-root:/tmp/demo",
      concurrency: 1
    });
    expect(exportTask).toEqual({
      bucket: "affairs-root:/tmp/demo",
      concurrency: 1
    });
  });

  it("不同 rootDir 的事务文档库重任务不会被错误串行", () => {
    const left = resolveTaskHelperScheduling("affairs.library_export", {
      rootDir: "/tmp/demo-a"
    });
    const right = resolveTaskHelperScheduling("affairs.library_export", {
      rootDir: "/tmp/demo-b"
    });

    expect(left.bucket).not.toBe(right.bucket);
    expect(left.concurrency).toBe(1);
    expect(right.concurrency).toBe(1);
  });

  it("普通 handler 仍按原有 handler 级并发规则执行", () => {
    const discovery = resolveTaskHelperScheduling("session.workspace_discovery", {
      workspacePath: "/tmp/workspace"
    });
    const defaultHandler = resolveTaskHelperScheduling("workspace.code_composition_scan", {
      workspacePath: "/tmp/workspace"
    });

    expect(discovery).toEqual({
      bucket: "handler:session.workspace_discovery",
      concurrency: 2
    });
    expect(defaultHandler.bucket).toBe("handler:workspace.code_composition_scan");
    expect(defaultHandler.concurrency).toBe(Number.POSITIVE_INFINITY);
  });
});
