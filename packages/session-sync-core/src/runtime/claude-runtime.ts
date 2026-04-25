import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, sep } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { tmpdir } from "node:os";

import {
  buildClaudeMessageSignature,
  buildClaudeProgressiveTrackKey,
  buildClaudeStableRawRef,
  normalizeClaudeMessagePart,
  normalizeClaudeMessageParts,
  readClaudeMessageId,
  shouldReuseClaudeProgressiveIdentity,
  toClaudeRecord,
  type ClaudeMessageEnvelope,
  type ClaudeStableMessageRef
} from "../claude-message-utils.js";
import {
  ensureDirectory,
  ensureText,
  nextTimestamp,
  safeDate,
  stringifyStructuredValue,
  workspaceSlug
} from "../providers/utils.js";
import type { NormalizedMessage } from "../types.js";
import type {
  ProviderRuntimeAdapter,
  ProviderRuntimeEventSink,
  ProviderRuntimeLaunchResult,
  ProviderRuntimeRunRequest
} from "./types.js";

interface ClaudeRuntimeOptions {
  homeDir: string;
  commandPath?: string;
  hookBridge?: {
    url: string;
    token: string;
    scriptPath: string;
  } | null;
}

interface ClaudeStreamPartState {
  part: Record<string, unknown>;
  jsonBuffer?: string;
}

interface ClaudeStreamMessageState {
  type: "user" | "assistant";
  messageId: string | null;
  timestamp: unknown;
  partsByIndex: Map<number, ClaudeStreamPartState>;
  stopReason?: string | null;
}

interface ClaudeStreamEventState {
  currentMessageKey: string | null;
  messages: Map<string, ClaudeStreamMessageState>;
}

interface ClaudeStreamingUserInput {
  type: "user";
  message: {
    role: "user";
    content: Array<{
      type: "text";
      text: string;
    }>;
  };
}

/**
 * Claude 真实运行时：通过 claude.cmd 流式读取事件，而不是伪造写文件。
 */
export class ClaudeRuntimeAdapter implements ProviderRuntimeAdapter {
  readonly providerId = "claude-code" as const;
  private readonly commandPath: string;

  constructor(private readonly options: ClaudeRuntimeOptions) {
    this.commandPath = resolveClaudeCommand(options.commandPath);
  }

  async startSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const homeDir = request.runtimeHomeDir?.trim() || this.options.homeDir;
    const providerSessionId = request.providerSessionId ?? buildPendingClaudeSessionId(request.sessionId);
    const rawStoreRef = buildClaudePendingRawStoreRef(
      homeDir,
      request.workspacePath,
      request.sessionId
    );

    sink.updateSessionBinding({
      providerSessionId,
      rawStoreRef
    });

