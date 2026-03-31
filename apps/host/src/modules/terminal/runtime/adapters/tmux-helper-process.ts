import { spawn } from "node:child_process";
import readline from "node:readline";

const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

stdinReader.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  let payload: {
    type: "run";
    id: string;
    args: string[];
  };

  try {
    payload = JSON.parse(line) as typeof payload;
  } catch {
    return;
  }

  if (payload.type !== "run") {
    return;
  }

  try {
    const result = await runTmux(payload.args);
    process.stdout.write(
      `${JSON.stringify({
        type: "result",
        id: payload.id,
        ok: true,
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr
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

async function runTmux(args: string[]): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn("tmux", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
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
      resolve({
        status,
        stdout,
        stderr
      });
    });
  });
}
