import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  appendJsonLine,
  createRawRef,
  ensureDirectory,
  extractTextBlocks,
  messageIdFromStableKey,
  messageIdFromRawRef,
  nextTimestamp,
  normalizeWorkspacePath,
  readJsonLines
} from "../providers/utils.js";
import { buildCodexResumeHistoryFromRawStore } from "../codex-resume-history.js";
import {
  buildApplyPatchFromCodexCommandLikeValue,
  buildApplyPatchFromFileChangeList,
  extractApplyPatchTargetPathsFromToolOutput,
  normalizeApplyPatchText
} from "../patch-builder.js";
import { loadDatabaseSync, type DatabaseSyncType } from "../sqlite/node-sqlite.js";
import { createCodexThreadPermissionOptions } from "./codex-permissions.js";
import type { NormalizedMessage, NormalizedToolCall, ProviderId } from "../types.js";
import type {
  ProviderRuntimeAdapter,
  ProviderRuntimeEventSink,
  ProviderRuntimeLaunchResult,
  ProviderRuntimeRunRequest,
  RuntimeSendOptions
} from "./types.js";

interface CodexThread {
  id?: string | null;
  runStreamed(
    prompt: CodexRuntimeInput,
    options?: Record<string, unknown>
  ): Promise<{
    events: AsyncIterable<unknown>;
  }>;
}

interface CodexSdkClient {
  startThread(options: Record<string, unknown>): CodexThread;
  resumeThread(threadId: string, options: Record<string, unknown>): CodexThread;
}

interface CodexSdkModule {
  Codex: new () => CodexSdkClient;
}

type CodexRuntimeInput =
  | string
  | Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "local_image";
          path: string;
        }
    >;

interface ActiveTurnContext {
  providerSessionId: string;
  rawStoreRef: string;
  homeDir: string | null;
  sequence: number;
  toolNameByCallId: Map<string, string>;
  stableMessageRefByIdentity: Map<string, CodexStableMessageRef>;
  lastSignatureByIdentity: Map<string, string>;
  sink: ProviderRuntimeEventSink;
  workspacePath: string;
  firstUserMessage: string;
  launchedAtMs: number;
  launchPerfStartedAtMs: number;
}

interface CodexStableMessageRef {
  sequence: number;
  rawRef: string;
  messageId: string;
}

interface CodexThreadRow {
  id: string;
  rollout_path: string;
  cwd: string;
  first_user_message: string;
  created_at: number;
}

interface CodexRuntimeOptions {
  homeDir?: string;
  commandPath?: string;
  runtimeEnv?: Record<string, string> | null;
  transportFactory?: (request: ProviderRuntimeRunRequest) => CodexAppServerTransport;
  handleServerRequest?: (input: {
    sessionId: string;
    providerSessionId: string;
    request: Record<string, unknown>;
  }) => Promise<unknown>;
}

const CODEX_RUNTIME_DEBUG_ENABLED = /^(1|true|yes)$/i.test(
  process.env.CODINGNS_PERF_DEBUG?.trim() ?? ""
);
const CODEX_APP_SERVER_REQUEST_TIMEOUT_MS = 20_000;

function logCodexRuntimeStep(
  scope: string,
  startedAtMs: number,
  detail: Record<string, unknown> = {}
): void {
  if (!CODEX_RUNTIME_DEBUG_ENABLED) {
    return;
  }

  const durationMs = Math.round(performance.now() - startedAtMs);
  const suffix = formatCodexRuntimeDebugDetail(detail);
  console.info(`[perf][codex-runtime] ${scope} ${durationMs}ms${suffix ? ` ${suffix}` : ""}`);
}

function formatCodexRuntimeDebugDetail(detail: Record<string, unknown>): string {
  const entries = Object.entries(detail).filter(([, value]) => value !== undefined);

  if (entries.length === 0) {
    return "";
  }

  return entries
    .map(([key, value]) => `${key}=${formatCodexRuntimeDebugValue(value)}`)
    .join(" ");
}

function formatCodexRuntimeDebugValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.round(value)) : String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface CodexAppServerTransport {
  initialize(): Promise<void>;
  startThread(request: ProviderRuntimeRunRequest): Promise<{ providerSessionId: string; rawStoreRef: string | null }>;
  resumeThread(request: ProviderRuntimeRunRequest, providerSessionId: string): Promise<{
    providerSessionId: string;
    rawStoreRef: string | null;
  }>;
  resumeThreadFromHistory(input: {
    providerSessionId?: string | null;
    workspacePath: string;
    history: unknown[];
    model?: string | null;
  }): Promise<{
    providerSessionId: string;
    rawStoreRef: string | null;
  }>;
  startTurn(
    request: ProviderRuntimeRunRequest,
    providerSessionId: string
  ): Promise<{ notification?: Record<string, unknown> | null } | void>;
  steerTurn(options: RuntimeSendOptions): Promise<{ turnId?: string | null } | void>;
  interruptTurn(): Promise<void>;
  setNotificationHandler(handler: (notification: Record<string, unknown>) => void | Promise<void>): void;
  setServerRequestHandler(handler: (request: Record<string, unknown>) => Promise<unknown>): void;
  setOnClose(handler: ((error: Error | null) => void) | null): void;
  isClosed(): boolean;
  close(): void;
}

export class CodexRuntimeAdapter implements ProviderRuntimeAdapter {
  readonly providerId: ProviderId = "codex";

  constructor(private readonly options: CodexRuntimeOptions = {}) {}

