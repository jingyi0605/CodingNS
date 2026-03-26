import { spawnSync } from "node:child_process";

import { AppError } from "../../../../shared/errors/app-error.js";
import type { TerminalRuntimeAdapter } from "../terminal-runtime-adapter.js";

export class TmuxRuntimeAdapter implements TerminalRuntimeAdapter {
  readonly type = "tmux" as const;
  readonly survivesHostRestart = true;

  createPersistentSession(input: Parameters<TerminalRuntimeAdapter["createPersistentSession"]>[0]) {
    ensureTmuxSupported();

    const shellBootstrapScript = buildShellBootstrapScript(input.terminal.shell, input.env);
    const result = runTmuxCommand(
      [
        "new-session",
        "-d",
        "-s",
        input.session.sessionKey,
        "-c",
        input.terminal.cwd,
        "/bin/sh",
        "-lc",
        shellBootstrapScript
      ],
      {
        errorCode: "RUNTIME_CREATE_FAILED",
        actionLabel: "创建"
      }
    );

    if (result.status !== 0) {
      throw new AppError({
        statusCode: 502,
        errorCode: "RUNTIME_CREATE_FAILED",
        detail: result.stderr.trim() || result.stdout.trim() || "tmux 会话创建失败"
      });
    }

    return this.inspectPersistentSession(input);
  }

  inspectPersistentSession(input: Parameters<TerminalRuntimeAdapter["inspectPersistentSession"]>[0]) {
    ensureTmuxSupported();

    const hasSession = runTmuxCommand(["has-session", "-t", input.session.sessionKey], {
      errorCode: "RUNTIME_INSPECT_FAILED",
      actionLabel: "检查",
      tolerateMissingBinary: true
    });

    if (hasSession.error) {
      return {
        alive: false,
        shellPid: null,
        detail: formatTmuxErrorDetail("检查", hasSession.error.message)
      };
    }

    if (hasSession.status !== 0) {
      const detail = hasSession.stderr.trim() || hasSession.stdout.trim() || "tmux 会话不存在";
      return {
        alive: false,
        shellPid: null,
        detail
      };
    }

    const listPanes = runTmuxCommand(
      ["list-panes", "-t", input.session.sessionKey, "-F", "#{pane_pid}"],
      {
        errorCode: "RUNTIME_INSPECT_FAILED",
        actionLabel: "检查",
        tolerateMissingBinary: true
      }
    );

    if (listPanes.error || listPanes.status !== 0) {
      return {
        alive: true,
        shellPid: null,
        detail: listPanes.error?.message ?? (listPanes.stderr.trim() || null)
      };
    }

    const firstPanePid = Number.parseInt(listPanes.stdout.trim().split(/\s+/)[0] ?? "", 10);

    return {
      alive: true,
      shellPid: Number.isInteger(firstPanePid) && firstPanePid > 0 ? firstPanePid : null,
      detail: null
    };
  }

  buildHostAttachmentLaunch(
    input: Parameters<TerminalRuntimeAdapter["buildHostAttachmentLaunch"]>[0]
  ) {
    ensureTmuxSupported();

    return {
      command: "tmux",
      args: [
        "set-option",
        "-t",
        input.session.sessionKey,
        "status",
        "off",
        ";",
        "set-window-option",
        "-t",
        input.session.sessionKey,
        "window-size",
        "latest",
        ";",
        "attach-session",
        "-t",
        input.session.sessionKey
      ],
      cwd: input.terminal.cwd,
      env: input.env
    };
  }

  terminatePersistentSession(
    input: Parameters<TerminalRuntimeAdapter["terminatePersistentSession"]>[0]
  ): void {
    ensureTmuxSupported();

    const result = runTmuxCommand(["kill-session", "-t", input.session.sessionKey], {
      errorCode: "RUNTIME_TERMINATE_FAILED",
      actionLabel: "结束",
      tolerateMissingBinary: true
    });

    if (result.error) {
      return;
    }

    if (result.status !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();

      if (detail.includes("can't find session")) {
        return;
      }

      throw new AppError({
        statusCode: 502,
        errorCode: "RUNTIME_TERMINATE_FAILED",
        detail: detail || "tmux 会话结束失败"
      });
    }
  }
}

function ensureTmuxSupported(): void {
  if (process.platform === "win32") {
    throw new AppError({
      statusCode: 400,
      errorCode: "RUNTIME_UNSUPPORTED_PLATFORM",
      detail: "tmux runtime 仅支持 macOS/Linux"
    });
  }
}

function runTmuxCommand(
  args: string[],
  options: {
    errorCode: string;
    actionLabel: string;
    tolerateMissingBinary?: boolean;
  }
) {
  const result = spawnSync("tmux", args, { encoding: "utf8" });

  if (result.error) {
    if (options.tolerateMissingBinary && isMissingBinaryError(result.error)) {
      return result;
    }

    if (isMissingBinaryError(result.error)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "RUNTIME_DEPENDENCY_MISSING",
        detail: "当前系统未安装 tmux",
        field: "runtimeType"
      });
    }

    throw new AppError({
      statusCode: 502,
      errorCode: options.errorCode,
      detail: formatTmuxErrorDetail(options.actionLabel, result.error.message)
    });
  }

  return result;
}

function isMissingBinaryError(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

function formatTmuxErrorDetail(actionLabel: string, message: string): string {
  if (message.includes("ENOENT")) {
    return `tmux 会话${actionLabel}失败：当前系统未安装 tmux`;
  }

  return `tmux 会话${actionLabel}失败：${message}`;
}

function buildShellBootstrapScript(shell: string, env: Record<string, string>): string {
  const exportCommands = Object.entries(env)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("; ");

  const shellCommand = shellQuote(shell);
  return `${exportCommands}${exportCommands ? "; " : ""}exec ${shellCommand} -i`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
