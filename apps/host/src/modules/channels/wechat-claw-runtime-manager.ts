import crypto from "node:crypto";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import type { WechatClawRuntimeReadyMessage } from "../../helpers/wechat-claw-runtime/modules/types.js";

export class WechatClawRuntimeManager {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private stdoutReader: readline.Interface | null = null;
  private readyPromise: Promise<{ baseUrl: string; authToken: string }> | null = null;
  private currentRuntime: { baseUrl: string; authToken: string } | null = null;
  private disposed = false;
  private readonly authToken = crypto.randomUUID();

  constructor(private readonly runtimeRootDir: string) {}

  async ensureReady(): Promise<{ baseUrl: string; authToken: string }> {
    if (this.currentRuntime) {
      return this.currentRuntime;
    }

    if (this.readyPromise) {
      return await this.readyPromise;
    }

    this.readyPromise = this.startProcess();

    try {
      const runtime = await this.readyPromise;
      this.currentRuntime = runtime;
      return runtime;
    } finally {
      this.readyPromise = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stdoutReader?.close();
    this.stdoutReader = null;

    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }

    this.child = null;
    this.currentRuntime = null;
  }

  private async startProcess(): Promise<{ baseUrl: string; authToken: string }> {
    if (this.disposed) {
      throw new Error("wechat claw helper 已关闭");
    }

    const launch = resolveHelperLaunch();
    const child = spawn(launch.command, [
      ...launch.args,
      "--runtime-root-dir",
      this.runtimeRootDir,
      "--auth-token",
      this.authToken
    ], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutReader = readline.createInterface({
      input: child.stdout
    });

    this.child = child;
    this.stdoutReader = stdoutReader;

    child.stderr.on("data", (chunk) => {
      const content = String(chunk).trim();
      if (content) {
        console.warn(`[wechat-claw-helper] ${content}`);
      }
    });
    child.on("exit", () => {
      this.currentRuntime = null;
      this.child = null;
      this.stdoutReader?.close();
      this.stdoutReader = null;
    });

    return await new Promise<{ baseUrl: string; authToken: string }>((resolve, reject) => {
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(new Error(`wechat claw helper 启动失败：code=${code ?? "null"} signal=${signal ?? "null"}`));
      };
      const onLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) {
          return;
        }

        let payload: WechatClawRuntimeReadyMessage;
        try {
          payload = JSON.parse(trimmed) as WechatClawRuntimeReadyMessage;
        } catch {
          return;
        }

        if (payload.type !== "ready" || !Number.isFinite(payload.port) || payload.port <= 0) {
          return;
        }

        cleanup();
        resolve({
          baseUrl: `http://127.0.0.1:${payload.port}`,
          authToken: this.authToken
        });
      };
      const cleanup = () => {
        stdoutReader.off("line", onLine);
        child.off("error", onError);
        child.off("exit", onExit);
      };

      child.once("error", onError);
      child.once("exit", onExit);
      stdoutReader.on("line", onLine);
    });
  }
}

function resolveHelperLaunch(): { command: string; args: string[] } {
  const currentFilePath = fileURLToPath(import.meta.url);
  const extension = path.extname(currentFilePath);
  const helperPath = path.resolve(
    path.dirname(currentFilePath),
    "../../helpers/wechat-claw-runtime/main" + extension
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