    return this.launchClaude(
      request,
      sink,
      providerSessionId,
      rawStoreRef,
      []
    );
  }

  async continueSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const homeDir = request.runtimeHomeDir?.trim() || this.options.homeDir;
    const providerSessionId = ensureNonEmpty(
      request.providerSessionId,
      "CLAUDE_PROVIDER_SESSION_ID_REQUIRED"
    );
    const rawStoreRef =
      findClaudeSessionFile(homeDir, providerSessionId) ??
      request.rawStoreRef ??
      buildClaudeRawStoreRef(homeDir, request.workspacePath, providerSessionId);

    sink.updateSessionBinding({
      providerSessionId,
      rawStoreRef
    });

    return this.launchClaude(
      request,
      sink,
      providerSessionId,
      rawStoreRef,
      ["--resume", providerSessionId]
    );
  }

  private launchClaude(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink,
    providerSessionId: string,
    rawStoreRef: string,
    sessionArgs: string[]
  ): ProviderRuntimeLaunchResult {
    const homeDir = request.runtimeHomeDir?.trim() || this.options.homeDir;
    const instructionFilePath = normalizeOptionalInstructionFilePath(
      request.options.providerInstructionFilePath
    );
    const hookSettings = shouldInjectClaudeHookBridge(request.options.permissionMode) && this.options.hookBridge
      ? createClaudeHookSettingsFile(this.options.hookBridge)
      : null;
    const attachmentDirectories = Array.from(
      new Set(
        request.options.attachments.map((attachment) => dirname(attachment.filePath))
      )
    );
    const args = [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--include-partial-messages",
      ...(instructionFilePath ? ["--system-prompt-file", instructionFilePath] : []),
      ...(hookSettings ? ["--settings", hookSettings.filePath] : []),
      ...attachmentDirectories.flatMap((directory) => ["--add-dir", directory]),
      ...sessionArgs
    ];
    const permissionArgs = buildClaudePermissionArgs(request.options.permissionMode);

    if (permissionArgs.length > 0) {
      args.push(...permissionArgs);
    }

    if (request.options.model) {
      args.push("--model", request.options.model);
    }

    logClaudeRuntimeDebug("launch.begin", {
      sessionId: request.sessionId,
      providerSessionId,
      workspacePath: request.workspacePath,
      commandPath: this.commandPath,
      args,
      instructionFilePath,
      hookSettingsPath: hookSettings?.filePath ?? null,
      hookDebugLogPath: hookSettings?.debugLogPath ?? null,
      hookSettingsJson: hookSettings?.json ?? null
    });

    let sequence = Math.max(0, request.sequenceBase ?? 0);
    const toolNameById = new Map<string, string>();
    const stableMessageRefByIdentity = new Map<string, ClaudeStableMessageRef>();
    const progressiveMessagesByTrackKey = new Map<string, NormalizedMessage>();
    const emittedSignatureByMessageId = new Map<string, string>();
    const streamEventState: ClaudeStreamEventState = {
      currentMessageKey: null,
      messages: new Map()
    };
    let interrupted = false;
    let completed = false;
    let fatalWriteError: string | null = null;
    let fatalWriteErrorCode: string | null = null;
    let stderrBuffer = "";
    let stdoutBuffer = "";
    let stdinClosed = false;

    let activeProviderSessionId = providerSessionId;
    let activeRawStoreRef = rawStoreRef;
    const refreshBinding = (parsed?: Record<string, unknown>) => {
      const discoveredProviderSessionId = extractClaudeSessionId(parsed);
      let changed = false;

      if (
        discoveredProviderSessionId &&
        discoveredProviderSessionId !== activeProviderSessionId &&
        !isPendingClaudeSessionId(discoveredProviderSessionId)
      ) {
        activeProviderSessionId = discoveredProviderSessionId;
        changed = true;
      }

      if (!isPendingClaudeSessionId(activeProviderSessionId)) {
        const nextRawStoreRef =
          findClaudeSessionFile(homeDir, activeProviderSessionId) ??
          buildClaudeRawStoreRef(homeDir, request.workspacePath, activeProviderSessionId);

        if (nextRawStoreRef !== activeRawStoreRef) {
          activeRawStoreRef = nextRawStoreRef;
          this.ensureRuntimeStoreReady(activeRawStoreRef);
          changed = true;
        }
      }

      if (changed) {
        sink.updateSessionBinding({
          providerSessionId: activeProviderSessionId,
          rawStoreRef: activeRawStoreRef
        });
      }

      return {
        providerSessionId: activeProviderSessionId,
        rawStoreRef: activeRawStoreRef
      };
    };

    this.ensureRuntimeStoreReady(activeRawStoreRef);
    const runtimeEnv = {
      ...buildClaudeRuntimeEnv(homeDir),
      ...(request.runtimeEnv ?? {})
    };

    const proc = spawn(this.commandPath, args, {
      cwd: request.workspacePath,
      env: runtimeEnv,
      shell: shouldSpawnClaudeViaShell(this.commandPath),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let pendingInputWrite = Promise.resolve();
    const submitDuringRun = (options: ProviderRuntimeRunRequest["options"]) => {
      pendingInputWrite = pendingInputWrite.then(() =>
        writeClaudeStreamingInput(proc, options, completed || interrupted || stdinClosed)
      );
      return pendingInputWrite;
    };
    const bindingRefreshTimer = setInterval(() => {
      refreshBinding();
    }, 250);
    void submitDuringRun(request.options).catch((error) => {
      if (completed || interrupted) {
        return;
      }

      fatalWriteError = error instanceof Error ? error.message : "claude stdin write failed";
      fatalWriteErrorCode = "CLAUDE_CLI_STDIN_WRITE_FAILED";
      stderrBuffer = `${stderrBuffer}\n${fatalWriteError}`.trim();

      if (!proc.killed) {
        proc.kill("SIGTERM");
      }
    });

    const completedPromise = new Promise<void>((resolve) => {
      const shutdownProcessAfterTurn = () => {
        stdinClosed = true;

        if (!proc.stdin.destroyed) {
          proc.stdin.end();
        }

        if (!proc.killed) {
          proc.kill("SIGTERM");
        }
      };
      const emitRuntimeError = async (detail: string, errorCode = "CLAUDE_RUNTIME_ERROR") => {
        if (completed) {
          return;
        }

        completed = true;
        const binding = refreshBinding();
        await sink.emit({
          type: "error",
          status: "failed",
          providerSessionId: binding.providerSessionId,
          rawStoreRef: binding.rawStoreRef,
          errorCode,
          detail
        });
      };

      const emitRuntimeComplete = async (status: "complete" | "interrupted", detail: string) => {
        if (completed) {
          return;
        }

        completed = true;
        const binding = refreshBinding();
        await sink.emit({
          type: status,
          status: status === "complete" ? "completed" : "interrupted",
          providerSessionId: binding.providerSessionId,
          rawStoreRef: binding.rawStoreRef,
          detail
        });
      };
      const handleControlLine = (parsed: Record<string, unknown>) => {
        const result = readClaudeResultOutcome(parsed);

        if (!result) {
          return false;
        }

        stableMessageRefByIdentity.clear();

        const settle = result.kind === "complete"
          ? emitRuntimeComplete("complete", result.detail)
          : emitRuntimeError(result.detail, result.errorCode);

        void settle.finally(() => {
          shutdownProcessAfterTurn();
          resolve();
        });

        return true;
      };

      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();

          if (!trimmed) {
            continue;
          }

          void this.consumeStreamLine({
            line: trimmed,
            onParsed: handleControlLine,
            refreshBinding,
            sink,
            allocateSequence: () => {
              sequence += 1;
              return sequence;
            },
            toolNameById,
            stableMessageRefByIdentity,
            progressiveMessagesByTrackKey,
            emittedSignatureByMessageId,
            streamEventState
          });
        }
      });

      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        stderrBuffer += chunk;
      });

      proc.on("error", (error) => {
        clearInterval(bindingRefreshTimer);
        stdinClosed = true;
        hookSettings?.cleanup();
        void emitRuntimeError(error.message, "CLAUDE_CLI_SPAWN_FAILED").finally(resolve);
      });

      proc.on("close", (code, signal) => {
        clearInterval(bindingRefreshTimer);
        stdinClosed = true;
        hookSettings?.cleanup();

        if (fatalWriteError) {
          void emitRuntimeError(
            fatalWriteError,
            fatalWriteErrorCode ?? "CLAUDE_CLI_STDIN_WRITE_FAILED"
          ).finally(resolve);
          return;
        }

        if (interrupted || signal === "SIGTERM" || signal === "SIGINT") {
          void emitRuntimeComplete("interrupted", "claude process interrupted").finally(resolve);
          return;
        }

        if (code === 0) {
          void emitRuntimeComplete("complete", "claude turn completed").finally(resolve);
          return;
        }

        const detail = stderrBuffer.trim() || `claude exited with code ${String(code)}`;
        void emitRuntimeError(detail, "CLAUDE_CLI_EXIT_NON_ZERO").finally(resolve);
      });
    });

    return {
      providerSessionId: activeProviderSessionId,
      rawStoreRef: activeRawStoreRef,
      completed: completedPromise,
      submitDuringRun,
      interrupt: async () => {
        if (proc.killed) {
          return;
        }

        interrupted = true;
        stdinClosed = true;
        if (!proc.stdin.destroyed) {
          proc.stdin.end();
        }
        proc.kill("SIGTERM");
      }
    };
  }

  private ensureRuntimeStoreReady(rawStoreRef: string): void {
    ensureDirectory(dirname(rawStoreRef));

    if (existsSync(rawStoreRef)) {
      return;
    }

    writeFileSync(rawStoreRef, "", "utf8");
  }

  private async consumeStreamLine(input: {
    line: string;
    onParsed: (parsed: Record<string, unknown>) => boolean;
    refreshBinding: (parsed?: Record<string, unknown>) => {
      providerSessionId: string;
      rawStoreRef: string;
    };
    sink: ProviderRuntimeEventSink;
    allocateSequence: () => number;
    toolNameById: Map<string, string>;
    stableMessageRefByIdentity: Map<string, ClaudeStableMessageRef>;
    progressiveMessagesByTrackKey: Map<string, NormalizedMessage>;
    emittedSignatureByMessageId: Map<string, string>;
    streamEventState: ClaudeStreamEventState;
  }): Promise<void> {
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(input.line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (input.onParsed(parsed)) {
      return;
    }

    const binding = input.refreshBinding(parsed);
    const envelopes = collectMessageEnvelopes(parsed, input.streamEventState);

    for (const envelope of envelopes) {
      const parts = normalizeClaudeMessageParts(envelope.message.content);

      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const part = parts[partIndex];
        const normalized = normalizeClaudeMessagePart({
          part,
          envelope,
          providerSessionId: binding.providerSessionId,
          partIndex,
          timestamp: safeDate(envelope.timestamp, nextTimestamp()),
          toolNameById: input.toolNameById,
          resolveStableMessageRef: (identity) => {
            const existing = input.stableMessageRefByIdentity.get(identity);

            if (existing) {
              return existing;
            }

            const sequence = input.allocateSequence();
            const created: ClaudeStableMessageRef = {
              sequence,
              rawRef: buildClaudeStableRawRef(identity)
            };

            input.stableMessageRefByIdentity.set(identity, created);
            return created;
          }
        });

        if (!normalized) {
          continue;
        }

        if (normalized.role === "user") {
          input.progressiveMessagesByTrackKey.clear();
        }

        const trackKey = buildClaudeProgressiveTrackKey(normalized, partIndex);
        const previousProgressive = trackKey
          ? input.progressiveMessagesByTrackKey.get(trackKey) ?? null
          : null;
        const nextMessage =
          previousProgressive && shouldReuseClaudeProgressiveIdentity(previousProgressive, normalized)
            ? {
                ...normalized,
                messageId: previousProgressive.messageId,
                rawRef: previousProgressive.rawRef,
                sequence: previousProgressive.sequence
              }
            : normalized;

        if (trackKey) {
          input.progressiveMessagesByTrackKey.set(trackKey, nextMessage);
        }

        const signature = buildClaudeMessageSignature(nextMessage);

        if (input.emittedSignatureByMessageId.get(nextMessage.messageId) === signature) {
          continue;
        }

        input.emittedSignatureByMessageId.set(nextMessage.messageId, signature);

        await input.sink.emit({
          type: "message",
          providerSessionId: binding.providerSessionId,
          rawStoreRef: binding.rawStoreRef,
          message: nextMessage,
          status: "running",
          rawEventRef: nextMessage.rawRef
        });
      }
    }
  }
}

