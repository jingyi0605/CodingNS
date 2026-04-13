import readline from "node:readline";

import {
  runTaskHelperProcessHandler,
  type TaskHelperProcessHandlerName
} from "./task-helper-process-handlers.js";

interface HelperTaskRequest {
  id: string;
  handler: TaskHelperProcessHandlerName;
  input: unknown;
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

  let payload: HelperTaskRequest;

  try {
    payload = JSON.parse(trimmed) as HelperTaskRequest;
  } catch (error) {
    writeResponse({
      type: "result",
      id: "unknown",
      ok: false,
      error: error instanceof Error ? error.message : "helper request parse failed"
    });
    return;
  }

  try {
    const result = await runTaskHelperProcessHandler(payload.handler, payload.input);
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
  }
}

function writeResponse(payload: HelperTaskResponse): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
