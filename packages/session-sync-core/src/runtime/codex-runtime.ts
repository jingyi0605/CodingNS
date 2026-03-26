import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  appendJsonLine,
  createRawRef,
  ensureDirectory,
  extractTextBlocks,
  messageIdFromRawRef,
  nextTimestamp,
  normalizeWorkspacePath
} from "../providers/utils.js";
import { createCodexThreadPermissionOptions } from "./codex-permissions.js";
import type { NormalizedMessage, NormalizedToolCall, ProviderId } from "../types.js";
import type {
  ProviderRuntimeAdapter,
  ProviderRuntimeEventSink,
  ProviderRuntimeLaunchResult,
  ProviderRuntimeRunRequest
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
  sequence: number;
  toolNameByCallId: Map<string, string>;
  sink: ProviderRuntimeEventSink;
  workspacePath: string;
  firstUserMessage: string;
  launchedAtMs: number;
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
}

export class CodexRuntimeAdapter implements ProviderRuntimeAdapter {
  readonly providerId: ProviderId = "codex";

  constructor(private readonly options: CodexRuntimeOptions = {}) {}

  async startSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult> {
    const launchedAtMs = Date.now();
    const client = await loadCodexClient();
    const thread = client.startThread(createThreadOptions(request));
    const abortController = new AbortController();
    const streamed = await thread.runStreamed(createCodexInput(request), {
      signal: abortController.signal
    });
    const events = streamed.events[Symbol.asyncIterator]();
    const startedSession = await this.awaitThreadStarted(
      thread,
      events,
      request.workspacePath,
      request.options.content,
      launchedAtMs
    );
    const providerSessionId = startedSession.providerSessionId;
    const fallbackRawStoreRef =
      request.rawStoreRef ?? buildRuntimeRawStoreRef(resolveRuntimeStoreKey(providerSessionId, request.sessionId));
    const resolvedBinding = await this.resolveExistingSessionBinding(
      providerSessionId,
      fallbackRawStoreRef,
      request.workspacePath
    );
    const rawStoreRef = resolvedBinding?.rawStoreRef ?? fallbackRawStoreRef;

    sink.updateSessionBinding({
      providerSessionId,
      rawStoreRef
    });

    return {
      providerSessionId,
      rawStoreRef,
      interrupt: async () => {
        abortController.abort();
      },
      completed: this.runTurn(
        null,
        request,
        sink,
        providerSessionId,
        rawStoreRef,
        abortController,
        events,
        startedSession.bufferedEvents,
        launchedAtMs
      )
    };
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

    const client = await loadCodexClient();
    const thread = client.resumeThread(providerSessionId, createThreadOptions(request));
    const fallbackRawStoreRef = request.rawStoreRef ?? buildRuntimeRawStoreRef(providerSessionId);
    const resolvedBinding = await this.resolveExistingSessionBinding(
      providerSessionId,
      fallbackRawStoreRef,
      request.workspacePath
    );
    const resolvedSessionId = resolvedBinding?.providerSessionId ?? providerSessionId;
    const rawStoreRef = resolvedBinding?.rawStoreRef ?? fallbackRawStoreRef;
    const abortController = new AbortController();

    sink.updateSessionBinding({
      providerSessionId: resolvedSessionId,
      rawStoreRef
    });

    return {
      providerSessionId: resolvedSessionId,
      rawStoreRef,
      interrupt: async () => {
        abortController.abort();
      },
      completed: this.runTurn(
        thread,
        request,
        sink,
        resolvedSessionId,
        rawStoreRef,
        abortController,
        undefined,
        [],
        Date.now()
      )
    };
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
    launchedAtMs = Date.now()
  ): Promise<void> {
    const context: ActiveTurnContext = {
      providerSessionId,
      rawStoreRef,
      sequence: 0,
      toolNameByCallId: new Map(),
      sink,
      workspacePath: request.workspacePath,
      firstUserMessage: request.options.content,
      launchedAtMs
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
        errorCode: "CODEX_CLI_TURN_FAILED",
        detail,
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

    if (itemType === "agent_message" && eventType === "item.completed") {
      const content = pickFirstNonEmpty(
        ensureText(readProp(item, "text")).trim(),
        extractTextBlocks(readProp(item, "content")).trim()
      );

      if (content.length > 0) {
        await context.sink.emit({
          type: "message",
          message: this.buildMessage(request, context, {
            role: "assistant",
            kind: "text",
            content
          }),
          providerSessionId: context.providerSessionId,
          rawStoreRef: context.rawStoreRef,
          timestamp: pickTimestamp(item, event)
        });
      }

      return;
    }

    if (itemType === "reasoning" && eventType === "item.completed") {
      const content = pickFirstNonEmpty(
        ensureText(readProp(item, "text")).trim(),
        extractTextBlocks(readProp(item, "summary")).trim(),
        extractTextBlocks(readProp(item, "content")).trim()
      );

      if (content.length > 0) {
        await context.sink.emit({
          type: "message",
          message: this.buildMessage(request, context, {
            role: "assistant",
            kind: "thinking",
            content
          }),
          providerSessionId: context.providerSessionId,
          rawStoreRef: context.rawStoreRef,
          timestamp: pickTimestamp(item, event)
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
      const input = pickFirstNonEmpty(
        extractTextBlocks(readProp(item, "arguments")).trim(),
        extractTextBlocks(readProp(item, "input")).trim(),
        extractTextBlocks(readProp(item, "command")).trim()
      );
      const toolCall: NormalizedToolCall = {
        callId,
        name,
        input,
        output: null,
        error: null,
        status: "running"
      };
      context.toolNameByCallId.set(callId, name);

      await context.sink.emit({
        type: "message",
        message: this.buildMessage(request, context, {
          role: "tool",
          kind: "tool_call",
          content: input,
          toolCall
        }),
        providerSessionId: context.providerSessionId,
        rawStoreRef: context.rawStoreRef,
        timestamp: pickTimestamp(item, event)
      });
      return;
    }

    if (eventType === "item.completed") {
      const output = pickFirstNonEmpty(
        extractTextBlocks(readProp(item, "result")).trim(),
        extractTextBlocks(readProp(item, "output")).trim(),
        extractTextBlocks(readProp(item, "aggregated_output")).trim(),
        extractTextBlocks(readProp(item, "error")).trim()
      );
      const success = inferToolSuccess(item, output);
      const knownName = context.toolNameByCallId.get(callId) ?? name;
      const toolCall: NormalizedToolCall = {
        callId,
        name: knownName,
        input: "",
        output: success ? output : null,
        error: success ? null : output,
        status: success ? "completed" : "failed"
      };

      await context.sink.emit({
        type: "message",
        message: this.buildMessage(request, context, {
          role: "tool",
          kind: "tool_result",
          content: output,
          toolCall
        }),
        providerSessionId: context.providerSessionId,
        rawStoreRef: context.rawStoreRef,
        timestamp: pickTimestamp(item, event)
      });
    }
  }

  private async refreshSessionBindingIfNeeded(context: ActiveTurnContext): Promise<void> {
    if (!isSyntheticRawStoreRef(context.rawStoreRef)) {
      return;
    }

    const resolved =
      await this.resolveExistingSessionBinding(
        context.providerSessionId,
        context.rawStoreRef,
        context.workspacePath
      ) ??
      await this.resolveLaunchedSessionBinding(
        context.workspacePath,
        context.firstUserMessage,
        context.launchedAtMs
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
    workspacePath: string
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
      workspacePath
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
    launchedAtMs: number
  ): Promise<{ providerSessionId: string; rawStoreRef: string } | null> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const matched = this.findLaunchedSessionBindingOnce(
        workspacePath,
        firstUserMessage,
        launchedAtMs
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
    workspacePath: string
  ): Promise<string | null> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const matched = this.findRawStoreRefOnce(providerSessionId, workspacePath);

      if (matched) {
        return matched;
      }

      if (attempt < 9) {
        await sleep(150);
      }
    }

    return null;
  }

  private findRawStoreRefOnce(providerSessionId: string, workspacePath: string): string | null {
    const homeDir = this.options.homeDir?.trim() || process.env.CODINGNS_CODEX_HOME || join(homedir(), ".codex");
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
    launchedAtMs: number
  ): { providerSessionId: string; rawStoreRef: string } | null {
    const dbPath = findLatestCodexStateDatabase(this.getCodexHomeDir());

    if (!dbPath) {
      return null;
    }

    let db: DatabaseSync | null = null;

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

  private getCodexHomeDir(): string {
    return this.options.homeDir?.trim() || process.env.CODINGNS_CODEX_HOME || join(homedir(), ".codex");
  }

  private buildMessage(
    request: ProviderRuntimeRunRequest,
    context: ActiveTurnContext,
    input: {
      role: NormalizedMessage["role"];
      kind: NormalizedMessage["kind"];
      content: string;
      toolCall?: NormalizedToolCall | null;
    }
  ): NormalizedMessage {
    context.sequence += 1;
    const rawRef = createRawRef(
      this.providerId,
      context.rawStoreRef,
      context.sequence
    );

    return {
      messageId: messageIdFromRawRef(rawRef),
      provider: this.providerId,
      providerSessionId: context.providerSessionId,
      role: input.role,
      kind: input.kind,
      content: input.content,
      toolCall: input.toolCall ?? null,
      timestamp: nextTimestamp(),
      sequence: context.sequence,
      rawRef
    };
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
    input.push({
      type: "local_image",
      path: attachment.filePath
    });
  });

  return input;
}

async function loadCodexClient(): Promise<CodexSdkClient> {
  const moduleName = "@openai/codex-sdk";
  const runtimeImport = new Function(
    "name",
    "return import(name);"
  ) as (name: string) => Promise<unknown>;
  const module = (await runtimeImport(moduleName)) as Partial<CodexSdkModule>;

  if (!module.Codex) {
    throw new Error("CODEX_SDK_UNAVAILABLE");
  }

  return new module.Codex();
}

function buildRuntimeRawStoreRef(providerSessionId: string): string {
  return resolve(process.cwd(), "runtime", "codex", `${providerSessionId}.stream`);
}

function resolveRuntimeStoreKey(providerSessionId: string, sessionId: string): string {
  return providerSessionId.trim() || sessionId;
}

function resolveResumeThreadId(
  providerSessionId: string | null,
  rawStoreRef: string | null
): string | null {
  const normalizedProviderSessionId = ensureText(providerSessionId).trim();
  const fromRawStore = readThreadIdFromRawStore(rawStoreRef);

  if (fromRawStore) {
    return fromRawStore;
  }

  if (normalizedProviderSessionId.length > 0) {
    return normalizedProviderSessionId;
  }

  return null;
}

function readProp(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    return null;
  }

  return (value as Record<string, unknown>)[key];
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
    itemType === "mcp_tool_call" ||
    itemType === "function_call" ||
    itemType === "custom_tool_call"
  );
}

function inferToolSuccess(item: unknown, output: string): boolean {
  const status = ensureText(readProp(item, "status")).trim().toLowerCase();

  if (status === "failed" || status === "error") {
    return false;
  }

  if (status === "completed" || status === "success" || status === "succeeded") {
    return true;
  }

  const exitCode = readProp(item, "exit_code");

  if (typeof exitCode === "number") {
    return exitCode === 0;
  }

  const lowered = output.toLowerCase();

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
    errorCode: "CODEX_RUNTIME_ERROR",
    detail
  };
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
    const input = pickFirstNonEmpty(
      extractTextBlocks(readProp(item, "arguments")).trim(),
      extractTextBlocks(readProp(item, "input")).trim(),
      extractTextBlocks(readProp(item, "command")).trim()
    );

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