function writeClaudeStreamingInput(
  proc: ChildProcessWithoutNullStreams,
  options: ProviderRuntimeRunRequest["options"],
  isClosed: boolean
): Promise<void> {
  if (isClosed || proc.killed || proc.stdin.destroyed || !proc.stdin.writable) {
    return Promise.reject(new Error("IN_RUN_INPUT_NOT_SUPPORTED"));
  }

  const payload = JSON.stringify(buildClaudeStreamingUserInput(options));

  return new Promise<void>((resolve, reject) => {
    proc.stdin.write(`${payload}\n`, "utf8", (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function buildClaudeStreamingUserInput(
  options: ProviderRuntimeRunRequest["options"]
): ClaudeStreamingUserInput {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: options.providerPrompt ?? options.content
        }
      ]
    }
  };
}

function normalizeOptionalInstructionFilePath(value: string | null | undefined): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return normalized;
}

export function buildClaudePermissionArgs(permissionMode: string | null): string[] {
  if (
    permissionMode === "default" ||
    permissionMode === "acceptEdits" ||
    permissionMode === "bypassPermissions"
  ) {
    return ["--permission-mode", permissionMode];
  }

  return [];
}

function shouldInjectClaudeHookBridge(permissionMode: string | null): boolean {
  return permissionMode !== "bypassPermissions";
}

