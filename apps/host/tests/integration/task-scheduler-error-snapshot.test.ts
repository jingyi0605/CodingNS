import { describe, expect, it } from "vitest";

import { AppError } from "../../src/shared/errors/app-error.js";
import { createTaskManager } from "../../src/modules/tasks/task-manager.js";

describe("TaskScheduler error snapshot", () => {
  it("失败快照会保留 AppError 的 errorCode 和 detail", async () => {
    const manager = createTaskManager();

    manager.register({
      taskType: "test.app_error_snapshot",
      executionLane: "host_background",
      run: async () => {
        throw new AppError({
          statusCode: 409,
          errorCode: "OPENCLI_BRIDGE_LOAD_FAILED",
          detail: "无法加载 opencli 浏览器桥接模块: bridge module exploded"
        });
      }
    });

    const handle = manager.enqueue("test.app_error_snapshot", {
      key: "task-1",
      input: undefined
    });

    await expect(handle.promise).rejects.toMatchObject({
      errorCode: "OPENCLI_BRIDGE_LOAD_FAILED"
    });

    expect(manager.peek("test.app_error_snapshot", "task-1")).toMatchObject({
      status: "failed",
      errorCode: "OPENCLI_BRIDGE_LOAD_FAILED",
      errorMessage: "无法加载 opencli 浏览器桥接模块: bridge module exploded",
      errorDetail: "无法加载 opencli 浏览器桥接模块: bridge module exploded"
    });
  });
});
