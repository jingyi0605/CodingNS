import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import net from "node:net";

import { TaskManager } from "../../tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../../tasks/task-types.js";
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
  requestTimeoutMs?: number;
  startupTimeoutMs?: number;
  expectedVersion?: string;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof spawn;
  portAllocator?: () => Promise<number>;
  fetchImpl?: typeof fetch;
}

/** 只管理 CodingNS 自己启动的 loopback sidecar，外部进程不会被接管。 */
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
      startupTimeoutMs: 15_000,
      expectedVersion: "0.1.0-rc.5",
      ...options
    };
    this.options.taskManager.register({
      taskType: HOST_TASK_TYPES.harnessSidecarHealth,
      executionLane: "external_process",
      concurrency: 1,
      timeoutMs: this.options.startupTimeoutMs,
      retryPolicy: { maxAttempts: 1 },
      run: async () => this.startOwnedSidecar()
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

  private async startOwnedSidecar(): Promise<{ baseUrl: string; instanceId: string; harnessVersion: string | null }> {
    if (this.state.status === "ready" && this.state.baseUrl) {
      return { baseUrl: this.state.baseUrl, instanceId: this.state.instanceId, harnessVersion: this.state.harnessVersion };
    }

    this.state = { ...this.state, status: "starting", lastError: null };
    const port = await (this.options.portAllocator ?? allocateLoopbackPort)();
    const baseUrl = `http://127.0.0.1:${port}`;
    const commandPath = this.options.commandPath ?? "deepseek-harness";
    const commandArgs = this.options.commandArgs ?? ["serve", "--host", "127.0.0.1", "--port", String(port)];

    if (!hasOnlyLoopbackHost(commandArgs)) {
      throw new Error("HARNESS_LOOPBACK_ONLY");
    }

    const child = (this.options.spawnImpl ?? spawn)(commandPath, commandArgs, {
      env: { ...process.env, ...this.options.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;
    this.state = { ...this.state, pid: child.pid ?? null, baseUrl, startedAt: new Date().toISOString() };

    const exitPromise = once(child, "exit").then(() => {
      if (this.child === child && this.state.status !== "stopping") {
        this.state = { ...this.state, status: "failed", pid: null, baseUrl: null, lastError: "HARNESS_SIDECAR_EXITED" };
        this.child = null;
      }
    });

    try {
      const client = new DeepSeekHarnessApiClient({ baseUrl, requestTimeoutMs: this.options.requestTimeoutMs, fetchImpl: this.options.fetchImpl });
      const description = await waitForReady(client, this.options.startupTimeoutMs, exitPromise);
      const harnessVersion = readVersion(description);
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

async function waitForReady(client: DeepSeekHarnessApiClient, timeoutMs: number, exitPromise: Promise<unknown>): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await client.describe();
    } catch {
      await Promise.race([delay(150), exitPromise]);
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

function hasOnlyLoopbackHost(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index] ?? "";
    if (value === "--host") {
      const host = args[index + 1] ?? "";
      if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return false;
    }
    if (value.startsWith("--host=")) {
      const host = value.slice("--host=".length);
      if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") return false;
    }
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
