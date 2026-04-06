import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerProject, ButlerSessionSummaryState } from "../../types/domain.js";
import type { AuthUserRepository } from "../../storage/repositories/auth-user-repository.js";
import type { ButlerSessionRepository } from "../../storage/repositories/butler-session-repository.js";
import type { ButlerSessionSummaryStateRepository } from "../../storage/repositories/butler-session-summary-state-repository.js";
import type { SessionCheckpointRepository } from "../../storage/repositories/session-checkpoint-repository.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { ButlerProfileService } from "./butler-profile-service.js";
import { ensureButlerWorkspaceIsolation } from "./butler-profile-service.js";
import type { ButlerProjectService } from "./butler-project-service.js";
import type { ButlerProjectSessionView, ButlerSessionService } from "./butler-session-service.js";
import {
  ProviderAdapterRegistry,
  type PatrolSessionResult
} from "./provider-adapter-registry.js";
import {
  SessionSummaryInstructionAdapter
} from "./session-summary-instruction-adapter.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";

const DEFAULT_DEBOUNCE_MS = 300_000;
const DEFAULT_RECENT_MESSAGE_LIMIT = 40;

interface ButlerSessionSummaryLogger {
  error(message: string, detail?: unknown): void;
}

type SessionHistoryMessage = Awaited<
  ReturnType<SessionHistoryService["readSessionHistory"]>
>["messages"][number];

interface IncrementalHistoryResult {
  messages: SessionHistoryMessage[];
  latestSequence: number | null;
}

interface ButlerSessionSummaryServiceOptions {
  debounceMs?: number;
  recentMessageLimit?: number;
  now?: () => string;
  logger?: ButlerSessionSummaryLogger;
  summaryCodexHomeDir?: string | null;
  sourceCodexHomeDir?: string | null;
}

export class ButlerSessionSummaryService {
  private readonly debounceMs: number;
  private readonly recentMessageLimit: number;
  private readonly now: () => string;
  private readonly logger: ButlerSessionSummaryLogger;
  private readonly summaryCodexHomeDir: string | null;
  private readonly sourceCodexHomeDir: string | null;
  private readonly inFlightButlerSessionIds = new Set<string>();