  async startSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const launchedAtMs = Date.now();
    const launchPerfStartedAtMs = performance.now();
      const transport = this.options.transportFactory
      ? this.options.transportFactory(request)
      : createCodexAppServerTransport({
        ...this.options,
        homeDir: request.runtimeHomeDir?.trim() || this.options.homeDir,
        runtimeEnv: request.runtimeEnv ?? this.options.runtimeEnv ?? null
      });
    try {
      const initializeStartedAtMs = performance.now();
      await transport.initialize();
      logCodexRuntimeStep("start_session.initialize", initializeStartedAtMs, {
        sessionId: request.sessionId,
        workspacePath: request.workspacePath
      });
      const abortController = new AbortController();
      const eventQueue = createAsyncEventQueue();
      const translateNotification = createCodexAppServerNotificationTranslator();
      const forwardTranslatedNotification = createCodexTranslatedNotificationForwarder(eventQueue);
      const resumedSyntheticSession = await this.resumeSyntheticThreadFromHistory(transport, request);
      const startedSession =
        resumedSyntheticSession ??
        await (async () => {
          const startThreadStartedAtMs = performance.now();
          const started = await transport.startThread(request);
          logCodexRuntimeStep("start_session.thread_start", startThreadStartedAtMs, {
            sessionId: request.sessionId,
            providerSessionId: started.providerSessionId
          });
          return started;
        })();
      const providerSessionId = startedSession.providerSessionId;
      const syntheticRawStoreRef = buildRuntimeRawStoreRef(
        resolveRuntimeStoreKey(providerSessionId, request.sessionId)
      );
      const rawStoreRef = pickAvailableCodexRawStoreRef(
        providerSessionId,
        resumedSyntheticSession
          ? [resumedSyntheticSession.rawStoreRef]
          : [startedSession.rawStoreRef, request.rawStoreRef],
        syntheticRawStoreRef
      );
      logCodexRuntimeStep("start_session.raw_store_ref_ready", launchPerfStartedAtMs, {
        sessionId: request.sessionId,
        providerSessionId,
        synthetic: isSyntheticRawStoreRef(rawStoreRef),
        hasProviderRawStoreRef: Boolean(startedSession.rawStoreRef),
        providerRawStoreRefExists: Boolean(startedSession.rawStoreRef && existsSync(startedSession.rawStoreRef))
      });

      sink.updateSessionBinding({
        providerSessionId,
        rawStoreRef
      });

      let firstNotificationLogged = false;
      transport.setNotificationHandler(async (notification) => {
        if (!firstNotificationLogged) {
          firstNotificationLogged = true;
          logCodexRuntimeStep("start_session.first_notification", launchPerfStartedAtMs, {
            sessionId: request.sessionId,
            providerSessionId,
            method: ensureText(notification.method).trim() || null
          });
        }
          const translated = translateNotification(notification);
          forwardTranslatedNotification(translated);
      });
      transport.setServerRequestHandler(async (serverRequest) => {
        if (!this.options.handleServerRequest) {
          throw new Error("CODEX_APP_SERVER_REQUEST_NOT_SUPPORTED");
        }

        return this.options.handleServerRequest({
          sessionId: request.sessionId,
          providerSessionId,
          request: serverRequest
        });
      });
      transport.setOnClose((error) => {
        if (error) {
          eventQueue.push({
            type: "turn.failed",
            timestamp: nextTimestamp(),
            error: error.message
          });
        }
        eventQueue.close();
      });
      const startTurnStartedAtMs = performance.now();
      const startTurnResult = await transport.startTurn(request, providerSessionId);
      const startTurnNotification = startTurnResult?.notification ?? null;

      if (startTurnNotification) {
        const translated = translateNotification(startTurnNotification);
        forwardTranslatedNotification(translated);
      }
      logCodexRuntimeStep("start_session.turn_start", startTurnStartedAtMs, {
        sessionId: request.sessionId,
        providerSessionId
      });
      logCodexRuntimeStep("start_session.ready", launchPerfStartedAtMs, {
        sessionId: request.sessionId,
        providerSessionId
      });

      return {
        providerSessionId,
        rawStoreRef,
        submitDuringRun: async (options) => {
          await transport.steerTurn(options);
        },
        interrupt: async () => {
          abortController.abort();
          await transport.interruptTurn().catch(() => {
            return;
          });
          transport.close();
        },
        isAlive: () => transport.isClosed() === false,
        completed: this.runTurn(
          null,
          request,
          sink,
          providerSessionId,
          rawStoreRef,
          abortController,
          eventQueue.iterator,
          [],
          launchedAtMs,
          launchPerfStartedAtMs
        ).finally(() => {
          transport.close();
        })
      };
    } catch (error) {
      transport.close();
      throw error;
    }
  }

  private async resumeSyntheticThreadFromHistory(
    transport: CodexAppServerTransport,
    request: ProviderRuntimeRunRequest
  ): Promise<{ providerSessionId: string; rawStoreRef: string | null } | null> {
    const history = buildSyntheticResumeHistory(request.rawStoreRef);

    if (history.length === 0) {
      return null;
    }

    const resumeStartedAtMs = performance.now();
    const resumed = await transport.resumeThreadFromHistory({
      providerSessionId: null,
      workspacePath: request.workspacePath,
      history,
      model: request.options.model
    });
    logCodexRuntimeStep("start_session.thread_resume_from_history", resumeStartedAtMs, {
      sessionId: request.sessionId,
      providerSessionId: resumed.providerSessionId,
      messageCount: history.length
    });
    return resumed;
  }

  async continueSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const providerSessionId = resolveResumeThreadId(
      request.providerSessionId,
      request.rawStoreRef
    );

    if (!providerSessionId) {
      throw new Error("PROVIDER_SESSION_ID_REQUIRED");
    }

    const transport = this.options.transportFactory
      ? this.options.transportFactory(request)
      : createCodexAppServerTransport({
        ...this.options,
        homeDir: request.runtimeHomeDir?.trim() || this.options.homeDir,
        runtimeEnv: request.runtimeEnv ?? this.options.runtimeEnv ?? null
      });
    try {
      const runtimeStartedAtMs = performance.now();
      const initializeStartedAtMs = performance.now();
      await transport.initialize();
      logCodexRuntimeStep("continue_session.initialize", initializeStartedAtMs, {
        sessionId: request.sessionId,
        providerSessionId
      });
      const syntheticRawStoreRef = buildRuntimeRawStoreRef(providerSessionId);
      let resolvedSessionId = providerSessionId;
      let resolvedFallbackHistoryRawStoreRef: string | null = null;
      const resumeThreadStartedAtMs = performance.now();
      let resumed: { providerSessionId: string; rawStoreRef: string | null };

      try {
        resumed = await transport.resumeThread(request, resolvedSessionId);
        logCodexRuntimeStep("continue_session.thread_resume", resumeThreadStartedAtMs, {
          sessionId: request.sessionId,
          providerSessionId: resolvedSessionId,
          fallback: false
        });
      } catch (error) {
        const fallbackHistorySource = await this.resolveContinueFallbackHistorySource({
          providerSessionId,
          rawStoreRef: request.rawStoreRef,
          workspacePath: request.workspacePath,
          homeDir: request.runtimeHomeDir?.trim() || this.options.homeDir?.trim() || null
        });
        const resumeHistory = fallbackHistorySource?.history ?? [];

        if (!shouldFallbackCodexContinueFromHistory(error, resumeHistory)) {
          throw error;
        }

        resolvedFallbackHistoryRawStoreRef = fallbackHistorySource?.rawStoreRef ?? null;
        const resumeFallbackStartedAtMs = performance.now();
        resumed = await transport.resumeThreadFromHistory({
          providerSessionId: null,
          workspacePath: request.workspacePath,
          history: resumeHistory,
          model: request.options.model
        });
        resolvedSessionId = resumed.providerSessionId;
        logCodexRuntimeStep("continue_session.thread_resume_from_history_fallback", resumeFallbackStartedAtMs, {
          sessionId: request.sessionId,
          requestedProviderSessionId: providerSessionId,
          providerSessionId: resolvedSessionId,
          historyLength: resumeHistory.length
        });
      }

      const pickedRawStoreRef = pickAvailableCodexRawStoreRef(
        resolvedSessionId,
        [resolvedFallbackHistoryRawStoreRef, request.rawStoreRef, resumed.rawStoreRef],
        syntheticRawStoreRef
      );
      const rawStoreRef =
        !resumed.rawStoreRef?.trim() && resolvedFallbackHistoryRawStoreRef
          ? resolvedFallbackHistoryRawStoreRef
          : pickedRawStoreRef;
      const abortController = new AbortController();
      const eventQueue = createAsyncEventQueue();
      const translateNotification = createCodexAppServerNotificationTranslator();
      const forwardTranslatedNotification = createCodexTranslatedNotificationForwarder(eventQueue);
      logCodexRuntimeStep("continue_session.raw_store_ref_ready", runtimeStartedAtMs, {
        sessionId: request.sessionId,
        providerSessionId: resolvedSessionId,
        synthetic: isSyntheticRawStoreRef(rawStoreRef),
        hasResumedRawStoreRef: Boolean(resumed.rawStoreRef),
        hasRequestRawStoreRef: Boolean(request.rawStoreRef),
        resumedRawStoreRefExists: Boolean(resumed.rawStoreRef && existsSync(resumed.rawStoreRef))
      });

      sink.updateSessionBinding({
        providerSessionId: resolvedSessionId,
        rawStoreRef
      });

      let firstNotificationLogged = false;
      transport.setNotificationHandler(async (notification) => {
        if (!firstNotificationLogged) {
          firstNotificationLogged = true;
          logCodexRuntimeStep("continue_session.first_notification", runtimeStartedAtMs, {
            sessionId: request.sessionId,
            providerSessionId: resolvedSessionId,
            method: ensureText(notification.method).trim() || null
          });
        }
        const translated = translateNotification(notification);
        forwardTranslatedNotification(translated);
      });
      transport.setServerRequestHandler(async (serverRequest) => {
        if (!this.options.handleServerRequest) {
          throw new Error("CODEX_APP_SERVER_REQUEST_NOT_SUPPORTED");
        }

        return this.options.handleServerRequest({
          sessionId: request.sessionId,
          providerSessionId: resolvedSessionId,
          request: serverRequest
        });
      });
      transport.setOnClose((error) => {
        if (error) {
          eventQueue.push({
            type: "turn.failed",
            timestamp: nextTimestamp(),
            error: error.message
          });
        }
        eventQueue.close();
      });
      const startTurnStartedAtMs = performance.now();
      const startTurnResult = await transport.startTurn(request, resolvedSessionId);
      const startTurnNotification = startTurnResult?.notification ?? null;

      if (startTurnNotification) {
        const translated = translateNotification(startTurnNotification);
        forwardTranslatedNotification(translated);
      }
      logCodexRuntimeStep("continue_session.turn_start", startTurnStartedAtMs, {
        sessionId: request.sessionId,
        providerSessionId: resolvedSessionId
      });
      logCodexRuntimeStep("continue_session.ready", runtimeStartedAtMs, {
        sessionId: request.sessionId,
        providerSessionId: resolvedSessionId
      });

      return {
        providerSessionId: resolvedSessionId,
        rawStoreRef,
        submitDuringRun: async (options) => {
          await transport.steerTurn(options);
        },
        interrupt: async () => {
          abortController.abort();
          await transport.interruptTurn().catch(() => {
            return;
          });
          transport.close();
        },
        isAlive: () => transport.isClosed() === false,
        completed: this.runTurn(
          null,
          request,
          sink,
          resolvedSessionId,
          rawStoreRef,
          abortController,
          eventQueue.iterator,
          [],
          Date.now()
        ).finally(() => {
          transport.close();
        })
      };
    } catch (error) {
      transport.close();
      throw error;
    }
  }

  private async resolveContinueFallbackHistorySource(input: {
    providerSessionId: string;
    rawStoreRef: string | null;
    workspacePath: string;
    homeDir: string | null;
  }): Promise<{ rawStoreRef: string; history: Array<Record<string, unknown>> } | null> {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const pushCandidate = (candidate: string | null | undefined) => {
      const normalized = candidate?.trim();

      if (!normalized || seen.has(normalized) || !existsSync(normalized)) {
        return;
      }

      seen.add(normalized);
      candidates.push(normalized);
    };

    pushCandidate(input.rawStoreRef);

    // 旧会话的 binding 可能只剩 synthetic stream，或者已经指到了父线程 transcript。
    // 继续会话失败时，额外按真实 thread id 扫一次本地 transcript，尽量把历史恢复链路救回来。
    pushCandidate(
      await this.resolveRealRawStoreRef(
        input.providerSessionId.trim(),
        input.workspacePath,
        input.homeDir
      )
    );

    let fallbackMatch: { rawStoreRef: string; history: Array<Record<string, unknown>> } | null = null;

    for (const candidate of candidates) {
      const history = buildCodexResumeHistoryFromRawStore(candidate);

      if (history.length === 0) {
        continue;
      }

      const meta = readSessionMeta(candidate);

      if (meta?.threadId === input.providerSessionId.trim()) {
        return {
          rawStoreRef: candidate,
          history
        };
      }

      fallbackMatch ??= {
        rawStoreRef: candidate,
        history
      };
    }

    return fallbackMatch;
  }

  private async runTurn(
    thread: CodexThread | null,
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink,
    providerSessionId: string,
    rawStoreRef: string,
    abortController: AbortController,
    preparedEvents?: AsyncIterator<unknown>,
    bufferedEvents: unknown[] = [],
    launchedAtMs = Date.now(),
    launchPerfStartedAtMs = performance.now()
  ): Promise<void> {
    const context: ActiveTurnContext = {
      providerSessionId,
      rawStoreRef,
      // 运行时消息必须接在历史消息后面，不能每轮都从 1 重新编号，
      // 否则前端会把新 assistant/tool 消息排到旧消息前面，表现成用户消息一直挂在底部。
      sequence: Math.max(0, request.sequenceBase ?? 0),
      toolNameByCallId: new Map(),
      stableMessageRefByIdentity: new Map(),
      lastSignatureByIdentity: new Map(),
      sink,
      workspacePath: request.workspacePath,
      firstUserMessage: request.options.content,
      homeDir: request.runtimeHomeDir?.trim() || this.options.homeDir?.trim() || null,
      launchedAtMs,
      launchPerfStartedAtMs
    };

    try {
      await this.refreshSessionBindingIfNeeded(context);
      persistSyntheticUserMessageIfNeeded(context.rawStoreRef, context.providerSessionId, {
        workspacePath: request.workspacePath,
        content: request.options.content,
        timestamp: nextTimestamp()
      });

      for (const event of bufferedEvents) {
        await this.refreshSessionBindingIfNeeded(context);
        persistSyntheticEventIfNeeded(context.rawStoreRef, context.providerSessionId, event);
        await this.handleEvent(event, request, context, abortController.signal.aborted);
      }

      const events =
        preparedEvents ??
        (await thread!.runStreamed(createCodexInput(request), {
          signal: abortController.signal
        })).events[Symbol.asyncIterator]();

      while (true) {
        const next = await events.next();

        if (next.done) {
          return;
        }

        await this.refreshSessionBindingIfNeeded(context);
        persistSyntheticEventIfNeeded(context.rawStoreRef, context.providerSessionId, next.value);
        await this.handleEvent(next.value, request, context, abortController.signal.aborted);
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        await sink.emit({
          type: "interrupted",
          status: "interrupted",
          interruptSource: "user",
          providerSessionId: context.providerSessionId,
          rawStoreRef: context.rawStoreRef,
          detail: "codex turn interrupted",
          timestamp: nextTimestamp()
        });
        return;
      }

      const failure = classifyCodexRuntimeFailure(error);
      await sink.emit({
        type: "error",
        status: "failed",
        providerSessionId: context.providerSessionId,
        rawStoreRef: context.rawStoreRef,
        errorCode: failure.errorCode,
        detail: failure.detail,
        timestamp: nextTimestamp()
      });
    }
  }

  private async handleEvent(
    event: unknown,
    request: ProviderRuntimeRunRequest,
    context: ActiveTurnContext,
    interrupted: boolean
  ): Promise<void> {
    const eventType = ensureText(readProp(event, "type")).trim();

    if (eventType.length === 0) {
      return;
    }

    if (context.lastSignatureByIdentity.size === 0 && eventType.startsWith("item.")) {
      logCodexRuntimeStep("turn.first_item_event", context.launchPerfStartedAtMs, {
        sessionId: request.sessionId,
        providerSessionId: context.providerSessionId,
        eventType
      });
    }

    if (eventType === "turn.completed") {
      await context.sink.emit({
        type: "complete",
        status: "completed",
        providerSessionId: context.providerSessionId,
        rawStoreRef: context.rawStoreRef,
        detail: "codex turn completed",
        timestamp: pickTimestamp(event)
      });
      return;
    }

    if (eventType === "turn.failed") {
      const detail = extractTextBlocks(readProp(event, "error")).trim() || "codex turn failed";
      await context.sink.emit({
        type: "error",
        status: "failed",
        providerSessionId: context.providerSessionId,
        rawStoreRef: context.rawStoreRef,
        errorCode: classifyCodexDetailErrorCode(detail, "CODEX_CLI_TURN_FAILED"),
        detail,
        timestamp: pickTimestamp(event)
      });
      return;
    }

    if (eventType === "turn.interrupted") {
      await context.sink.emit({
        type: "interrupted",
        status: "interrupted",
        interruptSource: interrupted ? "user" : "runtime",
        providerSessionId: context.providerSessionId,
        rawStoreRef: context.rawStoreRef,
        detail: "codex turn interrupted",
        timestamp: pickTimestamp(event)
      });
      return;
    }

    if (interrupted) {
      return;
    }

    if (!eventType.startsWith("item.")) {
      return;
    }

    const item = readProp(event, "item");
    const itemType = ensureText(readProp(item, "type")).trim();

    if (itemType.length === 0) {
      return;
    }

    if (
      itemType === "agent_message" &&
      (eventType === "item.updated" || eventType === "item.completed")
    ) {
      const content = pickFirstNonEmpty(
        ensureText(readProp(item, "text")).trim(),
        extractTextBlocks(readProp(item, "content")).trim()
      );

      if (content.length > 0) {
        await this.emitStableMessage(context, {
          identity: `assistant:text:${ensureText(readProp(item, "id")).trim() || "default"}`,
          timestamp: pickTimestamp(item, event),
          role: "assistant",
          kind: "text",
          content
        });
      }

      return;
    }

    if (
      itemType === "reasoning" &&
      (eventType === "item.updated" || eventType === "item.completed")
    ) {
      const content = pickFirstNonEmpty(
        ensureText(readProp(item, "text")).trim(),
        extractTextBlocks(readProp(item, "summary")).trim(),
        extractTextBlocks(readProp(item, "content")).trim()
      );

      if (content.length > 0) {
        await this.emitStableMessage(context, {
          identity: `assistant:thinking:${ensureText(readProp(item, "id")).trim() || "default"}`,
          timestamp: pickTimestamp(item, event),
          role: "assistant",
          kind: "thinking",
          content
        });
      }

      return;
    }

    if (!isToolItem(itemType)) {
      return;
    }

    const callId = pickFirstNonEmpty(
      ensureText(readProp(item, "id")).trim(),
      ensureText(readProp(item, "call_id")).trim(),
      `${itemType}-${randomUUID()}`
    );
    const name = pickFirstNonEmpty(
      ensureText(readProp(item, "name")).trim(),
      ensureText(readProp(item, "tool")).trim(),
      itemType
    );

    if (eventType === "item.started") {
      const input = resolveCodexToolInput(name, item);
      const toolCall: NormalizedToolCall = {
        callId,
        name,
        input,
        output: null,
        error: null,
        status: "running"
      };
      context.toolNameByCallId.set(callId, name);

      await this.emitStableMessage(context, {
        identity: `tool:call:${callId}`,
        timestamp: pickTimestamp(item, event),
        role: "tool",
        kind: "tool_call",
        content: input,
        toolCall
      });
      return;
    }

    if (eventType === "item.updated") {
      const knownName = context.toolNameByCallId.get(callId) ?? name;
      const input = resolveCodexToolInput(knownName, item);
      const output = pickFirstNonEmpty(
        extractTextBlocks(readProp(item, "result")).trim(),
        extractTextBlocks(readProp(item, "output")).trim(),
        extractTextBlocks(readProp(item, "aggregated_output")).trim(),
        extractTextBlocks(readProp(item, "error")).trim()
      );

      if (output.length === 0) {
        return;
      }

      context.toolNameByCallId.set(callId, knownName);

      await this.emitStableMessage(context, {
        identity: `tool:result:${callId}`,
        timestamp: pickTimestamp(item, event),
        role: "tool",
        kind: "tool_result",
        content: output,
        toolCall: {
          callId,
          name: knownName,
          input,
          output,
          error: null,
          status: "running"
        }
      });
      return;
    }

    if (eventType === "item.completed") {
      const knownName = context.toolNameByCallId.get(callId) ?? name;
      const input = resolveCodexToolInput(knownName, item);
      const output = pickFirstNonEmpty(
        extractTextBlocks(readProp(item, "result")).trim(),
        extractTextBlocks(readProp(item, "output")).trim(),
        extractTextBlocks(readProp(item, "aggregated_output")).trim(),
        extractTextBlocks(readProp(item, "error")).trim()
      );
      const success = inferToolSuccess(item, output);
      const toolCall: NormalizedToolCall = {
        callId,
        name: knownName,
        input,
        output: success ? output : null,
        error: success ? null : output,
        status: success ? "completed" : "failed"
      };

      await this.emitStableMessage(context, {
        identity: `tool:result:${callId}`,
        timestamp: pickTimestamp(item, event),
        role: "tool",
        kind: "tool_result",
        content: output,
        toolCall
      });
    }
  }

  private async emitStableMessage(
    context: ActiveTurnContext,
    input: {
      identity: string;
      timestamp: string;
      role: NormalizedMessage["role"];
      kind: NormalizedMessage["kind"];
      content: string;
      toolCall?: NormalizedToolCall | null;
    }
  ): Promise<void> {
    const message = this.buildMessage(context, {
      timestamp: input.timestamp,
      role: input.role,
      kind: input.kind,
      content: input.content,
      toolCall: input.toolCall ?? null,
      stableIdentity: input.identity
    });
    const signature = buildCodexMessageSignature(message);

    if (context.lastSignatureByIdentity.get(input.identity) === signature) {
      return;
    }

    context.lastSignatureByIdentity.set(input.identity, signature);

    await context.sink.emit({
      type: "message",
      message,
      providerSessionId: context.providerSessionId,
      rawStoreRef: context.rawStoreRef,
      timestamp: input.timestamp,
      rawEventRef: message.rawRef
    });
  }

  private async refreshSessionBindingIfNeeded(context: ActiveTurnContext): Promise<void> {
    if (!isSyntheticRawStoreRef(context.rawStoreRef)) {
      return;
    }

    const resolved =
      await this.resolveLaunchedSessionBinding(
        context.workspacePath,
        context.firstUserMessage,
        context.launchedAtMs,
        context.homeDir
      ) ??
      await this.resolveExistingSessionBinding(
        context.providerSessionId,
        context.rawStoreRef,
        context.workspacePath,
        context.homeDir
      );

    if (
      !resolved ||
      (resolved.providerSessionId === context.providerSessionId &&
        resolved.rawStoreRef === context.rawStoreRef)
    ) {
      return;
    }

    context.providerSessionId = resolved.providerSessionId;
    context.rawStoreRef = resolved.rawStoreRef;
    context.sink.updateSessionBinding({
      providerSessionId: resolved.providerSessionId,
      rawStoreRef: resolved.rawStoreRef
    });
  }

  private async resolveExistingSessionBinding(
    providerSessionId: string,
    rawStoreRef: string,
    workspacePath: string,
    homeDirOverride: string | null = null
  ): Promise<{ providerSessionId: string; rawStoreRef: string } | null> {
    const normalizedProviderSessionId = providerSessionId.trim();

    const meta = readSessionMeta(rawStoreRef);

    if (meta && meta.threadId === normalizedProviderSessionId && existsSync(rawStoreRef)) {
      return {
        providerSessionId: meta.threadId,
        rawStoreRef
      };
    }

    if (!normalizedProviderSessionId) {
      return null;
    }

    const resolvedRawStoreRef = await this.resolveRealRawStoreRef(
      normalizedProviderSessionId,
      workspacePath,
      homeDirOverride
    );

    if (!resolvedRawStoreRef) {
      return null;
    }

    return {
      providerSessionId: normalizedProviderSessionId,
      rawStoreRef: resolvedRawStoreRef
    };
  }

  private async resolveLaunchedSessionBinding(
    workspacePath: string,
    firstUserMessage: string,
    launchedAtMs: number,
    homeDirOverride: string | null = null
  ): Promise<{ providerSessionId: string; rawStoreRef: string } | null> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const matched = this.findLaunchedSessionBindingOnce(
        workspacePath,
        firstUserMessage,
        launchedAtMs,
        homeDirOverride
      );

      if (matched) {
        return matched;
      }

      if (attempt < 19) {
        await sleep(100);
      }
    }

    return null;
  }

  private async resolveRealRawStoreRef(
    providerSessionId: string,
    workspacePath: string,
    homeDirOverride: string | null = null
  ): Promise<string | null> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const matched = this.findRawStoreRefOnce(providerSessionId, workspacePath, homeDirOverride);

      if (matched) {
        return matched;
      }

      if (attempt < 9) {
        await sleep(150);
      }
    }

    return null;
  }

  private findRawStoreRefOnce(
    providerSessionId: string,
    workspacePath: string,
    homeDirOverride: string | null = null
  ): string | null {
    const homeDir =
      homeDirOverride?.trim()
      || this.options.homeDir?.trim()
      || process.env.CODINGNS_CODEX_HOME
      || join(homedir(), ".codex");
    const candidates = this.listSessionFiles(homeDir);
    const normalizedWorkspace = normalizeWorkspacePath(workspacePath);

    for (const filePath of candidates) {
      const meta = readSessionMeta(filePath);

      if (!meta) {
        continue;
      }

      if (meta.threadId !== providerSessionId) {
        continue;
      }

      if (meta.cwd && normalizeWorkspacePath(meta.cwd) !== normalizedWorkspace) {
        continue;
      }

      return filePath;
    }

    return null;
  }

  private listSessionFiles(homeDir: string): string[] {
    const now = new Date();
    const currentYear = String(now.getUTCFullYear());
    const currentMonth = String(now.getUTCMonth() + 1).padStart(2, "0");
    const currentDay = String(now.getUTCDate()).padStart(2, "0");
    const preferredRoots = [
      join(homeDir, "sessions", currentYear, currentMonth, currentDay),
      join(homeDir, "sessions"),
      join(homeDir, "archived_sessions")
    ];
    const seen = new Set<string>();
    const files: string[] = [];

    for (const root of preferredRoots) {
      for (const file of walkJsonlFiles(root)) {
        if (seen.has(file)) {
          continue;
        }

        seen.add(file);
        files.push(file);
      }
    }

    return files;
  }

  private findLaunchedSessionBindingOnce(
    workspacePath: string,
    firstUserMessage: string,
    launchedAtMs: number,
    homeDirOverride: string | null = null
  ): { providerSessionId: string; rawStoreRef: string } | null {
    const dbPath = findLatestCodexStateDatabase(this.getCodexHomeDir(homeDirOverride));

    if (!dbPath) {
      return null;
    }

    const DatabaseSync = loadDatabaseSync();
    let db: DatabaseSyncType | null = null;

    try {
      db = new DatabaseSync(dbPath, { open: true, readOnly: true });
      const rows = db.prepare(
        `SELECT id, rollout_path, cwd, first_user_message, created_at
           FROM threads
          WHERE source = 'exec'
            AND created_at >= ?
          ORDER BY created_at DESC
          LIMIT 30`
      ).all(Math.max(0, Math.floor((launchedAtMs - 30_000) / 1000))) as unknown as CodexThreadRow[];
      const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
      const normalizedMessage = firstUserMessage.trim();

      for (const row of rows) {
        if (
          normalizeWorkspacePath(row.cwd) !== normalizedWorkspace ||
          row.first_user_message.trim() !== normalizedMessage ||
          !existsSync(row.rollout_path)
        ) {
          continue;
        }

        return {
          providerSessionId: row.id,
          rawStoreRef: row.rollout_path
        };
      }
    } catch {
      return null;
    } finally {
      db?.close();
    }

    return null;
  }

  private getCodexHomeDir(homeDirOverride: string | null = null): string {
    return (
      homeDirOverride?.trim()
      || this.options.homeDir?.trim()
      || process.env.CODINGNS_CODEX_HOME
      || join(homedir(), ".codex")
    );
  }

  private buildMessage(
    context: ActiveTurnContext,
    input: {
      timestamp: string;
      role: NormalizedMessage["role"];
      kind: NormalizedMessage["kind"];
      content: string;
      toolCall?: NormalizedToolCall | null;
      stableIdentity?: string | null;
    }
  ): NormalizedMessage {
    const stableRef = this.resolveStableMessageRef(context, input.stableIdentity ?? null);
    const rawRef =
      stableRef?.rawRef ??
      createRawRef(
        this.providerId,
        context.rawStoreRef,
        ++context.sequence
      );
    const sequence = stableRef?.sequence ?? context.sequence;
    const messageId = stableRef?.messageId ?? messageIdFromRawRef(rawRef);

    return {
      messageId,
      provider: this.providerId,
      providerSessionId: context.providerSessionId,
      role: input.role,
      kind: input.kind,
      content: input.content,
      toolCall: input.toolCall ?? null,
      timestamp: input.timestamp,
      sequence,
      rawRef
    };
  }

  private resolveStableMessageRef(
    context: ActiveTurnContext,
    stableIdentity: string | null
  ): CodexStableMessageRef | null {
    if (!stableIdentity) {
      return null;
    }

    const existing = context.stableMessageRefByIdentity.get(stableIdentity);

    if (existing) {
      return existing;
    }

    context.sequence += 1;
    const rawRef = createRawRef(this.providerId, context.rawStoreRef, context.sequence);
    const created: CodexStableMessageRef = {
      sequence: context.sequence,
      rawRef,
      messageId: messageIdFromStableKey(buildCodexStableMessageKey(context.providerSessionId, stableIdentity))
    };
    context.stableMessageRefByIdentity.set(stableIdentity, created);
    return created;
  }

  private async awaitThreadStarted(
    thread: CodexThread,
    events: AsyncIterator<unknown>,
    workspacePath: string,
    firstUserMessage: string,
    launchedAtMs: number
  ): Promise<{ providerSessionId: string; bufferedEvents: unknown[] }> {
    const bufferedEvents: unknown[] = [];

    while (true) {
      const next = await events.next();

      if (next.done) {
        const resolved = await this.resolveLaunchedSessionBinding(
          workspacePath,
          firstUserMessage,
          launchedAtMs
        );

        if (resolved) {
          return {
            providerSessionId: resolved.providerSessionId,
            bufferedEvents
          };
        }

        throw new Error("CODEX_THREAD_START_MISSING");
      }

      const eventType = ensureText(readProp(next.value, "type")).trim();

      if (eventType === "thread.started") {
        const providerSessionId = pickFirstNonEmpty(
          ensureText(readProp(next.value, "thread_id")).trim(),
          ensureText(thread.id).trim()
        );

        if (providerSessionId.length === 0) {
          throw new Error("CODEX_THREAD_ID_MISSING");
        }

        return {
          providerSessionId,
          bufferedEvents
        };
      }

      bufferedEvents.push(next.value);

      const resolved = await this.resolveLaunchedSessionBinding(
        workspacePath,
        firstUserMessage,
        launchedAtMs
      );

      if (resolved) {
        return {
          providerSessionId: resolved.providerSessionId,
          bufferedEvents
        };
      }
    }
  }
}

