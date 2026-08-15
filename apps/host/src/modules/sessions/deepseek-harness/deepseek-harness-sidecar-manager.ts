import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";

import { TaskManager } from "../../tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../tasks/task-types.js";
import { resolveCommandLaunch } from "../../../shared/utils/command-launch.js";
import { resolveCommandVersion } from "../../../shared/utils/command-version.js";
import { DeepSeekHarnessApiClient } from "./deepseek-harness-api-client.js";

export type DeepSeekHarnessSidecarStatus = "stopped" | "starting" | "ready" | "degraded" | "stopping" | "failed";

export interface DeepSeekHarnessSidecarState {
  instanceId: string;
  status: DeepSeekHarnessSidecarStatus;
  pid: number | null;
  baseUrl: string | null;
  harnessVersion: string | null;
  startedAt: string | null;
  lastError: string | null;
}

export interface DeepSeekHarnessSidecarManagerOptions {
  taskManager: TaskManager;
  commandPath?: string;
  commandArgs?: string[];
  bindHost?: "127.0.0.1" | "0.0.0.0";
  requestTimeoutMs?: number;
  startupTimeoutMs?: number;
  expectedVersion?: string;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawn;
  portAllocator?: () => Promise<number>;
  fetchImpl?: typeof fetch;
}

/** 只管理 CodingNS 自己启动的 sidecar，外部进程不会被接管。 */
export class DeepSeekHarnessSidecarManager {
  private readonly options: Required<Pick<DeepSeekHarnessSidecarManagerOptions, "requestTimeoutMs" | "startupTimeoutMs" | "expectedVersion">> & DeepSeekHarnessSidecarManagerOptions;
  private child: ChildProcess | null = null;
  private state: DeepSeekHarnessSidecarState = {
    instanceId: "sidecar-" + randomUUID(),
    status: "stopped",
    pid: null,
    baseUrl: null,
    harnessVersion: null,
    startedAt: null,
    lastError: null
  };

  constructor(options: DeepSeekHarnessSidecarManagerOptions) {
    this.options = {
      requestTimeoutMs: 5_000,
      startupTimeoutMs: 45_000,
      expectedVersion: "0.1.0-rc.5",
      ...options
    };
    this.options.taskManager.register({
      taskType: HOST_TASK_TYPES.harnessSidecarHealth,
      executionLane: "external_process",
      concurrency: 1,
      timeoutMs: this.options.startupTimeoutMs,
      retryPolicy: { maxAttempts: 1 },
      run: async (_input, context) => this.startOwnedSidecar(context.signal)
    });
  }

  getState(): DeepSeekHarnessSidecarState {
    return { ...this.state };
  }

  async ensureReady(): Promise<{ baseUrl: string; instanceId: string; harnessVersion: string | null }> {
    if (this.state.status === "ready" && this.state.baseUrl) {
      return { baseUrl: this.state.baseUrl, instanceId: this.state.instanceId, harnessVersion: this.state.harnessVersion };
    }

    const handle = this.options.taskManager.enqueue<{}, { baseUrl: string; instanceId: string; harnessVersion: string | null }>(HOST_TASK_TYPES.harnessSidecarHealth, {
      key: "deepseek-harness",
      input: {},
      source: "deepseek-harness"
    });
    return handle.promise;
  }

  async createClient(): Promise<DeepSeekHarnessApiClient> {
    const ready = await this.ensureReady();
    return new DeepSeekHarnessApiClient({
      baseUrl: ready.baseUrl,
      requestTimeoutMs: this.options.requestTimeoutMs,
      fetchImpl: this.options.fetchImpl
    });
  }

  async shutdown(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.state = { ...this.state, status: "stopped", pid: null, baseUrl: null };
      return;
    }

