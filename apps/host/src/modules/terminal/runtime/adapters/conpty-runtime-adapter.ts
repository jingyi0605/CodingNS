import { spawn } from "node:child_process";

import { AppError } from "../../../../shared/errors/app-error.js";
import type { TerminalRuntimeAdapter } from "../terminal-runtime-adapter.js";
import {
  assertConptySupported,
  buildConptyPipeName,
  isConptyRuntimeType,
  resolveRuntimeScriptLaunch,
  type ConptyRuntimeType
} from "../conpty-runtime-shared.js";
import { ConptyControlHelperClient } from "./conpty-control-helper-client.js";

const STARTUP_RETRY_COUNT = 40;
const STARTUP_RETRY_DELAY_MS = 50;

interface ControlClientResult {
  ok: boolean;
  action: string;
  alive?: boolean;
  shellPid?: number | null;
  agentPid?: number | null;
  reason?: string;
  detail?: string;
}

let conptyControlHelperClient: ConptyControlHelperClient | null = null;

export class ConptyRuntimeAdapter implements TerminalRuntimeAdapter {
  readonly survivesHostRestart = true;

  constructor(readonly type: ConptyRuntimeType) {
    if (!isConptyRuntimeType(type)) {
      throw new Error(`Unsupported conpty runtime type: ${type}`);
    }
  }

  async createPersistentSession(
    input: Parameters<TerminalRuntimeAdapter["createPersistentSession"]>[0]
  ) {
    assertConptySupported();

    const pipeName = buildConptyPipeName(input.session.sessionKey);
    const launch = resolveRuntimeScriptLaunch("conpty-session-agent-process");
    const agentProcess = spawn(
      launch.command,
      [
        ...launch.args,
        "--pipe",
        pipeName,
        "--shell",
        input.terminal.shell,
        "--cwd",
        input.terminal.cwd
      ],
      {
        cwd: launch.cwd,
        env: input.env,
        detached: true,
        stdio: "ignore",
        windowsHide: true
      }
    );

    agentProcess.unref();

    let lastDetail = "Windows 持久化终端启动超时";

    for (let index = 0; index < STARTUP_RETRY_COUNT; index += 1) {
      const inspection = await this.inspectPersistentSession(input);

      if (inspection.alive) {
        return inspection;
      }

      lastDetail = inspection.detail ?? lastDetail;
      await sleep(STARTUP_RETRY_DELAY_MS);
    }

    throw new AppError({
      statusCode: 502,
      errorCode: "RUNTIME_CREATE_FAILED",
      detail: lastDetail
    });
  }

  async inspectPersistentSession(
    input: Parameters<TerminalRuntimeAdapter["inspectPersistentSession"]>[0]
  ) {
    assertConptySupported();

    const result = await runControlClient("inspect", buildConptyPipeName(input.session.sessionKey));

    if (!result.ok) {
      return {
        alive: false,
        shellPid: null,
        agentPid: null,
        detail:
          result.reason === "SESSION_UNAVAILABLE"
            ? null
            : formatConptyErrorDetail("检查", result.detail ?? result.reason ?? "UNKNOWN")
      };
    }

    return {
      alive: result.alive === true,
      shellPid: result.shellPid ?? null,
      agentPid: result.agentPid ?? null,
      detail: null
    };
  }

  buildHostAttachmentLaunch(
    input: Parameters<TerminalRuntimeAdapter["buildHostAttachmentLaunch"]>[0]
  ) {
    assertConptySupported();

    const launch = resolveRuntimeScriptLaunch("conpty-session-attach-client");

    return {
      command: launch.command,
      args: [...launch.args, "--pipe", buildConptyPipeName(input.session.sessionKey)],
      cwd: launch.cwd,
      env: input.env,
      closeStrategy: "process-kill" as const
    };
  }

  async terminatePersistentSession(
    input: Parameters<TerminalRuntimeAdapter["terminatePersistentSession"]>[0]
  ): Promise<void> {
    assertConptySupported();

    const result = await runControlClient("terminate", buildConptyPipeName(input.session.sessionKey));

    if (!result.ok && result.reason !== "SESSION_UNAVAILABLE") {
      throw new AppError({
        statusCode: 502,
        errorCode: "RUNTIME_TERMINATE_FAILED",
        detail: formatConptyErrorDetail("结束", result.detail ?? result.reason ?? "UNKNOWN")
      });
    }
  }
}

async function runControlClient(
  action: "inspect" | "terminate",
  pipeName: string
): Promise<ControlClientResult> {
  const launch = resolveRuntimeScriptLaunch("conpty-session-control-client");
  try {
    return await getConptyControlHelperClient().run(action, launch, pipeName);
  } catch (error) {
    return {
      ok: false,
      action,
      reason: "CONTROL_CLIENT_FAILED",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function formatConptyErrorDetail(actionLabel: string, detail: string): string {
  return `Windows 持久化终端${actionLabel}失败：${detail}`;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function getConptyControlHelperClient(): ConptyControlHelperClient {
  if (!conptyControlHelperClient) {
    conptyControlHelperClient = new ConptyControlHelperClient();
  }

  return conptyControlHelperClient;
}
