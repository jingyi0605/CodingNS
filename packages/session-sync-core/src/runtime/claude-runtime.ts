import { randomUUID, createHash } from "node:crypto";
import { accessSync, constants, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, sep } from "node:path";
import { spawn } from "node:child_process";

import {
  createRawRef,
  ensureDirectory,
  ensureText,
  extractTextBlocks,
  nextTimestamp,
  safeDate,
  stringifyStructuredValue,
  workspaceSlug
} from "../providers/utils.js";
import type { MessageKind, NormalizedMessage } from "../types.js";
import type {
  ProviderRuntimeAdapter,
  ProviderRuntimeEventSink,
  ProviderRuntimeLaunchResult,
  ProviderRuntimeRunRequest
} from "./types.js";

interface ClaudeRuntimeOptions {
  homeDir: string;
  commandPath?: string;
}

interface ClaudeMessageEnvelope {
  type: "user" | "assistant";
  timestamp: unknown;
  message: {
    content?: Array<Record<string, unknown>>;
  };
}

type ClaudeToolStatus = "running" | "completed" | "failed";

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
    const providerSessionId = request.providerSessionId ?? buildPendingClaudeSessionId(request.sessionId);
    const rawStoreRef = buildClaudePendingRawStoreRef(
      this.options.homeDir,
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
    const providerSessionId = ensureNonEmpty(
      request.providerSessionId,
      "CLAUDE_PROVIDER_SESSION_ID_REQUIRED"
    );
    const rawStoreRef =
      findClaudeSessionFile(this.options.homeDir, providerSessionId) ??
      request.rawStoreRef ??
      buildClaudeRawStoreRef(this.options.homeDir, request.workspacePath, providerSessionId);

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
    const attachmentDirectories = Array.from(
      new Set(
        request.options.attachments.map((attachment) => dirname(attachment.filePath))
      )
    );
    const args = [
      "-p",
      request.options.providerPrompt ?? request.options.content,
      "--verbose",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      ...attachmentDirectories.flatMap((directory) => ["--add-dir", directory]),
      ...sessionArgs
    ];

    if (request.options.model) {
      args.push("--model", request.options.model);
    }

    let sequence = 0;
    const toolNameById = new Map<string, string>();
    let interrupted = false;
    let completed = false;
    let stderrBuffer = "";
    let stdoutBuffer = "";

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
          findClaudeSessionFile(this.options.homeDir, activeProviderSessionId) ??
          buildClaudeRawStoreRef(this.options.homeDir, request.workspacePath, activeProviderSessionId);

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

    const proc = spawn(this.commandPath, args, {
      cwd: request.workspacePath,
      shell: shouldSpawnClaudeViaShell(this.commandPath),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const bindingRefreshTimer = setInterval(() => {
      refreshBinding();
    }, 250);

    const completedPromise = new Promise<void>((resolve) => {
      const emitRuntimeError = async (detail: string) => {
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
            refreshBinding,
            sink,
            sequenceRef: () => {
              sequence += 1;
              return sequence;
            },
            toolNameById
          });
        }
      });

      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        stderrBuffer += chunk;
      });

      proc.on("error", (error) => {
        clearInterval(bindingRefreshTimer);
        void emitRuntimeError(error.message).finally(resolve);
      });

      proc.on("close", (code, signal) => {
        clearInterval(bindingRefreshTimer);

        if (interrupted || signal === "SIGTERM" || signal === "SIGINT") {
          void emitRuntimeComplete("interrupted", "claude process interrupted").finally(resolve);
          return;
        }

        if (code === 0) {
          void emitRuntimeComplete("complete", "claude turn completed").finally(resolve);
          return;
        }

        const detail = stderrBuffer.trim() || `claude exited with code ${String(code)}`;
        void emitRuntimeError(detail).finally(resolve);
      });
    });

    return {
      providerSessionId: activeProviderSessionId,
      rawStoreRef: activeRawStoreRef,
      completed: completedPromise,
      interrupt: async () => {
        if (proc.killed) {
          return;
        }

        interrupted = true;
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
    refreshBinding: (parsed?: Record<string, unknown>) => {
      providerSessionId: string;
      rawStoreRef: string;
    };
    sink: ProviderRuntimeEventSink;
    sequenceRef: () => number;
    toolNameById: Map<string, string>;
  }): Promise<void> {
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(input.line) as Record<string, unknown>;
    } catch {
      return;
    }

    const binding = input.refreshBinding(parsed);
    const envelopes = collectMessageEnvelopes(parsed);

    for (const envelope of envelopes) {
      const parts = Array.isArray(envelope.message.content) ? envelope.message.content : [];

      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const part = parts[partIndex];
        const normalized = normalizePart({
          part,
          envelope,
          providerSessionId: binding.providerSessionId,
          rawStoreRef: binding.rawStoreRef,
          partIndex,
          sequence: input.sequenceRef(),
          toolNameById: input.toolNameById
        });

        if (!normalized) {
          continue;
        }

        await input.sink.emit({
          type: "message",
          providerSessionId: binding.providerSessionId,
          rawStoreRef: binding.rawStoreRef,
          message: normalized,
          status: "running",
          rawEventRef: normalized.rawRef
        });
      }
    }
  }
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

