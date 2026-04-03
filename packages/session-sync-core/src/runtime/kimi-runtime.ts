import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import {
  ensureText,
  extractTextBlocks,
  messageIdFromRawRef,
  nextTimestamp,
  safeDate
} from "../providers/utils.js";
import type {
  MessageKind,
  NormalizedMessage,
  NormalizedToolCall,
  ProviderId
} from "../types.js";
import type {
  ProviderRuntimeAdapter,
  ProviderRuntimeEventSink,
  ProviderRuntimeLaunchResult,
  ProviderRuntimeRunRequest,
  RuntimeEventInput
} from "./types.js";

interface KimiRuntimeOptions {
  homeDir: string;
  commandPath?: string;
  baseArgs?: string[];
  spawnFactory?: typeof spawn;
}

interface KimiRuntimeContext {
  request: ProviderRuntimeRunRequest;
  sink: ProviderRuntimeEventSink;
  mode: "start" | "continue";
  sessionId: string;
  rawStoreRef: string;
}

interface KimiEventMappingContext {
  sessionId: string;
  rawStoreRef: string;
  sequence: number;
  lineNumber: number;
}

type KimiRuntimeTransport = "wire" | "command";

interface KimiLaunchAttempt {
  transport: KimiRuntimeTransport;
  launch: ProviderRuntimeLaunchResult;
  ready: Promise<void>;
}

const INTERRUPT_KILL_TIMEOUT_MS = 1_500;
const READY_SIGNAL_TIMEOUT_MS = 700;

export class KimiRuntimeAdapter implements ProviderRuntimeAdapter {
  readonly providerId: ProviderId = "kimi";
  private readonly commandPath: string;
  private readonly baseArgs: string[];
  private readonly spawnFactory: typeof spawn;

  constructor(private readonly options: KimiRuntimeOptions) {
    this.commandPath = options.commandPath?.trim() || "kimi";
    this.baseArgs = options.baseArgs ?? [];
    this.spawnFactory = options.spawnFactory ?? spawn;
  }

  async startSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const sessionId = request.providerSessionId?.trim() || randomUUID();
    const rawStoreRef = buildKimiRawStoreRef(sessionId);

    sink.updateSessionBinding({
      providerSessionId: sessionId,
      rawStoreRef
    });

