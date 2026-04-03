import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { AuthUserRepository } from "../../storage/repositories/auth-user-repository.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";
import type { ButlerSessionRepository } from "../../storage/repositories/butler-session-repository.js";
import type { PatrolPlanRepository } from "../../storage/repositories/patrol-plan-repository.js";
import type { ProjectMemoryRepository } from "../../storage/repositories/project-memory-repository.js";
import type { SessionChangedFileRepository } from "../../storage/repositories/session-changed-file-repository.js";
import type { SessionCheckpointRepository } from "../../storage/repositories/session-checkpoint-repository.js";
import type { ButlerProject, ButlerSession } from "../../types/domain.js";
import {
  InstructionAdapter,
  type ButlerInstructionEnvelope
} from "./instruction-adapter.js";
import {
  ProviderAdapterRegistry,
  type PatrolSessionResult
} from "./provider-adapter-registry.js";
import { PatrolRunService, type PatrolRunView } from "./patrol-run-service.js";

interface PatrolExecutionLogger {
  error(message: string, detail?: unknown): void;
}

interface PatrolExecutionOptions {
  logger?: PatrolExecutionLogger;
}

/**
 * 真正把 patrol_run 接到 provider 会话执行。
 *
 * 这里不重新发明一套 runtime，而是复用现有的 SessionLiveRuntimeService。
 */
export class PatrolExecutionService {
  private readonly logger: PatrolExecutionLogger;
  private readonly inFlightRuns = new Set<string>();

  constructor(
    private readonly butlerProjectRepository: ButlerProjectRepository,
    private readonly butlerSessionRepository: ButlerSessionRepository,
    private readonly sessionCheckpointRepository: SessionCheckpointRepository,
    private readonly patrolPlanRepository: PatrolPlanRepository,
    private readonly patrolRunService: PatrolRunService,
    private readonly projectMemoryRepository: ProjectMemoryRepository,
    private readonly sessionChangedFileRepository: SessionChangedFileRepository,
    private readonly authUserRepository: AuthUserRepository,
    private readonly providerAdapterRegistry: ProviderAdapterRegistry,
    private readonly instructionAdapter: InstructionAdapter,
    options: PatrolExecutionOptions = {}
  ) {
    this.logger = options.logger ?? console;
  }

  async executeQueuedRun(runId: string): Promise<PatrolRunView> {
    if (this.inFlightRuns.has(runId)) {
      return this.patrolRunService.getRunById(runId);
    }

    const run = this.patrolRunService.getRunById(runId);

    if (run.status !== "queued") {
      return run;
    }

    this.inFlightRuns.add(runId);
    let butlerSession: ButlerSession | undefined;

    try {
      const project = this.getProjectOrThrow(run.projectId);
      const plan = run.planId ? this.patrolPlanRepository.findById(run.planId) : null;
      const providerId = resolveProviderId(project);
      const adapter = this.providerAdapterRegistry.get(providerId);
      const userId = this.resolveExecutorUserId();
      const memories = this.projectMemoryRepository.listByProject(project.id, {
        status: "active"
      });
      const instruction = this.instructionAdapter.buildPatrolInstruction({
        providerId,
        project,
        run,
        plan: plan
          ? {
              id: plan.id,
              projectId: plan.projectId,
              name: plan.name,
              triggerType: plan.triggerType as "manual" | "interval" | "cron",
              triggerConfig: JSON.parse(plan.triggerConfigJson),
              executionMode: plan.executionMode as "readonly" | "controlled",
              patrolScope: JSON.parse(plan.patrolScopeJson),
              enabled: plan.enabled === 1,
              lastScheduledAt: plan.lastScheduledAt,
              nextRunAt: plan.nextRunAt,
              createdAt: plan.createdAt,
              updatedAt: plan.updatedAt
            }
          : null,
        memories
      });

      const launch = await adapter.startPatrolSession({
        workspaceId: project.workspaceId,
        userId,
        providerId,
        prompt: instruction.prompt,
        model: readProviderStringOption(project, providerId, "model"),
        reasoningLevel: readProviderStringOption(project, providerId, "reasoningLevel"),
        permissionMode: mapPermissionMode(instruction)
      });

      butlerSession = this.ensureButlerSession(project.id, launch.sessionId, launch.acceptedAt);
      const runningRun = this.patrolRunService.markRunRunning(runId, {
        butlerSessionId: butlerSession.id,
        startedAt: launch.acceptedAt
      });

      this.captureCheckpoint(butlerSession, {
        sourceKind: "summary",
        progressState: "working",
        summary: `巡视已启动，provider=${providerId}`,
        riskFlags: [],
        nextActions: ["等待巡视执行完成并回收总结"]
      });

      void this.watchRunCompletion(runId, project, butlerSession, adapter, instruction);
      return runningRun;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return this.failRun(runId, detail, butlerSession);
    } finally {
      this.inFlightRuns.delete(runId);
    }
  }

