import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import {
  ensureText,
  extractTextBlocks,
  messageIdFromRawRef,
  nextTimestamp,
  safeDate,
  stringifyStructuredValue
} from "../providers/utils.js";
import { buildApplyPatchFromStructuredFileTool } from "../patch-builder.js";
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

interface GeminiRuntimeOptions {
  homeDir: string;
  commandPath?: string;
  baseArgs?: string[];
  spawnFactory?: typeof spawn;
}

interface ProgressiveMessageState {
  rawRef: string;
  messageId: string;
  sequence: number;
  timestamp: string;
  content: string;
}

const INTERRUPT_KILL_TIMEOUT_MS = 1_500;

export class GeminiRuntimeAdapter implements ProviderRuntimeAdapter {
  readonly providerId: ProviderId = "gemini";
  private readonly commandPath: string;
  private readonly baseArgs: string[];
  private readonly spawnFactory: typeof spawn;

  constructor(private readonly options: GeminiRuntimeOptions) {
    this.commandPath = options.commandPath?.trim() || "gemini";
    this.baseArgs = options.baseArgs ?? [];
    this.spawnFactory = options.spawnFactory ?? spawn;
  }

  async startSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const pendingProviderSessionId = buildPendingGeminiSessionRef(request.sessionId);
    const pendingRawStoreRef = buildGeminiRawStoreRef(
      pendingProviderSessionId,
      request.runtimeHomeDir ?? null
    );

    sink.updateSessionBinding({
      providerSessionId: pendingProviderSessionId,
      rawStoreRef: pendingRawStoreRef
    });