function createCodexAppServerTransport(options: CodexRuntimeOptions): CodexAppServerTransport {
  const commandPath = resolveCodexCommand(options.commandPath);
  const launch = resolveCodexCommandLaunch(commandPath, ["app-server"]);
  const runtimeEnv = options.runtimeEnv ?? null;
  const child: ChildProcessWithoutNullStreams = spawn(launch.command, launch.args, {
    env: {
      ...process.env,
      ...(runtimeEnv ?? {})
    },
    stdio: ["pipe", "pipe", "pipe"],
    shell: launch.shell,
    windowsHide: true
  });
  const stdout = createInterface({ input: child.stdout });
  let notificationHandler: (notification: Record<string, unknown>) => void | Promise<void> = () => undefined;
  let serverRequestHandler: (request: Record<string, unknown>) => Promise<unknown> = async () => {
    throw new Error("CODEX_APP_SERVER_REQUEST_NOT_SUPPORTED");
  };
  let requestSequence = 0;
  let closed = false;
  let activeTurnId: string | null = null;
  let activeThreadId: string | null = null;
  let closeHandler: ((error: Error | null) => void) | null = null;
  const pendingResponses = new Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();

  const finalize = (error: Error | null) => {
    if (closed) {
      return;
    }

    closed = true;
    stdout.close();

    for (const pending of pendingResponses.values()) {
      pending.reject(error ?? new Error("CODEX_APP_SERVER_CLOSED"));
    }
    pendingResponses.clear();

    closeHandler?.(error);
  };

  child.on("error", (error: Error) => {
    finalize(error);
  });
  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    if (closed) {
      return;
    }

    const detail = signal
      ? `codex app-server exited with signal ${signal}`
      : `codex app-server exited with code ${String(code ?? "unknown")}`;
    finalize(new Error(detail));
  });

  stdout.on("line", (line: string) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof parsed.method === "string" && parsed.id !== undefined) {
      void Promise.resolve(serverRequestHandler(parsed))
        .then((result) => {
          writeJsonRpcMessage(child, {
            jsonrpc: "2.0",
            id: parsed.id,
            result
          });
        })
        .catch((error) => {
          writeJsonRpcMessage(child, {
            jsonrpc: "2.0",
            id: parsed.id,
            error: {
              code: -32000,
              message: error instanceof Error ? error.message : "CODEX_APP_SERVER_REQUEST_FAILED"
            }
          });
        });
      return;
    }

    if (typeof parsed.method === "string") {
      const method = parsed.method.trim();
      const params = readJsonRpcParams(parsed);

      if (method === "turn/started") {
        activeTurnId = ensureText(readProp(readProp(params, "turn"), "id")).trim() || activeTurnId;
      }

      if (method === "thread/started") {
        activeThreadId = ensureText(readProp(readProp(params, "thread"), "id")).trim() || activeThreadId;
      }

      void notificationHandler({
        method,
        params
      });
      return;
    }

    const responseId = String(parsed.id ?? "");
    const pending = pendingResponses.get(responseId);

    if (!pending) {
      return;
    }

    pendingResponses.delete(responseId);

    if (parsed.error && typeof parsed.error === "object") {
      const message = ensureText(readProp(parsed.error, "message")).trim() || "CODEX_APP_SERVER_ERROR";
      pending.reject(new Error(message));
      return;
    }

    pending.resolve(readJsonRpcResult(parsed));
  });

  return {
    async initialize() {
      const startedAtMs = performance.now();
      await sendJsonRpcRequest(child, pendingResponses, () => nextJsonRpcId("initialize", () => ++requestSequence), {
        method: "initialize",
        params: {
          clientInfo: {
            name: "codingns-runtime",
            version: "0.0.0"
          },
          capabilities: null
        }
      });
      writeJsonRpcMessage(child, {
        jsonrpc: "2.0",
        method: "initialized",
        params: {}
      });
      logCodexRuntimeStep("transport.initialize", startedAtMs);
    },
    async startThread(request) {
      const startedAtMs = performance.now();
      const result = await sendJsonRpcRequest(
        child,
        pendingResponses,
        () => nextJsonRpcId("thread-start", () => ++requestSequence),
        {
          method: "thread/start",
          params: createThreadStartParams(request)
        }
      );
      const thread = toRecord(result.thread);
      const providerSessionId = ensureText(thread?.id).trim();

      if (!providerSessionId) {
        throw new Error("CODEX_APP_SERVER_THREAD_ID_MISSING");
      }

      activeThreadId = providerSessionId;
      logCodexRuntimeStep("transport.thread_start", startedAtMs, {
        sessionId: request.sessionId,
        providerSessionId
      });

      return {
        providerSessionId,
        rawStoreRef: normalizeText(thread?.path) || null
      };
    },
    async resumeThread(request, providerSessionId) {
      const startedAtMs = performance.now();
      const result = await sendJsonRpcRequest(
        child,
        pendingResponses,
        () => nextJsonRpcId("thread-resume", () => ++requestSequence),
        {
          method: "thread/resume",
          params: createThreadResumeParams(request, providerSessionId)
        }
      );
      const thread = toRecord(result.thread);
      activeThreadId = ensureText(thread?.id).trim() || providerSessionId;
      logCodexRuntimeStep("transport.thread_resume", startedAtMs, {
        sessionId: request.sessionId,
        providerSessionId: activeThreadId
      });

      return {
        providerSessionId: activeThreadId,
        rawStoreRef: normalizeText(thread?.path) || null
      };
    },
    async resumeThreadFromHistory(input) {
      const startedAtMs = performance.now();
      const result = await sendJsonRpcRequest(
        child,
        pendingResponses,
        () => nextJsonRpcId("thread-resume-history", () => ++requestSequence),
        {
          method: "thread/resume",
          params: createThreadResumeWithHistoryParams(input)
        }
      );
      const thread = toRecord(result.thread);
      const providerSessionId = ensureText(thread?.id).trim();

      if (!providerSessionId) {
        throw new Error("CODEX_APP_SERVER_THREAD_ID_MISSING");
      }

      activeThreadId = providerSessionId;
      logCodexRuntimeStep("transport.thread_resume_from_history", startedAtMs, {
        providerSessionId
      });

      return {
        providerSessionId,
        rawStoreRef: normalizeText(thread?.path) || null
      };
    },
    async startTurn(request, providerSessionId) {
      const startedAtMs = performance.now();
      const result = await sendJsonRpcRequest(
        child,
        pendingResponses,
        () => nextJsonRpcId("turn-start", () => ++requestSequence),
        {
          method: "turn/start",
          params: createTurnStartParams(request, providerSessionId)
        }
      );
      const turn = toRecord(result.turn);
      activeTurnId = ensureText(readProp(turn, "id")).trim() || activeTurnId;
      logCodexRuntimeStep("transport.turn_start", startedAtMs, {
        sessionId: request.sessionId,
        providerSessionId,
        turnId: activeTurnId
      });

      return {
        notification: buildCodexTurnCompletionNotification(turn, providerSessionId)
      };
    },
    async steerTurn(options) {
      if (!activeThreadId || !activeTurnId) {
        throw new Error("SESSION_NOT_RUNNING");
      }

      try {
        const result = await sendJsonRpcRequest(
          child,
          pendingResponses,
          () => nextJsonRpcId("turn-steer", () => ++requestSequence),
          {
            method: "turn/steer",
            params: createTurnSteerParams(activeThreadId, activeTurnId, options)
          }
        );
        const turnId = ensureText(readProp(result, "turnId")).trim();

        if (turnId) {
          activeTurnId = turnId;
        }

        return {
          turnId: turnId || activeTurnId
        };
      } catch (error) {
        throw normalizeCodexTurnSteerError(error);
      }
    },
    async interruptTurn() {
      if (!activeThreadId || !activeTurnId) {
        return;
      }

      await sendJsonRpcRequest(
        child,
        pendingResponses,
        () => nextJsonRpcId("turn-interrupt", () => ++requestSequence),
        {
          method: "turn/interrupt",
          params: {
            threadId: activeThreadId,
            turnId: activeTurnId
          }
        }
      );
    },
    setNotificationHandler(handler) {
      notificationHandler = handler;
    },
    setServerRequestHandler(handler) {
      serverRequestHandler = handler;
    },
    setOnClose(handler: ((error: Error | null) => void) | null): void {
      closeHandler = handler;
    },
    isClosed() {
      return closed;
    },
    close() {
      if (closed) {
        return;
      }

      finalize(null);

      if (!child.stdin.destroyed) {
        child.stdin.end();
      }

      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };
}

