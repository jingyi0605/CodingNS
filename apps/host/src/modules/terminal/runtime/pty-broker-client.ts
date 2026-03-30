import { EventEmitter } from "node:events";
import net from "node:net";

import { AppError } from "../../../shared/errors/app-error.js";
import {
  createJsonLineParser,
  encodeTerminalData,
  writeJsonLine
} from "./pty-broker-shared.js";

const CONNECT_RETRY_COUNT = 40;
const CONNECT_RETRY_DELAY_MS = 50;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

export declare interface PtyBrokerClient {
  on(event: "output", listener: (content: string) => void): this;
  on(event: "exit", listener: (event: { exitCode: number | null; requestedClose: boolean }) => void): this;
  emit(event: "output", content: string): boolean;
  emit(event: "exit", eventPayload: { exitCode: number | null; requestedClose: boolean }): boolean;
}

export class PtyBrokerClient extends EventEmitter {
  private exited = false;

  private constructor(
    private readonly socket: net.Socket,
    private readonly shellPid: number | null,
    private readonly agentPid: number | null
  ) {
    super();
  }

  static async connect(pipeName: string): Promise<PtyBrokerClient> {
    let socket: net.Socket | null = null;

    for (let attempt = 0; attempt < CONNECT_RETRY_COUNT; attempt += 1) {
      try {
        socket = await connectToPipe(pipeName);
        break;
      } catch {
        await delay(CONNECT_RETRY_DELAY_MS);
      }
    }

    if (!socket) {
      throw new AppError({
        statusCode: 502,
        errorCode: "PTY_START_FAILED",
        detail: "终端 broker 连接超时"
      });
    }

    socket.setEncoding("utf8");
    socket.setNoDelay(true);

    const attachResult = await waitForAttach(socket);
    const client = new PtyBrokerClient(
      socket,
      typeof attachResult.shellPid === "number" ? attachResult.shellPid : null,
      typeof attachResult.agentPid === "number" ? attachResult.agentPid : null
    );
    client.bindSocket();
    return client;
  }

  getProcessId(): number | null {
    return this.shellPid;
  }

  getAgentPid(): number | null {
    return this.agentPid;
  }

  write(content: string): void {
    writeJsonLine(this.socket, {
      type: "input",
      data: encodeTerminalData(content)
    });
  }

  resize(cols: number, rows: number): void {
    writeJsonLine(this.socket, {
      type: "resize",
      cols,
      rows
    });
  }

  terminate(): void {
    writeJsonLine(this.socket, {
      type: "terminate"
    });
  }

  close(): void {
    if (!this.socket.destroyed) {
      this.socket.end();
    }
  }

  private bindSocket(): void {
    const parser = createJsonLineParser((payload) => {
      if (!isRecord(payload)) {
        return;
      }

      const type = typeof payload.type === "string" ? payload.type : "";

      if (type === "data" && typeof payload.data === "string") {
        this.emit("output", Buffer.from(payload.data, "base64").toString("utf8"));
        return;
      }

      if (type === "exit") {
        this.emitExit(typeof payload.exitCode === "number" ? payload.exitCode : null);
        return;
      }
    });

    this.socket.on("data", (chunk) => {
      parser.push(chunk);
    });

    this.socket.on("close", () => {
      this.emitExit(null);
    });
  }

  private emitExit(exitCode: number | null): void {
    if (this.exited) {
      return;
    }

    this.exited = true;
    this.emit("exit", {
      exitCode,
      requestedClose: false
    });
  }
}

async function waitForAttach(socket: net.Socket): Promise<Record<string, unknown>> {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const parser = createJsonLineParser((payload) => {
      if (!isRecord(payload)) {
        reject(new Error("INVALID_PROTOCOL"));
        return;
      }

      const type = typeof payload.type === "string" ? payload.type : "";

      if (type === "attached") {
        cleanup();
        resolve(payload);
        return;
      }

      if (type === "error") {
        cleanup();
        reject(new Error(typeof payload.detail === "string" ? payload.detail : "BROKER_ATTACH_FAILED"));
      }
    });

    const onData = (chunk: string | Buffer) => {
      parser.push(chunk);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("BROKER_CLOSED"));
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);

    writeJsonLine(socket, {
      type: "attach",
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS
    });
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

async function delay(timeoutMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