  constructor(
    private readonly butlerProfileService: Pick<ButlerProfileService, "getProfile">,
    private readonly butlerProjectService: Pick<ButlerProjectService, "list">,
    private readonly butlerSessionService: Pick<
      ButlerSessionService,
      "ensureProjectSessionsSynced" | "listByProject"
    >,
    private readonly butlerSessionRepository: Pick<ButlerSessionRepository, "findById" | "update">,
    private readonly butlerSessionSummaryStateRepository: Pick<
      ButlerSessionSummaryStateRepository,
      "findByButlerSessionId" | "upsert"
    >,
    private readonly sessionCheckpointRepository: Pick<
      SessionCheckpointRepository,
      "create" | "getLatestSeq"
    >,
    private readonly sessionIndexRepository: Pick<SessionIndexRepository, "findIndexRecordBySessionId">,
    private readonly authUserRepository: Pick<AuthUserRepository, "listIds">,
    private readonly workspaceService: Pick<WorkspaceService, "importWorkspace">,
    private readonly sessionHistoryService: Pick<SessionHistoryService, "readSessionHistory">,
    private readonly providerAdapterRegistry: ProviderAdapterRegistry,
    private readonly instructionAdapter: SessionSummaryInstructionAdapter,
    options: ButlerSessionSummaryServiceOptions = {}
  ) {
    this.debounceMs = Math.max(5_000, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.recentMessageLimit = Math.max(10, options.recentMessageLimit ?? DEFAULT_RECENT_MESSAGE_LIMIT);
    this.now = options.now ?? nowIso;
    this.logger = options.logger ?? console;
    this.summaryCodexHomeDir = options.summaryCodexHomeDir ?? null;
    this.sourceCodexHomeDir = options.sourceCodexHomeDir ?? null;
  }

  async runOnce(): Promise<void> {
    const profile = this.butlerProfileService.getProfile();

    if (!profile) {
      return;
    }

    const userId = this.resolveExecutorUserId();

    if (!userId) {
      return;
    }

    ensureButlerWorkspaceIsolation(profile.workspacePath);
    this.workspaceService.importWorkspace(profile.workspacePath, "代码管家");
    this.syncSummaryInstructionFiles(profile.workspacePath, profile.providerId);
    const debounceMs = this.resolveDebounceMs(profile.focus.summaryDebounceSeconds);

    const projects = this.butlerProjectService.list({
      lifecycleStatus: "active"
    });

    for (const project of projects) {
      await this.butlerSessionService.ensureProjectSessionsSynced(project.id, userId);
      const sessions = this.butlerSessionService.listByProject(project.id, userId);

      for (const session of sessions) {
        await this.maybeSummarizeSession(
          project,
          session,
          userId,
          profile.providerId,
          profile.workspacePath,
          debounceMs
        );
      }
    }
  }

  private async maybeSummarizeSession(
    project: ButlerProject,
    session: ButlerProjectSessionView,
    userId: string,
    providerId: "codex" | "claude-code",
    summaryWorkspacePath: string,
    debounceMs: number
  ): Promise<void> {
    const index = this.sessionIndexRepository.findIndexRecordBySessionId(session.sessionId);

    if (!index || index.isArchived || index.isSubagent) {
      return;
    }

    const state = this.butlerSessionSummaryStateRepository.findByButlerSessionId(session.id);
    const sourceChanged =
      !state
      || state.sourceMessageCount !== index.messageCount
      || state.sourceLastMessageAt !== index.lastMessageAt;

    if (sourceChanged) {
      this.scheduleSession(state, session.id, index.messageCount, index.lastMessageAt, debounceMs);
      return;
    }

    if (!state || state.status !== "scheduled" || !state.debounceUntil || state.debounceUntil > this.now()) {
      return;
    }

    if (this.inFlightButlerSessionIds.has(session.id)) {
      return;
    }

    await this.summarizeSession(
      project,
      session,
      index.title,
      index.messageCount,
      index.lastMessageAt,
      userId,
      providerId,
      summaryWorkspacePath
    );
  }

  private scheduleSession(
    current: ButlerSessionSummaryState | null,
    butlerSessionId: string,
    sourceMessageCount: number,
    sourceLastMessageAt: string | null,
    debounceMs: number
  ): void {
    const timestamp = this.now();
    this.butlerSessionSummaryStateRepository.upsert({
      butlerSessionId,
      sourceMessageCount,
      sourceLastMessageAt,
      lastSummarizedAt: current?.lastSummarizedAt ?? null,
      lastSummarizedSequence: current?.lastSummarizedSequence ?? null,
      debounceUntil: new Date(Date.parse(timestamp) + debounceMs).toISOString(),
      status: "scheduled",
      errorDetail: null,
      updatedAt: timestamp
    });
  }

  private resolveDebounceMs(summaryDebounceSeconds: number): number {
    return Math.max(5_000, Math.trunc(summaryDebounceSeconds * 1_000 || this.debounceMs));
  }

  private async summarizeSession(
    project: ButlerProject,
    session: ButlerProjectSessionView,
    sessionTitle: string | null,
    sourceMessageCount: number,
    sourceLastMessageAt: string | null,
    userId: string,
    providerId: "codex" | "claude-code",
    summaryWorkspacePath: string
  ): Promise<void> {
    this.inFlightButlerSessionIds.add(session.id);
    const runningAt = this.now();
    const currentState = this.butlerSessionSummaryStateRepository.findByButlerSessionId(session.id);
    this.butlerSessionSummaryStateRepository.upsert({
      butlerSessionId: session.id,
      sourceMessageCount,
      sourceLastMessageAt,
      lastSummarizedAt: currentState?.lastSummarizedAt ?? null,
      lastSummarizedSequence: currentState?.lastSummarizedSequence ?? null,
      debounceUntil: currentState?.debounceUntil ?? null,
      status: "running",
      errorDetail: null,
      updatedAt: runningAt
    });

    try {
      const incrementalHistory = await this.collectIncrementalHistory(
        session.sessionId,
        currentState?.lastSummarizedSequence ?? null,
        userId
      );

      if (incrementalHistory.messages.length === 0 || incrementalHistory.latestSequence === null) {
        this.butlerSessionSummaryStateRepository.upsert({
          butlerSessionId: session.id,
          sourceMessageCount,
          sourceLastMessageAt,
          lastSummarizedAt: currentState?.lastSummarizedAt ?? null,
          lastSummarizedSequence: currentState?.lastSummarizedSequence ?? null,
          debounceUntil: null,
          status: "idle",
          errorDetail: null,
          updatedAt: this.now()
        });
        return;
      }

      const transcriptLines = incrementalHistory.messages
        .map((message) => renderHistoryLine(message.role, message.kind, message.timestamp, message.content));
      const instruction = this.instructionAdapter.buildInstruction({
        providerId,
        project,
        butlerSessionId: session.id,
        sessionId: session.sessionId,
        sessionTitle,
        lastMessageAt: sourceLastMessageAt,
        messageCount: sourceMessageCount,
        previousSummary: session.lastSummary,
        lastSummarizedSequence: currentState?.lastSummarizedSequence ?? null,
        transcriptLines
      });
      const adapter = this.providerAdapterRegistry.get(providerId);
      const summaryWorkspace = this.workspaceService.importWorkspace(
        summaryWorkspacePath,
        "代码管家"
      );
      const launch = await adapter.startPatrolSession({
        workspaceId: summaryWorkspace.id,
        userId,
        providerId,
        prompt: instruction.prompt,
        model: resolveSummaryModel(providerId),
        reasoningLevel: "low",
        permissionMode: "default"
      });

      await adapter.waitForSessionTerminal(launch.sessionId);
      const result = await adapter.readPatrolResult(launch.sessionId);
      this.persistSummary(
        session,
        sourceMessageCount,
        sourceLastMessageAt,
        incrementalHistory.latestSequence,
        result,
        runningAt
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.butlerSessionSummaryStateRepository.upsert({
        butlerSessionId: session.id,
        sourceMessageCount,
        sourceLastMessageAt,
        lastSummarizedAt: currentState?.lastSummarizedAt ?? null,
        lastSummarizedSequence: currentState?.lastSummarizedSequence ?? null,
        debounceUntil: null,
        status: "failed",
        errorDetail: detail,
        updatedAt: this.now()
      });
      this.logger.error("[butler-session-summary] summarize failed", {
        butlerSessionId: session.id,
        sessionId: session.sessionId,
        error: detail
      });
    } finally {
      this.inFlightButlerSessionIds.delete(session.id);
    }
  }

  private persistSummary(
    session: ButlerProjectSessionView,
    sourceMessageCount: number,
    sourceLastMessageAt: string | null,
    lastSummarizedSequence: number,
    result: PatrolSessionResult,
    startedAt: string
  ): void {
    const timestamp = this.now();
    const summary = result.structured.summary ?? result.latestAssistantMessage ?? "已尝试生成摘要，但未拿到有效结果";
    const progressState = result.structured.progressState ?? "unknown";
    const nextActions = dedupeItems([
      ...result.structured.nextActions,
      ...result.structured.suggestions
    ]).slice(0, 3);
    const riskFlags = dedupeItems(result.structured.riskFlags).slice(0, 4);
    const existing = this.butlerSessionRepository.findById(session.id);

    if (existing) {
      this.butlerSessionRepository.update({
        ...existing,
        status: resolveButlerSessionStatus(session.runningState, progressState),
        lastSummary: summary,
        lastCheckpointAt: timestamp,
        updatedAt: timestamp
      });
    }

    this.sessionCheckpointRepository.create({
      id: createId(),
      butlerSessionId: session.id,
      checkpointSeq: this.sessionCheckpointRepository.getLatestSeq(session.id) + 1,
      sourceKind: "summary",
      progressState,
      summary,
      riskFlags,
      nextActions,
      capturedAt: timestamp
    });
    this.butlerSessionSummaryStateRepository.upsert({
      butlerSessionId: session.id,
      sourceMessageCount,
      sourceLastMessageAt,
      lastSummarizedAt: timestamp,
      lastSummarizedSequence,
      debounceUntil: null,
      status: "idle",
      errorDetail: null,
      updatedAt: timestamp
    });

    if (timestamp < startedAt) {
      this.logger.error("[butler-session-summary] invalid clock order", {
        butlerSessionId: session.id,
        startedAt,
        finishedAt: timestamp
      });
    }
  }

  private resolveExecutorUserId(): string | null {
    return this.authUserRepository.listIds()[0] ?? null;
  }

  private async collectIncrementalHistory(
    sessionId: string,
    lastSummarizedSequence: number | null,
    userId: string
  ): Promise<IncrementalHistoryResult> {
    const collected = new Map<number, SessionHistoryMessage>();
    let cursor: string | null = null;
    let latestSequence: number | null = null;

    while (true) {
      const page = await this.sessionHistoryService.readSessionHistory(
        sessionId,
        cursor,
        this.recentMessageLimit,
        "backward",
        userId
      );
      const sortedMessages = page.messages
        .slice()
        .sort((left, right) => left.sequence - right.sequence);

      for (const message of sortedMessages) {
        if (latestSequence === null || message.sequence > latestSequence) {
          latestSequence = message.sequence;
        }

        if (lastSummarizedSequence !== null && message.sequence <= lastSummarizedSequence) {
          continue;
        }

        collected.set(message.sequence, message);
      }

      const reachedBoundary =
        lastSummarizedSequence !== null
        && sortedMessages.some((message) => message.sequence <= lastSummarizedSequence);

      if (reachedBoundary || !page.nextCursor) {
        break;
      }

      cursor = page.nextCursor;
    }

    return {
      messages: Array.from(collected.values()).sort((left, right) => left.sequence - right.sequence),
      latestSequence
    };
  }

  private syncSummaryInstructionFiles(
    workspacePath: string,
    providerId: "codex" | "claude-code"
  ): void {
    const summaryAgentsPath = path.join(workspacePath, "SUMMARY_AGENTS.md");
    writeFileIfChanged(
      summaryAgentsPath,
      [
        "# 代码管家后台摘要规则",
        "",
        "你现在不是面向用户的聊天助手，而是后台摘要器。",
        "你的唯一职责是把单个项目会话最近消息压缩成短摘要，供后续检索和聚合使用。",
        "禁止编造不存在的项目状态；信息不足时直接承认不足。",
        "输出语言必须是中文，先给摘要，再给结构化 JSON。"
      ].join("\n")
    );

    if (providerId === "codex") {
      syncCodexSummaryConfig(this.summaryCodexHomeDir, this.sourceCodexHomeDir, summaryAgentsPath);
    }
  }
}

function resolveSummaryModel(providerId: "codex" | "claude-code"): string {
  return providerId === "codex" ? "gpt-5.1-codex-mini" : "haiku";
}

function resolveButlerSessionStatus(
  runningState: ButlerProjectSessionView["runningState"],
  progressState: PatrolSessionResult["structured"]["progressState"]
): ButlerProjectSessionView["status"] {
  switch (runningState) {
    case "starting":
    case "running":
      return "running";
    case "failed":
    case "interrupted":
      return "blocked";
    default:
      return progressState === "blocked" ? "blocked" : "idle";
  }
}

function renderHistoryLine(
  role: string,
  kind: string,
  timestamp: string,
  content: string
): string {
  const compactContent = truncateText(
    content
      .replace(/\s+/g, " ")
      .trim(),
    kind === "tool_call" ? 220 : 360
  );

  return `[${timestamp}] ${role}/${kind}: ${compactContent || "（空内容）"}`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function dedupeItems(items: string[]): string[] {
  return Array.from(
    new Set(items.map((item) => item.trim()).filter((item) => item.length > 0))
  );
}

function syncCodexSummaryConfig(
  codexHomeDir: string | null,
  sourceCodexHomeDir: string | null,
  instructionFilePath: string
): void {
  if (!codexHomeDir?.trim()) {
    return;
  }

  const targetHomeDir = path.resolve(codexHomeDir);
  const sourceHomeDir = resolveSourceCodexHomeDir(sourceCodexHomeDir, targetHomeDir);
  const sourceConfigPath = path.join(sourceHomeDir, "config.toml");
  const sourceConfigContent =
    sourceHomeDir !== targetHomeDir && fs.existsSync(sourceConfigPath) && fs.statSync(sourceConfigPath).isFile()
      ? fs.readFileSync(sourceConfigPath, "utf8")
      : "";

  fs.mkdirSync(targetHomeDir, { recursive: true });
  syncOptionalFile(path.join(sourceHomeDir, "auth.json"), path.join(targetHomeDir, "auth.json"));
  writeFileIfChanged(
    path.join(targetHomeDir, "config.toml"),
    `${composeCodexConfigContent(sourceConfigContent, path.resolve(instructionFilePath))}\n`
  );
}

function resolveSourceCodexHomeDir(sourceCodexHomeDir: string | null, targetHomeDir: string): string {
  const configuredSource = sourceCodexHomeDir?.trim();

  if (configuredSource) {
    const resolvedConfiguredSource = path.resolve(configuredSource);

    if (resolvedConfiguredSource !== targetHomeDir) {
      return resolvedConfiguredSource;
    }
  }

  const fallbackHomeDir = path.resolve(path.join(os.homedir(), ".codex"));

  if (fallbackHomeDir !== targetHomeDir) {
    return fallbackHomeDir;
  }

  return targetHomeDir;
}

function composeCodexConfigContent(sourceConfigContent: string, instructionFilePath: string): string {
  const normalizedSource = sourceConfigContent
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("model_instructions_file");
    })
    .join("\n")
    .trim();

  return [
    "# 代码管家后台摘要专用 Codex 配置（系统自动生成）",
    normalizedSource,
    `model_instructions_file = ${toTomlString(instructionFilePath)}`
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function writeFileIfChanged(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
    return;
  }

  fs.writeFileSync(filePath, content, "utf8");
}

function syncOptionalFile(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return;
  }

  writeFileIfChanged(targetPath, fs.readFileSync(sourcePath, "utf8"));
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}