  private async watchRunCompletion(
    runId: string,
    project: ButlerProject,
    butlerSession: ButlerSession,
    adapter: ReturnType<ProviderAdapterRegistry["get"]>,
    instruction: ButlerInstructionEnvelope
  ): Promise<void> {
    try {
      await adapter.waitForSessionTerminal(butlerSession.sessionId);
      const result = await adapter.readPatrolResult(butlerSession.sessionId);
      this.completeRun(runId, project, butlerSession, result, instruction);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.failRun(runId, detail, butlerSession);
      this.logger.error("[patrol-execution] run completion failed", {
        runId,
        projectId: project.id,
        error: detail
      });
    }
  }

  private completeRun(
    runId: string,
    project: ButlerProject,
    butlerSession: ButlerSession,
    result: PatrolSessionResult,
    instruction: ButlerInstructionEnvelope
  ): void {
    const finishedAt = nowIso();
    const summary = result.structured.summary ?? result.latestAssistantMessage ?? "巡视完成，但未产出有效总结";
    const suggestions = mergeSuggestions(result.structured.suggestions, result.structured.nextActions);
    const inferredRiskLevel = result.structured.riskLevel ?? project.riskLevel;
    const inferredProgressState =
      result.structured.progressState === "unknown"
        ? inferredRiskLevel === "high"
          ? "blocked"
          : "done"
        : result.structured.progressState;
    const readonlyAudit = this.inspectReadonlyViolations(instruction, butlerSession.sessionId);

    if (readonlyAudit !== null) {
      const violationSummary = buildReadonlyViolationSummary(summary, readonlyAudit.changedPaths);
      const violationSuggestions = mergeSuggestions(suggestions, [
        "检查并回滚本次只读巡视产生的文件改动",
        "复核 provider 权限模式与巡视提示词约束"
      ]);
      const violationRiskFlags = mergeRiskFlags(result.structured.riskFlags, [
        "readonly 模式检测到文件写入",
        ...readonlyAudit.changedPaths
      ]);
      const completedRun = this.patrolRunService.completeRun(runId, {
        status: "failed",
        summary: violationSummary,
        riskLevel: "high",
        suggestions: violationSuggestions,
        finishedAt
      });

      this.captureCheckpoint(butlerSession, {
        sourceKind: "summary",
        progressState: "blocked",
        summary: violationSummary,
        riskFlags: violationRiskFlags,
        nextActions: violationSuggestions
      });

      this.updateButlerSession(butlerSession, {
        status: "failed",
        lastSummary: violationSummary,
        lastCheckpointAt: finishedAt
      });

      this.butlerProjectRepository.update({
        ...project,
        riskLevel: "high",
        lastPatrolAt: completedRun.finishedAt,
        updatedAt: finishedAt,
        config: {
          ...project.config,
          lastPatrolContractVersion: instruction.outputContractVersion,
          lastPatrolProvider: instruction.providerId,
          lastReadonlyViolationAt: finishedAt,
          lastReadonlyViolationPaths: readonlyAudit.changedPaths
        }
      });
      return;
    }

    const completedRun = this.patrolRunService.completeRun(runId, {
      status: "succeeded",
      summary,
      riskLevel: inferredRiskLevel,
      suggestions,
      finishedAt
    });

    this.captureCheckpoint(butlerSession, {
      sourceKind: "summary",
      progressState: inferredProgressState,
      summary,
      riskFlags: result.structured.riskFlags,
      nextActions: suggestions
    });

    this.updateButlerSession(butlerSession, {
      status: inferredProgressState === "blocked" ? "blocked" : "idle",
      lastSummary: summary,
      lastCheckpointAt: finishedAt
    });

    this.butlerProjectRepository.update({
      ...project,
      riskLevel: inferredRiskLevel,
      lastPatrolAt: completedRun.finishedAt,
      updatedAt: finishedAt,
      config: {
        ...project.config,
        lastPatrolContractVersion: instruction.outputContractVersion,
        lastPatrolProvider: instruction.providerId
      }
    });
  }

  private failRun(runId: string, detail: string, butlerSession?: ButlerSession): PatrolRunView {
    const finishedAt = nowIso();
    const failedRun = this.patrolRunService.completeRun(runId, {
      status: "failed",
      summary: detail,
      riskLevel: "high",
      suggestions: [],
      finishedAt
    });

    if (butlerSession) {
      this.captureCheckpoint(butlerSession, {
        sourceKind: "summary",
        progressState: "blocked",
        summary: `巡视失败：${detail}`,
        riskFlags: [detail],
        nextActions: ["检查 provider 会话日志和权限状态"]
      });
      this.updateButlerSession(butlerSession, {
        status: "failed",
        lastSummary: detail,
        lastCheckpointAt: finishedAt
      });
    }

    return failedRun;
  }

