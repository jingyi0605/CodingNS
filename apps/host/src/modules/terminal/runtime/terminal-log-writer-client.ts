import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

interface PersistTerminalLogBatchInput {
  terminalId: string;
  startSeq: number;
  endSeq: number;
  content: string;
}

interface PendingRequest {
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

type WriterRequest =
  | ({
      type: "persist";
      id: string;
    } & PersistTerminalLogBatchInput)
  | {
      type: "delete";
      id: string;
      terminalId: string;
    }
  | {
      type: "shutdown";
      id: string;
    };

type WriterRequestInput =
  | Omit<Extract<WriterRequest, { type: "persist" }>, "id">
  | Omit<Extract<WriterRequest, { type: "delete" }>, "id">
  | Omit<Extract<WriterRequest, { type: "shutdown" }>, "id">;

type WriterResponse =
  | {
      type: "result";
      id: string;
      ok: true;
    }
  | {
      type: "result";
      id: string;
      ok: false;
      error: string;
    };

export class TerminalLogWriterClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly stdoutReader: readline.Interface;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private nextRequestId = 1;
  private closed = false;

  constructor(databasePath: string, logRootDir: string) {
    const launch = resolveWriterLaunch(databasePath, logRootDir);
    this.child = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
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
        console.warn(
          content.startsWith("[terminal-log-writer]") ? content : `[terminal-log-writer] ${content}`
        );
      }
    });
    this.child.on("error", (error) => {
      this.rejectAll(error);
    });
    this.child.on("exit", (code, signal) => {
      this.closed = true;
      this.rejectAll(new Error(`terminal log writer 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  }

  async persistChunkBatch(input: PersistTerminalLogBatchInput): Promise<void> {
    await this.sendRequest({
      type: "persist",
      ...input
    });
  }

  async deleteTerminalLogs(terminalId: string): Promise<void> {
    await this.sendRequest({
      type: "delete",
      terminalId
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    try {
      await this.sendRequest({
        type: "shutdown"
      });
    } finally {
      this.closed = true;
      this.stdoutReader.close();
      this.child.kill();
    }
  }

  private async sendRequest(
    input: WriterRequestInput
  ): Promise<void> {
    if (this.closed) {
      throw new Error("terminal log writer 已关闭");
    }

    const id = String(this.nextRequestId++);
    const payload: WriterRequest = {
      ...input,
      id
    } as WriterRequest;

    await new Promise<void>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject
      });

      this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
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

    let payload: WriterResponse;

    try {
      payload = JSON.parse(trimmed) as WriterResponse;
    } catch {
      return;
    }

    const pending = this.pendingRequests.get(payload.id);

    if (!pending) {
      return;
    }

    this.pendingRequests.delete(payload.id);

    if (payload.ok) {
      pending.resolve();
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

function resolveWriterLaunch(
  databasePath: string,
  logRootDir: string
): { command: string; args: string[]; cwd: string } {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFilePath);
  const isSourceFile = currentFilePath.endsWith(".ts");
  const scriptPath = path.join(
    currentDir,
    `terminal-log-writer-process${isSourceFile ? ".ts" : ".js"}`
  );
  const hostAppRoot = resolveHostAppRoot(currentFilePath);
  const baseArgs = isSourceFile ? ["--import", "tsx", scriptPath] : [scriptPath];

  return {
    command: process.execPath,
    args: [
      ...baseArgs,
      "--database-path",
      databasePath,
      "--log-root-dir",
      logRootDir
    ],
    cwd: hostAppRoot
  };
}

function resolveHostAppRoot(currentFilePath: string): string {
  const srcRootCandidate = path.resolve(path.dirname(currentFilePath), "..", "..", "..");
  const withoutSrc =
    path.basename(srcRootCandidate) === "src"
      ? path.dirname(srcRootCandidate)
      : srcRootCandidate;

  return path.basename(withoutSrc) === ".build" ? path.dirname(withoutSrc) : withoutSrc;
}
