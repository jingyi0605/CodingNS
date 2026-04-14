import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export type TailscaleHelperBackendState =
  | "running"
  | "needs_login"
  | "starting"
  | "stopped"
  | "error";

export interface TailscaleHelperSnapshot {
  backendState: TailscaleHelperBackendState;
  loginUrl: string | null;
  hostname: string | null;
  accountName: string | null;
  tailnetFqdn: string | null;
  tailnetIpv4: string | null;
  tailnetIpv6: string | null;
  lastError: string | null;
}

interface PendingRequest<TResult> {
  resolve: (value: TResult) => void;
  reject: (reason?: unknown) => void;
}

type HelperResponse =
  | {
      type: "result";
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      type: "result";
      id: string;
      ok: false;
      error: string;
    };

export class TailscaleHelperClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutReader: readline.Interface;
  private readonly pendingRequests = new Map<string, PendingRequest<unknown>>();
  private nextRequestId = 1;

  constructor() {
    const launch = resolveHelperLaunch();
    this.child = spawn(launch.command, launch.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.stdoutReader = readline.createInterface({
      input: this.child.stdout
    });

    this.stdoutReader.on("line", (line) => {
      this.handleResponseLine(line);
    });
    this.child.stderr.on("data", (chunk) => {
      const content = String(chunk).trim();

      if (content) {
        console.warn(`[tailscale-helper] ${content}`);
      }
    });
    this.child.on("error", (error) => {
      this.rejectAll(error);
    });
    this.child.on("exit", (code, signal) => {
      this.rejectAll(
        new Error(
          `tailscale helper 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`
        )
      );
    });
  }

  async inspectStatus(input: {
    commandPath: string;
  }): Promise<TailscaleHelperSnapshot> {
    return await this.sendRequest<TailscaleHelperSnapshot>({
      type: "status",
      ...input
    });
  }

  async enable(input: {
    commandPath: string;
    controlServerUrl: string | null;
    hostname: string | null;
  }): Promise<TailscaleHelperSnapshot> {
    return await this.sendRequest<TailscaleHelperSnapshot>({
      type: "enable",
      ...input
    });
  }

  async login(input: {
    commandPath: string;
    controlServerUrl: string | null;
    hostname: string | null;
  }): Promise<TailscaleHelperSnapshot> {
    return await this.sendRequest<TailscaleHelperSnapshot>({
      type: "login",
      ...input
    });
  }

  async disable(input: {
    commandPath: string;
  }): Promise<TailscaleHelperSnapshot> {
    return await this.sendRequest<TailscaleHelperSnapshot>({
      type: "disable",
      ...input
    });
  }

  async logout(input: {
    commandPath: string;
  }): Promise<TailscaleHelperSnapshot> {
    return await this.sendRequest<TailscaleHelperSnapshot>({
      type: "logout",
      ...input
    });
  }

  dispose(): void {
    this.stdoutReader.close();

    if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }
  }

  private async sendRequest<TResult>(payload: Record<string, unknown>): Promise<TResult> {
    const id = String(this.nextRequestId++);

    return await new Promise<TResult>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => {
          resolve(value as TResult);
        },
        reject
      });
      this.child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, (error) => {
        if (!error) {
          return;
        }

        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  private handleResponseLine(line: string): void {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{")) {
      return;
    }

    let payload: HelperResponse;

    try {
      payload = JSON.parse(trimmed) as HelperResponse;
    } catch {
      return;
    }

    const pending = this.pendingRequests.get(payload.id);

    if (!pending) {
      return;
    }

    this.pendingRequests.delete(payload.id);

    if (payload.ok) {
      pending.resolve(payload.result);
      return;
    }

    pending.reject(new Error(payload.error));
  }

  private rejectAll(error: unknown): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }
}

function resolveHelperLaunch(): { command: string; args: string[] } {
  const currentFilePath = fileURLToPath(import.meta.url);
  const extension = path.extname(currentFilePath);
  const helperPath = currentFilePath.replace(
    /tailscale-helper-client\.(ts|js)$/,
    `tailscale-helper-process${extension}`
  );

  if (extension === ".ts") {
    return {
      command: process.execPath,
      args: ["--import", "tsx", helperPath]
    };
  }

  return {
    command: process.execPath,
    args: [helperPath]
  };
}