function buildClaudeRuntimeEnv(homeDir: string): NodeJS.ProcessEnv {
  const resolvedHomeDir = join(homeDir);
  const xdgConfigHome = join(resolvedHomeDir, "xdg-config");
  const xdgDataHome = join(resolvedHomeDir, "xdg-data");
  const xdgStateHome = join(resolvedHomeDir, "xdg-state");
  const xdgCacheHome = join(resolvedHomeDir, "xdg-cache");
  const appDataHome = join(resolvedHomeDir, "appdata");
  const localAppDataHome = join(resolvedHomeDir, "localappdata");

  [
    resolvedHomeDir,
    xdgConfigHome,
    xdgDataHome,
    xdgStateHome,
    xdgCacheHome,
    appDataHome,
    localAppDataHome
  ].forEach((directoryPath) => {
    ensureDirectory(directoryPath);
  });

  return {
    ...process.env,
    CLAUDE_CONFIG_DIR: resolvedHomeDir,
    HOME: resolvedHomeDir,
    USERPROFILE: resolvedHomeDir,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: xdgDataHome,
    XDG_STATE_HOME: xdgStateHome,
    XDG_CACHE_HOME: xdgCacheHome,
    APPDATA: appDataHome,
    LOCALAPPDATA: localAppDataHome
  };
}