    return this.launchRuntime(
      request,
      sink,
      "start",
      pendingProviderSessionId,
      pendingRawStoreRef
    );
  }

  async continueSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const providerSessionId = request.providerSessionId?.trim();

    if (!providerSessionId) {
      throw new Error("PROVIDER_SESSION_ID_REQUIRED");
    }

    const resolvedRawStoreRef = request.rawStoreRef
      ?? buildGeminiRawStoreRef(providerSessionId, request.runtimeHomeDir ?? null);

    sink.updateSessionBinding({
      providerSessionId,
      rawStoreRef: resolvedRawStoreRef
    });

    return this.launchRuntime(
      request,
      sink,
      "continue",
      providerSessionId,
      resolvedRawStoreRef
    );
  }

  private launchRuntime(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink,
    mode: "start" | "continue",
    initialProviderSessionId: string,
    initialRawStoreRef: string
  ): ProviderRuntimeLaunchResult {
    const args = [
      ...this.baseArgs,
      ...buildGeminiRuntimeArgs(mode, initialProviderSessionId, request)
    ];
    const proc = this.spawnFactory(this.commandPath, args, {
      cwd: request.workspacePath,
      env: {
        ...process.env,
        ...(request.runtimeEnv ?? {}),
        GEMINI_HOME: request.runtimeHomeDir?.trim() || this.options.homeDir,
        NO_COLOR: "1"
      },
      shell: shouldSpawnViaShell(this.commandPath),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let sequence = Math.max(0, request.sequenceBase ?? 0);
    let lineNumber = 0;
    let settled = false;
    let interrupted = false;
    let activeProviderSessionId = initialProviderSessionId;
    let activeRawStoreRef = initialRawStoreRef;
    let stderrBuffer = "";
    let runtimeFailure: Error | null = null;
    let resultStatus: string | null = null;
    let resultDetail: string | null = null;
    let assistantMessageIndex = 0;
    let userMessageIndex = 0;
    let activeAssistantMessage: ProgressiveMessageState | null = null;
    const toolNameById = new Map<string, string>();
    let lineChain = Promise.resolve();

    const updateBinding = (providerSessionId: string): void => {
      if (!providerSessionId.trim() || providerSessionId === activeProviderSessionId) {
        return;
      }

      activeProviderSessionId = providerSessionId;
      activeRawStoreRef = buildGeminiRawStoreRef(
        providerSessionId,
        request.runtimeHomeDir ?? null
      );
      sink.updateSessionBinding({
        providerSessionId: activeProviderSessionId,
        rawStoreRef: activeRawStoreRef
      });
    };

    const resetAssistantMessage = (): void => {
      activeAssistantMessage = null;
    };

    const emitStructuredEvent = async (event: RuntimeEventInput): Promise<void> => {
      await sink.emit({
        ...event,
        providerSessionId: activeProviderSessionId,
        rawStoreRef: activeRawStoreRef
      });
    };

    const handleMessageEvent = async (
      payload: Record<string, unknown>,
      rawEventRef: string
    ): Promise<void> => {
      const role = normalizeGeminiMessageRole(payload.role);

      if (!role) {
        return;
      }

      const timestamp = safeDate(payload.timestamp, nextTimestamp());
      const contentChunk = extractTextBlocks(payload.content).trim();

      if (!contentChunk) {
        return;
      }

      if (role === "user") {
        resetAssistantMessage();
        userMessageIndex += 1;
        sequence += 1;
        const rawRef = buildGeminiMessageRawRef(activeProviderSessionId, role, userMessageIndex);

        await emitStructuredEvent({
          type: "message",
          message: createGeminiRuntimeMessage({
            providerSessionId: activeProviderSessionId,
            role,
            kind: "text",
            content: contentChunk,
            timestamp,
            sequence,
            rawRef,
            toolCall: null
          }),
          rawEventRef
        });
        return;
      }

      if (!activeAssistantMessage) {
        assistantMessageIndex += 1;
        sequence += 1;
        const rawRef = buildGeminiMessageRawRef(
          activeProviderSessionId,
          role,
          assistantMessageIndex
        );
        activeAssistantMessage = {
          rawRef,
          messageId: messageIdFromRawRef(rawRef),
          sequence,
          timestamp,
          content: ""
        };
      }

      const isDelta = payload.delta === true;
      const nextContent = isDelta
        ? `${activeAssistantMessage.content}${contentChunk}`
        : contentChunk;

      if (nextContent === activeAssistantMessage.content) {
        return;
      }

      activeAssistantMessage = {
        ...activeAssistantMessage,
        timestamp,
        content: nextContent
      };

      await emitStructuredEvent({
        type: "message",
        message: {
          messageId: activeAssistantMessage.messageId,
          provider: "gemini",
          providerSessionId: activeProviderSessionId,
          role,
          kind: "text",
          content: activeAssistantMessage.content,
          toolCall: null,
          timestamp: activeAssistantMessage.timestamp,
          sequence: activeAssistantMessage.sequence,
          rawRef: activeAssistantMessage.rawRef
        },
        rawEventRef
      });
    };

    const handleToolUseEvent = async (
      payload: Record<string, unknown>,
      rawEventRef: string
    ): Promise<void> => {
      resetAssistantMessage();
      const toolId = readFirstNonEmptyString(payload, [
        ["tool_id"],
        ["toolUseId"],
        ["id"]
      ]) || `gemini-tool-call-${lineNumber}`;
      const toolName = readFirstNonEmptyString(payload, [
        ["tool_name"],
        ["toolName"],
        ["name"]
      ]) || "tool";
      const parameters = readFirstDefinedValue(payload, [
        ["parameters"],
        ["args"],
        ["input"]
      ]);
      const patchText = buildGeminiRuntimeApplyPatch(parameters);
      const normalizedToolName = patchText ? "apply_patch" : toolName;

      toolNameById.set(toolId, normalizedToolName);
      sequence += 1;

      await emitStructuredEvent({
        type: "message",
        message: createGeminiRuntimeMessage({
          providerSessionId: activeProviderSessionId,
          role: patchText ? "tool" : "assistant",
          kind: "tool_call",
          content: patchText || stringifyStructuredValue(parameters),
          timestamp: safeDate(payload.timestamp, nextTimestamp()),
          sequence,
          rawRef: buildGeminiToolRawRef(activeProviderSessionId, toolId, "call"),
          toolCall: {
            callId: toolId,
            name: normalizedToolName,
            input: patchText || stringifyStructuredValue(parameters),
            output: null,
            error: null,
            status: "running"
          }
        }),
        rawEventRef
      });
    };

    const handleToolResultEvent = async (
      payload: Record<string, unknown>,
      rawEventRef: string
    ): Promise<void> => {
      resetAssistantMessage();
      const toolId = readFirstNonEmptyString(payload, [
        ["tool_id"],
        ["toolUseId"],
        ["tool_use_id"],
        ["id"]
      ]) || `gemini-tool-result-${lineNumber}`;
      const toolName =
        toolNameById.get(toolId)
        || readFirstNonEmptyString(payload, [
          ["tool_name"],
          ["toolName"],
          ["name"]
        ])
        || "tool";
      const output = extractTextBlocks(
        readFirstDefinedValue(payload, [
          ["output"],
          ["result"],
          ["content"]
        ])
      ).trim();
      const errorDetail = extractGeminiErrorDetail(payload.error);
      const toolStatus = normalizeGeminiToolStatus(payload.status, errorDetail);

      sequence += 1;

      await emitStructuredEvent({
        type: "message",
        message: createGeminiRuntimeMessage({
          providerSessionId: activeProviderSessionId,
          role: "tool",
          kind: "tool_result",
          content: output || errorDetail || toolName,
          timestamp: safeDate(payload.timestamp, nextTimestamp()),
          sequence,
          rawRef: buildGeminiToolRawRef(activeProviderSessionId, toolId, "result"),
          toolCall: {
            callId: toolId,
            name: toolName,
            input: "",
            output: output || null,
            error: errorDetail || null,
            status: toolStatus
          }
        }),
        rawEventRef
      });
    };

    const handleLine = async (line: string): Promise<void> => {
      lineNumber += 1;
      const trimmed = line.trim();

      if (!trimmed) {
        return;
      }

      let payload: Record<string, unknown>;

      try {
        payload = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }

      const rawEventRef = buildGeminiRawEventRef(activeProviderSessionId, lineNumber);
      const eventType = ensureText(payload.type).trim().toLowerCase();

      switch (eventType) {
        case "init": {
          const discoveredSessionId = readFirstNonEmptyString(payload, [["session_id"], ["sessionId"]]);

          if (discoveredSessionId) {
            updateBinding(discoveredSessionId);
          }
          return;
        }
        case "message":
          await handleMessageEvent(payload, rawEventRef);
          return;
        case "tool_use":
          await handleToolUseEvent(payload, rawEventRef);
          return;
        case "tool_result":
          await handleToolResultEvent(payload, rawEventRef);
          return;
        case "error": {
          const severity = ensureText(payload.severity).trim().toLowerCase();
          const message = readFirstNonEmptyString(payload, [["message"]]);

          if (severity === "error" && message) {
            resultStatus = "error";
            resultDetail = message;
          }
          return;
        }
        case "result":
          resultStatus = ensureText(payload.status).trim().toLowerCase() || "success";
          resultDetail = buildGeminiResultDetail(payload);
          return;
        default:
          return;
      }
    };

    const completed = new Promise<void>((resolve, reject) => {
      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        callback();
      };

      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");

      const stdoutReader = createInterface({
        input: proc.stdout
      });

      stdoutReader.on("line", (line) => {
        lineChain = lineChain.then(() => handleLine(line)).catch((error) => {
          runtimeFailure = error instanceof Error ? error : new Error("GEMINI_RUNTIME_FAILED");
        });
      });

      proc.stderr.on("data", (chunk) => {
        stderrBuffer = `${stderrBuffer}${chunk.toString()}`;
      });

      proc.once("error", (error) => {
        stdoutReader.close();
        settle(() => {
          reject(error);
        });
      });

      proc.once("close", (code, signal) => {
        stdoutReader.close();
        void lineChain
          .then(() => {
            if (runtimeFailure) {
              settle(() => {
                reject(runtimeFailure as Error);
              });
              return;
            }

            if (interrupted) {
              settle(() => {
                resolve();
              });
              return;
            }

            if (resultStatus && resultStatus !== "success") {
              settle(() => {
                reject(new Error(resultDetail || "GEMINI_RUNTIME_FAILED"));
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
              stderrBuffer.trim()
              || resultDetail
              || `Gemini exited with code=${String(code ?? "null")} signal=${String(signal ?? "null")}`;

            settle(() => {
              reject(new Error(detail));
            });
          })
          .catch((error) => {
            settle(() => {
              reject(error instanceof Error ? error : new Error("GEMINI_RUNTIME_FAILED"));
            });
          });
      });
    });

    return {
      providerSessionId: activeProviderSessionId,
      rawStoreRef: activeRawStoreRef,
      interrupt: async () => {
        interrupted = true;

        if (!proc.killed) {
          proc.kill("SIGINT");
        }

        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGTERM");
          }
        }, INTERRUPT_KILL_TIMEOUT_MS).unref?.();
      },
      isAlive: () => !proc.killed && proc.exitCode === null,
      completed
    };
  }
}

