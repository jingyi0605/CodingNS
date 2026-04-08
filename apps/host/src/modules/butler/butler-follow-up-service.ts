import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerFollowUpTask,
  ButlerFollowUpTaskStatus,
  ButlerProject,
  ButlerProfile,
  SessionRunningState
} from "../../types/domain.js";
import type { ButlerProfileService } from "./butler-profile-service.js";
import { ensureButlerWorkspaceIsolation } from "./butler-profile-service.js";
import type { ButlerProjectService } from "./butler-project-service.js";
import type { ButlerSessionService } from "./butler-session-service.js";
import type { ButlerFollowUpTaskRepository } from "../../storage/repositories/butler-follow-up-task-repository.js";
import type { SessionHistoryEnvelope, SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionIndexRepository } from "../../storage/repositories/session-index-repository.js";
import type { SessionMessageOriginRepository } from "../../storage/repositories/session-message-origin-repository.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import { ProviderAdapterRegistry, type PatrolSessionResult } from "./provider-adapter-registry.js";
import {
  ButlerFollowUpEvaluationInstructionAdapter,
  type ButlerFollowUpEvaluationDecision
} from "./butler-follow-up-evaluation-instruction-adapter.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";

const DEFAULT_CHECK_INTERVAL_SECONDS = 300;
const MIN_CHECK_INTERVAL_SECONDS = 60;
const MAX_CHECK_INTERVAL_SECONDS = 3600;
const FOLLOW_UP_EVALUATOR_DIRNAME = ".butler-follow-up-evaluator";
const RECENT_HISTORY_LIMIT = 40;

export interface ButlerFollowUpTaskView {
  id: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  butlerSessionId: string;
  sessionId: string;
  sessionTitle: string | null;
  objective: string;
  status: ButlerFollowUpTaskStatus;
  checkIntervalSeconds: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastObservedRunningState: SessionRunningState | null;
  lastObservedMessageAt: string | null;
  lastObservedMessageCount: number;
  lastAutomationSummary: string | null;
  lastAutomationAt: string | null;
  autoContinueCount: number;
  waitingReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateButlerFollowUpTaskInput {
  projectId: string;
  butlerSessionId: string;
  objective: string;
  checkIntervalSeconds?: number;
}

interface FollowUpTaskInspection {
  runningState: SessionRunningState | null;
  messageAt: string | null;
  messageCount: number;
  sessionTitle: string | null;
  latestAssistantText: string | null;
  transcriptLines: string[];
}

interface ButlerFollowUpEvaluationResult {
  decision: ButlerFollowUpEvaluationDecision;
  summary: string;
  waitingReason: string | null;
  continuePrompt: string | null;
  riskLevel: "low" | "medium" | "high" | null;
}

export class ButlerFollowUpService {
  constructor(
    private readonly butlerProfileService: Pick<ButlerProfileService, "ensureInitialized">,
    private readonly butlerProjectService: Pick<ButlerProjectService, "getById">,
    private readonly butlerSessionService: Pick<ButlerSessionService, "captureSessionSnapshot">,
    private readonly butlerFollowUpTaskRepository: ButlerFollowUpTaskRepository,
    private readonly sessionHistoryService: Pick<
      SessionHistoryService,
      "getSession" | "readRecentHistoryEnvelope"
    >,
    private readonly sessionIndexRepository: Pick<SessionIndexRepository, "findIndexRecordBySessionId">,
    private readonly sessionLiveRuntimeService: Pick<
      SessionLiveRuntimeService,
      "getSessionRuntime" | "sendLiveMessage"
    >,
    private readonly workspaceService: Pick<WorkspaceService, "importWorkspace">,
    private readonly providerAdapterRegistry: ProviderAdapterRegistry,
    private readonly instructionAdapter: ButlerFollowUpEvaluationInstructionAdapter,
    private readonly followUpCodexHomeDir: string | null = null,
    private readonly sourceCodexHomeDir: string | null = null,
    private readonly sessionMessageOriginRepository: Pick<SessionMessageOriginRepository, "upsert"> | null = null
  ) {}