function createClaudeHookSettingsFile(input: {
  url: string;
  token: string;
  scriptPath: string;
}): { filePath: string; cleanup: () => void; debugLogPath: string; json: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "codingns-claude-hooks-"));
  const filePath = join(tempDir, "settings.json");
  const debugLogPath = join(tmpdir(), "codingns-claude-hook-bridge.log");
  const command = buildClaudeHookBridgeCommand(input, tempDir, debugLogPath);
  const settings = {
    hooks: {
      PreToolUse: ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit"].map((matcher) => ({
        matcher,
        hooks: [
          {
            type: "command",
            command
          }
        ]
      }))
    }
  };
  const settingsJson = JSON.stringify(settings);

  writeFileSync(filePath, settingsJson, "utf8");

  return {
    filePath,
    debugLogPath,
    json: settingsJson,
    cleanup: () => {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function buildClaudeHookBridgeCommand(input: {
  url: string;
  token: string;
  scriptPath: string;
}, tempDir: string, debugLogPath: string): string {
  if (process.platform === "win32") {
    void tempDir;
    return `${quoteShellArgument(process.execPath)} ${quoteShellArgument(input.scriptPath)} --url ${quoteShellArgument(input.url)} --token ${quoteShellArgument(input.token)} --debug-log ${quoteShellArgument(debugLogPath)}`;
  }

  return `${quoteShellArgument(process.execPath)} ${quoteShellArgument(input.scriptPath)} --url ${quoteShellArgument(input.url)} --token ${quoteShellArgument(input.token)} --debug-log ${quoteShellArgument(debugLogPath)}`;
}

function quoteShellArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function resolveClaudeCommand(explicitPath?: string): string {
  const explicitCandidate = pickFirstNonEmpty(
    explicitPath,
    process.env.CODINGNS_CLAUDE_CODE_COMMAND,
    process.env.CLAUDE_CODE_COMMAND
  );

  if (explicitCandidate) {
    return resolveExecutableCandidate(explicitCandidate) ?? explicitCandidate;
  }

  const candidates =
    process.platform === "win32"
      ? [
          "claude.cmd",
          process.env.APPDATA ? join(process.env.APPDATA, "npm", "claude.cmd") : "",
          process.env.USERPROFILE
            ? join(process.env.USERPROFILE, "AppData", "Roaming", "npm", "claude.cmd")
            : "",
          "claude"
        ]
      : ["claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"];

  for (const candidate of candidates) {
    const resolved = resolveExecutableCandidate(candidate);

    if (resolved) {
      return resolved;
    }
  }

  return process.platform === "win32" ? "claude.cmd" : "claude";
}

function shouldSpawnClaudeViaShell(commandPath: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(commandPath);
}

const CLAUDE_RUNTIME_DEBUG_ENABLED = /^(1|true|yes)$/i.test(
  process.env.CODINGNS_PERMISSION_DEBUG?.trim() ?? ""
);

function logClaudeRuntimeDebug(scope: string, detail: Record<string, unknown>): void {
  if (!CLAUDE_RUNTIME_DEBUG_ENABLED) {
    return;
  }

  const suffix = Object.entries(detail)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (value === null) {
        return `${key}=null`;
      }

      if (typeof value === "string") {
        return `${key}=${JSON.stringify(value.length > 400 ? `${value.slice(0, 400)}...` : value)}`;
      }

      try {
        const json = JSON.stringify(value);
        return `${key}=${json.length > 400 ? `${json.slice(0, 400)}...` : json}`;
      } catch {
        return `${key}=${String(value)}`;
      }
    })
    .join(" ");

  console.info(`[permission-debug][claude-runtime] ${scope}${suffix ? ` ${suffix}` : ""}`);
}