function buildGeminiRuntimeArgs(
  mode: "start" | "continue",
  providerSessionId: string,
  request: ProviderRuntimeRunRequest
): string[] {
  const args = [
    "--output-format",
    "stream-json"
  ];
  const prompt = resolveGeminiPrompt(request.options);
  const approvalMode = mapGeminiApprovalMode(request.options.permissionMode);

  if (mode === "continue" && !providerSessionId.startsWith("pending://")) {
    args.push("--resume", providerSessionId);
  }

  if (request.options.model?.trim()) {
    args.push("--model", request.options.model.trim());
  }

  if (approvalMode) {
    args.push("--approval-mode", approvalMode);
  }

  args.push("--prompt", prompt);
  return args;
}

function resolveGeminiPrompt(options: ProviderRuntimeRunRequest["options"]): string {
  const providerPrompt = options.providerPrompt?.trim();

  if (providerPrompt) {
    return providerPrompt;
  }

  return options.content;
}

function mapGeminiApprovalMode(permissionMode: string | null): string | null {
  switch (permissionMode) {
    case "acceptEdits":
      return "auto_edit";
    case "bypassPermissions":
      return "yolo";
    case "default":
      return "default";
    default:
      return null;
  }
}

function normalizeGeminiMessageRole(value: unknown): "user" | "assistant" | null {
  const normalized = ensureText(value).trim().toLowerCase();

  if (normalized === "user" || normalized === "assistant") {
    return normalized;
  }

  return null;
}

