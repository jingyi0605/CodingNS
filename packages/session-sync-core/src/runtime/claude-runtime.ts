import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

import {
  createRawRef,
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
    const providerSessionId = request.providerSessionId ?? randomUUID();
    const rawStoreRef = buildClaudeRawStoreRef(this.options.homeDir, request.workspacePath, providerSessionId);

    sink.updateSessionBinding({
      providerSessionId,
      rawStoreRef
    });

    return this.launchClaude(
      request,
      sink,
      providerSessionId,
      rawStoreRef,
      ["--session-id", providerSessionId]
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
      "--cwd",
      request.workspacePath,
      ...attachmentDirectories.flatMap((directory) => ["--add-dir", directory]),
      ...sessionArgs
    ];

    let sequence = 0;
    const toolNameById = new Map<string, string>();
    let interrupted = false;
    let completed = false;
    let stderrBuffer = "";
    let stdoutBuffer = "";

    const proc = spawn(this.commandPath, args, {
      cwd: request.workspacePath,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const completedPromise = new Promise<void>((resolve) => {
      const emitRuntimeError = async (detail: string) => {
        if (completed) {
          return;
        }

        completed = true;
        await sink.emit({
          type: "error",
          status: "failed",
          providerSessionId,
          rawStoreRef,
          detail
        });
      };

      const emitRuntimeComplete = async (status: "complete" | "interrupted", detail: string) => {
        if (completed) {
          return;
        }

        completed = true;
        await sink.emit({
          type: status,
          status: status === "complete" ? "completed" : "interrupted",
          providerSessionId,
          rawStoreRef,
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
            rawStoreRef,
            providerSessionId,
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
        void emitRuntimeError(error.message).finally(resolve);
      });

      proc.on("close", (code, signal) => {
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
      providerSessionId,
      rawStoreRef,
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

  private async consumeStreamLine(input: {
    line: string;
    rawStoreRef: string;
    providerSessionId: string;
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

    const envelopes = collectMessageEnvelopes(parsed);

    for (const envelope of envelopes) {
      const parts = Array.isArray(envelope.message.content) ? envelope.message.content : [];

      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const part = parts[partIndex];
        const normalized = normalizePart({
          part,
          envelope,
          providerSessionId: input.providerSessionId,
          rawStoreRef: input.rawStoreRef,
          partIndex,
          sequence: input.sequenceRef(),
          toolNameById: input.toolNameById
        });

        if (!normalized) {
          continue;
        }

        await input.sink.emit({
          type: "message",
          providerSessionId: input.providerSessionId,
          rawStoreRef: input.rawStoreRef,
          message: normalized,
          status: "running",
          rawEventRef: normalized.rawRef
        });
      }
    }
  }
}

function resolveClaudeCommand(explicitPath?: string): string {
  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }

  const appData = process.env.APPDATA;
  const fallback = appData ? join(appData, "npm", "claude.cmd") : "";

  if (fallback && existsSync(fallback)) {
    return fallback;
  }

  return "claude.cmd";
}

function buildClaudeRawStoreRef(homeDir: string, workspacePath: string, sessionId: string): string {
  return join(homeDir, "projects", workspaceSlug(workspacePath), `${sessionId}.jsonl`);
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