function resolveExecutableCandidate(candidate: string): string | null {
  const trimmed = candidate.trim();

  if (!trimmed) {
    return null;
  }

  if (hasPathSegment(trimmed)) {
    return isExecutableFile(trimmed) ? trimmed : null;
  }

  return resolveExecutableOnPath(trimmed);
}

function resolveExecutableOnPath(command: string): string | null {
  const pathValue = process.env.PATH ?? "";

  if (!pathValue.trim()) {
    return null;
  }

  const extensions =
    process.platform === "win32"
      ? buildWindowsExecutableExtensions(command)
      : [""];

  for (const entry of pathValue.split(delimiter)) {
    const trimmedEntry = entry.trim();

    if (!trimmedEntry) {
      continue;
    }

    for (const extension of extensions) {
      const candidatePath = join(trimmedEntry, `${command}${extension}`);

      if (isExecutableFile(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function buildWindowsExecutableExtensions(command: string): string[] {
  if (/\.[^./\\]+$/.test(command)) {
    return [""];
  }

  const pathExtensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return ["", ...pathExtensions];
}

function hasPathSegment(value: string): boolean {
  return isAbsolute(value) || value.includes(sep) || value.includes("/") || value.includes("\\");
}

function isExecutableFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  if (process.platform === "win32") {
    return true;
  }

  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pickFirstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function buildPendingClaudeSessionId(sessionId: string): string {
  return `pending://claude-code/${sessionId}`;
}

function isPendingClaudeSessionId(sessionId: string): boolean {
  return sessionId.startsWith("pending://claude-code/");
}

function buildClaudeRawStoreRef(homeDir: string, workspacePath: string, sessionId: string): string {
  return join(homeDir, "projects", workspaceSlug(workspacePath), `${sessionId}.jsonl`);
}

function buildClaudePendingRawStoreRef(homeDir: string, workspacePath: string, sessionId: string): string {
  return join(homeDir, "projects", workspaceSlug(workspacePath), `.pending-${sessionId}.jsonl`);
}

function findClaudeSessionFile(homeDir: string, sessionId: string): string | null {
  const projectsDir = join(homeDir, "projects");

  if (!existsSync(projectsDir)) {
    return null;
  }

  const candidates = readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(projectsDir, entry.name, `${sessionId}.jsonl`))
    .filter((filePath) => existsSync(filePath));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => compareClaudeSessionFiles(right, left));
  return candidates[0] ?? null;
}

function compareClaudeSessionFiles(left: string, right: string): number {
  const leftStat = statSync(left);
  const rightStat = statSync(right);

  if (leftStat.size !== rightStat.size) {
    return leftStat.size - rightStat.size;
  }

  return leftStat.mtimeMs - rightStat.mtimeMs;
}

function extractClaudeSessionId(parsed?: Record<string, unknown>): string | null {
  const directSessionId = ensureText(parsed?.session_id).trim();

  if (directSessionId.length > 0) {
    return directSessionId;
  }

  const resultSessionId = ensureText(
    ((parsed?.result ?? {}) as Record<string, unknown>).session_id
  ).trim();

  if (resultSessionId.length > 0) {
    return resultSessionId;
  }

  return null;
}

function ensureNonEmpty(value: string | null, errorCode: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(errorCode);
  }

  return value.trim();
}

function readClaudeResultOutcome(record: Record<string, unknown>):
  | {
      kind: "complete";
      detail: string;
    }
  | {
      kind: "error";
      detail: string;
      errorCode: string;
    }
  | null {
  if (ensureText(record.type).trim() !== "result") {
    return null;
  }

  const subtype = ensureText(record.subtype).trim().toLowerCase();
  const stopReason = ensureText(record.stop_reason).trim();
  const resultRecord = ((record.result ?? {}) as Record<string, unknown>);
  const nestedStopReason = ensureText(resultRecord.stop_reason).trim();
  const detailCandidate =
    ensureText(record.error).trim()
    || ensureText(record.message).trim()
    || ensureText(resultRecord.error).trim()
    || ensureText(resultRecord.message).trim()
    || stopReason
    || nestedStopReason;

  if (!subtype || subtype === "success" || subtype === "completed") {
    return {
      kind: "complete",
      detail: detailCandidate || "claude turn completed"
    };
  }

  return {
    kind: "error",
    detail: detailCandidate || `claude result ${subtype}`,
    errorCode: `CLAUDE_RESULT_${subtype.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`
  };
}

function collectMessageEnvelopes(
  record: Record<string, unknown>,
  streamEventState: ClaudeStreamEventState
): ClaudeMessageEnvelope[] {
  if (ensureText(record.type).trim() === "stream_event") {
    return collectStreamEventEnvelopes(record, streamEventState);
  }

  const envelopes: ClaudeMessageEnvelope[] = [];
  const directType = ensureText(record.type).trim();
  const directMessage = toClaudeRecord(record.message);

  if (directType === "user" || directType === "assistant") {
    envelopes.push({
      type: directType,
      source: "direct",
      messageId: readClaudeMessageId(directMessage, record),
      timestamp: record.timestamp,
      message: directMessage as ClaudeMessageEnvelope["message"]
    });
  }

  const progressMessage = readProgressEnvelope(record);

  if (progressMessage) {
    envelopes.push(progressMessage);
  }

  return envelopes;
}

function readProgressEnvelope(record: Record<string, unknown>): ClaudeMessageEnvelope | null {
  if (ensureText(record.type) !== "progress") {
    return null;
  }

  const nested = toClaudeRecord(toClaudeRecord(record.data).message);
  const nestedType = ensureText(nested.type).trim();
  const nestedMessage = toClaudeRecord(nested.message);

  if (nestedType !== "user" && nestedType !== "assistant") {
    return null;
  }

  return {
    type: nestedType,
    source: "progress",
    messageId: readClaudeMessageId(nestedMessage, nested),
    timestamp: nested.timestamp ?? record.timestamp,
    message: nestedMessage as ClaudeMessageEnvelope["message"]
  };
}

function collectStreamEventEnvelopes(
  record: Record<string, unknown>,
  state: ClaudeStreamEventState
): ClaudeMessageEnvelope[] {
  const event = toClaudeRecord(record.event);
  const eventType = ensureText(event.type).trim();

  if (!eventType) {
    return [];
  }

  if (eventType === "message_start") {
    const message = toClaudeRecord(event.message);
    const role = ensureText(message.role).trim();

    if (role !== "user" && role !== "assistant") {
      return [];
    }

    const messageId = readClaudeMessageId(message, message);
    const messageKey = messageId || `stream:${randomUUID()}`;
    const messageState: ClaudeStreamMessageState = {
      type: role,
      messageId,
      timestamp: message.timestamp ?? record.timestamp,
      partsByIndex: new Map()
    };
    const initialParts = normalizeClaudeMessageParts(message.content);

    initialParts.forEach((part, partIndex) => {
      messageState.partsByIndex.set(partIndex, {
        part: { ...part }
      });
    });

    state.currentMessageKey = messageKey;
    state.messages.set(messageKey, messageState);
    return [];
  }

  const messageKey = resolveClaudeStreamMessageKey(record, state);

  if (!messageKey) {
    return [];
  }

  const messageState = state.messages.get(messageKey);

  if (!messageState) {
    return [];
  }

  if (record.timestamp !== undefined && record.timestamp !== null) {
    messageState.timestamp = record.timestamp;
  }

  if (eventType === "content_block_start") {
    const partIndex = readClaudeContentBlockIndex(event);

    if (partIndex < 0) {
      return [];
    }

    const contentBlock = toClaudeRecord(event.content_block);
    const partState: ClaudeStreamPartState = {
      part: { ...contentBlock }
    };

    if (ensureText(contentBlock.type).trim() === "tool_use") {
      partState.jsonBuffer = serializeClaudeToolInput(contentBlock.input);
    }

    messageState.partsByIndex.set(partIndex, partState);
    return [buildClaudeStreamEnvelope(messageState, partIndex)];
  }

  if (eventType === "content_block_delta") {
    const partIndex = readClaudeContentBlockIndex(event);

    if (partIndex < 0) {
      return [];
    }

    const partState = messageState.partsByIndex.get(partIndex);

    if (!partState) {
      return [];
    }

    applyClaudeContentBlockDelta(partState, toClaudeRecord(event.delta));
    return [buildClaudeStreamEnvelope(messageState, partIndex)];
  }

  if (eventType === "content_block_stop") {
    const partIndex = readClaudeContentBlockIndex(event);

    if (partIndex < 0 || !messageState.partsByIndex.has(partIndex)) {
      return [];
    }

    return [buildClaudeStreamEnvelope(messageState, partIndex)];
  }

  if (eventType === "message_delta") {
    const delta = toClaudeRecord(event.delta);
    messageState.stopReason = ensureText(delta.stop_reason).trim() || null;
    return [];
  }

  if (eventType === "message_stop") {
    state.messages.delete(messageKey);

    if (state.currentMessageKey === messageKey) {
      state.currentMessageKey = null;
    }
  }

  return [];
}

function resolveClaudeStreamMessageKey(
  record: Record<string, unknown>,
  state: ClaudeStreamEventState
): string | null {
  const event = toClaudeRecord(record.event);
  const eventMessage = toClaudeRecord(event.message);
  const eventDelta = toClaudeRecord(event.delta);
  const directKey =
    readClaudeMessageId(eventMessage, eventMessage)
    || ensureText(event.message_id).trim()
    || ensureText(eventDelta.message_id).trim()
    || ensureText(record.message_id).trim();

  if (directKey.length > 0 && state.messages.has(directKey)) {
    state.currentMessageKey = directKey;
    return directKey;
  }

  if (state.currentMessageKey && state.messages.has(state.currentMessageKey)) {
    return state.currentMessageKey;
  }

  return directKey.length > 0 ? directKey : null;
}

function readClaudeContentBlockIndex(event: Record<string, unknown>): number {
  const candidates = [event.index, event.content_block_index, event.contentBlockIndex];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0) {
      return candidate;
    }
  }

  return -1;
}

