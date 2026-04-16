import readline from "node:readline";

import {
  runTaskHelperProcessHandler,
  type TaskHelperProcessHandlerName
} from "./task-helper-process-handlers.js";

interface HelperTaskRequest {
  id: string;
  type: "run";
  handler: TaskHelperProcessHandlerName;
  input: unknown;
}

interface HelperTaskCancelRequest {
  id: string;
  type: "cancel";
  targetId: string;
}

type HelperTaskResponse =
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

type HelperTaskMessage = HelperTaskRequest | HelperTaskCancelRequest;

const activeRequests = new Map<string, AbortController>();

const reader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY
});

reader.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();

  if (!trimmed) {
    return;
  }

  let payload: HelperTaskMessage;

  try {
    payload = JSON.parse(trimmed) as HelperTaskMessage;
  } catch (error) {
    writeResponse({
      type: "result",
      id: "unknown",
      ok: false,
      error: error instanceof Error ? error.message : "helper request parse failed"
    });
    return;
  }

  if (payload.type === "cancel") {
    activeRequests.get(payload.targetId)?.abort(new Error("helper task aborted"));
    return;
  }

  const controller = new AbortController();
  activeRequests.set(payload.id, controller);

  try {
    const result = await runTaskHelperProcessHandler(payload.handler, payload.input, controller.signal);
    writeResponse({
      type: "result",
      id: payload.id,
      ok: true,
      result
    });
  } catch (error) {
    writeResponse({
      type: "result",
      id: payload.id,
      ok: false,
      error: error instanceof Error ? error.message : "helper task failed"
    });
  } finally {
    activeRequests.delete(payload.id);
  }
}

function writeResponse(payload: HelperTaskResponse): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
