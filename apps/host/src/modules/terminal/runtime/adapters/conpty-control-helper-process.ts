import { spawn } from "node:child_process";
import readline from "node:readline";

interface ControlClientResult {
  ok: boolean;
  action: string;
  alive?: boolean;
  shellPid?: number | null;
  agentPid?: number | null;
  reason?: string;
  detail?: string;
}

type HelperRequest = {
  type: "run";
  id: string;
  action: "inspect" | "terminate";
  command: string;
  args: string[];
  cwd: string;
};

const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

stdinReader.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  let payload: HelperRequest;

  try {
    payload = JSON.parse(line) as HelperRequest;
  } catch {
    return;
  }

  if (payload.type !== "run") {
    return;
  }

  try {
    const result = await runCommand(payload.command, payload.args, payload.cwd);
    process.stdout.write(
      `${JSON.stringify({
        type: "result",
        id: payload.id,
        ok: true,
        result
      })}\n`
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        type: "result",
        id: payload.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })}\n`
    );
  }
}

async function runCommand(command: string, args: string[], cwd: string): Promise<ControlClientResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (status) => {
      if (status !== 0) {
        resolve({
          ok: false,
          action: extractAction(args),
          reason: "CONTROL_CLIENT_FAILED",
          detail: stderr.trim() || stdout.trim() || "CONTROL_CLIENT_FAILED"
        });
        return;
      }

      const rawOutput = stdout.trim();

      if (!rawOutput) {
        resolve({
          ok: false,
          action: extractAction(args),
          reason: "EMPTY_RESPONSE",
          detail: "EMPTY_RESPONSE"
        });
        return;
      }

      try {
        resolve(JSON.parse(rawOutput) as ControlClientResult);
      } catch {
        resolve({
          ok: false,
          action: extractAction(args),
          reason: "INVALID_RESPONSE",
          detail: rawOutput
        });
      }
    });
  });
}

function extractAction(args: string[]): string {
  const actionIndex = args.findIndex((entry) => entry === "--action");
  return actionIndex >= 0 ? (args[actionIndex + 1] ?? "unknown") : "unknown";
}
