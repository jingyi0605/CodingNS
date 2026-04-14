import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";

import { resolveAvailableCommandPath } from "../../shared/utils/command-availability.js";
import { resolveCommandLaunch } from "../../shared/utils/command-launch.js";
import type {
  TailscaleHelperBackendState,
  TailscaleHelperSnapshot
} from "./tailscale-helper-client.js";

type HelperRequest =
  | {
      id: string;
      type: "status";
      commandPath: string;
    }
  | {
      id: string;
      type: "enable" | "login";
      commandPath: string;
      controlServerUrl: string | null;
      hostname: string | null;
    }
  | {
      id: string;
      type: "disable" | "logout";
      commandPath: string;
    };

const stdinReader = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

stdinReader.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  let payload: HelperRequest;

  try {
    payload = JSON.parse(line) as HelperRequest;
  } catch {
    return;
  }

  try {
    switch (payload.type) {
      case "status":
        emitResult(payload.id, await inspectStatus(payload.commandPath));
        return;
      case "enable":
        emitResult(
          payload.id,
          await enableTailscale(payload.commandPath, payload.controlServerUrl, payload.hostname)
        );
        return;
      case "login":
        emitResult(
          payload.id,
          await loginTailscale(payload.commandPath, payload.controlServerUrl, payload.hostname)
        );
        return;
      case "disable":
        emitResult(payload.id, await disableTailscale(payload.commandPath));
        return;
      case "logout":
        emitResult(payload.id, await logoutTailscale(payload.commandPath));
        return;
    }
  } catch (error) {
    emitError(payload.id, error instanceof Error ? error.message : String(error));
  }
}

function emitResult(id: string, result: unknown): void {
  process.stdout.write(
    `${JSON.stringify({
      type: "result",
      id,
      ok: true,
      result
    })}\n`
  );
}

function emitError(id: string, error: string): void {
  process.stdout.write(
    `${JSON.stringify({
      type: "result",
      id,
      ok: false,
      error
    })}\n`
  );
}

async function enableTailscale(
  commandPath: string,
  controlServerUrl: string | null,
  hostname: string | null
): Promise<TailscaleHelperSnapshot> {
  ensureCliAvailable(commandPath);
  const current = await inspectStatus(commandPath);

  if (current.backendState === "running") {
    if (hostname) {
      await runTailscaleCommand(commandPath, ["set", `--hostname=${hostname}`]);
      return await inspectStatus(commandPath);
    }

    return current;
  }

  if (current.backendState === "needs_login") {
    return await loginTailscale(commandPath, controlServerUrl, hostname);
  }

  const upArgs = ["up"];

  if (controlServerUrl) {
    upArgs.push(`--login-server=${controlServerUrl}`);
  }

  if (hostname) {
    upArgs.push(`--hostname=${hostname}`);
  }

  const upResult = await runTailscaleCommand(commandPath, upArgs, {
    captureLoginUrl: true
  });

  if (upResult.loginUrl) {
    const snapshot = await inspectStatus(commandPath);
    return {
      ...snapshot,
      backendState: "needs_login",
      loginUrl: upResult.loginUrl
    };
  }

  return await inspectStatus(commandPath);
}

async function loginTailscale(
  commandPath: string,
  controlServerUrl: string | null,
  hostname: string | null
): Promise<TailscaleHelperSnapshot> {
  ensureCliAvailable(commandPath);
  const loginArgs = ["login"];

  if (controlServerUrl) {
    loginArgs.push(`--login-server=${controlServerUrl}`);
  }

  const loginResult = await runTailscaleCommand(commandPath, loginArgs, {
    captureLoginUrl: true
  });

  const snapshot = await inspectStatus(commandPath);

  if (hostname && snapshot.backendState === "running") {
    await runTailscaleCommand(commandPath, ["set", `--hostname=${hostname}`]);
    return await inspectStatus(commandPath);
  }

  if (loginResult.loginUrl) {
    return {
      ...snapshot,
      backendState: "needs_login",
      loginUrl: loginResult.loginUrl
    };
  }

  return snapshot;
}

async function disableTailscale(commandPath: string): Promise<TailscaleHelperSnapshot> {
  ensureCliAvailable(commandPath);
  await runTailscaleCommand(commandPath, ["down"]);
  return await inspectStatus(commandPath);
}

async function logoutTailscale(commandPath: string): Promise<TailscaleHelperSnapshot> {
  ensureCliAvailable(commandPath);
  await runTailscaleCommand(commandPath, ["logout"]);
  return await inspectStatus(commandPath);
}

