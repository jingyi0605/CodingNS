import net from "node:net";

import {
  assertConptySupported,
  createJsonLineParser,
  decodeTerminalData,
  normalizeShellExitCode,
  parseCliArgs,
  readRequiredCliArg,
  writeJsonLine
} from "./conpty-runtime-shared.js";

await main();

async function main(): Promise<void> {
  assertConptySupported();

  const args = parseCliArgs(process.argv.slice(2));
  const pipeName = readRequiredCliArg(args, "pipe");
  const socket = await connectToPipe(pipeName);

  socket.setEncoding("utf8");
  socket.setNoDelay(true);

  let shellExitCode: number | null = null;
  let attached = false;
  const parser = createJsonLineParser((payload) => {
    if (!isRecord(payload)) {
      return;
    }

    const type = typeof payload.type === "string" ? payload.type : "";

    if (type === "attached") {
      attached = true;
      return;
    }

    if (type === "data" && typeof payload.data === "string") {
      process.stdout.write(decodeTerminalData(payload.data));
      return;
    }

    if (type === "exit") {
      shellExitCode = normalizeShellExitCode(
        typeof payload.exitCode === "number" ? payload.exitCode : undefined
      );
      socket.end();
      return;
    }

    if (type === "error") {
      const detail =
        typeof payload.detail === "string" ? payload.detail : "Windows 持久化会话附着失败";
      process.stderr.write(`${detail}\n`);
      shellExitCode = 1;
      socket.end();
    }
  });

  socket.on("data", (chunk) => {
    parser.push(chunk);
  });

  socket.on("close", () => {
    process.exit(shellExitCode ?? 0);
  });

  socket.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.resume();
  process.stdin.on("data", (chunk) => {
    if (!attached) {
      return;
    }

    writeJsonLine(socket, {
      type: "input",
      data: Buffer.isBuffer(chunk) ? chunk.toString("base64") : Buffer.from(chunk).toString("base64")
    });
  });

  process.stdin.on("end", () => {
    if (!socket.destroyed) {
      writeJsonLine(socket, {
        type: "detach"
      });
      socket.end();
    }
  });

  process.stdout.on("resize", () => {
    if (!attached || socket.destroyed) {
      return;
    }

    writeJsonLine(socket, {
      type: "resize",
      cols: process.stdout.columns,
      rows: process.stdout.rows
    });
  });

  const detachAndExit = () => {
    if (!socket.destroyed) {
      writeJsonLine(socket, {
        type: "detach"
      });
      socket.end();
    }
  };

  process.on("SIGINT", detachAndExit);
  process.on("SIGTERM", detachAndExit);

  writeJsonLine(socket, {
    type: "attach",
    cols: process.stdout.columns,
    rows: process.stdout.rows
  });
}

async function connectToPipe(pipeName: string): Promise<net.Socket> {
  return await new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection(pipeName, () => {
      resolve(socket);
    });

    socket.once("error", (error) => {
      reject(error);
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