  listTasks(filters: {
    statuses?: ButlerFollowUpTaskStatus[];
    projectId?: string;
    sessionId?: string;
    limit?: number;
  } = {}): ButlerFollowUpTaskView[] {
    this.butlerProfileService.ensureInitialized();

    return this.butlerFollowUpTaskRepository.list(filters).flatMap((task) => {
      const project = this.butlerProjectService.getById(task.projectId);
      const index = this.sessionIndexRepository.findIndexRecordBySessionId(task.sessionId);

      if (!project) {
        return [];
      }

      return [mapTaskView(task, project.workspaceId, project.name, index?.title ?? null)];
    });
  }

  getTask(taskId: string): ButlerFollowUpTaskView {
    this.butlerProfileService.ensureInitialized();
    const task = this.butlerFollowUpTaskRepository.findById(taskId);

    if (!task) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_FOLLOW_UP_TASK_NOT_FOUND",
        detail: "未找到对应的跟进任务"
      });
    }

    const project = this.butlerProjectService.getById(task.projectId);
    const index = this.sessionIndexRepository.findIndexRecordBySessionId(task.sessionId);

    return mapTaskView(task, project.workspaceId, project.name, index?.title ?? null);
  }

  async createTask(
    input: CreateButlerFollowUpTaskInput,
    userId: string
  ): Promise<ButlerFollowUpTaskView> {
    this.butlerProfileService.ensureInitialized();
    const project = this.butlerProjectService.getById(input.projectId);
    const objective = normalizeObjective(input.objective);
    const checkIntervalSeconds = normalizeCheckInterval(input.checkIntervalSeconds);
    const snapshot = this.butlerSessionService.captureSessionSnapshot(
      project.id,
      input.butlerSessionId,
      userId,
      { sourceKind: "manual" }
    );
    const existing = this.butlerFollowUpTaskRepository.findActiveByButlerSessionId(input.butlerSessionId);

    if (existing) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_FOLLOW_UP_TASK_EXISTS",
        detail: "当前会话已经有一个进行中的跟进任务"
      });
    }

    const session = this.sessionHistoryService.getSession(snapshot.sessionId, userId);
    const timestamp = nowIso();
    const task = this.butlerFollowUpTaskRepository.create({
      id: createId(),
      projectId: project.id,
      butlerSessionId: input.butlerSessionId,
      sessionId: snapshot.sessionId,
      createdByUserId: userId,
      objective,
      status: "active",
      checkIntervalSeconds,
      lastCheckedAt: null,
      nextCheckAt:
        snapshot.runningState === "starting" || snapshot.runningState === "running"
          ? shiftSeconds(timestamp, checkIntervalSeconds)
          : timestamp,
      lastObservedRunningState: snapshot.runningState,
      lastObservedMessageAt: session.lastMessageAt,
      lastObservedMessageCount: session.messageCount,
      lastAutomationSummary:
        snapshot.runningState === "starting" || snapshot.runningState === "running"
          ? "已开始跟进，先等待当前运行结束，再由后台评估助手决定下一步。"
          : "已开始跟进，准备由后台评估助手检查当前进展。",
      lastAutomationAt: null,
      autoContinueCount: 0,
      waitingReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null
    });

    const processed = await this.processTask(task.id);
    return mapTaskView(
      processed,
      project.workspaceId,
      project.name,
      session.title ?? null
    );
  }

  async runDueTasks(referenceAt = nowIso()): Promise<void> {
    const tasks = this.butlerFollowUpTaskRepository.list({
      statuses: ["active"],
      limit: 100
    });

    for (const task of tasks) {
      if (task.nextCheckAt && task.nextCheckAt > referenceAt) {
        continue;
      }

      await this.processTask(task.id, referenceAt);
    }
  }

  async processTask(taskId: string, referenceAt = nowIso()): Promise<ButlerFollowUpTask> {
    const task = this.butlerFollowUpTaskRepository.findById(taskId);

    if (!task) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_FOLLOW_UP_TASK_NOT_FOUND",
        detail: "未找到对应的跟进任务"
      });
    }

    if (task.status !== "active") {
      return task;
    }

    const profile = this.butlerProfileService.ensureInitialized();
    const project = this.butlerProjectService.getById(task.projectId);
    const inspection = await this.inspectTask(task);
    const runningState = normalizeRunningState(inspection.runningState);
    const baseUpdate: ButlerFollowUpTask = {
      ...task,
      lastCheckedAt: referenceAt,
      lastObservedRunningState: runningState,
      lastObservedMessageAt: inspection.messageAt,
      lastObservedMessageCount: inspection.messageCount,
      updatedAt: referenceAt
    };

    if (runningState === "starting" || runningState === "running") {
      return this.persist({
        ...baseUpdate,
        status: "active",
        waitingReason: null,
        nextCheckAt: shiftSeconds(referenceAt, task.checkIntervalSeconds),
        lastAutomationSummary: "会话仍在运行，助手继续观察当前进度。"
      });
    }

    try {
      const evaluation = await this.evaluateTask(profile, project, task, inspection, runningState);

      switch (evaluation.decision) {
        case "completed":
          return this.persist({
            ...baseUpdate,
            status: "completed",
            waitingReason: null,
            nextCheckAt: null,
            completedAt: referenceAt,
            lastAutomationAt: referenceAt,
            lastAutomationSummary: evaluation.summary
          });
        case "waiting_user":
          return this.persist({
            ...baseUpdate,
            status: "waiting_user",
            waitingReason: evaluation.waitingReason ?? evaluation.summary,
            nextCheckAt: null,
            completedAt: null,
            lastAutomationAt: referenceAt,
            lastAutomationSummary: evaluation.summary
          });
        case "failed":
          return this.persist({
            ...baseUpdate,
            status: "failed",
            waitingReason: evaluation.waitingReason ?? evaluation.summary,
            nextCheckAt: null,
            completedAt: null,
            lastAutomationAt: referenceAt,
            lastAutomationSummary: evaluation.summary
          });
        case "continue":
          if (!evaluation.continuePrompt) {
            return this.persist({
              ...baseUpdate,
              status: "failed",
              waitingReason: "后台评估助手没有返回可继续推进的指令。",
              nextCheckAt: null,
              completedAt: null,
              lastAutomationAt: referenceAt,
              lastAutomationSummary: evaluation.summary
            });
          }

          const clientRequestId = buildFollowUpClientRequestId(task.id, referenceAt);
          const result = await this.sessionLiveRuntimeService.sendLiveMessage({
            sessionId: task.sessionId,
            userId: task.createdByUserId,
            content: evaluation.continuePrompt,
            clientRequestId,
            runtimeOptions: {
              model: null,
              reasoningLevel: null,
              permissionMode: null,
              attachments: []
            }
          });
          this.sessionMessageOriginRepository?.upsert({
            sessionId: task.sessionId,
            clientRequestId,
            messageId: isSyntheticMessageId(result.message.messageId) ? null : result.message.messageId,
            origin: "butler_proxy",
            originRef: task.id,
            content: evaluation.continuePrompt,
            createdAt: result.acceptedAt,
            updatedAt: result.acceptedAt
          });

          this.butlerSessionService.captureSessionSnapshot(
            task.projectId,
            task.butlerSessionId,
            task.createdByUserId,
            { sourceKind: "manual" }
          );

          return this.persist({
            ...baseUpdate,
            status: "active",
            waitingReason: null,
            nextCheckAt: shiftSeconds(referenceAt, task.checkIntervalSeconds),
            lastAutomationAt: referenceAt,
            autoContinueCount: task.autoContinueCount + 1,
            lastAutomationSummary: evaluation.summary
          });
        default:
          return this.persist({
            ...baseUpdate,
            status: "failed",
            waitingReason: "后台评估助手返回了不支持的决策。",
            nextCheckAt: null,
            completedAt: null,
            lastAutomationAt: referenceAt,
            lastAutomationSummary: "后台评估助手返回了不支持的决策。"
          });
      }
    } catch (error) {
      if (isDeferredFollowUpSendError(error)) {
        return this.persist({
          ...baseUpdate,
          status: "active",
          waitingReason: null,
          nextCheckAt: shiftSeconds(referenceAt, task.checkIntervalSeconds),
          completedAt: null,
          lastAutomationAt: referenceAt,
          lastAutomationSummary: "当前会话又进入运行态，本轮不插话，等待下一次检查。"
        });
      }

      const detail = error instanceof Error ? error.message : String(error);
      return this.persist({
        ...baseUpdate,
        status: "failed",
        waitingReason: detail,
        nextCheckAt: null,
        completedAt: null,
        lastAutomationAt: referenceAt,
        lastAutomationSummary: `后台评估助手执行失败：${detail}`
      });
    }
  }

  private persist(task: ButlerFollowUpTask): ButlerFollowUpTask {
    return this.butlerFollowUpTaskRepository.update(task) ?? task;
  }

  private async inspectTask(task: ButlerFollowUpTask): Promise<FollowUpTaskInspection> {
    const session = this.sessionHistoryService.getSession(task.sessionId, task.createdByUserId);
    const runtime = await this.sessionLiveRuntimeService.getSessionRuntime(
      task.sessionId,
      task.createdByUserId
    );
    const envelope = await this.sessionHistoryService.readRecentHistoryEnvelope(
      task.sessionId,
      RECENT_HISTORY_LIMIT
    );
    const sortedMessages = (envelope?.messages ?? [])
      .slice()
      .sort((left, right) => left.sequence - right.sequence);

    return {
      runningState: normalizeRunningState(runtime.runningState),
      messageAt: session.lastMessageAt,
      messageCount: session.messageCount,
      sessionTitle: session.title ?? null,
      latestAssistantText: resolveLatestAssistantText(envelope),
      transcriptLines: sortedMessages.map((message) => renderHistoryLine(
        message.sequence,
        message.role,
        message.kind ?? "text",
        message.timestamp,
        message.content
      ))
    };
  }

  private async evaluateTask(
    profile: ButlerProfile,
    project: ButlerProject,
    task: ButlerFollowUpTask,
    inspection: FollowUpTaskInspection,
    runningState: SessionRunningState | null
  ): Promise<ButlerFollowUpEvaluationResult> {
    const evaluatorWorkspacePath = path.join(profile.workspacePath, FOLLOW_UP_EVALUATOR_DIRNAME);
    ensureButlerWorkspaceIsolation(evaluatorWorkspacePath);
    this.writeEvaluationInstructionFiles(evaluatorWorkspacePath, profile.providerId);
    this.syncCodexInstructionConfig(profile.providerId, evaluatorWorkspacePath);
    const workspace = this.workspaceService.importWorkspace(evaluatorWorkspacePath, "代码助手");
    const instruction = this.instructionAdapter.buildInstruction({
      providerId: profile.providerId,
      project,
      sessionId: task.sessionId,
      butlerSessionId: task.butlerSessionId,
      sessionTitle: inspection.sessionTitle,
      objective: task.objective,
      runningState,
      messageCount: inspection.messageCount,
      lastMessageAt: inspection.messageAt,
      autoContinueCount: task.autoContinueCount,
      lastAutomationSummary: task.lastAutomationSummary,
      latestAssistantText: inspection.latestAssistantText,
      transcriptLines: inspection.transcriptLines
    });
    const adapter = this.providerAdapterRegistry.get(profile.providerId);
    const launch = await adapter.startPatrolSession({
      workspaceId: workspace.id,
      userId: task.createdByUserId,
      providerId: profile.providerId,
      prompt: instruction.prompt,
      model: resolveFollowUpModel(profile.providerId),
      reasoningLevel: "low",
      permissionMode: "default"
    });

    await adapter.waitForSessionTerminal(launch.sessionId);
    const result = await adapter.readPatrolResult(launch.sessionId);
    return parseEvaluationResult(result);
  }

  private writeEvaluationInstructionFiles(
    workspacePath: string,
    providerId: ButlerProfile["providerId"]
  ): void {
    const content = [
      "# 代码助手后台跟进评估规则",
      "",
      "你不是普通项目会话，也不是面向用户的聊天助手。",
      "你的身份是后台跟进评估器，只负责判断某个开发会话现在该继续推进、等用户决定、还是已经完成。",
      "如果目标或上下文里提到了 spec，完成标准只能按 spec 明确要求的必做项判断。",
      "“建议下一步”“最佳实践”“可以顺手优化”这类内容默认都不是必做项，不能据此继续扩范围。",
      "如果没有 spec，就先从目标和最近消息里归纳一句当前核心任务，后续只能围绕这个核心任务判断，不准无限扩展。",
      "除非目标本身要求，否则不要把重构、补测试、补体验优化之类建议项升级成必须开发的工作。",
      "禁止照搬最后一句回复做草率判断，必须结合用户目标、当前运行态和最近消息一起判断。",
      "如果能继续推进，就直接给出下一条要发给开发会话的中文指令，不要空谈。",
      "如果确实需要用户决定，要把缺口说清楚，但不要替用户做不存在的决定。",
      "输出语言必须是中文，先给结论，再给结构化 JSON。"
    ].join("\n");

    writeFileIfChanged(path.join(workspacePath, "AGENTS.md"), `${content}\n`);

    if (providerId === "claude-code") {
      writeFileIfChanged(path.join(workspacePath, "CLAUDE.md"), `${content}\n`);
    }
  }

  private syncCodexInstructionConfig(
    providerId: ButlerProfile["providerId"],
    workspacePath: string
  ): void {
    if (providerId !== "codex" || !this.followUpCodexHomeDir?.trim()) {
      return;
    }

    const targetHomeDir = path.resolve(this.followUpCodexHomeDir);
    const sourceHomeDir = resolveSourceCodexHomeDir(this.sourceCodexHomeDir, targetHomeDir);
    const sourceConfigPath = path.join(sourceHomeDir, "config.toml");
    const sourceConfigContent =
      sourceHomeDir !== targetHomeDir && fs.existsSync(sourceConfigPath) && fs.statSync(sourceConfigPath).isFile()
        ? fs.readFileSync(sourceConfigPath, "utf8")
        : "";
    const instructionFilePath = path.join(workspacePath, "AGENTS.md");

    fs.mkdirSync(targetHomeDir, { recursive: true });
    removeFileIfExists(path.join(targetHomeDir, "AGENTS.md"));
    removeFileIfExists(path.join(targetHomeDir, "AGENTS.override.md"));
    syncOptionalFile(path.join(sourceHomeDir, "auth.json"), path.join(targetHomeDir, "auth.json"));
    writeFileIfChanged(
      path.join(targetHomeDir, "config.toml"),
      `${composeCodexConfigContent(sourceConfigContent, instructionFilePath)}\n`
    );
  }
}

