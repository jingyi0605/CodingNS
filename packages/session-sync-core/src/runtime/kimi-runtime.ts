import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import {
  buildKimiSessionRawStoreRef,
  findKimiWorkDirRecordByPath,
  readKimiWorkDirRecords
} from "../kimi-shared.js";
import {
  ensureText,
  extractTextBlocks,
  messageIdFromRawRef,
  nextTimestamp,
  safeDate
} from "../providers/utils.js";
import {
  buildKimiMessageRawRef,
  looksLikeKimiMessagePayload,
  normalizeKimiMessageRecord,
  readKimiFirstNonEmptyString,
  readKimiFirstPresentValue
} from "../kimi-message-normalizer.js";
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
  cliSyntax?: KimiCliSyntax | "auto";
  cliProbeTimeoutMs?: number;
}

interface KimiRuntimeContext {
  request: ProviderRuntimeRunRequest;
  sink: ProviderRuntimeEventSink;
  mode: "start" | "continue";
  sessionId: string;
  rawStoreRef: string;
  startBindingProbe: KimiStartBindingProbe | null;
}

interface KimiEventMappingContext {
  sessionId: string;
  rawStoreRef: string;
  sequence: number;
  lineNumber: number;
}

interface KimiStartBindingProbe {
  workDirHash: string | null;
  lastSessionId: string | null;
}

type KimiRuntimeTransport = "wire" | "command";
type KimiCliSyntax = "modern" | "legacy";

interface KimiLaunchAttempt {
  transport: KimiRuntimeTransport;
  launch: ProviderRuntimeLaunchResult;
  ready: Promise<void>;
  updateBinding(binding: { providerSessionId: string; rawStoreRef: string }): void;
}

const INTERRUPT_KILL_TIMEOUT_MS = 1_500;
const READY_SIGNAL_TIMEOUT_MS = 700;
const KIMI_START_BINDING_RESOLVE_TIMEOUT_MS = 10_000;
const KIMI_START_BINDING_RESOLVE_POLL_MS = 100;

export class KimiRuntimeAdapter implements ProviderRuntimeAdapter {
  readonly providerId: ProviderId = "kimi";
  private readonly commandPath: string;
  private readonly baseArgs: string[];
  private readonly spawnFactory: typeof spawn;
  private readonly cliSyntax: KimiCliSyntax | "auto";
  private readonly cliProbeTimeoutMs: number;
  private cliSyntaxPromise: Promise<KimiCliSyntax> | null = null;

  constructor(private readonly options: KimiRuntimeOptions) {
    this.commandPath = options.commandPath?.trim() || "kimi";
    this.baseArgs = options.baseArgs ?? [];
    this.spawnFactory = options.spawnFactory ?? spawn;
    this.cliSyntax = options.cliSyntax ?? "auto";
    this.cliProbeTimeoutMs = options.cliProbeTimeoutMs ?? 1_500;
  }

  async startSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const pendingBinding = buildPendingKimiBinding(request.sessionId);
    const startBindingProbe = this.captureStartBindingProbe(request.workspacePath);

    sink.updateSessionBinding(pendingBinding);