function buildCodexTurnCompletionNotification(
  turn: Record<string, unknown> | null,
  threadId: string
): Record<string, unknown> | null {
  const status = ensureText(readProp(turn, "status")).trim();

  if (status !== "completed" && status !== "failed" && status !== "interrupted") {
    return null;
  }

  return {
    method: "turn/completed",
    params: {
      threadId,
      turn
    }
  };
}

function createAsyncEventQueue(): {
  iterator: AsyncIterator<unknown>;
  push(value: unknown): void;
  close(): void;
  setTurnId(turnId: string): void;
  getTurnId(): string | null;
} {
  const values: unknown[] = [];
  const waiters: Array<(result: IteratorResult<unknown>) => void> = [];
  let closed = false;
  let turnId: string | null = null;

  return {
    iterator: {
      next() {
        if (values.length > 0) {
          return Promise.resolve({
            done: false,
            value: values.shift()
          });
        }

        if (closed) {
          return Promise.resolve({
            done: true,
            value: undefined
          });
        }

        return new Promise((resolve) => {
          waiters.push(resolve);
        });
      }
    },
    push(value) {
      if (closed) {
        return;
      }

      const waiter = waiters.shift();

      if (waiter) {
        waiter({
          done: false,
          value
        });
        return;
      }

      values.push(value);
    },
    close() {
      if (closed) {
        return;
      }

      closed = true;

      while (waiters.length > 0) {
        waiters.shift()?.({
          done: true,
          value: undefined
        });
      }
    },
    setTurnId(nextTurnId) {
      turnId = nextTurnId;
    },
    getTurnId() {
      return turnId;
    }
  };
}

