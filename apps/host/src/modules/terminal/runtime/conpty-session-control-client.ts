import net from "node:net";

import {
  assertConptySupported,
  createJsonLineParser,
  parseCliArgs,
  readRequiredCliArg,
  writeJsonLine
} from "./conpty-runtime-shared.js";

await main();

async function main(): Promise<void> {
  assertConptySupported();

  const args = parseCliArgs(process.argv.slice(2));
  const pipeName = readRequiredCliArg(args, "pipe");
  const action = readRequiredCliArg(args, "action");

  try {
    const socket = await connectToPipe(pipeName);
    socket.setEncoding("utf8");
    socket.setNoDelay(true);

    const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const parser = createJsonLineParser((payload) => {
        if (!isRecord(payload)) {
          reject(new Error("INVALID_PROTOCOL"));
          return;
        }

        resolve(payload);
      });

      socket.on("data", (chunk) => {
        parser.push(chunk);
      });
      socket.once("error", reject);
      socket.once("close", () => {
        reject(new Error("PIPE_CLOSED"));
      });
    }).finally(() => {
      socket.end();
    });

    process.stdout.write(JSON.stringify(mapResponse(action, response)));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        action,
        reason: "SESSION_UNAVAILABLE",
        detail: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

async function connectToPipe(pipeName: string): Promise<net.Socket> {
  return await new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection(pipeName, () => {
      resolve(socket);
    });

    const timer = setTimeout(() => {
      socket.destroy(new Error("PIPE_CONNECT_TIMEOUT"));
    }, 1200);

    socket.once("connect", () => {
      clearTimeout(timer);
      return;
    });

    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    writeJsonLine(socket, {
      type: readRequiredCliArg(parseCliArgs(process.argv.slice(2)), "action")
    });
  });
}

function mapResponse(action: string, response: Record<string, unknown>): Record<string, unknown> {
  const type = typeof response.type === "string" ? response.type : "";

  if (action === "inspect" && type === "inspect-result") {
    return {
      ok: true,
      action,
      alive: response.alive === true,
      shellPid: typeof response.shellPid === "number" ? response.shellPid : null,
      agentPid: typeof response.agentPid === "number" ? response.agentPid : null
    };
  }

  if (action === "terminate" && type === "terminate-accepted") {
    return {
      ok: true,
      action
    };
  }

  return {
    ok: false,
    action,
    reason: "INVALID_RESPONSE",
    detail: typeof response.detail === "string" ? response.detail : "INVALID_RESPONSE"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