function buildClaudeStreamEnvelope(
  messageState: ClaudeStreamMessageState,
  partIndex: number
): ClaudeMessageEnvelope {
  const content: unknown[] = Array.from({ length: partIndex + 1 }, (_, index) =>
    index === partIndex ? { ...(messageState.partsByIndex.get(partIndex)?.part ?? {}) } : ""
  );

  return {
    type: messageState.type,
    source: "stream_event",
    messageId: messageState.messageId,
    timestamp: messageState.timestamp,
    message: {
      content
    }
  };
}

function applyClaudeContentBlockDelta(
  partState: ClaudeStreamPartState,
  delta: Record<string, unknown>
): void {
  const deltaType = ensureText(delta.type).trim();

  if (deltaType === "text_delta") {
    partState.part.text = `${ensureText(partState.part.text)}${ensureText(delta.text)}`;
    return;
  }

  if (deltaType === "thinking_delta") {
    partState.part.type = ensureText(partState.part.type).trim() || "thinking";
    partState.part.thinking = `${ensureText(partState.part.thinking)}${ensureText(delta.thinking)}`;
    return;
  }

  if (deltaType === "input_json_delta") {
    partState.part.type = ensureText(partState.part.type).trim() || "tool_use";
    const nextBuffer = `${partState.jsonBuffer ?? ""}${ensureText(delta.partial_json)}`;
    partState.jsonBuffer = nextBuffer;
    partState.part.input = parseClaudePartialJson(nextBuffer);
    return;
  }

  if (deltaType === "signature_delta") {
    partState.part.signature = `${ensureText(partState.part.signature)}${ensureText(delta.signature)}`;
  }
}

function parseClaudePartialJson(value: string): unknown {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function serializeClaudeToolInput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  return stringifyStructuredValue(value);
}
