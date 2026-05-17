import { AppError } from "../../shared/errors/app-error.js";
import type { BrowserExecutionBackend } from "./browser-task-payload.js";
import type { BrowserTaskExecutor } from "./browser-task-executor.js";

export class BrowserTaskExecutorRegistry {
  private readonly executors = new Map<BrowserExecutionBackend, BrowserTaskExecutor>();

  constructor(executors: BrowserTaskExecutor[]) {
    for (const executor of executors) {
      this.executors.set(executor.backend, executor);
    }
  }

  get(backend: BrowserExecutionBackend): BrowserTaskExecutor {
    const executor = this.executors.get(backend);

    if (executor) {
      return executor;
    }

    throw new AppError({
      statusCode: 400,
      errorCode: "BROWSER_EXECUTION_BACKEND_NOT_SUPPORTED",
      detail: `当前系统未注册浏览器执行后端 ${backend}`
    });
  }
}