function mapTaskView(
  task: ButlerFollowUpTask,
  workspaceId: string,
  projectName: string,
  sessionTitle: string | null
): ButlerFollowUpTaskView {
  return {
    id: task.id,
    projectId: task.projectId,
    projectName,
    workspaceId,
    butlerSessionId: task.butlerSessionId,
    sessionId: task.sessionId,
    sessionTitle,
    objective: task.objective,
    status: task.status,
    checkIntervalSeconds: task.checkIntervalSeconds,
    lastCheckedAt: task.lastCheckedAt,
    nextCheckAt: task.nextCheckAt,
    lastObservedRunningState: task.lastObservedRunningState,
    lastObservedMessageAt: task.lastObservedMessageAt,
    lastObservedMessageCount: task.lastObservedMessageCount,
    lastAutomationSummary: task.lastAutomationSummary,
    lastAutomationAt: task.lastAutomationAt,
    autoContinueCount: task.autoContinueCount,
    waitingReason: task.waitingReason,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt
  };
}

function normalizeObjective(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "请先写清楚希望助手继续推动的目标",
      field: "objective"
    });
  }

  return normalized;
}

function normalizeCheckInterval(value: number | undefined): number {
  const fallback = value ?? DEFAULT_CHECK_INTERVAL_SECONDS;
  const rounded = Math.round(fallback);

  return Math.min(MAX_CHECK_INTERVAL_SECONDS, Math.max(MIN_CHECK_INTERVAL_SECONDS, rounded));
}