    return this.launchWithFallback({
      request,
      sink,
      mode: "start",
      sessionId,
      rawStoreRef
    });
  }

  async continueSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const sessionId = request.providerSessionId?.trim();

    if (!sessionId) {
      throw new Error("PROVIDER_SESSION_ID_REQUIRED");
    }

    const rawStoreRef = request.rawStoreRef ?? buildKimiRawStoreRef(sessionId);

    sink.updateSessionBinding({
      providerSessionId: sessionId,
      rawStoreRef
    });

    return this.launchWithFallback({
      request,
      sink,
      mode: "continue",
      sessionId,
      rawStoreRef
    });
  }

  private async launchWithFallback(
    context: KimiRuntimeContext
  ): Promise<ProviderRuntimeLaunchResult> {
    const wireAttempt = this.launchTransport(context, "wire");

    try {
      await wireAttempt.ready;
      return wireAttempt.launch;
    } catch (error) {
      wireAttempt.launch.completed.catch(() => {
        return;
      });

      if (!isWireUnavailableError(error)) {
        throw error;
      }
    }

    const wireDetail = extractErrorDetail(await wireAttempt.launch.completed.then(() => null).catch((error) => error));

    await context.sink.emit({
      type: "status",
      status: "running",
      detail: `Kimi wire 不可用，已切换命令模式 fallback（stream-json）：${wireDetail}`
    });

    const commandAttempt = this.launchTransport(context, "command");

    try {
      await commandAttempt.ready;
      return commandAttempt.launch;
    } catch (commandError) {
      commandAttempt.launch.completed.catch(() => {
        return;
      });

      const commandDetail = extractErrorDetail(
        await commandAttempt.launch.completed.then(() => null).catch((error) => error)
      );
      throw new Error(
        `KIMI_RUNTIME_FALLBACK_FAILED: wire=${wireDetail}; command=${commandDetail}; cause=${extractErrorDetail(commandError)}`
      );
    }
  }

  private launchTransport(
    context: KimiRuntimeContext,
    transport: KimiRuntimeTransport
  ): KimiLaunchAttempt {
    const args = [
      ...this.baseArgs,
      ...buildKimiRuntimeArgs(transport, context.mode, context.sessionId, context.request)
    ];
    const proc = this.spawnFactory(this.commandPath, args, {
      cwd: context.request.workspacePath,
      shell: shouldSpawnViaShell(this.commandPath),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let sequence = Math.max(0, context.request.sequenceBase ?? 0);
    let lineNumber = 0;
    let interrupted = false;
    let settled = false;
    let activeSessionId = context.sessionId;
    let activeRawStoreRef = context.rawStoreRef;
    let stderrBuffer = "";
    let lineChain = Promise.resolve();
    let stdinClosed = false;
    let writeChain = Promise.resolve();
    let sawStdoutEvent = false;
    let readySettled = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let resolveReady: (() => void) | null = null;
    let rejectReady: ((error: Error) => void) | null = null;
    const enqueuePromptWrite = (
      options: ProviderRuntimeRunRequest["options"]
    ): Promise<void> => {
      writeChain = writeChain.then(() => this.writePromptPayload(proc, options));
      return writeChain;
    };
    const canSubmitInRunInput = (): boolean =>
      !interrupted &&
      !settled &&
      !proc.killed &&
      !stdinClosed &&
      !proc.stdin.destroyed &&
      !proc.stdin.writableEnded &&
      proc.stdin.writable;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = (error) => reject(error);
    });
    const settleReady = (error?: Error): void => {
      if (readySettled) {
        return;
      }

      readySettled = true;
      if (readyTimer) {
        clearTimeout(readyTimer);
      }

      if (error) {
        rejectReady?.(error);
      } else {
        resolveReady?.();
      }
    };
    readyTimer = setTimeout(() => {
      settleReady();
    }, READY_SIGNAL_TIMEOUT_MS);

    const completed = new Promise<void>((resolve, reject) => {
      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        callback();
      };

      const onStructuredEvent = async (event: RuntimeEventInput): Promise<void> => {
        if (event.providerSessionId?.trim() && event.providerSessionId !== activeSessionId) {
          activeSessionId = event.providerSessionId;
          activeRawStoreRef = buildKimiRawStoreRef(activeSessionId);
          context.sink.updateSessionBinding({
            providerSessionId: activeSessionId,
            rawStoreRef: activeRawStoreRef
          });
        }

        await context.sink.emit({
          ...event,
          providerSessionId: activeSessionId,
          rawStoreRef: activeRawStoreRef
        });
      };

      const handleJsonPayload = async (payload: Record<string, unknown>): Promise<void> => {
        const mapped = mapKimiWirePayload(payload, {
          sessionId: activeSessionId,
          rawStoreRef: activeRawStoreRef,
          sequence,
          lineNumber
        });

        if (mapped.providerSessionId && mapped.providerSessionId !== activeSessionId) {
          activeSessionId = mapped.providerSessionId;
          activeRawStoreRef = buildKimiRawStoreRef(activeSessionId);
          context.sink.updateSessionBinding({
            providerSessionId: activeSessionId,
            rawStoreRef: activeRawStoreRef
          });
        }

        for (const event of mapped.events) {
          if (event.type === "message" && event.message) {
            sequence = event.message.sequence;
          }

          await onStructuredEvent(event);
        }
      };

      const handleStdoutLine = (line: string): Promise<void> => {
        lineNumber += 1;
        const trimmed = line.trim();

        if (!trimmed) {
          return Promise.resolve();
        }
        sawStdoutEvent = true;
        settleReady();

        const payload = parseJsonObject(trimmed);

        if (payload) {
          return handleJsonPayload(payload);
        }

        const nextSequence = sequence + 1;
        sequence = nextSequence;

        const message = createTextMessage({
          sessionId: activeSessionId,
          rawStoreRef: activeRawStoreRef,
          sequence: nextSequence,
          lineNumber,
          role: "assistant",
          kind: "text",
          content: trimmed,
          timestamp: nextTimestamp(),
          rawEventRef: buildKimiRawEventRef(activeSessionId, lineNumber)
        });

        return onStructuredEvent({
          type: "message",
          message,
          status: "running",
          detail: "wire line",
          rawEventRef: message.rawRef
        });
      };

      const stdoutReader = createInterface({ input: proc.stdout });

      stdoutReader.on("line", (line) => {
        lineChain = lineChain.then(() => handleStdoutLine(line));
      });

      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        stderrBuffer = `${stderrBuffer}${chunk}`.trim();
      });

      proc.once("error", (error) => {
        if (transport === "wire") {
          settleReady(toWireUnavailableError(error));
        } else {
          settleReady(error instanceof Error ? error : new Error("KIMI_RUNTIME_FAILED"));
        }
        settle(() => {
          reject(error);
        });
      });

      proc.once("close", (code, signal) => {
        stdinClosed = true;
        if (!sawStdoutEvent && !interrupted && code !== 0) {
          if (transport === "wire") {
            settleReady(
              toWireUnavailableError(
                new Error(
                  stderrBuffer ||
                  `Kimi wire exited with code=${String(code ?? "null")} signal=${String(signal ?? "null")}`
                )
              )
            );
          } else {
            settleReady(
              new Error(
                stderrBuffer ||
                `Kimi command exited with code=${String(code ?? "null")} signal=${String(signal ?? "null")}`
              )
            );
          }
        } else {
          settleReady();
        }
        void lineChain
          .then(async () => {
            if (interrupted) {
              settle(() => {
                resolve();
              });
              return;
            }

            if (code === 0) {
              settle(() => {
                resolve();
              });
              return;
            }

            const detail =
              stderrBuffer ||
              `Kimi ${transport} exited with code=${String(code ?? "null")} signal=${String(signal ?? "null")}`;

            settle(() => {
              reject(new Error(detail));
            });
          })
          .catch((error) => {
            settle(() => {
              reject(error instanceof Error ? error : new Error("KIMI_WIRE_RUNTIME_FAILED"));
            });
          });
      });

      enqueuePromptWrite(context.request.options).catch((error) => {
        if (!sawStdoutEvent && transport === "wire") {
          settleReady(toWireUnavailableError(error));
        }
        settle(() => {
          reject(error);
        });
      });
    });

    const submitDuringRun = async (
      options: ProviderRuntimeRunRequest["options"]
    ): Promise<void> => {
      if (!canSubmitInRunInput()) {
        throw new Error("IN_RUN_INPUT_NOT_SUPPORTED");
      }

      return enqueuePromptWrite(options).catch((error) => {
        throw mapInRunSubmitError(error);
      });
    };

    const launch: ProviderRuntimeLaunchResult = {
      providerSessionId: context.sessionId,
      rawStoreRef: context.rawStoreRef,
      interrupt: async () => {
        interrupted = true;

        if (proc.killed) {
          return;
        }

        proc.kill("SIGINT");

        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (!proc.killed) {
              proc.kill("SIGKILL");
            }

            resolve();
          }, INTERRUPT_KILL_TIMEOUT_MS);

          proc.once("close", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      },
      isAlive: () => !proc.killed,
      submitDuringRun,
      completed
    };

    return {
      transport,
      launch,
      ready
    };
  }

  private async writePrompt(
    proc: ChildProcessWithoutNullStreams,
    request: ProviderRuntimeRunRequest
  ): Promise<void> {
    return this.writePromptPayload(proc, request.options);
  }

  private async writePromptPayload(
    proc: ChildProcessWithoutNullStreams,
    options: ProviderRuntimeRunRequest["options"]
  ): Promise<void> {
    const prompt = options.providerPrompt?.trim() || options.content.trim();

    if (!prompt) {
      return;
    }

    const payload = buildPromptPayloadFromOptions(options, prompt);

    await this.writeWirePayload(proc, payload);
  }

  private async writeWirePayload(
    proc: ChildProcessWithoutNullStreams,
    payload: Record<string, unknown>
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      proc.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

function buildPromptPayloadFromOptions(
  options: ProviderRuntimeRunRequest["options"],
  prompt: string
): Record<string, unknown> {
  return {
    type: "prompt.submit",
    content: prompt,
    client_request_id: options.clientRequestId,
    permission_mode: options.permissionMode,
    model: options.model,
    reasoning_level: options.reasoningLevel,
    attachments: options.attachments.map((attachment) => ({
      file_path: attachment.filePath,
      file_name: attachment.fileName,
      mime_type: attachment.mimeType,
      file_size: attachment.fileSize
    }))
  };
}

function buildKimiRuntimeArgs(
  transport: KimiRuntimeTransport,
  mode: "start" | "continue",
  sessionId: string,
  request: ProviderRuntimeRunRequest
): string[] {
  if (transport === "wire") {
    const args = ["wire", "--output-format", "stream-json"];

    if (mode === "continue") {
      args.push("--resume", sessionId);
    } else {
      args.push("--new-session");
    }

    args.push("--cwd", request.workspacePath);

    if (request.options.model) {
      args.push("--model", request.options.model);
    }

    return args;
  }

  const args = ["--print", "--output-format", "stream-json", "--input-format", "stream-json"];

  if (mode === "continue") {
    args.push("--resume", sessionId);
  }

  args.push("--cwd", request.workspacePath);

  if (request.options.model) {
    args.push("--model", request.options.model);
  }

  return args;
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapKimiWirePayload(
  payload: Record<string, unknown>,
  context: KimiEventMappingContext
): {
  providerSessionId: string | null;
  events: RuntimeEventInput[];
} {
  const events: RuntimeEventInput[] = [];
  const wireType = ensureText(payload.type ?? payload.event ?? payload.kind).trim().toLowerCase();
  const providerSessionId =
    readFirstNonEmptyString(payload, [
      ["sessionId"],
      ["session_id"],
      ["session", "id"]
    ]) ?? null;
  const timestamp = resolveEventTimestamp(payload);
  const rawEventRef = buildKimiRawEventRef(context.sessionId, context.lineNumber);

  if (wireType.includes("session") && wireType.includes("created")) {
    events.push({
      type: "session_created",
      status: "starting",
      timestamp,
      detail: "Kimi wire session created",
      rawEventRef,
      providerSessionId: providerSessionId ?? undefined
    });
  }

  if (wireType.includes("running") || wireType.includes("progress")) {
    events.push({
      type: "status",
      status: "running",
      timestamp,
      detail: extractTextBlocks(payload).trim() || "Kimi wire running",
      rawEventRef,
      providerSessionId: providerSessionId ?? undefined
    });
  }

  if (wireType.includes("question") || wireType.includes("prompt") || wireType.includes("request")) {
    events.push({
      type: "status",
      status: "running",
      timestamp,
      detail: extractTextBlocks(payload).trim() || "Kimi wire awaiting runtime guidance",
      rawEventRef,
      providerSessionId: providerSessionId ?? undefined
    });
  }

  const maybeError = readFirstNonEmptyString(payload, [["error"], ["detail"], ["message"]]);

  if (wireType.includes("error") || wireType.includes("failed")) {
    events.push({
      type: "error",
      status: "failed",
      timestamp,
      detail: maybeError || "Kimi wire failed",
      errorCode: normalizeErrorCode(payload),
      rawEventRef,
      providerSessionId: providerSessionId ?? undefined
    });

    return {
      providerSessionId,
      events
    };
  }

  if (wireType.includes("complete") || wireType.includes("finished") || wireType.includes("done")) {
    events.push({
      type: "complete",
      status: "completed",
      timestamp,
      detail: maybeError || "Kimi wire completed",
      rawEventRef,
      providerSessionId: providerSessionId ?? undefined
    });
  }

  const normalizedMessage = normalizeKimiWireMessage(payload, wireType, {
    ...context,
    sequence: context.sequence + 1,
    rawEventRef,
    timestamp
  });

  if (normalizedMessage) {
    events.push({
      type: "message",
      message: normalizedMessage,
      status: "running",
      timestamp,
      detail: null,
      rawEventRef,
      providerSessionId: providerSessionId ?? undefined
    });
  }

  return {
    providerSessionId,
    events
  };
}

function normalizeKimiWireMessage(
  payload: Record<string, unknown>,
  wireType: string,
  input: {
    sessionId: string;
    rawStoreRef: string;
    sequence: number;
    lineNumber: number;
    rawEventRef: string;
    timestamp: string;
  }
): NormalizedMessage | null {
  const hasMessageShape =
    wireType.includes("message") ||
    wireType.includes("text") ||
    wireType.includes("delta") ||
    wireType.includes("think") ||
    wireType.includes("tool") ||
    wireType.includes("function") ||
    readPath(payload, ["content"]) !== undefined ||
    readPath(payload, ["text"]) !== undefined ||
    readPath(payload, ["message"]) !== undefined;

  if (!hasMessageShape) {
    return null;
  }

  const role = normalizeRole(
    readFirstNonEmptyString(payload, [["role"], ["message", "role"], ["event", "role"]])
  );
  const kind = normalizeMessageKind(payload);
  const content = resolveMessageContent(payload, kind);

  if (!content.trim() && kind !== "tool_call" && kind !== "tool_result") {
    return null;
  }

  const toolCall = normalizeToolCall(payload, kind);

  return createTextMessage({
    sessionId: input.sessionId,
    rawStoreRef: input.rawStoreRef,
    sequence: input.sequence,
    lineNumber: input.lineNumber,
    role,
    kind,
    content,
    timestamp: input.timestamp,
    rawEventRef: input.rawEventRef,
    toolCall
  });
}

function createTextMessage(input: {
  sessionId: string;
  rawStoreRef: string;
  sequence: number;
  lineNumber: number;
  role: NormalizedMessage["role"];
  kind: MessageKind;
  content: string;
  timestamp: string;
  rawEventRef: string;
  toolCall?: NormalizedToolCall | null;
}): NormalizedMessage {
  return {
    messageId: messageIdFromRawRef(input.rawEventRef),
    provider: "kimi",
    providerSessionId: input.sessionId,
    role: input.role,
    kind: input.kind,
    content: input.content,
    toolCall: input.toolCall ?? null,
    timestamp: input.timestamp,
    sequence: input.sequence,
    rawRef: input.rawEventRef
  };
}

function normalizeRole(value: string | null): NormalizedMessage["role"] {
  const role = value?.trim().toLowerCase();

  if (role === "user" || role === "assistant" || role === "tool" || role === "system") {
    return role;
  }

  if (role === "human") {
    return "user";
  }

  if (role === "ai" || role === "model") {
    return "assistant";
  }

  return "assistant";
}

function normalizeMessageKind(payload: Record<string, unknown>): MessageKind {
  const rawType = ensureText(payload.type ?? payload.kind ?? payload.event).trim().toLowerCase();

  if (rawType.includes("think") || rawType.includes("reason")) {
    return "thinking";
  }

  if (rawType.includes("tool_call") || rawType.includes("tool-use") || rawType.includes("function_call")) {
    return "tool_call";
  }

  if (rawType.includes("tool_result") || rawType.includes("tool-output") || rawType.includes("function_result")) {
    return "tool_result";
  }

  if (readPath(payload, ["tool_call"]) || readPath(payload, ["function_call"])) {
    return "tool_call";
  }

  if (readPath(payload, ["tool_result"]) || readPath(payload, ["function_result"])) {
    return "tool_result";
  }

  return "text";
}

function resolveMessageContent(payload: Record<string, unknown>, kind: MessageKind): string {
  if (kind === "tool_call") {
    return (
      extractTextBlocks(
        readPath(payload, ["input"]) ??
        readPath(payload, ["arguments"]) ??
        readPath(payload, ["tool_call", "input"]) ??
        readPath(payload, ["function_call", "arguments"])
      ).trim() ||
      extractTextBlocks(payload).trim()
    );
  }

  if (kind === "tool_result") {
    return (
      extractTextBlocks(
        readPath(payload, ["output"]) ??
        readPath(payload, ["result"]) ??
        readPath(payload, ["tool_result", "output"]) ??
        readPath(payload, ["function_result", "output"])
      ).trim() ||
      extractTextBlocks(payload).trim()
    );
  }

  return (
    extractTextBlocks(
      readPath(payload, ["content"]) ??
      readPath(payload, ["message"]) ??
      readPath(payload, ["text"]) ??
      readPath(payload, ["delta"]) ??
      payload
    ).trim() || ensureText(payload).trim()
  );
}

function normalizeToolCall(
  payload: Record<string, unknown>,
  kind: MessageKind
): NormalizedToolCall | null {
  if (kind !== "tool_call" && kind !== "tool_result") {
    return null;
  }

  const callId =
    readFirstNonEmptyString(payload, [["call_id"], ["callId"], ["id"], ["tool_use_id"]]) ??
    "kimi-tool-call";
  const name =
    readFirstNonEmptyString(payload, [["name"], ["tool", "name"], ["function", "name"]]) ??
    "unknown_tool";
  const input = extractTextBlocks(
    readPath(payload, ["input"]) ??
    readPath(payload, ["arguments"]) ??
    readPath(payload, ["tool_call", "input"]) ??
    readPath(payload, ["function_call", "arguments"]) ??
    ""
  ).trim();
  const output = extractTextBlocks(
    readPath(payload, ["output"]) ??
    readPath(payload, ["result"]) ??
    readPath(payload, ["tool_result", "output"]) ??
    readPath(payload, ["function_result", "output"]) ??
    ""
  ).trim();
  const error =
    readFirstNonEmptyString(payload, [["error"], ["failure"]]) ??
    null;

  return {
    callId,
    name,
    input,
    output: output || null,
    error,
    status:
      kind === "tool_call"
        ? output
          ? "completed"
          : "running"
        : error
          ? "failed"
          : "completed"
  };
}

function resolveEventTimestamp(payload: Record<string, unknown>): string {
  const raw = readFirstNonEmptyString(payload, [
    ["timestamp"],
    ["created_at"],
    ["createdAt"],
    ["time"],
    ["event", "timestamp"]
  ]);

  return safeDate(raw, nextTimestamp()) || nextTimestamp();
}

function normalizeErrorCode(payload: Record<string, unknown>): string {
  const code = readFirstNonEmptyString(payload, [["error_code"], ["code"], ["error", "code"]]);
  return code?.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_") || "KIMI_WIRE_ERROR";
}

function toWireUnavailableError(error: unknown): Error {
  return new Error(`KIMI_WIRE_MODE_UNAVAILABLE: ${extractErrorDetail(error)}`);
}

function isWireUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("KIMI_WIRE_MODE_UNAVAILABLE:");
}

function extractErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim() || "unknown error";
  }

  if (typeof error === "string") {
    return error.trim() || "unknown error";
  }

  return "unknown error";
}