function collectMessageEnvelopes(record: Record<string, unknown>): ClaudeMessageEnvelope[] {
  const envelopes: ClaudeMessageEnvelope[] = [];
  const directType = ensureText(record.type);

  if (directType === "user" || directType === "assistant") {
    envelopes.push({
      type: directType,
      timestamp: record.timestamp,
      message: ((record.message ?? {}) as ClaudeMessageEnvelope["message"])
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

  const nested = (((record.data ?? {}) as Record<string, unknown>).message ?? {}) as Record<
    string,
    unknown
  >;
  const nestedType = ensureText(nested.type);

  if (nestedType !== "user" && nestedType !== "assistant") {
    return null;
  }

  return {
    type: nestedType,
    timestamp: nested.timestamp ?? record.timestamp,
    message: ((nested.message ?? {}) as ClaudeMessageEnvelope["message"])
  };
}

function normalizePart(input: {
  part: Record<string, unknown>;
  envelope: ClaudeMessageEnvelope;
  providerSessionId: string;
  rawStoreRef: string;
  partIndex: number;
  sequence: number;
  toolNameById: Map<string, string>;
}): NormalizedMessage | null {
  const { part, envelope, providerSessionId, rawStoreRef, partIndex, sequence, toolNameById } = input;
  const partType = ensureText(part.type);
  const timestamp = safeDate(envelope.timestamp, nextTimestamp());
  const rawRef = createRawRef("claude-code", rawStoreRef, sequence, partIndex);

  if (envelope.type === "user") {
    if (partType === "tool_result") {
      const callId = ensureText(part.tool_use_id).trim() || rawRef;
      const output = extractTextBlocks(part.content).trim() || stringifyStructuredValue(part.content);
      const isError = Boolean(part.is_error);

      if (output.length === 0) {
        return null;
      }

      return createMessage({
        providerSessionId,
        rawRef,
        sequence,
        timestamp,
        role: "tool",
        kind: "tool_result",
        content: output,
        toolCall: {
          callId,
          name: toolNameById.get(callId) ?? "tool",
          input: "",
          output: isError ? null : output,
          error: isError ? output : null,
          status: isError ? "failed" : "completed"
        }
      });
    }

    const content = extractTextBlocks(part).trim();

    if (!content) {
      return null;
    }

    return createMessage({
      providerSessionId,
      rawRef,
      sequence,
      timestamp,
      role: "user",
      kind: "text",
      content,
      toolCall: null
    });
  }

  if (partType === "tool_use") {
    const callId = ensureText(part.id).trim() || rawRef;
    const name = ensureText(part.name).trim() || "tool";
    const toolInput = stringifyStructuredValue(part.input);
    toolNameById.set(callId, name);

    if (!name && !toolInput) {
      return null;
    }

    return createMessage({
      providerSessionId,
      rawRef,
      sequence,
      timestamp,
      role: "tool",
      kind: "tool_call",
      content: toolInput,
      toolCall: {
        callId,
        name,
        input: toolInput,
        output: null,
        error: null,
        status: "running"
      }
    });
  }

  const content =
    partType === "thinking"
      ? extractTextBlocks(part.thinking).trim()
      : extractTextBlocks(part).trim();

  if (!content) {
    return null;
  }

  return createMessage({
    providerSessionId,
    rawRef,
    sequence,
    timestamp,
    role: "assistant",
    kind: partType === "thinking" ? "thinking" : "text",
    content,
    toolCall: null
  });
}

function createMessage(input: {
  providerSessionId: string;
  rawRef: string;
  sequence: number;
  timestamp: string;
  role: "user" | "assistant" | "tool";
  kind: MessageKind;
  content: string;
  toolCall:
    | {
        callId: string;
        name: string;
        input: string;
        output: string | null;
        error: string | null;
        status: ClaudeToolStatus;
      }
    | null;
}): NormalizedMessage {
  const { providerSessionId, rawRef, sequence, timestamp, role, kind, content, toolCall } = input;

  return {
    messageId: createHash("sha1").update(rawRef).digest("hex"),
    provider: "claude-code",
    providerSessionId,
    role,
    kind,
    content,
    toolCall,
    timestamp,
    sequence,
    rawRef
  };
}
