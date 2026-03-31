import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

interface ControlClientResult {
  ok: boolean;
  action: string;
  alive?: boolean;
  shellPid?: number | null;
  agentPid?: number | null;
  reason?: string;
  detail?: string;
}

type HelperResponse =
  | {
      type: "result";
      id: string;
      ok: true;
      result: ControlClientResult;
    }
  | {
      type: "result";
      id: string;
      ok: false;
      error: string;
    };

interface PendingRequest {
  resolve: (value: ControlClientResult) => void;
  reject: (reason?: unknown) => void;
}

export class ConptyControlHelperClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutReader: readline.Interface;
  private readonly pendingRequests = new Map<string, PendingRequest>();
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
        console.warn(`[conpty-control-helper] ${content}`);
      }
    });
    this.child.on("error", (error) => {
      this.rejectAll(error);
    });
    this.child.on("exit", (code, signal) => {
      this.rejectAll(
        new Error(`conpty control helper 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`)
      );
    });
  }

  async run(
    action: "inspect" | "terminate",
    launch: { command: string; args: string[]; cwd: string },
    pipeName: string
  ): Promise<ControlClientResult> {
    const id = String(this.nextRequestId++);

    return await new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject
      });

      this.child.stdin.write(
        `${JSON.stringify({
          type: "run",
          id,
          action,
          command: launch.command,
          args: [...launch.args, "--action", action, "--pipe", pipeName],
          cwd: launch.cwd
        })}\n`,
        (error) => {
          if (!error) {
            return;
          }

          this.pendingRequests.delete(id);
          reject(error);
        }
      );
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
    /conpty-control-helper-client\.(ts|js)$/,
    `conpty-control-helper-process${extension}`
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