function normalizeGeminiToolStatus(
  value: unknown,
  errorDetail: string
): NormalizedToolCall["status"] {
  const normalized = ensureText(value).trim().toLowerCase();

  if (normalized === "completed" || normalized === "success") {
    return "completed";
  }

  if (normalized === "failed" || normalized === "error") {
    return "failed";
  }

  return errorDetail ? "failed" : "completed";
}

function extractGeminiErrorDetail(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const message = ensureText(record.message).trim();

  if (message) {
    return message;
  }

  return stringifyStructuredValue(value).trim();
}

function buildGeminiResultDetail(payload: Record<string, unknown>): string | null {
  const status = ensureText(payload.status).trim().toLowerCase();
  const detail = readFirstNonEmptyString(payload, [
    ["message"],
    ["detail"]
  ]);

  if (detail) {
    return detail;
  }

  if (status && status !== "success") {
    return `Gemini runtime result=${status}`;
  }

  return null;
}

function buildGeminiRuntimeApplyPatch(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return buildApplyPatchFromStructuredFileTool(value as Record<string, unknown>);
}

function createGeminiRuntimeMessage(input: {
  providerSessionId: string;
  role: NormalizedMessage["role"];
  kind: MessageKind;
  content: string;
  timestamp: string;
  sequence: number;
  rawRef: string;
  toolCall: NormalizedToolCall | null;
}): NormalizedMessage {
  return {
    messageId: messageIdFromRawRef(input.rawRef),
    provider: "gemini",
    providerSessionId: input.providerSessionId,
    role: input.role,
    kind: input.kind,
    content: input.content,
    toolCall: input.toolCall,
    timestamp: input.timestamp,
    sequence: input.sequence,
    rawRef: input.rawRef
  };
}

function buildPendingGeminiSessionRef(sessionId: string): string {
  return `pending://gemini/${sessionId}`;
}

function buildGeminiRawStoreRef(sessionId: string, runtimeHomeDir: string | null = null): string {
  const encodedSessionId = encodeURIComponent(sessionId);

  if (!runtimeHomeDir?.trim()) {
    return `gemini://session/${encodedSessionId}`;
  }

  return `gemini://session/${encodedSessionId}?homeDir=${encodeURIComponent(runtimeHomeDir)}`;
}

function buildGeminiRawEventRef(sessionId: string, lineNumber: number): string {
  return `gemini://session/${encodeURIComponent(sessionId)}/stream#line=${lineNumber}`;
}

function buildGeminiMessageRawRef(
  sessionId: string,
  role: "user" | "assistant",
  index: number
): string {
  return `gemini://session/${encodeURIComponent(sessionId)}/message/${role}-${index}`;
}

function buildGeminiToolRawRef(
  sessionId: string,
  toolId: string,
  kind: "call" | "result"
): string {
  return `gemini://session/${encodeURIComponent(sessionId)}/tool/${encodeURIComponent(toolId)}/${kind}`;
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

function readFirstDefinedValue(
  record: Record<string, unknown>,
  paths: string[][]
): unknown {
  for (const path of paths) {
    const value = readPath(record, path);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
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
