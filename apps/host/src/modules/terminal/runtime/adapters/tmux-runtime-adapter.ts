import { spawn } from "node:child_process";

import { AppError } from "../../../../shared/errors/app-error.js";
import type { TerminalRuntimeAdapter } from "../terminal-runtime-adapter.js";
import { TmuxHelperClient } from "./tmux-helper-client.js";

let tmuxHelperClient: TmuxHelperClient | null = null;

export class TmuxRuntimeAdapter implements TerminalRuntimeAdapter {
  readonly type = "tmux" as const;
  readonly survivesHostRestart = true;

  async createPersistentSession(
    input: Parameters<TerminalRuntimeAdapter["createPersistentSession"]>[0]
  ) {
    ensureTmuxSupported();

    const shellBootstrapScript = buildShellBootstrapScript(input.terminal.shell, input.env);
    const createArgs = [
      "new-session",
      "-d",
      "-s",
      input.session.sessionKey,
      "-c",
      input.terminal.cwd,
      "/bin/sh",
      "-lc",
      shellBootstrapScript
    ];

    const result = await runTmuxCommand(createArgs, {
      errorCode: "RUNTIME_CREATE_FAILED",
      actionLabel: "创建"
    });

    if (result.status !== 0) {
      throw new AppError({
        statusCode: 502,
        errorCode: "RUNTIME_CREATE_FAILED",
        detail: result.stderr.trim() || result.stdout.trim() || "tmux 会话创建失败"
      });
    }

    return {
      alive: true,
      shellPid: null,
      detail: null
    };
  }

  async inspectPersistentSession(
    input: Parameters<TerminalRuntimeAdapter["inspectPersistentSession"]>[0]
  ) {
    ensureTmuxSupported();

    const hasSession = await runTmuxCommand(["has-session", "-t", input.session.sessionKey], {
      errorCode: "RUNTIME_INSPECT_FAILED",
      actionLabel: "检查",
      tolerateMissingBinary: true
    });

    if (hasSession.error) {
      if (isBadFileDescriptorError(hasSession.error)) {
        return {
          alive: true,
          shellPid: input.terminal.processId ?? input.session.shellPid ?? null,
          detail: null
        };
      }

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

    const listPanes = await runTmuxCommand(
      ["list-panes", "-t", input.session.sessionKey, "-F", "#{pane_dead}\t#{pane_dead_status}\t#{pane_pid}"],
      {
        errorCode: "RUNTIME_INSPECT_FAILED",
        actionLabel: "检查",
        tolerateMissingBinary: true
      }
    );

    if (listPanes.error || listPanes.status !== 0) {
      if (listPanes.error && isBadFileDescriptorError(listPanes.error)) {
        return {
          alive: true,
          shellPid: input.terminal.processId ?? input.session.shellPid ?? null,
          detail: null
        };
      }

      return {
        alive: true,
        shellPid: null,
        detail: listPanes.error?.message ?? (listPanes.stderr.trim() || null)
      };
    }

    const [firstPaneLine = ""] = listPanes.stdout.trim().split(/\r?\n/);
    const [paneDead = "0", paneDeadStatus = "", panePid = ""] = firstPaneLine.split("\t");

    if (paneDead === "1") {
      const parsedExitCode = Number.parseInt(paneDeadStatus, 10);

      return {
        alive: false,
        shellPid: null,
        detail: Number.isInteger(parsedExitCode)
          ? `终端异常退出，exitCode=${parsedExitCode}`
          : "终端异常退出"
      };
    }

    const firstPanePid = Number.parseInt(panePid, 10);

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
        "set-window-option",
        "-t",
        input.session.sessionKey,
        "remain-on-exit",
        "on",
        ";",
        "attach-session",
        "-t",
        input.session.sessionKey
      ],
      cwd: input.terminal.cwd,
      env: input.env
    };
  }

  async terminatePersistentSession(
    input: Parameters<TerminalRuntimeAdapter["terminatePersistentSession"]>[0]
  ): Promise<void> {
    ensureTmuxSupported();

    const result = await runTmuxCommand(["kill-session", "-t", input.session.sessionKey], {
      errorCode: "RUNTIME_TERMINATE_FAILED",
      actionLabel: "结束",
      tolerateMissingBinary: true
    });

    if (result.error) {
      return;
    }

    if (result.status !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim();

      if (isIgnorableTerminateDetail(detail)) {
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

export async function captureTmuxPaneContent(sessionKey: string): Promise<string> {
  ensureTmuxSupported();

  const result = await runTmuxCommand(
    ["capture-pane", "-p", "-S", "-20000", "-t", sessionKey],
    {
      errorCode: "RUNTIME_CAPTURE_FAILED",
      actionLabel: "抓取",
      tolerateMissingBinary: true
    }
  );

  if (result.error) {
    throw new AppError({
      statusCode: 502,
      errorCode: "RUNTIME_CAPTURE_FAILED",
      detail: formatTmuxErrorDetail("抓取", result.error.message)
    });
  }

  if (result.status !== 0) {
    throw new AppError({
      statusCode: 502,
      errorCode: "RUNTIME_CAPTURE_FAILED",
      detail: result.stderr.trim() || result.stdout.trim() || "tmux pane 历史抓取失败"
    });
  }

  return result.stdout;
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

async function runTmuxCommand(
  args: string[],
  options: {
    errorCode: string;
    actionLabel: string;
    tolerateMissingBinary?: boolean;
  }
) {
  try {
    const result = process.env.VITEST
      ? await runTmuxCommandDirect(args)
      : await getTmuxHelperClient().run(args);
    return {
      ...result,
      error: undefined
    };
  } catch (error) {
    if (
      error instanceof Error &&
      options.tolerateMissingBinary &&
      (isMissingBinaryError(error) || isBadFileDescriptorError(error))
    ) {
      return {
        status: null,
        stdout: "",
        stderr: "",
        error
      };
    }

    if (error instanceof Error && isMissingBinaryError(error)) {
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
      detail: formatTmuxErrorDetail(
        options.actionLabel,
        error instanceof Error ? error.message : String(error)
      )
    });
  }
}

function isMissingBinaryError(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

function isBadFileDescriptorError(error: Error): boolean {
  return "code" in error && error.code === "EBADF";
}

function formatTmuxErrorDetail(actionLabel: string, message: string): string {
  if (message.includes("ENOENT")) {
    return `tmux 会话${actionLabel}失败：当前系统未安装 tmux`;
  }

  if (message.includes("EBADF")) {
    return `tmux 会话${actionLabel}失败：当前运行时无法创建 tmux 子进程`;
  }

  return `tmux 会话${actionLabel}失败：${message}`;
}

function isIgnorableTerminateDetail(detail: string): boolean {
  return (
    detail.includes("can't find session") ||
    detail.includes("no server running on") ||
    detail.includes("failed to connect to server")
  );
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

function getTmuxHelperClient(): TmuxHelperClient {
  if (!tmuxHelperClient) {
    tmuxHelperClient = new TmuxHelperClient();
  }

  return tmuxHelperClient;
}

async function runTmuxCommandDirect(args: string[]): Promise<{
  status: number | null;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn("tmux", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (status) => {
      resolve({
        status,
        stdout,
        stderr
      });
    });
  });
}