function createCodexTranslatedNotificationForwarder(eventQueue: {
  push(value: unknown): void;
  close(): void;
  setTurnId(turnId: string): void;
}): (translated: {
  events: Record<string, unknown>[];
  terminal: boolean;
  turnId: string | null;
}) => void {
  const seenReplayKeys = new Set<string>();

  return (translated) => {
    if (translated.turnId) {
      eventQueue.setTurnId(translated.turnId);
    }

    for (const event of translated.events) {
      const replayKey = buildCodexTranslatedReplayKey(event);

      if (replayKey) {
        if (seenReplayKeys.has(replayKey)) {
          continue;
        }

        seenReplayKeys.add(replayKey);

        while (seenReplayKeys.size > 1024) {
          const oldest = seenReplayKeys.keys().next().value;

          if (typeof oldest !== "string") {
            break;
          }

          seenReplayKeys.delete(oldest);
        }
      }

      eventQueue.push(event);
    }

    if (translated.terminal) {
      eventQueue.close();
    }
  };
}

function buildCodexTranslatedReplayKey(event: Record<string, unknown>): string | null {
  const eventType = ensureText(event.type).trim();

  if (!eventType) {
    return null;
  }

  if (eventType === "turn.completed" || eventType === "turn.failed" || eventType === "turn.interrupted") {
    return `${eventType}:${ensureText(readProp(event, "turnId")).trim() || ""}`;
  }

  if (!eventType.startsWith("item.")) {
    return null;
  }

  const item = toRecord(readProp(event, "item"));

  if (!item) {
    return null;
  }

  return JSON.stringify({
    eventType,
    itemType: ensureText(item.type).trim(),
    id: ensureText(item.id).trim(),
    status: ensureText(item.status).trim(),
    text: ensureText(item.text).trim(),
    summary: normalizeReplayKeyText(readProp(item, "summary")),
    content: normalizeReplayKeyText(readProp(item, "content")),
    command: normalizeReplayKeyText(readProp(item, "command")),
    result: normalizeReplayKeyText(readProp(item, "result")),
    output: normalizeReplayKeyText(readProp(item, "output")),
    aggregatedOutput: normalizeReplayKeyText(readProp(item, "aggregated_output")),
    error: normalizeReplayKeyText(readProp(item, "error"))
  });
}

function normalizeReplayKeyText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeReplayKeyText(entry)).join("\n");
  }

  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return ensureText(value).trim();
}

function createCodexAppServerNotificationTranslator(): (
  notification: Record<string, unknown>
) => {
  events: Record<string, unknown>[];
  terminal: boolean;
  turnId: string | null;
} {
  const agentMessageTextById = new Map<string, string>();
  const reasoningSummaryPartsById = new Map<string, string[]>();
  const reasoningContentPartsById = new Map<string, string[]>();

  const resetStreamState = (): void => {
    agentMessageTextById.clear();
    reasoningSummaryPartsById.clear();
    reasoningContentPartsById.clear();
  };

  const ensureIndexedTextPart = (
    store: Map<string, string[]>,
    itemId: string,
    index: number
  ): string[] | null => {
    if (!itemId || !Number.isInteger(index) || index < 0) {
      return null;
    }

    const existing = store.get(itemId) ?? [];

    while (existing.length <= index) {
      existing.push("");
    }

    store.set(itemId, existing);
    return existing;
  };

  const buildReasoningSyntheticItem = (itemId: string): Record<string, unknown> => {
    // 这里必须复制一份快照，不能把可变数组引用直接塞进事件队列。
    // 否则后续 delta 继续追加时，前一帧事件里的 summary/content 也会被同步改掉，
    // 最终所有帧都会看起来像“最后一帧”，下游稳定消息去重就会把中间增量吃掉。
    const summary = [...(reasoningSummaryPartsById.get(itemId) ?? [])];
    const content = [...(reasoningContentPartsById.get(itemId) ?? [])];

    return {
      type: "reasoning",
      id: itemId,
      summary,
      content
    };
  };

  const translateAgentMessageDelta = (params: Record<string, unknown>): {
    events: Record<string, unknown>[];
    terminal: boolean;
    turnId: string | null;
  } => {
    const itemId = ensureText(params.itemId).trim();
    const delta = ensureText(params.delta);

    if (!itemId || delta.length === 0) {
      return {
        events: [],
        terminal: false,
        turnId: ensureText(params.turnId).trim() || null
      };
    }

    const nextText = `${agentMessageTextById.get(itemId) ?? ""}${delta}`;
    agentMessageTextById.set(itemId, nextText);

    return {
      events: [
        {
          type: "item.updated",
          item: {
            type: "agent_message",
            id: itemId,
            text: nextText
          },
          timestamp: nextTimestamp()
        }
      ],
      terminal: false,
      turnId: ensureText(params.turnId).trim() || null
    };
  };

  const translateReasoningSummaryPartAdded = (params: Record<string, unknown>): {
    events: Record<string, unknown>[];
    terminal: boolean;
    turnId: string | null;
  } => {
    const itemId = ensureText(params.itemId).trim();
    const summaryIndex = Math.trunc(Number(params.summaryIndex));
    ensureIndexedTextPart(reasoningSummaryPartsById, itemId, summaryIndex);

    return {
      events: [],
      terminal: false,
      turnId: ensureText(params.turnId).trim() || null
    };
  };

  const translateReasoningSummaryTextDelta = (params: Record<string, unknown>): {
    events: Record<string, unknown>[];
    terminal: boolean;
    turnId: string | null;
  } => {
    const itemId = ensureText(params.itemId).trim();
    const summaryIndex = Math.trunc(Number(params.summaryIndex));
    const delta = ensureText(params.delta);
    const parts = ensureIndexedTextPart(reasoningSummaryPartsById, itemId, summaryIndex);

    if (!parts || delta.length === 0) {
      return {
        events: [],
        terminal: false,
        turnId: ensureText(params.turnId).trim() || null
      };
    }

    parts[summaryIndex] = `${parts[summaryIndex] ?? ""}${delta}`;

    return {
      events: [
        {
          type: "item.updated",
          item: buildReasoningSyntheticItem(itemId),
          timestamp: nextTimestamp()
        }
      ],
      terminal: false,
      turnId: ensureText(params.turnId).trim() || null
    };
  };

  const translateReasoningTextDelta = (params: Record<string, unknown>): {
    events: Record<string, unknown>[];
    terminal: boolean;
    turnId: string | null;
  } => {
    const itemId = ensureText(params.itemId).trim();
    const contentIndex = Math.trunc(Number(params.contentIndex));
    const delta = ensureText(params.delta);
    const parts = ensureIndexedTextPart(reasoningContentPartsById, itemId, contentIndex);

    if (!parts || delta.length === 0) {
      return {
        events: [],
        terminal: false,
        turnId: ensureText(params.turnId).trim() || null
      };
    }

    parts[contentIndex] = `${parts[contentIndex] ?? ""}${delta}`;

    return {
      events: [
        {
          type: "item.updated",
          item: buildReasoningSyntheticItem(itemId),
          timestamp: nextTimestamp()
        }
      ],
      terminal: false,
      turnId: ensureText(params.turnId).trim() || null
    };
  };

  return (notification) => {
    const method = ensureText(notification.method).trim();
    const params = toRecord(notification.params) ?? {};

    if (method === "turn/started") {
      return {
        events: [],
        terminal: false,
        turnId: ensureText(readProp(readProp(params, "turn"), "id")).trim() || null
      };
    }

    if (method === "turn/completed") {
      const turn = toRecord(params.turn);
      const status = ensureText(turn?.status).trim();
      const itemEvents = translateCodexAppServerTurnItems(turn, "item.completed");

      resetStreamState();

      if (status === "failed") {
        return {
          events: [
            ...itemEvents,
            {
              type: "turn.failed",
              timestamp: nextTimestamp(),
              error: ensureText(readProp(turn?.error, "message")).trim() || "codex turn failed"
            }
          ],
          terminal: true,
          turnId: ensureText(turn?.id).trim() || null
        };
      }

      if (status === "interrupted") {
        return {
          events: [
            ...itemEvents,
            {
              type: "turn.interrupted",
              timestamp: nextTimestamp()
            }
          ],
          terminal: true,
          turnId: ensureText(turn?.id).trim() || null
        };
      }

      return {
        events: [
          ...itemEvents,
          {
            type: "turn.completed",
            timestamp: nextTimestamp()
          }
        ],
        terminal: true,
        turnId: ensureText(turn?.id).trim() || null
      };
    }

    if (method === "error") {
      const error = toRecord(params.error);
      const detail = buildCodexAppServerErrorDetail(error);

      if (params.willRetry === true) {
        return {
          events: [],
          terminal: false,
          turnId: ensureText(params.turnId).trim() || null
        };
      }

      resetStreamState();

      return {
        events: [
          {
            type: "turn.failed",
            timestamp: nextTimestamp(),
            error: detail
          }
        ],
        terminal: true,
        turnId: ensureText(params.turnId).trim() || null
      };
    }

    if (method === "item/agentMessage/delta") {
      return translateAgentMessageDelta(params);
    }

    if (method === "item/reasoning/summaryPartAdded") {
      return translateReasoningSummaryPartAdded(params);
    }

    if (method === "item/reasoning/summaryTextDelta") {
      return translateReasoningSummaryTextDelta(params);
    }

    if (method === "item/reasoning/textDelta") {
      return translateReasoningTextDelta(params);
    }

    if (method === "item/started" || method === "item/updated" || method === "item/completed") {
      const item = translateCodexAppServerItem(toRecord(params.item));

      if (!item) {
        return {
          events: [],
          terminal: false,
          turnId: null
        };
      }

      if (ensureText(item.type).trim() === "agent_message") {
        const itemId = ensureText(item.id).trim();
        const itemText = ensureText(item.text);

        if (itemId) {
          if (itemText.length > 0) {
            agentMessageTextById.set(itemId, itemText);
          } else if (method === "item/completed") {
            agentMessageTextById.delete(itemId);
          }
        }
      }

      if (ensureText(item.type).trim() === "reasoning") {
        const itemId = ensureText(item.id).trim();

        if (itemId) {
          const summary =
            Array.isArray(item.summary)
              ? item.summary.map((entry) => ensureText(entry))
              : ensureText(item.summary).trim()
                ? [ensureText(item.summary)]
                : [];
          const content =
            Array.isArray(item.content)
              ? item.content.map((entry) => ensureText(entry))
              : ensureText(item.text).trim()
                ? [ensureText(item.text)]
                : [];

          if (summary.length > 0) {
            reasoningSummaryPartsById.set(itemId, summary);
          } else if (method === "item/completed") {
            reasoningSummaryPartsById.delete(itemId);
          }

          if (content.length > 0) {
            reasoningContentPartsById.set(itemId, content);
          } else if (method === "item/completed") {
            reasoningContentPartsById.delete(itemId);
          }
        }
      }

      return {
        events: [
          {
            type:
              method === "item/started"
                ? "item.started"
                : method === "item/updated"
                  ? "item.updated"
                  : "item.completed",
            item,
            timestamp: nextTimestamp()
          }
        ],
        terminal: false,
        turnId: null
      };
    }

    return {
      events: [],
      terminal: false,
      turnId: null
    };
  };
}

