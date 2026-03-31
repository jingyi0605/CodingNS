import { spawn } from "node:child_process";

import type { TerminalRuntimeAdapter } from "../terminal-runtime-adapter.js";
import {
  buildPtyBrokerEndpoint,
  normalizeProcessId,
  resolvePtyBrokerScriptLaunch
} from "../pty-broker-shared.js";

export class EmbeddedPtyRuntimeAdapter implements TerminalRuntimeAdapter {
  readonly type = "embedded-pty" as const;
  readonly survivesHostRestart = false;

  async createPersistentSession(
    input: Parameters<TerminalRuntimeAdapter["createPersistentSession"]>[0]
  ) {
    const pipeName = buildPtyBrokerEndpoint(input.session.sessionKey);
    const launch = resolvePtyBrokerScriptLaunch("pty-broker-agent-process");
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

    return {
      alive: true,
      shellPid: null,
      agentPid: normalizeProcessId(agentProcess.pid),
      detail: null
    };
  }

  async inspectPersistentSession(
    input: Parameters<TerminalRuntimeAdapter["inspectPersistentSession"]>[0]
  ) {
    const trackedProcessId = input.session.shellPid ?? input.session.agentPid;

    if (trackedProcessId && isProcessAlive(trackedProcessId)) {
      return {
        alive: true,
        shellPid: input.session.shellPid,
        agentPid: input.session.agentPid,
        detail: null
      };
    }

    return {
      alive: false,
      shellPid: null,
      agentPid: input.session.agentPid,
      detail: "EMBEDDED_RUNTIME_NOT_RECOVERABLE"
    };
  }

  buildHostAttachmentLaunch(input: Parameters<TerminalRuntimeAdapter["buildHostAttachmentLaunch"]>[0]) {
    return {
      command: input.terminal.shell,
      args: [],
      cwd: input.terminal.cwd,
      env: input.env
    };
  }

  async terminatePersistentSession(): Promise<void> {
    // embedded-pty broker 由 Host 侧连接负责发起终止，这里保留空实现做兼容。
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