function buildFollowUpClientRequestId(taskId: string, referenceAt: string): string {
  return `butler-follow-up:${taskId}:${Date.parse(referenceAt) || Date.now()}`;
}

function isDeferredFollowUpSendError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.errorCode === "ACTIVE_RUN_EXISTS" || error.errorCode === "SESSION_NOT_RUNNING";
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "ACTIVE_RUN_EXISTS"
    || error.message === "SESSION_NOT_RUNNING"
    || error.message.includes("当前会话正在运行")
  );
}

function isSyntheticMessageId(messageId: string | null | undefined): boolean {
  return typeof messageId === "string" && messageId.startsWith("synthetic-");
}

function shiftSeconds(referenceAt: string, seconds: number): string {
  const time = new Date(referenceAt).getTime();
  return new Date(time + seconds * 1000).toISOString();
}

function normalizeRunningState(value: string | null | undefined): SessionRunningState | null {
  switch (value) {
    case "idle":
    case "starting":
    case "running":
    case "completed":
    case "interrupted":
    case "failed":
      return value;
    default:
      return null;
  }
}

function resolveLatestAssistantText(envelope: SessionHistoryEnvelope | null): string | null {
  if (!envelope || envelope.messages.length === 0) {
    return null;
  }

  const latestAssistant = [...envelope.messages]
    .sort((left, right) => right.sequence - left.sequence)
    .find((message) => message.role === "assistant" && message.content.trim().length > 0);

  return latestAssistant?.content?.trim() || null;
}

