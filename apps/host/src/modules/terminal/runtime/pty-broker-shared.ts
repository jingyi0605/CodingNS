import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PtyBrokerScriptLaunch {
  command: string;
  args: string[];
  cwd: string;
}

export function buildPtyBrokerEndpoint(sessionKey: string): string {
  const sessionHash = crypto.createHash("sha1").update(sessionKey).digest("hex").slice(0, 24);

  if (process.platform === "win32") {
    return `\\\\.\\pipe\\codingns-terminal-${sessionHash}`;
  }

  return path.join(os.tmpdir(), `codingns-terminal-${sessionHash}.sock`);
}

export function resolvePtyBrokerScriptLaunch(scriptBaseName: string): PtyBrokerScriptLaunch {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFilePath);
  const isSourceFile = currentFilePath.endsWith(".ts");
  const scriptPath = path.join(currentDir, `${scriptBaseName}${isSourceFile ? ".ts" : ".js"}`);
  const hostAppRoot = resolveHostAppRoot(currentFilePath);

  if (isSourceFile) {
    return {
      command: process.execPath,
      args: ["--import", "tsx", scriptPath],
      cwd: hostAppRoot
    };
  }

  return {
    command: process.execPath,
    args: [scriptPath],
    cwd: hostAppRoot
  };
}

export function writeJsonLine(
  writer: { write(content: string): unknown },
  payload: unknown
): void {
  writer.write(`${JSON.stringify(payload)}\n`);
}

export function createJsonLineParser(
  onMessage: (payload: unknown) => void
): { push(chunk: string | Buffer): void } {
  let buffer = "";

  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

      while (true) {
        const newlineIndex = buffer.indexOf("\n");

        if (newlineIndex < 0) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          continue;
        }

        onMessage(JSON.parse(line));
      }
    }
  };
}

export function encodeTerminalData(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

export function decodeTerminalData(content: string): string {
  return Buffer.from(content, "base64").toString("utf8");
}

export function parseCliArgs(argv: string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current?.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const nextValue = argv[index + 1];

    if (!nextValue || nextValue.startsWith("--")) {
      result.set(key, true);
      continue;
    }

    result.set(key, nextValue);
    index += 1;
  }

  return result;
}

export function readRequiredCliArg(args: Map<string, string | true>, key: string): string {
  const value = args.get(key);

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`缺少命令行参数 --${key}`);
  }

  return value;
}

export function normalizeProcessId(processId: number | undefined): number | null {
  if (typeof processId !== "number" || !Number.isInteger(processId) || processId <= 0) {
    return null;
  }

  return processId;
}

export function normalizeShellExitCode(exitCode: number | undefined): number | null {
  if (typeof exitCode !== "number" || !Number.isInteger(exitCode)) {
    return null;
  }

  return exitCode;
}

export function normalizeTerminalDimension(
  value: unknown,
  fallback: number,
  minimum: number
): number {
  if (!Number.isInteger(value) || typeof value !== "number") {
    return fallback;
  }

  return value >= minimum ? value : fallback;
}

export function preparePtyBrokerEndpoint(endpoint: string): void {
  if (process.platform === "win32") {
    return;
  }

  fs.rmSync(endpoint, { force: true });
}

export function cleanupPtyBrokerEndpoint(endpoint: string): void {
  if (process.platform === "win32") {
    return;
  }

  fs.rmSync(endpoint, { force: true });
}

function resolveHostAppRoot(currentFilePath: string): string {
  const srcRootCandidate = path.resolve(path.dirname(currentFilePath), "..", "..", "..");
  const withoutSrc =
    path.basename(srcRootCandidate) === "src"
      ? path.dirname(srcRootCandidate)
      : srcRootCandidate;

  return path.basename(withoutSrc) === ".build" ? path.dirname(withoutSrc) : withoutSrc;
}