function translateCodexAppServerTurnItems(
  turn: Record<string, unknown> | null,
  eventType: "item.completed"
): Record<string, unknown>[] {
  const rawItems = Array.isArray(turn?.items) ? turn.items : [];
  const translatedItems = rawItems
    .map((item) => translateCodexAppServerItem(toRecord(item)))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item) => ({
      type: eventType,
      item,
      timestamp: nextTimestamp()
    }));

  if (translatedItems.length > 0) {
    return translatedItems;
  }

  const lastAgentMessage = normalizeCodexTurnLastAgentMessage(turn);

  if (!lastAgentMessage) {
    return [];
  }

  return [
    {
      type: eventType,
      item: {
        type: "agent_message",
        id: ensureText(turn?.id).trim() || "turn-final-message",
        text: lastAgentMessage
      },
      timestamp: nextTimestamp()
    }
  ];
}

function normalizeCodexTurnLastAgentMessage(turn: Record<string, unknown> | null): string | null {
  const candidate =
    readProp(turn, "lastAgentMessage")
    ?? readProp(turn, "last_agent_message")
    ?? readProp(turn, "lastMessage")
    ?? readProp(turn, "last_message");

  if (typeof candidate === "string") {
    const normalized = candidate.trim();
    return normalized.length > 0 ? normalized : null;
  }

  const record = toRecord(candidate);

  if (!record) {
    return null;
  }

  const content = pickFirstNonEmpty(
    ensureText(record.text).trim(),
    extractTextBlocks(readProp(record, "content")).trim(),
    ensureText(readProp(record, "message")).trim()
  );

  return content.length > 0 ? content : null;
}

function buildCodexAppServerErrorDetail(error: Record<string, unknown> | null): string {
  const message = ensureText(error?.message).trim();
  const additionalDetails = ensureText(error?.additionalDetails).trim();

  if (message && additionalDetails && !message.includes(additionalDetails)) {
    return `${message}\n${additionalDetails}`;
  }

  return message || additionalDetails || "codex app-server error";
}

function buildCodexMessageSignature(message: NormalizedMessage): string {
  return JSON.stringify({
    role: message.role,
    kind: message.kind,
    content: message.content,
    toolCall: message.toolCall
      ? {
          callId: message.toolCall.callId,
          name: message.toolCall.name,
          input: message.toolCall.input,
          output: message.toolCall.output,
          error: message.toolCall.error,
          status: message.toolCall.status
        }
      : null
  });
}

function translateCodexAppServerItem(item: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!item) {
    return null;
  }

  const itemType = ensureText(item.type).trim();

  if (!itemType) {
    return null;
  }

  if (itemType === "agentMessage") {
    return {
      type: "agent_message",
      id: item.id,
      text: ensureText(item.text).trim()
    };
  }

  if (itemType === "reasoning") {
    return {
      type: "reasoning",
      id: item.id,
      text: Array.isArray(item.content) ? item.content.join("\n") : ensureText(item.text).trim(),
      summary: Array.isArray(item.summary) ? item.summary.join("\n") : ensureText(item.summary).trim()
    };
  }

  if (itemType === "commandExecution") {
    const patchText = extractApplyPatchTextFromCommandLikeValues(item.command);

    if (patchText) {
      return {
        type: "custom_tool_call",
        id: item.id,
        tool: "apply_patch",
        input: patchText,
        output: item.aggregatedOutput,
        error: item.error,
        status: normalizeCodexItemStatus(item.status)
      };
    }

    return {
      type: "command_execution",
      id: item.id,
      command: item.command,
      cwd: item.cwd,
      status: normalizeCodexItemStatus(item.status),
      commandActions: item.commandActions,
      aggregated_output: item.aggregatedOutput,
      exit_code: item.exitCode
    };
  }

  if (itemType === "fileChange") {
    const diffText = buildCodexFileChangeOutput(item.changes);

    return {
      type: "custom_tool_call",
      id: item.id,
      tool: "apply_patch",
      input: diffText,
      output: diffText,
      status: normalizeCodexItemStatus(item.status)
    };
  }

  if (itemType === "mcpToolCall") {
    return {
      type: "mcp_tool_call",
      id: item.id,
      tool: item.tool,
      server: item.server,
      arguments: item.arguments,
      result: item.result,
      error: item.error,
      status: normalizeCodexItemStatus(item.status)
    };
  }

  if (itemType === "dynamicToolCall") {
    const toolName = ensureText(item.tool).trim();
    const patchText = isCodexExecCommandToolName(toolName)
      ? extractApplyPatchTextFromCommandLikeValues(item.arguments)
      : null;

    return {
      type: "custom_tool_call",
      id: item.id,
      tool: patchText ? "apply_patch" : item.tool,
      input: patchText ?? item.arguments,
      output: item.contentItems,
      success: item.success,
      status: normalizeCodexItemStatus(item.status)
    };
  }

  return null;
}

export function createThreadOptions(request: ProviderRuntimeRunRequest): Record<string, unknown> {
  const options: Record<string, unknown> = {
    workingDirectory: request.workspacePath,
    skipGitRepoCheck: true,
    ...createCodexThreadPermissionOptions(request.options.permissionMode ?? "default")
  };

  if (request.options.model) {
    options.model = request.options.model;
  }

  const reasoningEffort = normalizeCodexReasoningEffort(request.options.reasoningLevel);

  if (reasoningEffort) {
    options.modelReasoningEffort = reasoningEffort;
  }

  const additionalDirectories = Array.from(
    new Set(
      request.options.attachments.map((attachment) => dirname(attachment.filePath))
    )
  );

  if (additionalDirectories.length > 0) {
    options.additionalDirectories = additionalDirectories;
  }

  return options;
}

function createThreadStartParams(request: ProviderRuntimeRunRequest): Record<string, unknown> {
  const permissionOptions = createCodexThreadPermissionOptions(request.options.permissionMode ?? "default");
  const params: Record<string, unknown> = {
    cwd: request.workspacePath,
    approvalsReviewer: "user"
  };

  if (permissionOptions.approvalPolicy) {
    params.approvalPolicy = permissionOptions.approvalPolicy;
  }


  if (request.options.model) {
    params.model = request.options.model;
  }

  return params;
}

function createThreadResumeParams(
  request: ProviderRuntimeRunRequest,
  providerSessionId: string
): Record<string, unknown> {
  const permissionOptions = createCodexThreadPermissionOptions(request.options.permissionMode ?? "default");
  const params: Record<string, unknown> = {
    threadId: providerSessionId,
    cwd: request.workspacePath,
    approvalsReviewer: "user"
  };

  if (permissionOptions.approvalPolicy) {
    params.approvalPolicy = permissionOptions.approvalPolicy;
  }


  if (request.options.model) {
    params.model = request.options.model;
  }

  return params;
}

function createThreadResumeWithHistoryParams(input: {
  providerSessionId?: string | null;
  workspacePath: string;
  history: unknown[];
  model?: string | null;
}): Record<string, unknown> {
  const params: Record<string, unknown> = {
    threadId:
      input.providerSessionId && input.providerSessionId.trim().length > 0
        ? input.providerSessionId.trim()
        : "__history_resume__",
    cwd: input.workspacePath,
    history: input.history,
    approvalsReviewer: "user"
  };

  if (input.model) {
    params.model = input.model;
  }

  return params;
}

function createTurnStartParams(
  request: ProviderRuntimeRunRequest,
  providerSessionId: string
): Record<string, unknown> {
  const permissionOptions = createCodexThreadPermissionOptions(request.options.permissionMode ?? "default");
  const params: Record<string, unknown> = {
    threadId: providerSessionId,
    input: createCodexAppServerInput(request),
    cwd: request.workspacePath,
    approvalsReviewer: "user"
  };

  if (permissionOptions.approvalPolicy) {
    params.approvalPolicy = permissionOptions.approvalPolicy;
  }

  if (request.options.model) {
    params.model = request.options.model;
  }

  const reasoningEffort = normalizeCodexReasoningEffort(request.options.reasoningLevel);

  if (reasoningEffort) {
    params.effort = reasoningEffort;
  }

  return params;
}

function createTurnSteerParams(
  providerSessionId: string,
  activeTurnId: string,
  options: RuntimeSendOptions
): Record<string, unknown> {
  return {
    threadId: providerSessionId,
    expectedTurnId: activeTurnId,
    input: createCodexAppServerInputFromOptions(options)
  };
}

function normalizeCodexReasoningEffort(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? null;

  if (!normalized) {
    return null;
  }

  if (normalized === "maximum") {
    return "xhigh";
  }

  if (
    normalized === "minimal" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "xhigh"
  ) {
    return normalized;
  }

  return null;
}

function createCodexInput(request: ProviderRuntimeRunRequest): CodexRuntimeInput {
  if (request.options.attachments.length === 0) {
    return request.options.content;
  }

  const input: CodexRuntimeInput = [];
  const promptText = request.options.content.trim();

  if (promptText.length > 0) {
    input.push({
      type: "text",
      text: promptText
    });
  }

  request.options.attachments.forEach((attachment) => {
    if (attachment.kind !== "image") {
      return;
    }

    input.push({
      type: "local_image",
      path: attachment.filePath
    });
  });

  return input;
}

function createCodexAppServerInput(request: ProviderRuntimeRunRequest): Array<Record<string, unknown>> {
  return createCodexAppServerInputFromOptions(request.options);
}