  private inspectReadonlyViolations(
    instruction: ButlerInstructionEnvelope,
    sessionId: string
  ): { changedPaths: string[] } | null {
    if (instruction.metadata.executionMode !== "readonly") {
      return null;
    }

    const changedPaths = this.sessionChangedFileRepository
      .listBySessionId(sessionId)
      .map((record) => record.path.trim())
      .filter((path) => path.length > 0)
      .slice(0, 12);

    return changedPaths.length > 0
      ? {
          changedPaths
        }
      : null;
  }

  private ensureButlerSession(projectId: string, sessionId: string, timestamp: string): ButlerSession {
    const existing = this.butlerSessionRepository.findBySessionId(sessionId);

    if (existing) {
      return this.updateButlerSession(existing, {
        status: "running",
        lastCheckpointAt: existing.lastCheckpointAt,
        lastSummary: existing.lastSummary
      });
    }

    return this.butlerSessionRepository.create({
      id: createId(),
      projectId,
      sessionId,
      role: "patrol",
      ownershipMode: "managed",
      status: "running",
      lastSummary: null,
      lastCheckpointAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  private updateButlerSession(
    session: ButlerSession,
    input: {
      status: ButlerSession["status"];
      lastSummary: string | null;
      lastCheckpointAt: string | null;
    }
  ): ButlerSession {
    return this.butlerSessionRepository.update({
      ...session,
      status: input.status,
      lastSummary: input.lastSummary,
      lastCheckpointAt: input.lastCheckpointAt,
      updatedAt: nowIso()
    }) ?? {
      ...session,
      status: input.status,
      lastSummary: input.lastSummary,
      lastCheckpointAt: input.lastCheckpointAt,
      updatedAt: nowIso()
    };
  }

  private captureCheckpoint(
    butlerSession: ButlerSession,
    input: {
      sourceKind: "snapshot" | "summary" | "verification" | "manual";
      progressState: "unknown" | "working" | "blocked" | "done";
      summary: string;
      riskFlags: string[];
      nextActions: string[];
    }
  ): void {
    const capturedAt = nowIso();
    this.sessionCheckpointRepository.create({
      id: createId(),
      butlerSessionId: butlerSession.id,
      checkpointSeq: this.sessionCheckpointRepository.getLatestSeq(butlerSession.id) + 1,
      sourceKind: input.sourceKind,
      progressState: input.progressState,
      summary: input.summary,
      riskFlags: input.riskFlags,
      nextActions: input.nextActions,
      capturedAt
    });
  }

  private getProjectOrThrow(projectId: string): ButlerProject {
    const project = this.butlerProjectRepository.findById(projectId);

    if (!project) {
      throw new Error("BUTLER_PROJECT_NOT_FOUND");
    }

    return project;
  }

  private resolveExecutorUserId(): string {
    const userId = this.authUserRepository.listIds()[0] ?? null;

    if (!userId) {
      throw new Error("PATROL_EXECUTOR_USER_NOT_FOUND");
    }

    return userId;
  }
}

function mapPermissionMode(instruction: ButlerInstructionEnvelope): string {
  return instruction.metadata.executionMode === "controlled" ? "acceptEdits" : "default";
}

function resolveProviderId(project: ButlerProject): "codex" | "claude-code" {
  if (project.defaultProvider === "claude-code") {
    return "claude-code";
  }

  return "codex";
}

function readProviderStringOption(
  project: ButlerProject,
  providerId: "codex" | "claude-code",
  field: "model" | "reasoningLevel"
): string | null {
  const providers = project.config.providers;

  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return null;
  }

  const providerConfig = (providers as Record<string, unknown>)[providerId];

  if (!providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig)) {
    return null;
  }

  const value = (providerConfig as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function mergeSuggestions(primary: string[], secondary: string[]): string[] {
  return Array.from(new Set([...primary, ...secondary].map((item) => item.trim()).filter((item) => item.length > 0))).slice(0, 8);
}

function mergeRiskFlags(primary: string[], secondary: string[]): string[] {
  return Array.from(new Set([...primary, ...secondary].map((item) => item.trim()).filter((item) => item.length > 0))).slice(0, 8);
}

function buildReadonlyViolationSummary(summary: string, changedPaths: string[]): string {
  const preview = changedPaths.slice(0, 3).join("、");
  const suffix = changedPaths.length > 3 ? ` 等 ${changedPaths.length} 个文件` : "";
  return `只读巡视违反约束：检测到文件写入 ${preview}${suffix}。原巡视结论：${summary}`;
}