    this.state = { ...this.state, status: "stopping" };
    child.kill();
    await Promise.race([once(child, "exit"), delay(2_000)]);
    this.child = null;
    this.state = { ...this.state, status: "stopped", pid: null, baseUrl: null };
  }

  private async startOwnedSidecar(signal?: AbortSignal): Promise<{ baseUrl: string; instanceId: string; harnessVersion: string | null }> {
    if (this.state.status === "ready" && this.state.baseUrl) {
      return { baseUrl: this.state.baseUrl, instanceId: this.state.instanceId, harnessVersion: this.state.harnessVersion };
    }

    this.state = { ...this.state, status: "starting", lastError: null };
    const port = await (this.options.portAllocator ?? allocateLoopbackPort)();
    const baseUrl = `http://127.0.0.1:${port}`;
    const bindHost = this.options.bindHost ?? "127.0.0.1";
    const commandPath = this.options.commandPath ?? "dsh";
    const usesDefaultCommandArgs = this.options.commandArgs === undefined;
    const commandArgs = this.options.commandArgs ?? ["web", "--host", bindHost, "--port", String(port)];

    if (!hasSupportedBindHost(commandArgs)) {
      throw new Error("HARNESS_BIND_HOST_UNSUPPORTED");
    }

    // rc.5 的 host.describe.version 固定是上游占位值 0.0.1，必须读取 CLI 本身的版本。
    const commandVersion = usesDefaultCommandArgs ? resolveCommandVersion(commandPath) : null;
    if (usesDefaultCommandArgs && commandVersion !== this.options.expectedVersion) {
      this.state = { ...this.state, status: "failed", baseUrl: null, lastError: "HARNESS_VERSION_UNSUPPORTED" };
      throw new Error("HARNESS_VERSION_UNSUPPORTED");
    }

    const launch = resolveCommandLaunch(commandPath, commandArgs);
    const child = (this.options.spawnImpl ?? spawn)(launch.command, launch.args, {
      env: { ...process.env, ...this.options.env, HOST: bindHost, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
      shell: launch.shell
    });
    this.child = child;
    this.state = { ...this.state, pid: child.pid ?? null, baseUrl, startedAt: new Date().toISOString() };
    // sidecar 的日志不属于 Host 业务数据，必须持续消费，避免子进程因管道写满而卡死。
    child.stdout?.resume();
    child.stderr?.resume();

    const exitPromise = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => {
        if (this.child === child && this.state.status !== "stopping") {
          this.state = { ...this.state, status: "failed", pid: null, baseUrl: null, lastError: "HARNESS_SIDECAR_EXITED" };
          this.child = null;
        }
        resolve();
      });
    });

    try {
      const client = new DeepSeekHarnessApiClient({ baseUrl, requestTimeoutMs: this.options.requestTimeoutMs, fetchImpl: this.options.fetchImpl });
      const description = await waitForReady(client, this.options.startupTimeoutMs, exitPromise, signal);
      const harnessVersion = commandVersion ?? readVersion(description);
      if (harnessVersion !== this.options.expectedVersion) throw new Error("HARNESS_VERSION_UNSUPPORTED");
      this.state = { ...this.state, status: "ready", harnessVersion };
      return { baseUrl, instanceId: this.state.instanceId, harnessVersion: this.state.harnessVersion };
    } catch (error) {
      this.state = { ...this.state, status: "failed", pid: child.pid ?? null, lastError: sanitizeError(error) };
      child.kill();
      throw error;
    }
  }
}

async function waitForReady(client: DeepSeekHarnessApiClient, timeoutMs: number, exitPromise: Promise<unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("HARNESS_SIDECAR_START_ABORTED");
    try {
      return await client.describe(signal);
    } catch {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("HARNESS_SIDECAR_START_ABORTED");
      const outcome = await Promise.race([
        delay(150).then(() => ({ kind: "waiting" as const })),
        exitPromise.then(
          () => ({ kind: "exited" as const }),
          (error) => ({ kind: "error" as const, error })
        )
      ]);
      if (outcome.kind === "error") throw outcome.error;
      if (outcome.kind === "exited") throw new Error("HARNESS_SIDECAR_EXITED");
    }
  }
  throw new Error("HARNESS_SIDECAR_START_FAILED");
}

async function allocateLoopbackPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) throw new Error("HARNESS_PORT_ALLOCATE_FAILED");
  return port;
}

function readVersion(value: Record<string, unknown>): string | null {
  for (const key of ["version", "harnessVersion", "hostVersion"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return null;
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "HARNESS_SIDECAR_START_FAILED";
}

function hasSupportedBindHost(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index] ?? "";
    if (value === "--host") {
      const host = args[index + 1] ?? "";
      if (host !== "127.0.0.1" && host !== "0.0.0.0") return false;
    }
    if (value.startsWith("--host=")) {
      const host = value.slice("--host=".length);
      if (host !== "127.0.0.1" && host !== "0.0.0.0") return false;
    }
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