function createCodexAppServerInputFromOptions(
  options: Pick<RuntimeSendOptions, "content" | "providerPrompt" | "attachments">
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  const promptText = (options.providerPrompt ?? options.content).trim();

  if (promptText.length > 0) {
    input.push({
      type: "text",
      text: promptText
    });
  }

  for (const attachment of options.attachments) {
    if (attachment.kind !== "image") {
      continue;
    }

    input.push({
      type: "localImage",
      path: attachment.filePath
    });
  }

  return input;
}

function normalizeCodexTurnSteerError(error: unknown): Error {
  const detail = error instanceof Error ? error.message.trim() : String(error).trim();
  const normalized = detail.toLowerCase();

  if (
    normalized.includes("method not found")
    || (normalized.includes("turn/steer") && normalized.includes("not found"))
    || normalized.includes("unknown method")
  ) {
    return new Error("IN_RUN_INPUT_NOT_SUPPORTED");
  }

  if (
    normalized.includes("expectedturnid")
    || normalized.includes("active turn")
    || normalized.includes("turn mismatch")
    || normalized.includes("no active turn")
    || normalized.includes("not running")
  ) {
    return new Error("SESSION_NOT_RUNNING");
  }

  return error instanceof Error ? error : new Error(detail || "CODEX_TURN_STEER_FAILED");
}

async function loadCodexClient(): Promise<CodexSdkClient> {
  const moduleName = "@openai/codex-sdk";
  const runtimeImport = new Function(
    "name",
    "return import(name);"
  ) as (name: string) => Promise<unknown>;
  const resolvedModuleName = resolveCodexSdkModuleSpecifier(moduleName);
  const module = (await runtimeImport(resolvedModuleName)) as Partial<CodexSdkModule>;

  if (!module.Codex) {
    throw new Error("CODEX_SDK_UNAVAILABLE");
  }

  return new module.Codex();
}

function resolveCodexSdkModuleSpecifier(moduleName: string): string {
  const localSdkEntry = findNodeModulesFile(
    dirname(fileURLToPath(import.meta.url)),
    ["@openai", "codex-sdk", "dist", "index.js"]
  );

  if (localSdkEntry) {
    return pathToFileURL(localSdkEntry).href;
  }

  if (typeof import.meta.resolve === "function") {
    return import.meta.resolve(moduleName);
  }

  return moduleName;
}

function findNodeModulesFile(startDirectory: string, relativeSegments: string[]): string | null {
  let currentDirectory = startDirectory;

  while (true) {
    const candidate = resolveNodeModulesCandidate(currentDirectory, relativeSegments);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return null;
    }

    currentDirectory = parentDirectory;
  }
}

function resolveNodeModulesCandidate(currentDirectory: string, relativeSegments: string[]): string {
  if (basename(currentDirectory) === "node_modules") {
    return resolve(currentDirectory, ...relativeSegments);
  }

  return resolve(currentDirectory, "node_modules", ...relativeSegments);
}

function buildRuntimeRawStoreRef(providerSessionId: string): string {
  return resolve(process.cwd(), "runtime", "codex", `${providerSessionId}.stream`);
}

function pickAvailableCodexRawStoreRef(
  providerSessionId: string,
  candidates: Array<string | null | undefined>,
  fallbackRawStoreRef: string
): string {
  const normalizedProviderSessionId = providerSessionId.trim();
  const normalizedCandidates: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = candidate?.trim();

    if (!normalized || seen.has(normalized) || !existsSync(normalized)) {
      continue;
    }

    seen.add(normalized);
    normalizedCandidates.push(normalized);
  }

  if (!normalizedProviderSessionId) {
    return normalizedCandidates[0] ?? fallbackRawStoreRef;
  }

  for (const candidate of normalizedCandidates) {
    if (readSessionMeta(candidate)?.threadId === normalizedProviderSessionId) {
      return candidate;
    }
  }

  for (const candidate of normalizedCandidates) {
    if (doesRawStorePathLookLikeThread(candidate, normalizedProviderSessionId)) {
      return candidate;
    }
  }

  for (const candidate of normalizedCandidates) {
    if (isSyntheticRawStoreRef(candidate)) {
      return candidate;
    }
  }

  for (const candidate of normalizedCandidates) {
    if (!readSessionMeta(candidate)) {
      return candidate;
    }
  }

  return fallbackRawStoreRef;
}

function doesRawStorePathLookLikeThread(rawStoreRef: string, providerSessionId: string): boolean {
  const fileName = basename(rawStoreRef, ".jsonl").trim().toLowerCase();
  const normalizedProviderSessionId = providerSessionId.trim().toLowerCase();

  if (!fileName || !normalizedProviderSessionId) {
    return false;
  }

  return fileName === normalizedProviderSessionId || fileName.includes(normalizedProviderSessionId);
}

function resolveRuntimeStoreKey(providerSessionId: string, sessionId: string): string {
  return providerSessionId.trim() || sessionId;
}

function resolveCodexCommand(explicitPath?: string): string {
  const explicitCandidate =
    explicitPath?.trim() ||
    process.env.CODINGNS_CODEX_COMMAND?.trim() ||
    "codex";

  return explicitCandidate;
}

function resolveCodexCommandLaunch(
  commandPath: string,
  args: readonly string[]
): {
  command: string;
  args: string[];
  shell: boolean;
} {
  const normalizedCommandPath = commandPath.trim();

  if (isNodeScriptPath(normalizedCommandPath)) {
    return {
      command: process.execPath,
      args: [normalizedCommandPath, ...args],
      shell: false
    };
  }

  return {
    command: normalizedCommandPath,
    args: [...args],
    shell: shouldSpawnViaShellOnWindows(normalizedCommandPath)
  };
}

function isNodeScriptPath(commandPath: string): boolean {
  return /\.(?:c|m)?js$/i.test(commandPath);
}

function shouldSpawnViaShellOnWindows(commandPath: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  if (/\.(cmd|bat)$/i.test(commandPath)) {
    return true;
  }

  // Windows 上裸名命令（无扩展名、无路径分隔符）需要 shell 才能从 PATH 解析 .cmd 文件
  const extension = commandPath.split(".").pop()?.toLowerCase();
  const hasPathSep = commandPath.includes("\\") || commandPath.includes("/");
  if (!extension || extension === commandPath.toLowerCase()) {
    if (!hasPathSep) {
      return true;
    }
  }

  return false;
}

function nextJsonRpcId(prefix: string, allocate: () => number): string {
  return `${prefix}:${allocate()}`;
}

function writeJsonRpcMessage(
  child: ReturnType<typeof spawn>,
  payload: Record<string, unknown>
): void {
  if (!child.stdin || child.stdin.destroyed || !child.stdin.writable) {
    throw new Error("CODEX_APP_SERVER_STDIN_UNAVAILABLE");
  }

  child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8");
}

function sendJsonRpcRequest(
  child: ReturnType<typeof spawn>,
  pendingResponses: Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >,
  createRequestId: () => string,
  input: {
    method: string;
    params: Record<string, unknown>;
  }
): Promise<Record<string, unknown>> {
  const id = createRequestId();

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingResponses.delete(id);
      reject(new Error("SERVER_TIMEOUT"));
    }, CODEX_APP_SERVER_REQUEST_TIMEOUT_MS);

    pendingResponses.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    });

    try {
      writeJsonRpcMessage(child, {
        jsonrpc: "2.0",
        id,
        method: input.method,
        params: input.params
      });
    } catch (error) {
      clearTimeout(timeout);
      pendingResponses.delete(id);
      reject(error instanceof Error ? error : new Error("CODEX_APP_SERVER_REQUEST_WRITE_FAILED"));
    }
  });
}

function readJsonRpcParams(parsed: Record<string, unknown>): Record<string, unknown> {
  return toRecord(parsed.params) ?? {};
}

function readJsonRpcResult(parsed: Record<string, unknown>): Record<string, unknown> {
  return toRecord(parsed.result) ?? {};
}

function resolveResumeThreadId(
  providerSessionId: string | null,
  rawStoreRef: string | null
): string | null {
  const normalizedProviderSessionId = ensureText(providerSessionId).trim();

  if (normalizedProviderSessionId.length > 0) {
    return normalizedProviderSessionId;
  }

  const fromRawStore = readThreadIdFromRawStore(rawStoreRef);

  if (fromRawStore) {
    return fromRawStore;
  }

  return null;
}

function buildSyntheticResumeHistory(rawStoreRef: string | null): Array<Record<string, unknown>> {
  const filePath = ensureText(rawStoreRef).trim();

  if (!filePath || !existsSync(filePath)) {
    return [];
  }

  const threadId = readThreadIdFromRawStore(filePath);

  if (!threadId || looksLikeCodexThreadId(threadId)) {
    return [];
  }

  return buildCodexResumeHistoryFromRawStore(filePath);
}

function shouldFallbackCodexContinueFromHistory(
  error: unknown,
  history: unknown[]
): boolean {
  if (history.length === 0) {
    return false;
  }

  return isCodexThreadLoadError(error) || isCodexRequestTimeoutError(error);
}

function isCodexThreadLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toLowerCase();

  return (
    normalized.includes("thread not loaded") ||
    normalized.includes("no rollout found for thread id")
  );
}

function isCodexRequestTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message === "SERVER_TIMEOUT";
}