function renderHistoryLine(
  sequence: number,
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

  return `#${sequence} [${timestamp}] ${role}/${kind}: ${compactContent || "（空内容）"}`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function resolveFollowUpModel(providerId: ButlerProfile["providerId"]): string {
  return providerId === "codex" ? "gpt-5.1-codex-mini" : "haiku";
}

function parseEvaluationResult(result: PatrolSessionResult): ButlerFollowUpEvaluationResult {
  const rawJson = result.structured.rawJson ?? extractJsonFromText(result.latestAssistantMessage);

  if (!rawJson) {
    throw new Error("后台评估助手没有返回结构化 JSON");
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `后台评估助手返回的 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`
    );
  }

  const decision = normalizeDecision(parsed.decision);

  if (!decision) {
    throw new Error("后台评估助手返回的 decision 不合法");
  }

  const summary = normalizeNonEmptyString(parsed.summary) ?? result.structured.summary ?? "后台评估助手未提供摘要";
  const waitingReason = normalizeNullableString(parsed.waitingReason);
  const continuePrompt = normalizeNullableString(parsed.continuePrompt);
  const riskLevel = normalizeRiskLevel(parsed.riskLevel);

  return {
    decision,
    summary,
    waitingReason,
    continuePrompt,
    riskLevel
  };
}