    return this.launchWithFallback({
      request,
      sink,
      mode: "start",
      sessionId: pendingBinding.providerSessionId,
      rawStoreRef: pendingBinding.rawStoreRef,
      startBindingProbe
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

    const rawStoreRef = request.rawStoreRef ?? buildKimiSessionRawStoreRef(sessionId);

    sink.updateSessionBinding({
      providerSessionId: sessionId,
      rawStoreRef
    });

    return this.launchWithFallback({
      request,
      sink,
      mode: "continue",
      sessionId,
      rawStoreRef,
      startBindingProbe: null
    });
  }

  private async launchWithFallback(
    context: KimiRuntimeContext
  ): Promise<ProviderRuntimeLaunchResult> {
    const cliSyntax = await this.resolveCliSyntax();
    const commandAttempt = this.launchTransport(context, "command", cliSyntax);

    try {
      await commandAttempt.ready;
      this.scheduleBindingResolution(context, commandAttempt);
      return commandAttempt.launch;
    } catch (commandError) {
      commandAttempt.launch.completed.catch(() => {
        return;
      });
      const commandDetail = extractErrorDetail(
        await commandAttempt.launch.completed.then(() => null).catch((error) => error)
      );
      throw new Error(
        `KIMI_RUNTIME_FALLBACK_FAILED: wire=disabled; command=${commandDetail}; cause=${extractErrorDetail(commandError)}`
      );
    }
  }

  private launchTransport(
    context: KimiRuntimeContext,
    transport: KimiRuntimeTransport,
    cliSyntax: KimiCliSyntax
  ): KimiLaunchAttempt {
    const args = [
      ...this.baseArgs,
      ...buildKimiRuntimeArgs(transport, context.mode, context.sessionId, context.request, cliSyntax)
    ];
    const proc = this.spawnFactory(this.commandPath, args, {
      cwd: context.request.workspacePath,
      env: buildKimiSpawnEnv(),
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
    const updateActiveBinding = (binding: { providerSessionId: string; rawStoreRef: string }): void => {
      if (
        !binding.providerSessionId.trim()
        || (
          binding.providerSessionId === activeSessionId
          && binding.rawStoreRef === activeRawStoreRef
        )
      ) {
        return;
      }

      activeSessionId = binding.providerSessionId;
      activeRawStoreRef = binding.rawStoreRef;
      context.sink.updateSessionBinding(binding);
      launch.providerSessionId = binding.providerSessionId;
      launch.rawStoreRef = binding.rawStoreRef;
    };
    const enqueuePromptWrite = (
      options: ProviderRuntimeRunRequest["options"],
      closeAfterWrite = false
    ): Promise<void> => {
      writeChain = writeChain.then(() => this.writePromptPayload(proc, options, transport, closeAfterWrite));
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
          updateActiveBinding({
            providerSessionId: event.providerSessionId,
            rawStoreRef: event.rawStoreRef ?? buildKimiSessionRawStoreRef(event.providerSessionId)
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
          updateActiveBinding({
            providerSessionId: mapped.providerSessionId,
            rawStoreRef: buildKimiSessionRawStoreRef(mapped.providerSessionId)
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
          rawEventRef: buildKimiMessageRawRef(activeSessionId, "wire", lineNumber)
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

      enqueuePromptWrite(context.request.options, transport === "command").catch((error) => {
        settle(() => {
          reject(error);
        });
      });
    });

    const submitDuringRun = async (
      options: ProviderRuntimeRunRequest["options"]
    ): Promise<void> => {
      if (transport === "command" || !canSubmitInRunInput()) {
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
      submitDuringRun: transport === "command" ? undefined : submitDuringRun,
      completed
    };

    return {
      transport,
      launch,
      ready,
      updateBinding: updateActiveBinding
    };
  }

  private scheduleBindingResolution(
    context: KimiRuntimeContext,
    attempt: KimiLaunchAttempt
  ): void {
    if (context.mode !== "start" || !isPendingKimiBinding(context.sessionId)) {
      return;
    }

    void Promise.race([
      this.resolveStartedSessionBinding(context.request.workspacePath, context.startBindingProbe),
      attempt.launch.completed.then(() => null)
    ])
      .then(async (binding) => {
        if (!binding) {
          return;
        }

        attempt.updateBinding(binding);
        await context.sink.emit({
          type: "session_created",
          status: "starting",
          providerSessionId: binding.providerSessionId,
          rawStoreRef: binding.rawStoreRef,
          detail: "Kimi session binding resolved"
        });
      })
      .catch(() => {
        return;
      });
  }

  private async resolveCliSyntax(): Promise<KimiCliSyntax> {
    if (this.cliSyntax !== "auto") {
      return this.cliSyntax;
    }

    if (!this.cliSyntaxPromise) {
      // 先探测本地 CLI 的参数风格，避免新版/旧版参数互相打架。
      this.cliSyntaxPromise = detectKimiCliSyntax({
        commandPath: this.commandPath,
        baseArgs: this.baseArgs,
        spawnFactory: this.spawnFactory,
        timeoutMs: this.cliProbeTimeoutMs
      }).catch(() => "modern");
    }

    return this.cliSyntaxPromise;
  }

  private async resolveStartedSessionBinding(
    workspacePath: string,
    startBindingProbe: KimiStartBindingProbe | null
  ): Promise<{ providerSessionId: string; rawStoreRef: string } | null> {
    const startedAtMs = Date.now();
    const initialLastSessionId = startBindingProbe?.lastSessionId ?? null;
    const workDirHash = startBindingProbe?.workDirHash ?? null;

    while (Date.now() - startedAtMs < KIMI_START_BINDING_RESOLVE_TIMEOUT_MS) {
      const workDirs = readKimiWorkDirRecords(this.options.homeDir);
      const activeWorkDir = findKimiWorkDirRecordByPath(workDirs, workspacePath);
      const candidateSessionId =
        this.findResolvedSessionIdFromWorkDir(activeWorkDir?.lastSessionId ?? null, initialLastSessionId)
        ?? this.findLatestSessionIdForWorkspace(
          activeWorkDir?.hash ?? workDirHash,
          startedAtMs,
          initialLastSessionId
        );

      if (candidateSessionId) {
        return {
          providerSessionId: candidateSessionId,
          rawStoreRef: buildKimiSessionRawStoreRef(candidateSessionId)
        };
      }

      await waitForKimiBindingResolvePoll();
    }

    return null;
  }

  private captureStartBindingProbe(workspacePath: string): KimiStartBindingProbe {
    const workDirs = readKimiWorkDirRecords(this.options.homeDir);
    const workDir = findKimiWorkDirRecordByPath(workDirs, workspacePath);

    return {
      workDirHash: workDir?.hash ?? null,
      lastSessionId: workDir?.lastSessionId ?? null
    };
  }

  private findResolvedSessionIdFromWorkDir(
    candidateSessionId: string | null,
    initialLastSessionId: string | null
  ): string | null {
    const normalizedCandidate = candidateSessionId?.trim();

    if (!normalizedCandidate) {
      return null;
    }

    if (initialLastSessionId && normalizedCandidate === initialLastSessionId) {
      return null;
    }

    return normalizedCandidate;
  }

  private findLatestSessionIdForWorkspace(
    workDirHash: string | null,
    startedAtMs: number,
    initialLastSessionId: string | null
  ): string | null {
    if (!workDirHash?.trim()) {
      return null;
    }

    const workspaceSessionsDir = join(this.options.homeDir, "sessions", workDirHash);

    if (!existsSync(workspaceSessionsDir)) {
      return null;
    }

    let bestCandidate: { sessionId: string; mtimeMs: number } | null = null;
    const entries = readdirSync(workspaceSessionsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (initialLastSessionId && entry.name === initialLastSessionId) {
        continue;
      }

      const sessionDir = join(workspaceSessionsDir, entry.name);
      const mtimeMs = readKimiSessionDirectoryMtime(sessionDir);

      if (mtimeMs < startedAtMs - 1_000) {
        continue;
      }

      if (!bestCandidate || mtimeMs > bestCandidate.mtimeMs) {
        bestCandidate = {
          sessionId: entry.name,
          mtimeMs
        };
      }
    }

    return bestCandidate?.sessionId ?? null;
  }

  private async writePrompt(
    proc: ChildProcessWithoutNullStreams,
    request: ProviderRuntimeRunRequest
  ): Promise<void> {
    return this.writePromptPayload(proc, request.options, "command");
  }

  private async writePromptPayload(
    proc: ChildProcessWithoutNullStreams,
    options: ProviderRuntimeRunRequest["options"],
    transport: KimiRuntimeTransport,
    closeAfterWrite = false
  ): Promise<void> {
    const prompt = options.providerPrompt?.trim() || options.content.trim();

    if (!prompt) {
      if (transport === "command" && closeAfterWrite) {
        await this.closeCommandInput(proc);
      }
      return;
    }

    const payload =
      transport === "command"
        ? buildCommandInputPayloadFromOptions(prompt)
        : buildPromptPayloadFromOptions(options, prompt);

    await this.writeWirePayload(proc, payload);

    if (transport === "command" && closeAfterWrite) {
      await this.closeCommandInput(proc);
    }
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

  private async closeCommandInput(proc: ChildProcessWithoutNullStreams): Promise<void> {
    if (proc.stdin.destroyed || proc.stdin.writableEnded) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      try {
        proc.stdin.end();
        resolve();
      } catch (error: unknown) {
        reject(error);
      }
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
  request: ProviderRuntimeRunRequest,
  cliSyntax: KimiCliSyntax
): string[] {
  if (cliSyntax === "modern") {
    return buildModernKimiRuntimeArgs(transport, mode, sessionId, request);
  }

  return buildLegacyKimiRuntimeArgs(transport, mode, sessionId, request);
}

function buildModernKimiRuntimeArgs(
  transport: KimiRuntimeTransport,
  mode: "start" | "continue",
  sessionId: string,
  request: ProviderRuntimeRunRequest
): string[] {
  if (transport === "wire") {
    const args = ["--wire"];

    if (mode === "continue") {
      args.push("--session", sessionId);
    }

    args.push("--work-dir", request.workspacePath);

    if (request.options.model) {
      args.push("--model", request.options.model);
    }

    return args;
  }

  const args = ["--print", "--output-format", "stream-json", "--input-format", "stream-json"];

  if (mode === "continue") {
    args.push("--session", sessionId);
  }

  args.push("--work-dir", request.workspacePath);

  if (request.options.model) {
    args.push("--model", request.options.model);
  }

  return args;
}

function buildLegacyKimiRuntimeArgs(
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
    readKimiFirstNonEmptyString(payload, [
      ["sessionId"],
      ["session_id"],
      ["session", "id"]
    ]) ?? null;
  const timestamp = resolveEventTimestamp(payload);
  const resolvedSessionId = providerSessionId ?? context.sessionId;
  const resolvedRawStoreRef = providerSessionId
    ? buildKimiSessionRawStoreRef(providerSessionId)
    : context.rawStoreRef;
  const rawEventRef = buildKimiMessageRawRef(resolvedSessionId, "wire", context.lineNumber);

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

  const maybeError = readKimiFirstNonEmptyString(payload, [["error"], ["detail"], ["message"]]);

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

  const normalizedMessages = normalizeKimiWireMessages(payload, wireType, {
    sessionId: resolvedSessionId,
    rawStoreRef: resolvedRawStoreRef,
    sequence: context.sequence,
    lineNumber: context.lineNumber,
    timestamp
  });

  for (const normalizedMessage of normalizedMessages) {
    events.push({
      type: "message",
      message: normalizedMessage,
      status: "running",
      timestamp,
      detail: null,
      rawEventRef: normalizedMessage.rawRef,
      providerSessionId: providerSessionId ?? undefined
    });
  }

  return {
    providerSessionId,
    events
  };
}

function normalizeKimiWireMessages(
  payload: Record<string, unknown>,
  wireType: string,
  input: {
    sessionId: string;
    rawStoreRef: string;
    sequence: number;
    lineNumber: number;
    timestamp: string;
  }
): NormalizedMessage[] {
  if (!looksLikeKimiMessagePayload(payload, wireType)) {
    return [];
  }

  const normalizedParts = normalizeKimiMessageRecord(payload);

  return normalizedParts.map((part, index) =>
    createTextMessage({
      sessionId: input.sessionId,
      rawStoreRef: input.rawStoreRef,
      sequence: input.sequence + index + 1,
      lineNumber: input.lineNumber,
      role: part.role,
      kind: part.kind,
      content: part.content,
      timestamp: input.timestamp,
      rawEventRef: buildKimiMessageRawRef(
        input.sessionId,
        "wire",
        input.lineNumber,
        part.partIndex ?? undefined
      ),
      toolCall: part.toolCall
    })
  );
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

function resolveEventTimestamp(payload: Record<string, unknown>): string {
  const raw = readKimiFirstPresentValue(payload, [
    ["timestamp"],
    ["created_at"],
    ["createdAt"],
    ["time"],
    ["event", "timestamp"]
  ]);

  return safeDate(raw, nextTimestamp()) || nextTimestamp();
}

function normalizeErrorCode(payload: Record<string, unknown>): string {
  const code = readKimiFirstNonEmptyString(payload, [["error_code"], ["code"], ["error", "code"]]);
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

function shouldSpawnViaShell(commandPath: string): boolean {
  return /\.(cmd|bat|ps1)$/i.test(commandPath);
}

function buildKimiSpawnEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1"
  };
}

function buildPendingKimiBinding(sessionId: string): { providerSessionId: string; rawStoreRef: string } {
  const pendingValue = `pending://kimi/${sessionId}`;
  return {
    providerSessionId: pendingValue,
    rawStoreRef: pendingValue
  };
}

function buildCommandInputPayloadFromOptions(prompt: string): Record<string, unknown> {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: prompt
      }
    ]
  };
}

function isPendingKimiBinding(value: string): boolean {
  return value.trim().toLowerCase().startsWith("pending://kimi/");
}

function readKimiSessionDirectoryMtime(sessionDir: string): number {
  let mtimeMs = 0;

  for (const fileName of ["state.json", "context.jsonl", "wire.jsonl"]) {
    const filePath = join(sessionDir, fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    mtimeMs = Math.max(mtimeMs, statSync(filePath).mtimeMs);
  }

  return mtimeMs;
}

function waitForKimiBindingResolvePoll(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, KIMI_START_BINDING_RESOLVE_POLL_MS);
  });
}

async function detectKimiCliSyntax(input: {
  commandPath: string;
  baseArgs: string[];
  spawnFactory: typeof spawn;
  timeoutMs: number;
}): Promise<KimiCliSyntax> {
  const helpOutput = await captureKimiCliOutput(input, ["--help"]);

  if (looksLikeModernKimiHelp(helpOutput)) {
    return "modern";
  }

  if (looksLikeLegacyKimiHelp(helpOutput)) {
    return "legacy";
  }

  return "modern";
}

async function captureKimiCliOutput(
  input: {
    commandPath: string;
    baseArgs: string[];
    spawnFactory: typeof spawn;
    timeoutMs: number;
  },
  probeArgs: string[]
): Promise<string> {
  return new Promise<string>((resolve) => {
    const proc = input.spawnFactory(input.commandPath, [...input.baseArgs, ...probeArgs], {
      shell: shouldSpawnViaShell(input.commandPath),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let settled = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const finalize = (value: string) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGTERM");
      }

      finalize(`${stdoutBuffer}\n${stderrBuffer}`.trim());
    }, Math.max(200, input.timeoutMs));

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
    });

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
    });

    proc.once("error", () => {
      finalize(`${stdoutBuffer}\n${stderrBuffer}`.trim());
    });

    proc.once("close", () => {
      finalize(`${stdoutBuffer}\n${stderrBuffer}`.trim());
    });
  });
}

function looksLikeModernKimiHelp(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("--wire") || normalized.includes("--work-dir");
}

function looksLikeLegacyKimiHelp(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("--cwd") || normalized.includes("no such command 'wire'");
}