function readProp(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    return null;
  }

  return (value as Record<string, unknown>)[key];
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function ensureText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeText(value: unknown): string | null {
  const normalized = ensureText(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function readThreadIdFromRawStore(rawStoreRef: string | null): string | null {
  const filePath = ensureText(rawStoreRef).trim();

  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  const firstLine = readFileSync(filePath, "utf8")
    .split(/\r?\n/, 1)
    .at(0)
    ?.trim();

  if (!firstLine) {
    return null;
  }

  try {
    const record = JSON.parse(firstLine) as {
      type?: unknown;
      payload?: {
        id?: unknown;
      };
    };

    if (ensureText(record.type).trim() !== "session_meta") {
      return null;
    }

    const threadId = ensureText(record.payload?.id).trim();

    return threadId.length > 0 ? threadId : null;
  } catch {
    return null;
  }
}

function looksLikeCodexThreadId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function readSessionMeta(filePath: string): { threadId: string; cwd: string | null } | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const firstLine = readFileSync(filePath, "utf8")
    .split(/\r?\n/, 1)
    .at(0)
    ?.trim();

  if (!firstLine) {
    return null;
  }

  try {
    const record = JSON.parse(firstLine) as {
      type?: unknown;
      payload?: {
        id?: unknown;
        cwd?: unknown;
      };
    };

    if (ensureText(record.type).trim() !== "session_meta") {
      return null;
    }

    const metaThreadId = ensureText(record.payload?.id).trim();
    const fileThreadId = basename(filePath, ".jsonl").trim();
    const threadId = looksLikeCodexThreadId(metaThreadId)
      ? metaThreadId
      : looksLikeCodexThreadId(fileThreadId)
        ? fileThreadId
        : metaThreadId;

    if (!threadId) {
      return null;
    }

    const cwdText = ensureText(record.payload?.cwd).trim();

    return {
      threadId,
      cwd: cwdText.length > 0 ? cwdText : null
    };
  } catch {
    return null;
  }
}

function isSyntheticRawStoreRef(rawStoreRef: string): boolean {
  const normalized = rawStoreRef.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("/runtime/codex/") || normalized.startsWith("runtime/codex/");
}

function walkJsonlFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const queue = [rootDir];
  const files: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile() && basename(fullPath).endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function findLatestCodexStateDatabase(homeDir: string): string | null {
  if (!existsSync(homeDir)) {
    return null;
  }

  const candidates = readdirSync(homeDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/i.test(entry.name))
    .map((entry) => {
      const filePath = join(homeDir, entry.name);

      return {
        filePath,
        mtimeMs: statSync(filePath).mtimeMs
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0]?.filePath ?? null;
}

function pickTimestamp(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const raw = ensureText(readProp(candidate, "timestamp")).trim();

    if (raw.length > 0) {
      return raw;
    }
  }

  return nextTimestamp();
}

function pickFirstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

function isToolItem(itemType: string): boolean {
  return (
    itemType === "command_execution" ||
    itemType === "file_change" ||
    itemType === "mcp_tool_call" ||
    itemType === "function_call" ||
    itemType === "custom_tool_call" ||
    itemType === "commandExecution" ||
    itemType === "fileChange" ||
    itemType === "mcpToolCall" ||
    itemType === "dynamicToolCall"
  );
}

function inferToolSuccess(item: unknown, output: string): boolean {
  const status = ensureText(readProp(item, "status")).trim().toLowerCase();

  if (status === "failed" || status === "error") {
    return false;
  }

  const lowered = output.toLowerCase();

  if (lowered.includes("apply_patch was requested via exec_command")) {
    return false;
  }

  if (status === "completed" || status === "success" || status === "succeeded") {
    return true;
  }

  const exitCode = readProp(item, "exit_code");

  if (typeof exitCode === "number") {
    return exitCode === 0;
  }

  if (lowered.includes("error")) {
    return false;
  }

  return true;
}

function classifyCodexRuntimeFailure(error: unknown): { errorCode: string; detail: string } {
  const detail = error instanceof Error ? error.message : "codex runtime error";

  if (detail.includes("PROVIDER_SESSION_ID_REQUIRED")) {
    return {
      errorCode: "CODEX_PROVIDER_SESSION_ID_REQUIRED",
      detail
    };
  }

  if (detail.includes("Cannot find package") || detail.includes("ERR_MODULE_NOT_FOUND")) {
    return {
      errorCode: "CODEX_RUNTIME_SDK_MISSING",
      detail
    };
  }

  if (detail.includes("ENOENT") || detail.includes("spawn")) {
    return {
      errorCode: "CODEX_CLI_LAUNCH_FAILED",
      detail
    };
  }

  return {
    errorCode: classifyCodexDetailErrorCode(detail, "CODEX_RUNTIME_ERROR"),
    detail
  };
}

function classifyCodexDetailErrorCode(detail: string, fallback: string): string {
  const normalized = detail.trim();

  if (!normalized) {
    return fallback;
  }

  const statusMatch =
    normalized.match(/\bstatus\s+(\d{3})\b/i)
    ?? normalized.match(/\bHTTP\s+(\d{3})\b/i)
    ?? normalized.match(
      /\b(\d{3})\s+(?:Bad Gateway|Too Many Requests|Gateway Timeout|Service Unavailable)\b/i
    );

  if (!statusMatch) {
    return fallback;
  }

  return `CODEX_HTTP_${statusMatch[1]}`;
}

function persistSyntheticUserMessageIfNeeded(
  rawStoreRef: string,
  providerSessionId: string,
  input: {
    workspacePath: string;
    content: string;
    timestamp: string;
  }
): void {
  if (!isSyntheticRawStoreRef(rawStoreRef) || input.content.trim().length === 0) {
    return;
  }

  ensureSyntheticRuntimeFile(rawStoreRef, providerSessionId, input.workspacePath, input.timestamp);
  appendJsonLine(rawStoreRef, {
    timestamp: input.timestamp,
    type: "event_msg",
    payload: {
      type: "user_message",
      message: input.content
    }
  });
}

function persistSyntheticEventIfNeeded(
  rawStoreRef: string,
  providerSessionId: string,
  event: unknown
): void {
  if (!isSyntheticRawStoreRef(rawStoreRef)) {
    return;
  }

  const serialized = toSyntheticRuntimeRecord(event, providerSessionId);

  if (!serialized) {
    return;
  }

  ensureSyntheticRuntimeFile(rawStoreRef, providerSessionId, null, serialized.timestamp);
  appendJsonLine(rawStoreRef, serialized.record);
}

function ensureSyntheticRuntimeFile(
  rawStoreRef: string,
  providerSessionId: string,
  workspacePath: string | null,
  timestamp: string
): void {
  if (existsSync(rawStoreRef)) {
    return;
  }

  ensureDirectory(dirname(rawStoreRef));
  appendJsonLine(rawStoreRef, {
    timestamp,
    type: "session_meta",
    payload: {
      id: providerSessionId,
      timestamp,
      cwd: workspacePath ?? "",
      originator: "CodingNS Runtime",
      source: "codingns-runtime"
    }
  });
}

function toSyntheticRuntimeRecord(
  event: unknown,
  providerSessionId: string
): { timestamp: string; record: Record<string, unknown> } | null {
  const eventType = ensureText(readProp(event, "type")).trim();
  const timestamp = pickTimestamp(event);

  if (eventType === "turn.completed") {
    return {
      timestamp,
      record: {
        timestamp,
        type: "event_msg",
        payload: {
          type: "task_complete"
        }
      }
    };
  }

  if (eventType === "turn.failed") {
    return {
      timestamp,
      record: {
        timestamp,
        type: "event_msg",
        payload: {
          type: "task_failed",
          error: extractTextBlocks(readProp(event, "error")).trim()
        }
      }
    };
  }

  if (!eventType.startsWith("item.")) {
    return null;
  }

  const item = readProp(event, "item");
  const itemType = ensureText(readProp(item, "type")).trim();

  if (itemType.length === 0) {
    return null;
  }

  if (itemType === "agent_message" && eventType === "item.completed") {
    const content = pickFirstNonEmpty(
      ensureText(readProp(item, "text")).trim(),
      extractTextBlocks(readProp(item, "content")).trim()
    );

    if (content.length === 0) {
      return null;
    }

    return {
      timestamp,
      record: {
        timestamp,
        type: "event_msg",
        payload: {
          type: "agent_message",
          id: ensureText(readProp(item, "id")).trim() || undefined,
          message: content
        }
      }
    };
  }

  if (itemType === "reasoning" && eventType === "item.completed") {
    const content = pickFirstNonEmpty(
      ensureText(readProp(item, "text")).trim(),
      extractTextBlocks(readProp(item, "summary")).trim(),
      extractTextBlocks(readProp(item, "content")).trim()
    );

    if (content.length === 0) {
      return null;
    }

    return {
      timestamp,
      record: {
        timestamp,
        type: "event_msg",
        payload: {
          type: "agent_reasoning",
          id: ensureText(readProp(item, "id")).trim() || undefined,
          text: content
        }
      }
    };
  }

  if (!isToolItem(itemType)) {
    return null;
  }

  const callId = pickFirstNonEmpty(
    ensureText(readProp(item, "id")).trim(),
    ensureText(readProp(item, "call_id")).trim(),
    `${itemType}-${providerSessionId}`
  );
  const name = pickFirstNonEmpty(
    ensureText(readProp(item, "name")).trim(),
    ensureText(readProp(item, "tool")).trim(),
    itemType
  );

  if (eventType === "item.started") {
    const input = resolveCodexToolInput(name, item);

    return {
      timestamp,
      record: {
        timestamp,
        type: "response_item",
        payload: {
          type: mapToolStartItemType(itemType),
          call_id: callId,
          name,
          arguments: input,
          input
        }
      }
    };
  }

  if (eventType !== "item.completed") {
    return null;
  }

  const output = pickFirstNonEmpty(
    extractTextBlocks(readProp(item, "result")).trim(),
    extractTextBlocks(readProp(item, "output")).trim(),
    extractTextBlocks(readProp(item, "aggregated_output")).trim(),
    extractTextBlocks(readProp(item, "error")).trim()
  );

  return {
    timestamp,
    record: {
      timestamp,
      type: "response_item",
      payload: {
        type: mapToolResultItemType(itemType),
        call_id: callId,
        name,
        output,
        status: inferToolSuccess(item, output) ? "completed" : "failed"
      }
    }
  };
}

function mapToolStartItemType(itemType: string): string {
  return itemType === "custom_tool_call" ? "custom_tool_call" : "function_call";
}

function mapToolResultItemType(itemType: string): string {
  return itemType === "custom_tool_call" ? "custom_tool_call_output" : "function_call_output";
}

function buildCodexStableMessageKey(providerSessionId: string, stableIdentity: string): string {
  return `codex:${providerSessionId}:${stableIdentity}`;
}

function normalizeCodexItemStatus(value: unknown): string {
  const normalized = ensureText(value).trim();

  if (!normalized) {
    return "in_progress";
  }

  if (normalized === "inProgress") {
    return "running";
  }

  if (normalized === "declined") {
    return "failed";
  }

  return normalized;
}

function buildCodexFileChangeOutput(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  const structuredPatch = buildApplyPatchFromFileChangeList(
    value.map((change) => {
      const record = toRecord(change);

      return {
        path: ensureText(record?.path).trim() || null,
        kind: ensureText(record?.kind).trim() || null
      };
    })
  );

  if (structuredPatch) {
    return structuredPatch;
  }

  return value
    .map((change) => {
      const record = toRecord(change);

      if (!record) {
        return "";
      }

      const diff = ensureText(record.diff).trim();

      if (diff.length > 0) {
        return diff;
      }

      const path = ensureText(record.path).trim();
      return path.length > 0 ? `Updated ${path}` : "";
    })
    .filter((entry) => entry.length > 0)
    .join("\n\n");
}

function isCodexExecCommandToolName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "exec_command" ||
    normalized === "shell_command" ||
    normalized === "command_execution"
  );
}

function extractApplyPatchTextFromCommandLikeValues(value: unknown): string | null {
  return buildApplyPatchFromCodexCommandLikeValue(value);
}

function resolveCodexToolInput(name: string, item: unknown): string {
  const rawInput = pickFirstNonEmpty(
    extractTextBlocks(readProp(item, "arguments")).trim(),
    extractTextBlocks(readProp(item, "input")).trim(),
    extractTextBlocks(readProp(item, "command")).trim()
  );

  if (name.trim().toLowerCase() !== "apply_patch") {
    return rawInput;
  }

  return (
    normalizeApplyPatchText(rawInput, {
      fallbackPaths: collectCodexApplyPatchFallbackPaths(item)
    }) ?? rawInput
  );
}

function collectCodexApplyPatchFallbackPaths(item: unknown): string[] {
  const directPaths = [
    ensureText(readProp(item, "path")).trim(),
    ensureText(readProp(item, "filePath")).trim(),
    ensureText(readProp(item, "file_path")).trim()
  ].filter((value) => value.length > 0);

  const rawChanges = readProp(item, "changes");
  const changes: unknown[] = Array.isArray(rawChanges) ? rawChanges : [];
  const changePaths = changes
    .map((change) => ensureText(readProp(change, "path")).trim())
    .filter((value) => value.length > 0);

  const outputText = pickFirstNonEmpty(
    extractTextBlocks(readProp(item, "result")).trim(),
    extractTextBlocks(readProp(item, "output")).trim(),
    extractTextBlocks(readProp(item, "aggregated_output")).trim(),
    extractTextBlocks(readProp(item, "error")).trim()
  );

  return [
    ...new Set([
      ...directPaths,
      ...changePaths,
      ...extractApplyPatchTargetPathsFromToolOutput(outputText)
    ])
  ];
}
