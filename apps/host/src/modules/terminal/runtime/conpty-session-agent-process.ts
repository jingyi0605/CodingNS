import net from "node:net";

import { spawn } from "node-pty";

import {
  assertConptySupported,
  createJsonLineParser,
  decodeTerminalData,
  encodeTerminalData,
  normalizeProcessId,
  normalizeShellExitCode,
  normalizeTerminalDimension,
  parseCliArgs,
  readRequiredCliArg,
  writeJsonLine
} from "./conpty-runtime-shared.js";

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const MIN_COLS = 20;
const MIN_ROWS = 5;
const MAX_BUFFERED_BYTES = 1024 * 1024;

await main();

async function main(): Promise<void> {
  assertConptySupported();

  const args = parseCliArgs(process.argv.slice(2));
  const pipeName = readRequiredCliArg(args, "pipe");
  const shell = readRequiredCliArg(args, "shell");
  const cwd = readRequiredCliArg(args, "cwd");

  const ptyProcess = spawn(shell, [], {
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd,
    env: process.env,
    name: "xterm-color"
  });
  const shellPid = normalizeProcessId(ptyProcess.pid);
  let shellExitCode: number | null = null;
  let attachedSocket: net.Socket | null = null;
  let bufferedOutput: string[] = [];
  let bufferedByteLength = 0;
  let terminating = false;

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.setNoDelay(true);

    let connectionMode: "initial" | "attach" = "initial";
    const parser = createJsonLineParser((payload) => {
      if (!isRecord(payload)) {
        writeJsonLine(socket, {
          type: "error",
          detail: "INVALID_PROTOCOL"
        });
        socket.end();
        return;
      }

      if (connectionMode === "initial") {
        handleInitialMessage(socket, payload);
        return;
      }

      handleAttachMessage(socket, payload);
    });

    socket.on("data", (chunk) => {
      try {
        parser.push(chunk);
      } catch {
        writeJsonLine(socket, {
          type: "error",
          detail: "INVALID_PROTOCOL"
        });
        socket.end();
      }
    });

    socket.on("close", () => {
      if (attachedSocket === socket) {
        attachedSocket = null;
      }
    });

    socket.on("error", () => {
      if (attachedSocket === socket) {
        attachedSocket = null;
      }
    });

    function handleInitialMessage(currentSocket: net.Socket, payload: Record<string, unknown>): void {
      const type = typeof payload.type === "string" ? payload.type : "";

      if (type === "inspect") {
        writeJsonLine(currentSocket, {
          type: "inspect-result",
          alive: shellExitCode === null,
          shellPid,
          agentPid: process.pid
        });
        currentSocket.end();
        return;
      }

      if (type === "terminate") {
        writeJsonLine(currentSocket, {
          type: "terminate-accepted"
        });
        terminateShell();
        currentSocket.end();
        return;
      }

      if (type === "attach") {
        if (attachedSocket && attachedSocket !== currentSocket) {
          writeJsonLine(currentSocket, {
            type: "error",
            detail: "SESSION_ALREADY_ATTACHED"
          });
          currentSocket.end();
          return;
        }

        const cols = normalizeTerminalDimension(payload.cols, DEFAULT_COLS, MIN_COLS);
        const rows = normalizeTerminalDimension(payload.rows, DEFAULT_ROWS, MIN_ROWS);

        attachedSocket = currentSocket;
        connectionMode = "attach";
        ptyProcess.resize(cols, rows);
        writeJsonLine(currentSocket, {
          type: "attached",
          shellPid
        });
        flushBufferedOutput(currentSocket);
        return;
      }

      writeJsonLine(currentSocket, {
        type: "error",
        detail: "UNKNOWN_REQUEST"
      });
      currentSocket.end();
    }

    function handleAttachMessage(currentSocket: net.Socket, payload: Record<string, unknown>): void {
      const type = typeof payload.type === "string" ? payload.type : "";

      if (type === "input" && typeof payload.data === "string") {
        ptyProcess.write(decodeTerminalData(payload.data));
        return;
      }

      if (type === "resize") {
        ptyProcess.resize(
          normalizeTerminalDimension(payload.cols, DEFAULT_COLS, MIN_COLS),
          normalizeTerminalDimension(payload.rows, DEFAULT_ROWS, MIN_ROWS)
        );
        return;
      }

      if (type === "detach") {
        currentSocket.end();
        return;
      }

      writeJsonLine(currentSocket, {
        type: "error",
        detail: "UNKNOWN_ATTACH_MESSAGE"
      });
    }
  });

  server.listen(pipeName);

  ptyProcess.onData((content) => {
    if (attachedSocket && !attachedSocket.destroyed) {
      writeJsonLine(attachedSocket, {
        type: "data",
        data: encodeTerminalData(content)
      });
      return;
    }

    bufferOutput(content);
  });

  ptyProcess.onExit((event) => {
    shellExitCode = normalizeShellExitCode(event.exitCode);

    if (attachedSocket && !attachedSocket.destroyed) {
      writeJsonLine(attachedSocket, {
        type: "exit",
        exitCode: shellExitCode
      });
      attachedSocket.end();
      attachedSocket = null;
    }

    server.close(() => {
      process.exit(shellExitCode ?? 0);
    });

    setTimeout(() => {
      process.exit(shellExitCode ?? 0);
    }, 200).unref();
  });

  function terminateShell(): void {
    if (terminating || shellExitCode !== null) {
      return;
    }

    terminating = true;
    ptyProcess.kill();
  }

  function bufferOutput(content: string): void {
    const byteLength = Buffer.byteLength(content, "utf8");
    bufferedOutput.push(content);
    bufferedByteLength += byteLength;

    while (bufferedByteLength > MAX_BUFFERED_BYTES && bufferedOutput.length > 0) {
      const removed = bufferedOutput.shift() ?? "";
      bufferedByteLength -= Buffer.byteLength(removed, "utf8");
    }
  }

  function flushBufferedOutput(socket: net.Socket): void {
    if (bufferedOutput.length === 0) {
      return;
    }

    for (const chunk of bufferedOutput) {
      writeJsonLine(socket, {
        type: "data",
        data: encodeTerminalData(chunk)
      });
    }

    bufferedOutput = [];
    bufferedByteLength = 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