async function inspectStatus(commandPath: string): Promise<TailscaleHelperSnapshot> {
  ensureCliAvailable(commandPath);
  const result = await runTailscaleCommand(commandPath, ["status", "--json"], {
    allowNonZeroExit: true
  });

  if (!result.stdout.trim()) {
    return {
      backendState: "stopped",
      loginUrl: result.loginUrl,
      hostname: null,
      accountName: null,
      tailnetFqdn: null,
      tailnetIpv4: null,
      tailnetIpv6: null,
      lastError: result.exitCode === 0 ? null : (result.stderr.trim() || "TAILSCALE_STATUS_EMPTY")
    };
  }

  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    throw new Error("TAILSCALE_STATUS_JSON_INVALID");
  }

  const self = asRecord(payload.Self);
  const ips = readIpList(self.TailscaleIPs) ?? readIpList(payload.TailscaleIPs) ?? [];
  const backendState = normalizeBackendState(payload.BackendState);
  const ipv4 = ips.find((item) => item.includes(".")) ?? null;
  const ipv6 = ips.find((item) => item.includes(":")) ?? null;

  return {
    backendState,
    loginUrl: result.loginUrl,
    hostname: readOptionalString(self.HostName),
    accountName: resolveAccountName(self),
    tailnetFqdn: trimDnsName(readOptionalString(self.DNSName)),
    tailnetIpv4: ipv4,
    tailnetIpv6: ipv6,
    lastError:
      backendState === "error"
        ? (result.stderr.trim() || readOptionalString(payload.Health) || "TAILSCALE_BACKEND_ERROR")
        : null
  };
}

function ensureCliAvailable(commandPath: string): void {
  if (!resolveTailscaleCliPath(commandPath)) {
    throw new Error("TAILSCALE_CLI_UNAVAILABLE");
  }
}

async function runTailscaleCommand(
  commandPath: string,
  args: string[],
  options: {
    allowNonZeroExit?: boolean;
    captureLoginUrl?: boolean;
  } = {}
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  loginUrl: string | null;
}> {
  const resolvedCommandPath = resolveTailscaleCliPath(commandPath);

  if (!resolvedCommandPath) {
    throw new Error("TAILSCALE_CLI_UNAVAILABLE");
  }

  const launch = resolveCommandLaunch(resolvedCommandPath, args);

  return await new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: launch.shell,
      windowsHide: true
    });
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let loginUrl: string | null = null;
    let settled = false;
    let killedAfterUrl = false;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const maybeCaptureLoginUrl = (content: string) => {
      if (!options.captureLoginUrl || loginUrl) {
        return;
      }

      const matched = content.match(/https?:\/\/[^\s"'<>]+/);

      if (matched) {
        loginUrl = matched[0];

        if (!child.killed) {
          killedAfterUrl = true;
          child.kill("SIGTERM");
          forceKillTimer = setTimeout(() => {
            if (!settled && !child.killed) {
              child.kill("SIGKILL");
            }
          }, 1000);
        }
      }
    };

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;

      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }

      reject(error);
    });

    child.stdout.on("data", (chunk) => {
      const content = chunk.toString("utf8");
      stdoutChunks.push(content);
      maybeCaptureLoginUrl(content);
    });

    child.stderr.on("data", (chunk) => {
      const content = chunk.toString("utf8");
      stderrChunks.push(content);
      maybeCaptureLoginUrl(content);
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;

      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }

      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");
      const success = code === 0 || killedAfterUrl || options.allowNonZeroExit;

      if (!success) {
        reject(new Error(stderr.trim() || stdout.trim() || `TAILSCALE_EXIT_${code ?? "null"}`));
        return;
      }

      resolve({
        stdout,
        stderr,
        exitCode: code,
        loginUrl
      });
    });
  });
}

function resolveTailscaleCliPath(commandPath: string): string | null {
  return resolveAvailableCommandPath(commandPath, listTailscaleFallbackCandidates());
}

function listTailscaleFallbackCandidates(): string[] {
  if (process.platform === "win32") {
    return [
      "tailscale.exe",
      path.join("C:\\", "Program Files", "Tailscale", "tailscale.exe"),
      path.join("C:\\", "Program Files (x86)", "Tailscale", "tailscale.exe")
    ];
  }

  if (process.platform === "darwin") {
    return [
      "/opt/homebrew/bin/tailscale",
      "/usr/local/bin/tailscale",
      "/usr/bin/tailscale",
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
      path.join(process.env.HOME ?? "", ".local", "bin", "tailscale")
    ];
  }

  return [
    "/usr/local/bin/tailscale",
    "/usr/bin/tailscale",
    "/snap/bin/tailscale",
    path.join(process.env.HOME ?? "", ".local", "bin", "tailscale")
  ];
}

function normalizeBackendState(value: unknown): TailscaleHelperBackendState {
  const normalized = readOptionalString(value)?.toLowerCase();

  switch (normalized) {
    case "running":
      return "running";
    case "needslogin":
      return "needs_login";
    case "starting":
      return "starting";
    case "stopped":
    case "nodaemon":
      return "stopped";
    default:
      return normalized ? "error" : "stopped";
  }
}

function readIpList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter((item): item is string => typeof item === "string");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function trimDnsName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.endsWith(".") ? value.slice(0, -1) : value;
}

function resolveAccountName(
  self: Record<string, unknown>
): string | null {
  const userProfile = asRecord(self.UserProfile);

  // 这里只能展示用户真实账号字段，不能把 tailnet 名称伪装成账号名。
  return (
    trimOptionalText(userProfile.LoginName)
    ?? trimOptionalText(userProfile.DisplayName)
    ?? null
  );
}

function trimOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