function mapInRunSubmitError(error: unknown): Error {
  if (error instanceof Error && error.message === "IN_RUN_INPUT_NOT_SUPPORTED") {
    return error;
  }

  if (isClosedStdinError(error)) {
    return new Error("IN_RUN_INPUT_NOT_SUPPORTED");
  }

  return error instanceof Error ? error : new Error("IN_RUN_INPUT_NOT_SUPPORTED");
}

function isClosedStdinError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "EPIPE" ||
    code === "ECONNRESET" ||
    code === "ERR_STREAM_DESTROYED" ||
    code === "ERR_STREAM_WRITE_AFTER_END"
  );
}

function buildKimiRawStoreRef(sessionId: string): string {
  return `kimi://session/${encodeURIComponent(sessionId)}`;
}

function buildKimiRawEventRef(sessionId: string, lineNumber: number): string {
  return `kimi://session/${encodeURIComponent(sessionId)}/wire#line=${lineNumber}`;
}

function shouldSpawnViaShell(commandPath: string): boolean {
  return /\.(cmd|bat|ps1)$/i.test(commandPath);
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;

  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function readFirstNonEmptyString(
  record: Record<string, unknown>,
  paths: string[][]
): string | null {
  for (const path of paths) {
    const value = readPath(record, path);

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}
