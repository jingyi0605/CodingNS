import readline from "node:readline";

import type {
  ProviderRuntimeEventSink,
  ProviderRuntimeLaunchResult,
  ProviderRuntimeRunRequest,
  RuntimeEventInput,
  RuntimeSendOptions,
  RuntimeSessionBinding
} from "@codingns/session-sync-core/runtime/types";
import { ClaudeRuntimeAdapter } from "@codingns/session-sync-core/runtime/claude-runtime";

type ParentToHelperMessage =
  | {
      type: "start" | "continue";
      requestId: string;
      request: ProviderRuntimeRunRequest;
    }
  | {
      type: "submit";
      sessionId: string;
      options: RuntimeSendOptions;
    }
  | {
      type: "interrupt";
      sessionId: string;
    };

interface ActiveRunRecord {
  launch: ProviderRuntimeLaunchResult;
}

const args = process.argv.slice(2);
const homeDir = readFlag(args, "--home-dir");
const commandPath = readFlag(args, "--command-path");
const hookBridge = readJsonFlag<{
  url: string;
  token: string;
  scriptPath: string;
}>(args, "--hook-bridge");

if (!homeDir) {
  throw new Error("CLAUDE_RUNTIME_HELPER_HOME_DIR_REQUIRED");
}

const adapter = new ClaudeRuntimeAdapter({
  homeDir,
  commandPath: commandPath ?? undefined,
  hookBridge
});
const activeRuns = new Map<string, ActiveRunRecord>();
const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

stdinReader.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  let message: ParentToHelperMessage;

  try {
    message = JSON.parse(line) as ParentToHelperMessage;
  } catch (error) {
    console.error("[claude-runtime-helper] 无法解析请求", error);
    return;
  }

  switch (message.type) {
    case "start":
    case "continue":
      await handleLaunch(message.type, message.requestId, message.request);
      return;
    case "submit": {
      const run = activeRuns.get(message.sessionId);

      if (!run || !run.launch.submitDuringRun) {
        emitError({
          sessionId: message.sessionId,
          detail: "IN_RUN_INPUT_NOT_SUPPORTED"
        });
        return;
      }

      try {
        await run.launch.submitDuringRun(message.options);
      } catch (error) {
        emitError({
          sessionId: message.sessionId,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }
    case "interrupt": {
      const run = activeRuns.get(message.sessionId);

      if (!run || !run.launch.interrupt) {
        return;
      }

      try {
        await run.launch.interrupt();
      } catch (error) {
        emitError({
          sessionId: message.sessionId,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}

async function handleLaunch(
  type: "start" | "continue",
  requestId: string,
  request: ProviderRuntimeRunRequest
): Promise<void> {
  const sink: ProviderRuntimeEventSink = {
    emit: async (event: RuntimeEventInput) => {
      emit({
        type: "event",
        sessionId: request.sessionId,
        event
      });
    },
    updateSessionBinding: (binding: RuntimeSessionBinding) => {
      emit({
        type: "binding",
        sessionId: request.sessionId,
        binding
      });
    }
  };

  try {
    const launch =
      type === "start"
        ? await adapter.startSession(request, sink)
        : await adapter.continueSession(request, sink);

    activeRuns.set(request.sessionId, {
      launch
    });

    emit({
      type: "launch",
      requestId,
      sessionId: request.sessionId,
      providerSessionId: launch.providerSessionId,
      rawStoreRef: launch.rawStoreRef,
      supportsSubmitDuringRun: typeof launch.submitDuringRun === "function",
      supportsInterrupt: typeof launch.interrupt === "function"
    });

    void launch.completed.finally(() => {
      activeRuns.delete(request.sessionId);
      emit({
        type: "completed",
        sessionId: request.sessionId
      });
    });
  } catch (error) {
    emitError({
      requestId,
      sessionId: request.sessionId,
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

function emit(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function emitError(input: {
  requestId?: string;
  sessionId?: string;
  detail: string;
}): void {
  emit({
    type: "error",
    ...input
  });
}

function readFlag(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);

  if (index < 0) {
    return null;
  }

  return argv[index + 1] ?? null;
}

function readJsonFlag<T>(argv: string[], flag: string): T | null {
  const value = readFlag(argv, flag);

  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
}