function normalizeDecision(value: unknown): ButlerFollowUpEvaluationDecision | null {
  switch (value) {
    case "continue":
    case "waiting_user":
    case "completed":
    case "failed":
      return value;
    default:
      return null;
  }
}

function normalizeRiskLevel(value: unknown): "low" | "medium" | "high" | null {
  switch (value) {
    case "low":
    case "medium":
    case "high":
      return value;
    default:
      return null;
  }
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeNonEmptyString(value);
}

function extractJsonFromText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const matched = value.match(/```json\s*([\s\S]*?)```/i);
  const raw = matched?.[1]?.trim();
  return raw || null;
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
    "# 代码助手跟进评估专用 Codex 配置（系统自动生成）",
    normalizedSource,
    `model_instructions_file = ${toTomlString(path.resolve(instructionFilePath))}`
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function toTomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function writeFileIfChanged(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
    return;
  }

  fs.writeFileSync(filePath, content, "utf8");
}

function removeFileIfExists(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  if (fs.statSync(filePath).isFile()) {
    fs.rmSync(filePath, { force: true });
  }
}

function syncOptionalFile(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    removeFileIfExists(targetPath);
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (fs.existsSync(targetPath) && fs.readFileSync(targetPath).equals(fs.readFileSync(sourcePath))) {
    return;
  }

  fs.copyFileSync(sourcePath, targetPath);
}
