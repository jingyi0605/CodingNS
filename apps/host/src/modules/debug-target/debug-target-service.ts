import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import type Database from "better-sqlite3";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { AiFallbackEditRepository } from "../../storage/repositories/ai-fallback-edit-repository.js";
import type { DebugServiceRepository } from "../../storage/repositories/debug-service-repository.js";
import type { DebugRuntimeSessionRepository } from "../../storage/repositories/debug-runtime-session-repository.js";
import type { DebugTargetRepository } from "../../storage/repositories/debug-target-repository.js";
import type { FrameworkAnalysisResultRepository } from "../../storage/repositories/framework-analysis-result-repository.js";
import type { PortLeaseRepository } from "../../storage/repositories/port-lease-repository.js";
import type { RuntimeBindingRepository } from "../../storage/repositories/runtime-binding-repository.js";
import type { WorkspaceWorktreeRepository } from "../../storage/repositories/workspace-worktree-repository.js";
import type {
  AiFallbackEditRecord,
  DebugLaunchPlan,
  DebugLaunchPlanServiceItem,
  DebugPortPoolConfig,
  DebugRuntimeHistoryEnvelope,
  DebugRuntimeDetail,
  DebugRuntimeSessionStatus,
  DebugRuntimeSession,
  PortLeaseRecord,
  DebugServiceRole,
  DebugServiceSpec,
  DebugTargetProfile,
  FrameworkAnalysisConfidence,
  FrameworkAnalysisResult,
  FrameworkCompatibilityLevel,
  TerminalCommandTemplate,
  TerminalInstance,
  TerminalRuntimeType
} from "../../types/domain.js";
import type { PreferenceProfileService } from "../preferences/profile-service.js";
import { DEFAULT_DEBUG_PORT_POOLS } from "../preferences/profile-service.js";
import { buildTemplateCommandLine, getShellEnterSequence } from "../terminal/terminal-shell.js";
import { discoverTemplateRuntimeStatuses } from "../terminal/template-port-runtime.js";
import type { TerminalService } from "../terminal/terminal-service.js";
import { createTaskManager, TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../tasks/task-types.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import {
  FRAMEWORK_COMPATIBILITY_MATRIX,
  FRAMEWORK_COMPATIBILITY_MATRIX_VERSION,
  getFrameworkCompatibilityItem
} from "./framework-compatibility-matrix.js";
import { resolveLaunchPlan } from "./launch-adapter-registry.js";

export interface AnalyzeDebugTargetInput {
  workspaceId: string;
  rootPath: string;
  commandHints?: string[];
}

export interface AnalyzeDebugTargetResult {
  target: DebugTargetProfile;
  services: DebugServiceSpec[];
  analyses: FrameworkAnalysisResult[];
  autoInjectionEligible: boolean;
}

export interface RunDebugTargetInput {
  targetId: string;
  userId: string;
  shell?: string;
  runtimeType?: TerminalRuntimeType | null;
  portRequests?: DebugTargetPortRequest[];
}

export interface DebugTargetPortRequest {
  serviceId?: string | null;
  role?: DebugServiceRole | null;
  cwd?: string | null;
  name?: string | null;
  command?: string | null;
  port: number;
}

interface DebugRuntimeReconciliationTaskInput {
  trigger: "scheduler" | "manual";
}

export interface DebugRuntimeReconciliationResult {
  scannedRuntimeCount: number;
  reconciledRuntimeCount: number;
  staleLeaseCount: number;
  releasedLeaseCount: number;
  failedRuntimeCount: number;
  stoppedRuntimeCount: number;
  idle: boolean;
}

export class DebugTargetService {
  constructor(
    private readonly db: Database.Database,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceWorktreeRepository: Pick<WorkspaceWorktreeRepository, "findByWorkspaceId">,
    private readonly debugTargetRepository: DebugTargetRepository,
    private readonly debugServiceRepository: DebugServiceRepository,
    private readonly frameworkAnalysisResultRepository: FrameworkAnalysisResultRepository,
    private readonly debugRuntimeSessionRepository: DebugRuntimeSessionRepository,
    private readonly portLeaseRepository: PortLeaseRepository,
    private readonly runtimeBindingRepository: RuntimeBindingRepository,
    private readonly aiFallbackEditRepository: AiFallbackEditRepository,
    private readonly terminalCommandTemplateRepository: {
      listByWorkspace(workspaceId: string): TerminalCommandTemplate[];
    },
    private readonly preferenceProfileService: Pick<PreferenceProfileService, "getProfile">,
    private readonly terminalService: Pick<TerminalService, "createTerminal" | "writeInput" | "closeTerminal" | "getTerminalOrThrow">,
    private readonly terminalInstanceRepository: {
      findById(id: string): TerminalInstance | null;
    },
    private readonly taskManager: TaskManager = createTaskManager()
  ) {
    this.registerBackgroundTasks();
  }

  analyze(input: AnalyzeDebugTargetInput): AnalyzeDebugTargetResult {
    const workspace = this.workspaceService.getWorkspaceOrThrow(input.workspaceId);
    const rootPath = this.resolveRootPath(workspace.path, input.rootPath);
    const sourceMeta = this.resolveSourceMeta(workspace.id);
    const timestamp = nowIso();
    const commandHints = resolveAnalyzeCommandHints({
      workspaceId: workspace.id,
      rootPath,
      explicitCommandHints: input.commandHints,
      terminalCommandTemplateRepository: this.terminalCommandTemplateRepository
    });
    const discoveredServices = discoverServiceCandidates(rootPath, commandHints);
    const analyzedServices = discoveredServices.map((candidate) => ({
      candidate,
      framework: pickFramework(collectFrameworkEvidence(candidate.cwd))
    }));
    const targetStackHint = analyzedServices[0]?.framework.primaryFramework ?? null;
    const target = this.upsertTarget({
      workspaceId: workspace.id,
      rootPath,
      displayName: path.basename(rootPath) || workspace.name,
      stackHint: targetStackHint,
      sourceType: sourceMeta.sourceType,
      rootWorkspaceId: sourceMeta.rootWorkspaceId,
      timestamp
    });
    const services: DebugServiceSpec[] = [];
    const analyses: FrameworkAnalysisResult[] = [];

    for (const item of analyzedServices) {
      const analysisId = createId();
      const service = buildServiceRecord(target, item.candidate, item.framework, timestamp, analysisId);
      const matrixItem = getFrameworkCompatibilityItem(item.framework.primaryFramework);
      const analysis: FrameworkAnalysisResult = {
        id: analysisId,
        targetId: target.id,
        serviceId: service.id,
        primaryFramework: item.framework.primaryFramework,
        confidence: item.framework.confidence,
        compatibilityLevel: matrixItem.compatibilityLevel,
        recommendedInjectionMode: matrixItem.recommendedInjectionMode,
        requiresServiceDiscoveryHandling: matrixItem.requiresServiceDiscoveryHandling,
        requiresHmrHandling: matrixItem.requiresHmrHandling,
        requiresCallbackHandling: matrixItem.requiresCallbackHandling,
        aiFallbackPolicy: matrixItem.aiFallbackPolicy,
        reasons: item.framework.reasons,
        detectedFiles: item.framework.detectedFiles,
        rawEvidence: item.framework.rawEvidence,
        createdAt: timestamp
      };

      services.push(service);
      analyses.push(analysis);
    }

    const persist = this.db.transaction(() => {
      this.debugServiceRepository.deleteByTargetId(target.id);
      this.frameworkAnalysisResultRepository.deleteByTargetId(target.id);

      for (const service of services) {
        this.debugServiceRepository.create(service);
      }

      for (const analysis of analyses) {
        this.frameworkAnalysisResultRepository.create(analysis);
      }
    });

    persist();

    return {
      target,
      services,
      analyses,
      autoInjectionEligible: analyses.every((analysis) =>
        analysis.compatibilityLevel === "supported" || analysis.compatibilityLevel === "conditional"
      )
    };
  }

  getFrameworkAnalysis(targetId: string): { targetId: string; items: FrameworkAnalysisResult[] } {
    this.getTargetOrThrow(targetId);
    return {
      targetId,
      items: this.frameworkAnalysisResultRepository.listByTargetId(targetId)
    };
  }

  refreshFrameworkAnalysis(targetId: string): AnalyzeDebugTargetResult {
    const target = this.getTargetOrThrow(targetId);
    const services = this.debugServiceRepository.listByTargetId(targetId);
    const commandHints = services.map((service) => [service.command, ...service.args].join(" "));

    return this.analyze({
      workspaceId: target.workspaceId,
      rootPath: target.rootPath,
      commandHints
    });
  }

  getCompatibilityMatrix(): { version: string; items: typeof FRAMEWORK_COMPATIBILITY_MATRIX } {
    return {
      version: FRAMEWORK_COMPATIBILITY_MATRIX_VERSION,
      items: FRAMEWORK_COMPATIBILITY_MATRIX
    };
  }

  getTargetWorkspaceId(targetId: string): string {
    return this.getTargetOrThrow(targetId).workspaceId;
  }

  getRuntimeWorkspaceId(runtimeId: string): string {
    const runtimeSession = this.debugRuntimeSessionRepository.findById(runtimeId);

    if (!runtimeSession) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DEBUG_RUNTIME_NOT_FOUND",
        detail: "调试运行时不存在"
      });
    }

    return this.getTargetOrThrow(runtimeSession.targetId).workspaceId;
  }

  async createLaunchPlan(
    targetId: string,
    portRequests: DebugTargetPortRequest[] = [],
    userId: string | null = null
  ): Promise<DebugLaunchPlan> {
    return await this.createRegisteredTemplatePreviewPlan(targetId, portRequests, userId);
  }

  async run(input: RunDebugTargetInput): Promise<{
    runtimeSession: DebugRuntimeSession;
    services: Array<{
      serviceId: string;
      processInstanceId: string;
      terminalId: string;
      leasedPort: number | null;
      runtimeBindingId: string;
    }>;
  }> {
    const launchPlan = await this.createManagedRuntimeLaunchPlan(
      input.targetId,
      input.portRequests ?? [],
      input.userId
    );

    if (!launchPlan.autoStartAllowed) {
      const aiFallbackItem = launchPlan.services.find((item) => item.aiFallback?.eligible);

      if (aiFallbackItem) {
        await this.failRuntimePlan(
          launchPlan.runtimeSession.id,
          aiFallbackItem.failureStage ?? "ai_fallback_required",
          "当前服务需要进入受限 AI 兜底流程，自动运行已阻止",
          409,
          "DEBUG_TARGET_AI_FALLBACK_REQUIRED"
        );
      }

      await this.failRuntimePlan(
        launchPlan.runtimeSession.id,
        launchPlan.services.find((item) => item.failureStage)?.failureStage ?? "launch_requirements",
        "当前启动计划缺少必要的服务发现、HMR 或 callback 处理，暂不允许自动启动",
        409,
        "DEBUG_TARGET_RUN_NOT_ALLOWED"
      );
    }

    const startedServices: Array<{
      serviceId: string;
      processInstanceId: string;
      terminalId: string;
      leasedPort: number | null;
      runtimeBindingId: string;
    }> = [];

    try {
      for (const item of launchPlan.services) {
        const service = this.getServiceOrThrow(item.serviceId, input.targetId);
        const analysis = this.frameworkAnalysisResultRepository
          .listByTargetId(input.targetId)
          .find((candidate) => candidate.id === item.frameworkAnalysisId) ?? null;
        const terminal = await this.terminalService.createTerminal({
          workspaceId: this.getTargetOrThrow(input.targetId).workspaceId,
          name: `${service.name} 运行`,
          cwd: service.cwd,
          shell: input.shell,
          runtimeType: input.runtimeType,
          createdByUserId: input.userId,
          env: {
            ...service.env,
            ...item.envPatch
          },
          debugRuntimeSessionId: launchPlan.runtimeSession.id,
          debugTargetId: input.targetId,
          debugServiceId: service.id,
          frameworkAnalysisId: analysis?.id ?? null,
          launcherSourceType: "debug_service",
          launchStage: "command_dispatched",
          failureStage: null,
          adapterKind: item.adapterKind ?? null,
          envPatchSummary: item.envPatch,
          artifactRef: item.artifactRef
        });
        const commandLine = buildTemplateCommandLine(
          buildEphemeralTemplate(service, item, input.runtimeType ?? terminal.runtimeType),
          terminal.shell
        );

        await this.terminalService.writeInput(
          terminal.id,
          `${commandLine}${getShellEnterSequence(terminal.shell)}`
        );
        this.runtimeBindingRepository.update({
          id: item.runtimeBindingId,
          runtimeId: launchPlan.runtimeSession.id,
          serviceId: service.id,
          processInstanceId: terminal.id,
          expectedPort: item.expectedPort,
          leasedPort: item.leasedPort,
          observedPort: null,
          proxyPath: null,
          status: "ALLOCATED",
          updatedAt: nowIso()
        });
        startedServices.push({
          serviceId: service.id,
          processInstanceId: terminal.id,
          terminalId: terminal.id,
          leasedPort: item.leasedPort,
          runtimeBindingId: item.runtimeBindingId
        });
      }
    } catch (error) {
      for (const service of startedServices) {
        try {
          await this.terminalService.closeTerminal(service.terminalId);
        } catch {
          // 失败回滚阶段只做尽力而为，避免覆盖原始错误。
        }
      }

      await this.failRuntimePlan(
        launchPlan.runtimeSession.id,
        "command_execution",
        error instanceof Error ? error.message : "调试目标启动失败",
        500,
        "DEBUG_TARGET_RUN_FAILED"
      );
    }

    const updatedRuntimeSession = this.debugRuntimeSessionRepository.update({
      ...launchPlan.runtimeSession,
      status: "RUNNING",
      failureStage: null,
      startedAt: nowIso(),
      updatedAt: nowIso()
    });

    return {
      runtimeSession: updatedRuntimeSession ?? launchPlan.runtimeSession,
      services: startedServices
    };
  }

  private async createManagedRuntimeLaunchPlan(
    targetId: string,
    portRequests: DebugTargetPortRequest[],
    userId: string | null
  ): Promise<DebugLaunchPlan> {
    const target = this.getTargetOrThrow(targetId);
    const services = this.debugServiceRepository.listByTargetId(targetId);
    const analyses = this.frameworkAnalysisResultRepository.listByTargetId(targetId);

    if (services.length === 0 || analyses.length === 0) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DEBUG_TARGET_ANALYSIS_REQUIRED",
        detail: "当前调试目标还没有可用的框架分析结果，请先执行分析"
      });
    }

    const analysisByServiceId = new Map(
      analyses
        .filter((analysis) => analysis.serviceId)
        .map((analysis) => [analysis.serviceId as string, analysis])
    );
    const timestamp = nowIso();
    const runtimeSession = this.debugRuntimeSessionRepository.create({
      id: createId(),
      targetId: target.id,
      status: "PREPARING",
      failureStage: null,
      startedAt: null,
      stoppedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const planItems: DebugLaunchPlanServiceItem[] = [];
    const requestedPorts = await resolveRequestedPorts({
      targetRootPath: target.rootPath,
      services,
      portRequests,
      portLeaseRepository: this.portLeaseRepository
    });
    const portPoolConfig = this.resolvePortPoolConfig(userId);

    for (const service of services) {
      const analysis = analysisByServiceId.get(service.id) ?? analyses[0] ?? null;

      if (!analysis) {
        throw new AppError({
          statusCode: 409,
          errorCode: "DEBUG_TARGET_ANALYSIS_REQUIRED",
          detail: "调试服务缺少框架分析结果，无法生成启动计划"
        });
      }

      const allocatedPort = requestedPorts.get(service.id)
        ?? await allocateManagedPort(service.role, this.portLeaseRepository, portPoolConfig);
      const injectionPlan = resolveLaunchPlan({
        targetRootPath: target.rootPath,
        service,
        analysis,
        leasedPort: allocatedPort
      });
      const missingRequirements = resolveMissingRequirements(analysis);
      let aiFallbackEditRecord: AiFallbackEditRecord | null = null;
      const autoStartAllowed =
        isFrameworkEligible(analysis.compatibilityLevel)
        && missingRequirements.length === 0
        && injectionPlan.adapterKind !== "ai_fallback"
        && injectionPlan.adapterKind !== null;
      const portLeaseId = injectionPlan.leasedPort === null ? null : createId();
      const runtimeBindingId = createId();

      if (injectionPlan.aiFallback?.eligible) {
        aiFallbackEditRecord = this.aiFallbackEditRepository.create({
          id: createId(),
          runtimeId: runtimeSession.id,
          serviceId: service.id,
          reason: injectionPlan.aiFallback.reason,
          allowedFiles: injectionPlan.aiFallback.allowedFiles,
          targetPort: injectionPlan.leasedPort ?? allocatedPort,
          patchRef: null,
          rollbackRef: null,
          status: "PENDING",
          createdAt: timestamp
        });
      }

      if (portLeaseId && injectionPlan.leasedPort !== null) {
        this.portLeaseRepository.create({
          id: portLeaseId,
          runtimeId: runtimeSession.id,
          serviceId: service.id,
          port: injectionPlan.leasedPort,
          protocol: "tcp",
          status: "LEASED",
          leasedAt: timestamp,
          expiresAt: null,
          releasedAt: null
        });
      }

      this.runtimeBindingRepository.create({
        id: runtimeBindingId,
        runtimeId: runtimeSession.id,
        serviceId: service.id,
        processInstanceId: null,
        expectedPort: injectionPlan.expectedPort,
        leasedPort: injectionPlan.leasedPort,
        observedPort: null,
        proxyPath: null,
        status: "ALLOCATED",
        updatedAt: timestamp
      });

      planItems.push({
        serviceId: service.id,
        role: service.role,
        frameworkAnalysisId: analysis.id,
        primaryFramework: analysis.primaryFramework ?? null,
        compatibilityLevel: analysis.compatibilityLevel,
        adapterKind: injectionPlan.adapterKind ?? null,
        injectionMode: injectionPlan.injectionMode ?? null,
        command: service.command,
        args: injectionPlan.args,
        envPatch: injectionPlan.envPatch,
        expectedPort: injectionPlan.expectedPort,
        leasedPort: injectionPlan.leasedPort,
        artifactRef: injectionPlan.artifactRef,
        runtimeBindingId,
        portLeaseId,
        requiresServiceDiscoveryHandling: analysis.requiresServiceDiscoveryHandling,
        requiresHmrHandling: analysis.requiresHmrHandling,
        requiresCallbackHandling: analysis.requiresCallbackHandling,
        failureStage: injectionPlan.failureStage,
        adapterAttempts: injectionPlan.adapterAttempts,
        aiFallback: injectionPlan.aiFallback
          ? {
              ...injectionPlan.aiFallback,
              editId: aiFallbackEditRecord?.id ?? null,
              status: aiFallbackEditRecord?.status ?? injectionPlan.aiFallback.status
            }
          : null,
        missingRequirements,
        autoStartAllowed
      });
    }

    return {
      runtimeSession,
      targetId: target.id,
      autoStartAllowed: planItems.every((item) => item.autoStartAllowed),
      services: planItems
    };
  }

  private async createRegisteredTemplatePreviewPlan(
    targetId: string,
    portRequests: DebugTargetPortRequest[],
    userId: string | null
  ): Promise<DebugLaunchPlan> {
    const target = this.getTargetOrThrow(targetId);
    const analyses = this.frameworkAnalysisResultRepository.listByTargetId(targetId);

    if (analyses.length === 0) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DEBUG_TARGET_ANALYSIS_REQUIRED",
        detail: "当前调试目标还没有可用的框架分析结果，请先执行分析"
      });
    }

    const timestamp = nowIso();
    const runtimeSession = buildPreviewRuntimeSession(target.id, timestamp);
    const templates = listRegisteredTemplatesForTarget(
      this.terminalCommandTemplateRepository.listByWorkspace(target.workspaceId),
      target.rootPath
    );

    if (templates.length === 0) {
      return await this.createManagedRuntimeLaunchPlan(targetId, portRequests, userId);
    }

    const services = this.debugServiceRepository.listByTargetId(targetId);
    const runtimeStatuses = await discoverTemplateRuntimeStatuses(
      templates
        .filter((template) => template.port !== null)
        .map((template) => ({
          templateId: template.id,
          port: template.port as number
        }))
    );
    const runtimeStatusByTemplateId = new Map(
      runtimeStatuses.map((item) => [item.templateId, item] as const)
    );
    const portPoolConfig = this.resolvePortPoolConfig(userId);
    const requestedPorts = await resolveTemplateRequestedPorts({
      targetRootPath: target.rootPath,
      templates,
      portRequests,
      portLeaseRepository: this.portLeaseRepository
    });
    const templatePlans = await buildRegisteredTemplatePlanItems({
      target,
      templates,
      services,
      analyses,
      runtimeStatusByTemplateId,
      requestedPorts,
      portPoolConfig,
      portLeaseRepository: this.portLeaseRepository
    });

    return {
      runtimeSession,
      targetId: target.id,
      autoStartAllowed: templatePlans.length > 0 && templatePlans.every((item) => item.autoStartAllowed),
      services: templatePlans
    };
  }

  private resolvePortPoolConfig(userId: string | null): DebugPortPoolConfig {
    if (!userId) {
      return clonePortPoolConfig(DEFAULT_DEBUG_PORT_POOLS);
    }

    return clonePortPoolConfig(this.preferenceProfileService.getProfile(userId).debugPortPools);
  }

  async handleTerminalExit(event: { terminal: TerminalInstance; requestedClose: boolean }): Promise<void> {
    const runtimeId = event.terminal.debugRuntimeSessionId ?? null;

    if (!runtimeId) {
      return;
    }

    await this.reconcileRuntimeState(runtimeId, {
      preferredFailureStage: event.terminal.status === "error" ? "process_exit" : null,
      staleMissingBindingAsFailure: false
    });
  }

  async getRuntimeDetail(runtimeId: string): Promise<DebugRuntimeDetail> {
    const runtimeSession = this.debugRuntimeSessionRepository.findById(runtimeId);

    if (!runtimeSession) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DEBUG_RUNTIME_NOT_FOUND",
        detail: "调试运行时不存在"
      });
    }

    const reconciled = await this.reconcileRuntimeState(runtimeId, {
      preferredFailureStage: null,
      staleMissingBindingAsFailure: true
    });
    const target = this.getTargetOrThrow(reconciled.targetId);
    const services = this.debugServiceRepository.listByTargetId(target.id);
    const analyses = this.frameworkAnalysisResultRepository.listByTargetId(target.id);
    const bindings = this.runtimeBindingRepository.listByRuntimeId(runtimeId);
    const leases = this.portLeaseRepository.listByRuntimeId(runtimeId);
    const aiFallbackEdits = this.aiFallbackEditRepository.listByRuntimeId(runtimeId);

    return {
      runtimeSession: reconciled,
      target,
      services: services.map((service) => ({
        service,
        analysis: analyses.find((analysis) => analysis.serviceId === service.id) ?? null,
        binding: bindings.find((binding) => binding.serviceId === service.id) ?? null,
        portLease: leases.find((lease) => lease.serviceId === service.id) ?? null,
        processInstance: resolveProcessInstance(
          bindings.find((binding) => binding.serviceId === service.id)?.processInstanceId ?? null,
          this.terminalInstanceRepository
        ),
        aiFallbackEdits: aiFallbackEdits.filter((edit) => edit.serviceId === service.id)
      }))
    };
  }

  async getLatestRuntimeDetail(targetId: string): Promise<DebugRuntimeDetail | null> {
    this.getTargetOrThrow(targetId);
    const latestRuntime = this.debugRuntimeSessionRepository.listByTargetId(targetId)[0] ?? null;

    if (!latestRuntime) {
      return null;
    }

    return await this.getRuntimeDetail(latestRuntime.id);
  }

  async getRecentRuntimeDetails(targetId: string, limit = 5): Promise<DebugRuntimeHistoryEnvelope> {
    this.getTargetOrThrow(targetId);
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.trunc(limit))) : 5;
    const runtimes = this.debugRuntimeSessionRepository.listByTargetId(targetId).slice(0, normalizedLimit);
    const items: DebugRuntimeDetail[] = [];

    for (const runtime of runtimes) {
      items.push(await this.getRuntimeDetail(runtime.id));
    }

    return {
      targetId,
      items
    };
  }

  async runBackgroundRuntimeReconciliation(
    source = "debug_target.runtime_stale_reconciliation"
  ): Promise<DebugRuntimeReconciliationResult> {
    const task = this.taskManager.enqueue<
      DebugRuntimeReconciliationTaskInput,
      DebugRuntimeReconciliationResult
    >(HOST_TASK_TYPES.debugRuntimeStaleReconciliation, {
      key: "global",
      source,
      input: {
        trigger: source.includes("scheduler") ? "scheduler" : "manual"
      }
    });

    return await task.promise;
  }

  updateAiFallbackEdit(
    editId: string,
    action: "apply" | "reject" | "rollback",
    refs: {
      patchRef?: string | null;
      rollbackRef?: string | null;
    } = {}
  ): AiFallbackEditRecord {
    const existing = this.aiFallbackEditRepository.findById(editId);

    if (!existing) {
      throw new AppError({
        statusCode: 404,
        errorCode: "AI_FALLBACK_EDIT_NOT_FOUND",
        detail: "AI 兜底记录不存在"
      });
    }

    const nextStatus = resolveAiFallbackNextStatus(action);
    const updated = this.aiFallbackEditRepository.update({
      ...existing,
      patchRef: refs.patchRef ?? existing.patchRef ?? null,
      rollbackRef: refs.rollbackRef ?? existing.rollbackRef ?? null,
      status: nextStatus
    });

    return updated ?? existing;
  }

  private getTargetOrThrow(targetId: string): DebugTargetProfile {
    const target = this.debugTargetRepository.findById(targetId);

    if (!target) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DEBUG_TARGET_NOT_FOUND",
        detail: "调试目标不存在"
      });
    }

    return target;
  }

  private getServiceOrThrow(serviceId: string, targetId: string): DebugServiceSpec {
    const service = this.debugServiceRepository
      .listByTargetId(targetId)
      .find((item) => item.id === serviceId);

    if (!service) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DEBUG_SERVICE_NOT_FOUND",
        detail: "调试服务不存在"
      });
    }

    return service;
  }

  private upsertTarget(input: {
    workspaceId: string;
    rootPath: string;
    displayName: string;
    stackHint: string | null;
    sourceType: DebugTargetProfile["sourceType"];
    rootWorkspaceId: string | null;
    timestamp: string;
  }): DebugTargetProfile {
    const existing = this.debugTargetRepository.findByWorkspaceAndRootPath(input.workspaceId, input.rootPath);

    if (existing) {
      return this.debugTargetRepository.update({
        ...existing,
        displayName: input.displayName,
        stackHint: input.stackHint,
        sourceType: input.sourceType,
        rootWorkspaceId: input.rootWorkspaceId,
        updatedAt: input.timestamp
      }) ?? existing;
    }

    return this.debugTargetRepository.create({
      id: createId(),
      workspaceId: input.workspaceId,
      rootPath: input.rootPath,
      displayName: input.displayName,
      stackHint: input.stackHint,
      sourceType: input.sourceType,
      rootWorkspaceId: input.rootWorkspaceId,
      createdAt: input.timestamp,
      updatedAt: input.timestamp
    });
  }

  private resolveSourceMeta(workspaceId: string): {
    sourceType: DebugTargetProfile["sourceType"];
    rootWorkspaceId: string | null;
  } {
    const worktree = this.workspaceWorktreeRepository.findByWorkspaceId(workspaceId);

    if (!worktree) {
      return {
        sourceType: "repo",
        rootWorkspaceId: null
      };
    }

    return {
      sourceType: "worktree",
      rootWorkspaceId: worktree.rootWorkspaceId
    };
  }

  private resolveRootPath(workspacePath: string, rootPath: string): string {
    const normalized = rootPath.trim();

    if (!normalized) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "分析调试目标必须提供 rootPath",
        field: "rootPath"
      });
    }

    const resolved = path.resolve(normalized);

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "rootPath 必须是现有目录",
        field: "rootPath"
      });
    }

    const workspaceRoot = withTrailingSeparator(path.resolve(workspacePath));
    const candidateRoot = withTrailingSeparator(resolved);

    if (candidateRoot !== workspaceRoot && !candidateRoot.startsWith(workspaceRoot)) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "rootPath 必须位于当前工作区路径内",
        field: "rootPath"
      });
    }

    return resolved;
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.debugRuntimeStaleReconciliation)) {
      this.taskManager.register<
        DebugRuntimeReconciliationTaskInput,
        DebugRuntimeReconciliationResult
      >({
        taskType: HOST_TASK_TYPES.debugRuntimeStaleReconciliation,
        executionLane: "host_background",
        timeoutMs: 10_000,
        concurrency: 1,
        run: async () => this.reconcileActiveRuntimeLeases()
      });
    }
  }

  private async failRuntimePlan(
    runtimeId: string,
    failureStage: string,
    detail: string,
    statusCode: number,
    errorCode: string
  ): Promise<never> {
    const current = this.debugRuntimeSessionRepository.findById(runtimeId);
    const now = nowIso();

    if (current) {
      this.debugRuntimeSessionRepository.update({
        ...current,
        status: "FAILED",
        failureStage,
        stoppedAt: now,
        updatedAt: now
      });
    }

    for (const lease of this.portLeaseRepository.listByRuntimeId(runtimeId)) {
      this.portLeaseRepository.update({
        ...lease,
        status: "RELEASED",
        releasedAt: now
      });
    }

    for (const binding of this.runtimeBindingRepository.listByRuntimeId(runtimeId)) {
      this.runtimeBindingRepository.update({
        ...binding,
        status: "FAILED",
        updatedAt: now
      });
    }

    throw new AppError({
      statusCode,
      errorCode,
      detail
    });
  }

  private async reconcileActiveRuntimeLeases(): Promise<DebugRuntimeReconciliationResult> {
    const runtimeIds = this.collectReconciliationRuntimeIds();
    let reconciledRuntimeCount = 0;
    let staleLeaseCount = 0;
    let releasedLeaseCount = 0;
    let failedRuntimeCount = 0;
    let stoppedRuntimeCount = 0;

    for (const runtimeId of runtimeIds) {
      const runtimeBefore = this.debugRuntimeSessionRepository.findById(runtimeId);

      if (!runtimeBefore) {
        continue;
      }

      const staleLeaseIdsBefore = new Set(
        this.portLeaseRepository
          .listByRuntimeId(runtimeId)
          .filter((lease) => lease.status === "STALE")
          .map((lease) => lease.id)
      );
      const runtimeAfter = await this.reconcileRuntimeState(runtimeId, {
        preferredFailureStage: null,
        staleMissingBindingAsFailure: true
      });
      const staleLeases = this.portLeaseRepository
        .listByRuntimeId(runtimeId)
        .filter((lease) => lease.status === "STALE");

      staleLeaseCount += staleLeases.filter((lease) => !staleLeaseIdsBefore.has(lease.id)).length;
      releasedLeaseCount += this.releaseStaleLeases(staleLeases);
      reconciledRuntimeCount += 1;

      if (runtimeAfter.status === "FAILED") {
        failedRuntimeCount += 1;
      } else if (runtimeAfter.status === "STOPPED") {
        stoppedRuntimeCount += 1;
      }
    }

    return {
      scannedRuntimeCount: runtimeIds.length,
      reconciledRuntimeCount,
      staleLeaseCount,
      releasedLeaseCount,
      failedRuntimeCount,
      stoppedRuntimeCount,
      idle: runtimeIds.length === 0
    };
  }

  private async reconcileRuntimeState(
    runtimeId: string,
    options: {
      preferredFailureStage: string | null;
      staleMissingBindingAsFailure: boolean;
    }
  ): Promise<DebugRuntimeSession> {
    const runtime = this.debugRuntimeSessionRepository.findById(runtimeId);

    if (!runtime) {
      throw new AppError({
        statusCode: 404,
        errorCode: "DEBUG_RUNTIME_NOT_FOUND",
        detail: "调试运行时不存在"
      });
    }

    const bindings = this.runtimeBindingRepository.listByRuntimeId(runtimeId);
    const leases = this.portLeaseRepository.listByRuntimeId(runtimeId);

    if (bindings.length === 0) {
      return runtime;
    }

    let nextStatus = runtime.status;
    let nextFailureStage = runtime.failureStage ?? null;
    let nextStoppedAt = runtime.stoppedAt ?? null;
    const now = nowIso();
    let hasRunningProcess = false;
    let hasErroredProcess = false;
    let hasClosedProcess = false;
    let hasMissingProcess = false;

    for (const binding of bindings) {
      if (!binding.processInstanceId && runtime.status === "PREPARING") {
        continue;
      }

      const processInstance = resolveProcessInstance(binding.processInstanceId ?? null, this.terminalInstanceRepository);
      const lease = leases.find((item) => item.serviceId === binding.serviceId) ?? null;

      if (!processInstance) {
        hasMissingProcess = true;

        if (lease && (lease.status === "LEASED" || lease.status === "RELEASING")) {
          this.portLeaseRepository.update({
            ...lease,
            status: "STALE",
            releasedAt: lease.releasedAt ?? now
          });
        }

        if (binding.status !== "FAILED" && binding.status !== "RELEASED") {
          this.runtimeBindingRepository.update({
            ...binding,
            status: options.staleMissingBindingAsFailure ? "FAILED" : "RELEASED",
            updatedAt: now
          });
        }

        continue;
      }

      if (processInstance.status === "running") {
        hasRunningProcess = true;
        continue;
      }

      if (processInstance.status === "error") {
        hasErroredProcess = true;
        nextFailureStage = nextFailureStage ?? options.preferredFailureStage ?? "process_runtime_error";

        if (lease && lease.status !== "RELEASED") {
          this.portLeaseRepository.update({
            ...lease,
            status: "RELEASED",
            releasedAt: lease.releasedAt ?? now
          });
        }

        if (binding.status !== "FAILED") {
          this.runtimeBindingRepository.update({
            ...binding,
            status: "FAILED",
            updatedAt: now
          });
        }

        continue;
      }

      if (processInstance.status === "closed") {
        hasClosedProcess = true;

        if (lease && lease.status !== "RELEASED") {
          this.portLeaseRepository.update({
            ...lease,
            status: "RELEASED",
            releasedAt: lease.releasedAt ?? now
          });
        }

        if (binding.status !== "RELEASED") {
          this.runtimeBindingRepository.update({
            ...binding,
            status: "RELEASED",
            updatedAt: now
          });
        }
      }
    }

    if (hasErroredProcess || (hasMissingProcess && options.staleMissingBindingAsFailure)) {
      nextStatus = "FAILED";
      nextFailureStage = nextFailureStage ?? (hasMissingProcess ? "stale_runtime_binding" : "process_runtime_error");
      nextStoppedAt = now;
    } else if (hasRunningProcess) {
      nextStatus = "RUNNING";
      nextStoppedAt = null;
    } else if (hasClosedProcess || hasMissingProcess) {
      nextStatus = "STOPPED";
      nextFailureStage = null;
      nextStoppedAt = now;
    }

    if (
      nextStatus !== runtime.status ||
      nextFailureStage !== (runtime.failureStage ?? null) ||
      nextStoppedAt !== (runtime.stoppedAt ?? null)
    ) {
      return this.debugRuntimeSessionRepository.update({
        ...runtime,
        status: nextStatus,
        failureStage: nextFailureStage,
        stoppedAt: nextStoppedAt,
        updatedAt: now
      }) ?? runtime;
    }

    return runtime;
  }

  private collectReconciliationRuntimeIds(): string[] {
    const runtimeIds = new Set<string>();

    for (const runtime of this.debugRuntimeSessionRepository.listByStatuses([
      "PREPARING",
      "RUNNING"
    ] satisfies DebugRuntimeSessionStatus[])) {
      runtimeIds.add(runtime.id);
    }

    for (const lease of this.portLeaseRepository.listByStatuses(["STALE"])) {
      runtimeIds.add(lease.runtimeId);
    }

    return [...runtimeIds];
  }

  private releaseStaleLeases(staleLeases: PortLeaseRecord[]): number {
    if (staleLeases.length === 0) {
      return 0;
    }

    const now = nowIso();

    for (const lease of staleLeases) {
      this.portLeaseRepository.update({
        ...lease,
        status: "RELEASED",
        releasedAt: lease.releasedAt ?? now
      });
    }

    return staleLeases.length;
  }
}

function discoverServiceCandidates(
  rootPath: string,
  commandHints: string[] | undefined
): DiscoveredServiceCandidate[] {
  const rootPackageJson = readJsonFile(path.join(rootPath, "package.json"));
  const rootScripts = extractPackageScripts(rootPackageJson);
  const workspacePackages = discoverWorkspacePackages(rootPath, rootPackageJson);
  const candidatesFromRootScripts = discoverWorkspaceServiceCandidatesFromRootScripts(
    rootPath,
    workspacePackages,
    rootScripts
  );
  const candidatesFromWorkspacePackages = discoverWorkspaceServiceCandidatesFromPackages(
    rootPath,
    workspacePackages
  );
  const candidatesFromAppsPythonServices = discoverAppsPythonServiceCandidates(rootPath);
  const discoveredByCwd = new Map<string, DiscoveredServiceCandidate>();

  for (const candidate of [
    ...candidatesFromRootScripts,
    ...candidatesFromWorkspacePackages,
    ...candidatesFromAppsPythonServices
  ]) {
    if (!discoveredByCwd.has(candidate.cwd)) {
      discoveredByCwd.set(candidate.cwd, candidate);
    }
  }

  if (discoveredByCwd.size > 0) {
    return applyCommandHintFallback(
      sortDiscoveredServiceCandidates([...discoveredByCwd.values()]),
      commandHints
    );
  }

  return applyCommandHintFallback([
    {
      name: extractPackageName(rootPackageJson) ?? (path.basename(rootPath) || "service"),
      cwd: rootPath,
      commandHint: commandHints?.[0] ?? null,
      roleHint: null
    }
  ], commandHints);
}

interface WorkspacePackageInfo {
  name: string | null;
  dir: string;
  scripts: Record<string, string>;
}

function discoverWorkspacePackages(
  rootPath: string,
  rootPackageJson: Record<string, unknown> | null
): WorkspacePackageInfo[] {
  const packagePatterns = resolveWorkspacePackagePatterns(rootPath, rootPackageJson);
  const packages: WorkspacePackageInfo[] = [];
  const seenDirs = new Set<string>();

  for (const pattern of packagePatterns) {
    for (const packageDir of expandWorkspacePattern(rootPath, pattern)) {
      const normalizedDir = path.resolve(packageDir);

      if (seenDirs.has(normalizedDir)) {
        continue;
      }

      const packageJson = readJsonFile(path.join(normalizedDir, "package.json"));

      if (!packageJson) {
        continue;
      }

      seenDirs.add(normalizedDir);
      packages.push({
        name: extractPackageName(packageJson),
        dir: normalizedDir,
        scripts: extractPackageScripts(packageJson)
      });
    }
  }

  return packages.sort((left, right) => left.dir.localeCompare(right.dir));
}

function resolveWorkspacePackagePatterns(
  rootPath: string,
  rootPackageJson: Record<string, unknown> | null
): string[] {
  const patterns = extractPackageJsonWorkspacePatterns(rootPackageJson);

  if (patterns.length > 0) {
    return patterns;
  }

  const pnpmWorkspacePath = path.join(rootPath, "pnpm-workspace.yaml");

  if (!fs.existsSync(pnpmWorkspacePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(pnpmWorkspacePath, "utf8");
    return content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-+\s*/, "").replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function extractPackageJsonWorkspacePatterns(rootPackageJson: Record<string, unknown> | null): string[] {
  if (!rootPackageJson) {
    return [];
  }

  const rawWorkspaces = rootPackageJson.workspaces;

  if (Array.isArray(rawWorkspaces)) {
    return rawWorkspaces.filter((item): item is string => typeof item === "string");
  }

  if (rawWorkspaces && typeof rawWorkspaces === "object" && !Array.isArray(rawWorkspaces)) {
    const packages = (rawWorkspaces as { packages?: unknown }).packages;
    return Array.isArray(packages)
      ? packages.filter((item): item is string => typeof item === "string")
      : [];
  }

  return [];
}

function expandWorkspacePattern(rootPath: string, pattern: string): string[] {
  const normalizedPattern = pattern.replace(/\\/g, "/");

  if (normalizedPattern.endsWith("/*")) {
    const baseDir = path.join(rootPath, normalizedPattern.slice(0, -2));

    if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
      return [];
    }

    try {
      return fs.readdirSync(baseDir)
        .map((entry) => path.join(baseDir, entry))
        .filter((entryPath) => fs.existsSync(entryPath) && fs.statSync(entryPath).isDirectory());
    } catch {
      return [];
    }
  }

  const exactDir = path.join(rootPath, normalizedPattern);

  return fs.existsSync(exactDir) && fs.statSync(exactDir).isDirectory() ? [exactDir] : [];
}

function discoverWorkspaceServiceCandidatesFromRootScripts(
  rootPath: string,
  workspacePackages: WorkspacePackageInfo[],
  rootScripts: Record<string, string>
): DiscoveredServiceCandidate[] {
  const discovered: DiscoveredServiceCandidate[] = [];
  const seenDirs = new Set<string>();

  for (const [scriptName, scriptCommand] of Object.entries(rootScripts)) {
    if (scriptName !== "dev" && !scriptName.startsWith("dev:")) {
      continue;
    }

    const matchedPackage = resolveWorkspacePackageForRootScript(rootPath, workspacePackages, scriptName, scriptCommand);

    if (!matchedPackage || seenDirs.has(matchedPackage.dir)) {
      continue;
    }

    seenDirs.add(matchedPackage.dir);
    discovered.push({
      name: matchedPackage.name ?? (path.basename(matchedPackage.dir) || "service"),
      cwd: matchedPackage.dir,
      commandHint: resolveWorkspacePackageCommandHint(matchedPackage.scripts),
      roleHint: inferServiceRoleHint(scriptName, matchedPackage)
    });
  }

  return sortDiscoveredServiceCandidates(discovered);
}

function resolveWorkspacePackageForRootScript(
  rootPath: string,
  workspacePackages: WorkspacePackageInfo[],
  scriptName: string,
  scriptCommand: string
): WorkspacePackageInfo | null {
  const dirMatch = scriptCommand.match(/--dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/u);
  const dirToken = dirMatch?.[1] ?? dirMatch?.[2] ?? dirMatch?.[3] ?? null;

  if (dirToken) {
    const resolvedDir = path.resolve(rootPath, dirToken);
    const matched = workspacePackages.find((item) => item.dir === resolvedDir);

    if (matched) {
      return matched;
    }
  }

  const filterMatch = scriptCommand.match(/--filter(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/u);
  const filterToken = filterMatch?.[1] ?? filterMatch?.[2] ?? filterMatch?.[3] ?? null;

  if (filterToken) {
    const normalizedFilter = filterToken.trim();
    const matched = workspacePackages.find((item) =>
      item.name === normalizedFilter || path.basename(item.dir) === normalizedFilter
    );

    if (matched) {
      return matched;
    }
  }

  const scriptAlias = scriptName.split(":")[1]?.trim() ?? "";

  if (!scriptAlias) {
    return null;
  }

  return workspacePackages.find((item) =>
    item.name === scriptAlias || path.basename(item.dir) === scriptAlias
  ) ?? null;
}

function discoverWorkspaceServiceCandidatesFromPackages(
  rootPath: string,
  workspacePackages: WorkspacePackageInfo[]
): DiscoveredServiceCandidate[] {
  const discovered = workspacePackages
    .filter((item) => hasRunnableDevScript(item.scripts))
    .map((item) => ({
      name: item.name ?? (path.basename(item.dir) || "service"),
      cwd: item.dir,
      commandHint: resolveWorkspacePackageCommandHint(item.scripts),
      roleHint: inferServiceRoleHint(path.relative(rootPath, item.dir), item)
    }));

  return sortDiscoveredServiceCandidates(discovered);
}

function discoverAppsPythonServiceCandidates(rootPath: string): DiscoveredServiceCandidate[] {
  const appsDir = path.join(rootPath, "apps");

  if (!fs.existsSync(appsDir) || !fs.statSync(appsDir).isDirectory()) {
    return [];
  }

  let appEntries: string[] = [];

  try {
    appEntries = fs.readdirSync(appsDir);
  } catch {
    return [];
  }

  const discovered: DiscoveredServiceCandidate[] = [];

  for (const entry of appEntries) {
    const serviceDir = path.join(appsDir, entry);

    if (!fs.existsSync(serviceDir) || !fs.statSync(serviceDir).isDirectory()) {
      continue;
    }

    const framework = pickFramework(collectFrameworkEvidence(serviceDir));

    if (!isPythonFramework(framework.primaryFramework)) {
      continue;
    }

    discovered.push({
      name: path.basename(serviceDir) || "service",
      cwd: serviceDir,
      commandHint: null,
      roleHint: "backend"
    });
  }

  return sortDiscoveredServiceCandidates(discovered);
}

function hasRunnableDevScript(scripts: Record<string, string>): boolean {
  return Object.keys(scripts).some((name) => name === "dev" || name.startsWith("dev:"));
}

function resolveWorkspacePackageCommandHint(scripts: Record<string, string>): string | null {
  if (typeof scripts.dev === "string" && scripts.dev.trim().length > 0) {
    return "pnpm dev";
  }

  const devScriptName = Object.keys(scripts)
    .filter((name) => name.startsWith("dev:"))
    .sort()[0] ?? null;

  return devScriptName ? `pnpm run ${devScriptName}` : null;
}

function inferServiceRoleHint(
  signal: string,
  workspacePackage: WorkspacePackageInfo
): DebugServiceRole | null {
  const normalizedSignal = `${signal} ${workspacePackage.name ?? ""} ${path.basename(workspacePackage.dir)}`
    .toLowerCase();

  if (normalizedSignal.includes("frontend") || normalizedSignal.includes("user-app")
    || normalizedSignal.includes("web") || normalizedSignal.includes("ui")) {
    return "frontend";
  }

  if (normalizedSignal.includes("backend") || normalizedSignal.includes("server")
    || normalizedSignal.includes("api") || normalizedSignal.includes("host")) {
    return "backend";
  }

  if (normalizedSignal.includes("worker")) {
    return "worker";
  }

  if (normalizedSignal.includes("mock")) {
    return "mock";
  }

  return null;
}

function sortDiscoveredServiceCandidates(
  candidates: DiscoveredServiceCandidate[]
): DiscoveredServiceCandidate[] {
  return [...candidates].sort((left, right) => {
    const roleDelta = resolveDiscoveredServicePriority(left.roleHint) - resolveDiscoveredServicePriority(right.roleHint);

    if (roleDelta !== 0) {
      return roleDelta;
    }

    return left.cwd.localeCompare(right.cwd);
  });
}

function resolveDiscoveredServicePriority(role: DebugServiceRole | null): number {
  switch (role) {
    case "frontend":
      return 0;
    case "backend":
      return 1;
    case "worker":
      return 2;
    case "mock":
      return 3;
    default:
      return 4;
  }
}

function applyCommandHintFallback(
  candidates: DiscoveredServiceCandidate[],
  commandHints: string[] | undefined
): DiscoveredServiceCandidate[] {
  if (!commandHints || commandHints.length === 0) {
    return candidates;
  }

  return candidates.map((candidate, index) => ({
    ...candidate,
    commandHint: candidate.commandHint ?? commandHints[index] ?? (candidates.length === 1 ? commandHints[0] ?? null : null)
  }));
}

function extractPackageName(packageJson: Record<string, unknown> | null): string | null {
  const packageName = packageJson?.name;
  return typeof packageName === "string" && packageName.trim().length > 0 ? packageName.trim() : null;
}

function buildServiceRecord(
  target: DebugTargetProfile,
  candidate: DiscoveredServiceCandidate,
  framework: FrameworkDetectionResult,
  timestamp: string,
  frameworkAnalysisId: string
): DebugServiceSpec {
  const parsedCommand = parseCommandHint(
    candidate.commandHint ?? defaultCommandHintForFramework(framework.primaryFramework, candidate.cwd)
  );

  return {
    id: createId(),
    targetId: target.id,
    role: candidate.roleHint ?? resolveServiceRole(framework.primaryFramework),
    name: candidate.name,
    cwd: candidate.cwd,
    command: parsedCommand.command,
    args: parsedCommand.args,
    env: {},
    defaultPortHint: framework.defaultPortHint,
    protocol: "http",
    healthPath: null,
    adapterKind: normalizeAdapterKind(framework.primaryFramework),
    frameworkAnalysisId,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

interface DiscoveredServiceCandidate {
  name: string;
  cwd: string;
  commandHint: string | null;
  roleHint: DebugServiceRole | null;
}

function parseCommandHint(commandHint: string): { command: string; args: string[] } {
  const tokens = (commandHint.match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
    .map((item) => item.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      command: "npm",
      args: ["run", "dev"]
    };
  }

  return {
    command: tokens[0] ?? "npm",
    args: tokens.slice(1)
  };
}

function defaultCommandHintForFramework(framework: string | null, rootPath?: string): string {
  switch (framework) {
    case "spring-boot":
      return "./mvnw spring-boot:run";
    case "uvicorn":
      return `uvicorn ${inferUvicornAppSpec(rootPath)} --reload`;
    case "flask":
      return "flask run";
    case "django":
      return "python manage.py runserver";
    case "rails":
      return "bin/rails server";
    case "aspnet-core":
      return "dotnet watch run";
    default:
      return "npm run dev";
  }
}

function resolveServiceRole(framework: string | null): DebugServiceRole {
  switch (framework) {
    case "vite":
    case "nextjs":
    case "cra":
    case "astro":
    case "nuxt":
    case "vue-cli":
    case "remix":
      return "frontend";
    case "spring-boot":
    case "uvicorn":
    case "flask":
    case "django":
    case "rails":
    case "aspnet-core":
    case "nestjs":
    case "express":
    case "koa":
    case "hono":
    case "node-custom":
    case "go-http":
    case "laravel":
    case "php-custom":
      return "backend";
    default:
      return "custom";
  }
}

function inferUvicornAppSpec(rootPath: string | undefined): string {
  if (!rootPath) {
    return "main:app";
  }

  const candidates: Array<{ relativePath: string; moduleSpec: string }> = [
    {
      relativePath: "app/main.py",
      moduleSpec: "app.main:app"
    },
    {
      relativePath: "main.py",
      moduleSpec: "main:app"
    },
    {
      relativePath: "src/main.py",
      moduleSpec: "src.main:app"
    },
    {
      relativePath: "app.py",
      moduleSpec: "app:app"
    }
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(rootPath, candidate.relativePath))) {
      return candidate.moduleSpec;
    }
  }

  return "main:app";
}

function normalizeAdapterKind(framework: string | null): DebugServiceSpec["adapterKind"] {
  const item = getFrameworkCompatibilityItem(framework);

  if (item.recommendedInjectionMode === "none") {
    return null;
  }

  return item.recommendedInjectionMode;
}

function withTrailingSeparator(input: string): string {
  return input.endsWith(path.sep) ? input : `${input}${path.sep}`;
}

interface FrameworkDetectionResult {
  primaryFramework: string | null;
  confidence: FrameworkAnalysisConfidence;
  reasons: string[];
  detectedFiles: string[];
  rawEvidence: Record<string, unknown>;
  defaultPortHint: number | null;
}

function collectFrameworkEvidence(rootPath: string): FrameworkDetectionResult {
  const rawEvidence: Record<string, unknown> = {};
  const candidates = new Map<string, FrameworkDetectionCandidate>();
  const packageJson = readJsonFile(path.join(rootPath, "package.json"));
  const packageDeps = extractPackageDependencies(packageJson);
  const packageScripts = extractPackageScripts(packageJson);

  if (packageJson) {
    rawEvidence.packageJson = {
      dependencies: Object.keys(packageDeps),
      scripts: Object.keys(packageScripts)
    };
  }

  const addCandidateSignal = (
    framework: string,
    score: number,
    reason: string,
    files: string[],
    defaultPortHint: number | null
  ) => {
    const candidate = candidates.get(framework) ?? {
      framework,
      score: 0,
      reasons: [],
      detectedFiles: [],
      defaultPortHint
    };

    candidate.score += score;
    candidate.defaultPortHint = candidate.defaultPortHint ?? defaultPortHint;

    if (!candidate.reasons.includes(reason)) {
      candidate.reasons.push(reason);
    }

    for (const file of files) {
      if (!candidate.detectedFiles.includes(file)) {
        candidate.detectedFiles.push(file);
      }
    }

    candidates.set(framework, candidate);
  };
  const firstExistingFile = (relativePaths: string[]): string | null => {
    for (const relativePath of relativePaths) {
      if (fs.existsSync(path.join(rootPath, relativePath))) {
        return relativePath;
      }
    }

    return null;
  };
  const existingFiles = (relativePaths: string[]): string[] =>
    relativePaths.filter((relativePath) => fs.existsSync(path.join(rootPath, relativePath)));

  if (packageJson) {
    addCandidateSignal("node-custom", 1, "命中 package.json，存在通用 Node 项目特征", ["package.json"], 3000);
  }

  const viteConfig = firstExistingFile(["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"]);

  if (viteConfig) {
    addCandidateSignal("vite", 4, "命中 Vite 配置文件", [viteConfig, "package.json"], 5173);
  }

  if (packageDeps.vite) {
    addCandidateSignal("vite", 3, "package.json 含 vite 依赖", ["package.json"], 5173);
  }

  if (includesScriptCommand(packageScripts, "vite")) {
    addCandidateSignal("vite", 2, "package.json 的脚本命中了 vite 命令", ["package.json"], 5173);
  }

  const nextConfig = firstExistingFile(["next.config.js", "next.config.mjs", "next.config.ts"]);

  if (nextConfig) {
    addCandidateSignal("nextjs", 4, "命中 Next.js 配置文件", [nextConfig, "package.json"], 3000);
  }

  if (packageDeps.next) {
    addCandidateSignal("nextjs", 3, "package.json 含 next 依赖", ["package.json"], 3000);
  }

  if (includesScriptCommand(packageScripts, "next dev")) {
    addCandidateSignal("nextjs", 2, "package.json 的脚本命中了 next dev", ["package.json"], 3000);
  }

  if (packageDeps["react-scripts"]) {
    addCandidateSignal("cra", 3, "package.json 命中 react-scripts 依赖", ["package.json"], 3000);
  }

  if (includesScriptCommand(packageScripts, "react-scripts")) {
    addCandidateSignal("cra", 2, "package.json 的脚本命中了 react-scripts", ["package.json"], 3000);
  }

  const astroConfig = firstExistingFile(["astro.config.mjs", "astro.config.ts", "astro.config.js"]);

  if (astroConfig) {
    addCandidateSignal("astro", 4, "命中 Astro 配置文件", [astroConfig, "package.json"], 4321);
  }

  if (packageDeps.astro) {
    addCandidateSignal("astro", 3, "package.json 含 astro 依赖", ["package.json"], 4321);
  }

  const nuxtConfig = firstExistingFile(["nuxt.config.ts", "nuxt.config.js"]);

  if (nuxtConfig) {
    addCandidateSignal("nuxt", 4, "命中 Nuxt 配置文件", [nuxtConfig, "package.json"], 3000);
  }

  if (packageDeps.nuxt) {
    addCandidateSignal("nuxt", 3, "package.json 含 nuxt 依赖", ["package.json"], 3000);
  }

  if (fs.existsSync(path.join(rootPath, "vue.config.js"))) {
    addCandidateSignal("vue-cli", 4, "命中 Vue CLI 配置文件", ["vue.config.js", "package.json"], 8080);
  }

  if (packageDeps["@vue/cli-service"]) {
    addCandidateSignal("vue-cli", 3, "package.json 含 @vue/cli-service 依赖", ["package.json"], 8080);
  }

  const remixConfig = firstExistingFile(["remix.config.js", "remix.config.mjs", "remix.config.ts"]);

  if (remixConfig) {
    addCandidateSignal("remix", 4, "命中 Remix 配置文件", [remixConfig, "package.json"], 3000);
  }

  if (packageDeps["@remix-run/dev"] || packageDeps["@remix-run/react"]) {
    addCandidateSignal("remix", 3, "package.json 含 Remix 依赖", ["package.json"], 3000);
  }

  if (includesScriptCommand(packageScripts, "remix dev")) {
    addCandidateSignal("remix", 2, "package.json 的脚本命中了 remix dev", ["package.json"], 3000);
  }

  const electronFiles = existingFiles(["electron-builder.json", "electron.vite.config.ts", "electron.vite.config.js"]);

  if (electronFiles.length > 0) {
    addCandidateSignal("electron", 4, "命中 Electron 配置文件", electronFiles, 3000);
  }

  if (packageDeps.electron || packageDeps["electron-vite"]) {
    addCandidateSignal("electron", 3, "package.json 含 Electron 相关依赖", ["package.json"], 3000);
  }

  const tauriConfig = firstExistingFile(["src-tauri/tauri.conf.json", "src-tauri/tauri.conf.json5"]);

  if (tauriConfig) {
    addCandidateSignal("tauri", 4, "命中 Tauri 配置文件", [tauriConfig, "package.json"], 3000);
  }

  if (packageDeps["@tauri-apps/cli"]) {
    addCandidateSignal("tauri", 3, "package.json 含 @tauri-apps/cli 依赖", ["package.json"], 3000);
  }

  const pomPath = path.join(rootPath, "pom.xml");

  if (fs.existsSync(pomPath) && fileContains(pomPath, "spring-boot")) {
    addCandidateSignal("spring-boot", 5, "pom.xml 命中 spring-boot 关键字", ["pom.xml"], 8080);
  }

  const gradleFiles = existingFiles(["build.gradle", "build.gradle.kts"]);

  for (const gradleFile of gradleFiles) {
    if (fileContains(path.join(rootPath, gradleFile), "spring-boot")) {
      addCandidateSignal("spring-boot", 4, `${gradleFile} 命中 spring-boot 关键字`, [gradleFile], 8080);
    }
  }

  if (existingFiles(["application.properties", "application.yml", "application.yaml"]).length > 0) {
    addCandidateSignal("spring-boot", 1, "命中 Spring Boot 常见应用配置文件", existingFiles([
      "application.properties",
      "application.yml",
      "application.yaml"
    ]), 8080);
  }

  const requirementsExists = fs.existsSync(path.join(rootPath, "requirements.txt"));
  const pyprojectExists = fs.existsSync(path.join(rootPath, "pyproject.toml"));

  if ((requirementsExists && fileContains(path.join(rootPath, "requirements.txt"), "uvicorn"))
    || (pyprojectExists && fileContains(path.join(rootPath, "pyproject.toml"), "fastapi"))) {
    addCandidateSignal("uvicorn", 4, "Python 依赖中命中 uvicorn / fastapi", existingFiles([
      "requirements.txt",
      "pyproject.toml"
    ]), 8000);
  }

  if (requirementsExists && fileContains(path.join(rootPath, "requirements.txt"), "flask")) {
    addCandidateSignal("flask", 3, "requirements.txt 命中 flask", ["requirements.txt"], 5000);
  }

  if (fs.existsSync(path.join(rootPath, "app.py"))) {
    addCandidateSignal("flask", 2, "命中 Flask 常见入口 app.py", ["app.py"], 5000);
  }

  if (fs.existsSync(path.join(rootPath, "manage.py"))) {
    addCandidateSignal("django", 4, "命中 Django 入口 manage.py", ["manage.py"], 8000);
  }

  if (requirementsExists && fileContains(path.join(rootPath, "requirements.txt"), "django")) {
    addCandidateSignal("django", 3, "requirements.txt 命中 django", ["requirements.txt"], 8000);
  }

  if (fs.existsSync(path.join(rootPath, "settings.py"))) {
    addCandidateSignal("django", 1, "命中 Django 常见配置 settings.py", ["settings.py"], 8000);
  }

  if (fs.existsSync(path.join(rootPath, "Gemfile")) && fileContains(path.join(rootPath, "Gemfile"), "rails")) {
    addCandidateSignal("rails", 4, "Gemfile 命中 Rails", ["Gemfile"], 3000);
  }

  const csprojFiles = safeListFiles(rootPath).filter((filePath) => filePath.endsWith(".csproj"));

  if (csprojFiles.length > 0) {
    addCandidateSignal(
      "aspnet-core",
      4,
      "命中 .csproj 项目文件",
      csprojFiles.slice(0, 3).map((filePath) => path.basename(filePath)),
      5000
    );
  }

  if (fs.existsSync(path.join(rootPath, "Program.cs"))) {
    addCandidateSignal("aspnet-core", 1, "命中 ASP.NET Core 常见入口 Program.cs", ["Program.cs"], 5000);
  }

  if (packageDeps["@nestjs/core"]) {
    addCandidateSignal("nestjs", 3, "package.json 命中 @nestjs/core 依赖", ["package.json"], 3000);
  }

  if (includesScriptCommand(packageScripts, "nest start")) {
    addCandidateSignal("nestjs", 2, "package.json 的脚本命中了 nest start", ["package.json"], 3000);
  }

  const nestEntry = firstExistingFile(["src/main.ts", "src/main.js"]);

  if (nestEntry && (packageDeps["@nestjs/core"] || includesScriptCommand(packageScripts, "nest start"))) {
    addCandidateSignal("nestjs", 1, "命中 NestJS 常见入口文件", [nestEntry], 3000);
  }

  if (packageDeps.express) {
    addCandidateSignal("express", 3, "package.json 命中 express 依赖", ["package.json"], 3000);
  }

  if (packageDeps.koa) {
    addCandidateSignal("koa", 3, "package.json 命中 koa 依赖", ["package.json"], 3000);
  }

  if (packageDeps.hono) {
    addCandidateSignal("hono", 3, "package.json 命中 hono 依赖", ["package.json"], 3000);
  }

  const nodeEntry = firstExistingFile(["server.ts", "server.js", "app.ts", "app.js", "main.ts", "main.js", "index.ts", "index.js"]);

  if (nodeEntry) {
    addCandidateSignal("node-custom", 1, "命中通用 Node 服务入口文件", [nodeEntry], 3000);
  }

  if (fs.existsSync(path.join(rootPath, "go.mod"))) {
    addCandidateSignal("go-http", 4, "命中 go.mod，第一阶段按 Go 自定义 HTTP 服务处理", ["go.mod"], 8080);
  }

  if (fs.existsSync(path.join(rootPath, "artisan"))) {
    addCandidateSignal("laravel", 4, "命中 Laravel 入口 artisan", ["artisan"], 8000);
  }

  if (fs.existsSync(path.join(rootPath, "composer.json"))
    && fileContains(path.join(rootPath, "composer.json"), "laravel")) {
    addCandidateSignal("laravel", 3, "composer.json 命中 laravel 依赖", ["composer.json"], 8000);
  }

  if (fs.existsSync(path.join(rootPath, "composer.json"))) {
    addCandidateSignal("php-custom", 1, "命中 composer.json，存在 PHP 项目特征", ["composer.json"], 8000);
  }

  rawEvidence.candidates = Array.from(candidates.values())
    .sort((left, right) => right.score - left.score)
    .map((candidate) => ({
      framework: candidate.framework,
      score: candidate.score,
      reasons: candidate.reasons,
      detectedFiles: candidate.detectedFiles
    }));

  const selected = selectFrameworkCandidate(candidates);

  if (!selected) {
    return buildDetection(
      null,
      "low",
      ["未识别到受支持框架的稳定特征"],
      packageJson ? ["package.json"] : [],
      rawEvidence,
      null
    );
  }

  rawEvidence.selectedCandidate = {
    framework: selected.framework,
    score: selected.score
  };

  return buildDetection(
    selected.framework,
    confidenceByCandidateScore(selected.score),
    selected.reasons,
    selected.detectedFiles,
    rawEvidence,
    selected.defaultPortHint
  );
}

function buildDetection(
  primaryFramework: string | null,
  confidence: FrameworkAnalysisConfidence,
  reasons: string[],
  detectedFiles: string[],
  rawEvidence: Record<string, unknown>,
  defaultPortHint: number | null
): FrameworkDetectionResult {
  return {
    primaryFramework,
    confidence,
    reasons,
    detectedFiles,
    rawEvidence,
    defaultPortHint
  };
}

function confidenceByCandidateScore(score: number): FrameworkAnalysisConfidence {
  if (score >= 6) {
    return "high";
  }

  if (score >= 3) {
    return "medium";
  }

  return "low";
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractPackageDependencies(packageJson: Record<string, unknown> | null): Record<string, string> {
  if (!packageJson) {
    return {};
  }

  const mergedEntries = [
    ...(objectEntries(packageJson.dependencies)),
    ...(objectEntries(packageJson.devDependencies))
  ];

  return Object.fromEntries(mergedEntries.filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function extractPackageScripts(packageJson: Record<string, unknown> | null): Record<string, string> {
  if (!packageJson) {
    return {};
  }

  return Object.fromEntries(
    objectEntries(packageJson.scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function objectEntries(value: unknown): Array<[string, unknown]> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>)
    : [];
}

function includesScriptCommand(scripts: Record<string, string>, needle: string): boolean {
  return Object.values(scripts).some((script) => script.includes(needle));
}

function fileContains(filePath: string, needle: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    return fs.readFileSync(filePath, "utf8").includes(needle);
  } catch {
    return false;
  }
}

function safeListFiles(rootPath: string): string[] {
  try {
    return fs.readdirSync(rootPath).map((name) => path.join(rootPath, name));
  } catch {
    return [];
  }
}

function pickFramework(result: FrameworkDetectionResult): FrameworkDetectionResult {
  return result;
}

function isPythonFramework(framework: string | null): boolean {
  return framework === "uvicorn" || framework === "flask" || framework === "django";
}

function resolveAnalyzeCommandHints(input: {
  workspaceId: string;
  rootPath: string;
  explicitCommandHints: string[] | undefined;
  terminalCommandTemplateRepository: {
    listByWorkspace(workspaceId: string): TerminalCommandTemplate[];
  };
}): string[] | undefined {
  const templateHints = collectTemplateCommandHints(
    input.terminalCommandTemplateRepository.listByWorkspace(input.workspaceId),
    input.rootPath
  );
  const explicitHints = (input.explicitCommandHints ?? []).map((item) => item.trim()).filter(Boolean);
  const mergedHints = [...templateHints, ...explicitHints];

  return mergedHints.length > 0 ? [...new Set(mergedHints)] : undefined;
}

function collectTemplateCommandHints(
  templates: TerminalCommandTemplate[],
  rootPath: string
): string[] {
  return templates
    .filter((template) => isTemplateRelevantToRootPath(template, rootPath))
    .sort((left, right) => compareTemplatePriority(left, right, rootPath))
    .map((template) => buildTemplateCommandHint(template))
    .filter((item): item is string => Boolean(item));
}

function isTemplateRelevantToRootPath(template: TerminalCommandTemplate, rootPath: string): boolean {
  const templateCwd = path.resolve(template.cwd);
  const normalizedRootPath = path.resolve(rootPath);

  return isPathWithin(normalizedRootPath, templateCwd) || isPathWithin(templateCwd, normalizedRootPath);
}

function compareTemplatePriority(
  left: TerminalCommandTemplate,
  right: TerminalCommandTemplate,
  rootPath: string
): number {
  const backendDelta = Number(isLikelyBackendTemplate(right)) - Number(isLikelyBackendTemplate(left));

  if (backendDelta !== 0) {
    return backendDelta;
  }

  const sourceDelta = resolveTemplateSourcePriority(left) - resolveTemplateSourcePriority(right);

  if (sourceDelta !== 0) {
    return sourceDelta;
  }

  const distanceDelta = resolveTemplateDistance(left, rootPath) - resolveTemplateDistance(right, rootPath);

  if (distanceDelta !== 0) {
    return distanceDelta;
  }

  return left.cwd.localeCompare(right.cwd);
}

function resolveTemplateSourcePriority(template: TerminalCommandTemplate): number {
  return template.sourceType === "debug_service" ? 1 : 0;
}

function resolveTemplateDistance(template: TerminalCommandTemplate, rootPath: string): number {
  const templateCwd = path.resolve(template.cwd);
  const normalizedRootPath = path.resolve(rootPath);

  if (templateCwd === normalizedRootPath) {
    return 0;
  }

  if (isPathWithin(normalizedRootPath, templateCwd)) {
    return 1;
  }

  if (isPathWithin(templateCwd, normalizedRootPath)) {
    return 2;
  }

  return 3;
}

function buildTemplateCommandHint(template: TerminalCommandTemplate): string | null {
  const command = template.command.trim();
  const args = template.args.map((item) => item.trim()).filter(Boolean);

  if (!command) {
    return null;
  }

  return [command, ...args].join(" ");
}

function isLikelyBackendTemplate(template: TerminalCommandTemplate): boolean {
  const signal = [
    template.name,
    template.cwd,
    template.command,
    ...template.args
  ].join(" ").toLowerCase();

  return (
    signal.includes("backend")
    || signal.includes("server")
    || signal.includes("api")
    || signal.includes("host")
    || signal.includes("python")
    || signal.includes("uvicorn")
    || signal.includes("gunicorn")
    || signal.includes("flask")
    || signal.includes("django")
    || signal.includes("manage.py")
  );
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const normalizedParent = withTrailingSeparator(path.resolve(parentPath));
  const normalizedChild = path.resolve(childPath);

  return normalizedChild === path.resolve(parentPath) || normalizedChild.startsWith(normalizedParent);
}

interface FrameworkDetectionCandidate {
  framework: string;
  score: number;
  reasons: string[];
  detectedFiles: string[];
  defaultPortHint: number | null;
}

function selectFrameworkCandidate(
  candidates: Map<string, FrameworkDetectionCandidate>
): FrameworkDetectionCandidate | null {
  return Array.from(candidates.values())
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.framework.localeCompare(right.framework);
    })[0] ?? null;
}

function resolveMissingRequirements(analysis: FrameworkAnalysisResult): string[] {
  const missing: string[] = [];

  if (analysis.requiresServiceDiscoveryHandling) {
    missing.push("service_discovery");
  }

  if (analysis.requiresHmrHandling) {
    missing.push("hmr");
  }

  if (analysis.requiresCallbackHandling) {
    missing.push("callback");
  }

  return missing;
}

function isFrameworkEligible(level: FrameworkCompatibilityLevel): boolean {
  return level === "supported" || level === "conditional";
}

interface RegisteredTemplatePlanBuildInput {
  target: DebugTargetProfile;
  templates: TerminalCommandTemplate[];
  services: DebugServiceSpec[];
  analyses: FrameworkAnalysisResult[];
  runtimeStatusByTemplateId: Map<string, { occupied: boolean }>;
  requestedPorts: Map<string, number>;
  portPoolConfig: DebugPortPoolConfig;
  portLeaseRepository: PortLeaseRepository;
}

interface MatchedTemplateAnalysisContext {
  template: TerminalCommandTemplate;
  role: DebugServiceRole;
  service: DebugServiceSpec | null;
  analysis: FrameworkAnalysisResult | null;
}

async function buildRegisteredTemplatePlanItems(
  input: RegisteredTemplatePlanBuildInput
): Promise<DebugLaunchPlanServiceItem[]> {
  const matchedContexts = input.templates.map((template) =>
    matchTemplateAnalysisContext(template, input.services, input.analyses)
  );
  const configuredPortCount = new Map<number, number>();
  const plannedPortByTemplateId = new Map<string, number | null>();
  const usedPorts = new Set<number>();

  for (const template of input.templates) {
    if (template.port !== null) {
      configuredPortCount.set(template.port, (configuredPortCount.get(template.port) ?? 0) + 1);
    }
  }

  for (const context of matchedContexts) {
    const requestedPort = input.requestedPorts.get(context.template.id);

    if (requestedPort !== undefined) {
      plannedPortByTemplateId.set(context.template.id, requestedPort);
      usedPorts.add(requestedPort);
      continue;
    }

    if (context.template.port === null) {
      plannedPortByTemplateId.set(context.template.id, null);
      continue;
    }

    const runtimeStatus = input.runtimeStatusByTemplateId.get(context.template.id) ?? null;
    const needsOrchestration =
      input.target.sourceType === "worktree"
      || (configuredPortCount.get(context.template.port) ?? 0) > 1
      || runtimeStatus?.occupied === true
      || input.portLeaseRepository.findActiveByPort(context.template.port, "tcp") !== null
      || usedPorts.has(context.template.port);

    if (!needsOrchestration) {
      plannedPortByTemplateId.set(context.template.id, context.template.port);
      usedPorts.add(context.template.port);
      continue;
    }

    const allocatedPort = await allocateManagedPort(
      context.role,
      input.portLeaseRepository,
      input.portPoolConfig,
      usedPorts
    );
    plannedPortByTemplateId.set(context.template.id, allocatedPort);
    usedPorts.add(allocatedPort);
  }

  const backendEndpoint = resolveRegisteredTemplateBackendEndpoint(matchedContexts, plannedPortByTemplateId);

  return matchedContexts.map((context) => {
    const plannedPort = plannedPortByTemplateId.get(context.template.id) ?? null;
    const runtimeBindingId = createId();
    const analysis = context.analysis;

    if (!analysis) {
      return {
        serviceId: context.template.id,
        role: context.role,
        frameworkAnalysisId: null,
        primaryFramework: null,
        compatibilityLevel: "unknown",
        adapterKind: context.template.adapterKind ?? null,
        injectionMode: context.template.injectionMode ?? null,
        command: context.template.command,
        args: context.template.args,
        envPatch: {},
        expectedPort: context.template.port,
        leasedPort: plannedPort,
        artifactRef: context.template.generatedArtifactRef ?? null,
        runtimeBindingId,
        portLeaseId: null,
        requiresServiceDiscoveryHandling: false,
        requiresHmrHandling: false,
        requiresCallbackHandling: false,
        failureStage: "framework_analysis_missing",
        adapterAttempts: [],
        aiFallback: null,
        missingRequirements: ["analysis"],
        autoStartAllowed: false
      };
    }

    if (plannedPort === null) {
      return {
        serviceId: context.template.id,
        role: context.role,
        frameworkAnalysisId: analysis.id,
        primaryFramework: analysis.primaryFramework ?? null,
        compatibilityLevel: analysis.compatibilityLevel,
        adapterKind: context.template.adapterKind ?? null,
        injectionMode: context.template.injectionMode ?? null,
        command: context.template.command,
        args: context.template.args,
        envPatch: {},
        expectedPort: context.template.port,
        leasedPort: null,
        artifactRef: context.template.generatedArtifactRef ?? null,
        runtimeBindingId,
        portLeaseId: null,
        requiresServiceDiscoveryHandling: analysis.requiresServiceDiscoveryHandling,
        requiresHmrHandling: analysis.requiresHmrHandling,
        requiresCallbackHandling: analysis.requiresCallbackHandling,
        failureStage: "port_unconfigured",
        adapterAttempts: [],
        aiFallback: null,
        missingRequirements: ["port"],
        autoStartAllowed: false
      };
    }

    const injectionPlan = resolveLaunchPlan({
      targetRootPath: input.target.rootPath,
      service: buildTemplateBackedDebugService(context.template, context.role, analysis.id),
      analysis,
      leasedPort: plannedPort
    });
    const serviceDiscoveryEnvPatch = buildServiceDiscoveryEnvPatch({
      role: context.role,
      analysis,
      backendEndpoint
    });
    const missingRequirements = resolveRegisteredTemplateMissingRequirements(analysis, {
      role: context.role,
      backendEndpoint
    });
    const envPatch = {
      ...injectionPlan.envPatch,
      ...serviceDiscoveryEnvPatch
    };
    const autoStartAllowed =
      isFrameworkEligible(analysis.compatibilityLevel)
      && missingRequirements.length === 0
      && injectionPlan.adapterKind !== "ai_fallback"
      && injectionPlan.adapterKind !== null;

    return {
      serviceId: context.template.id,
      role: context.role,
      frameworkAnalysisId: analysis.id,
      primaryFramework: analysis.primaryFramework ?? null,
      compatibilityLevel: analysis.compatibilityLevel,
      adapterKind: injectionPlan.adapterKind ?? null,
      injectionMode: injectionPlan.injectionMode ?? null,
      command: context.template.command,
      args: injectionPlan.args,
      envPatch,
      expectedPort: context.template.port,
      leasedPort: plannedPort,
      artifactRef: injectionPlan.artifactRef ?? context.template.generatedArtifactRef ?? null,
      runtimeBindingId,
      portLeaseId: null,
      requiresServiceDiscoveryHandling: analysis.requiresServiceDiscoveryHandling,
      requiresHmrHandling: analysis.requiresHmrHandling,
      requiresCallbackHandling: analysis.requiresCallbackHandling,
      failureStage: injectionPlan.failureStage,
      adapterAttempts: injectionPlan.adapterAttempts,
      aiFallback: injectionPlan.aiFallback,
      missingRequirements,
      autoStartAllowed
    };
  });
}

function buildPreviewRuntimeSession(targetId: string, timestamp: string): DebugRuntimeSession {
  return {
    id: `preview-${createId()}`,
    targetId,
    status: "PREPARING",
    failureStage: null,
    startedAt: null,
    stoppedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function listRegisteredTemplatesForTarget(
  templates: TerminalCommandTemplate[],
  rootPath: string
): TerminalCommandTemplate[] {
  return templates
    .filter((template) => template.managedBySystem !== true)
    .filter((template) => isTemplateRelevantToRootPath(template, rootPath))
    .sort((left, right) => compareTemplatePriority(left, right, rootPath));
}

function matchTemplateAnalysisContext(
  template: TerminalCommandTemplate,
  services: DebugServiceSpec[],
  analyses: FrameworkAnalysisResult[]
): MatchedTemplateAnalysisContext {
  const analysisByServiceId = new Map(
    analyses
      .filter((analysis) => analysis.serviceId)
      .map((analysis) => [analysis.serviceId as string, analysis] as const)
  );
  const normalizedTemplateCwd = path.resolve(template.cwd);
  const templateRole = inferTemplateRole(template);
  const matchedService = [...services]
    .sort((left, right) => compareServiceMatchPriority(left, right, normalizedTemplateCwd, templateRole))
    .find((service) => {
      const serviceCwd = path.resolve(service.cwd);
      return serviceCwd === normalizedTemplateCwd
        || isPathWithin(normalizedTemplateCwd, serviceCwd)
        || isPathWithin(serviceCwd, normalizedTemplateCwd);
    }) ?? null;
  const analysis = matchedService ? analysisByServiceId.get(matchedService.id) ?? null : null;

  return {
    template,
    role: matchedService?.role ?? templateRole,
    service: matchedService,
    analysis
  };
}

function compareServiceMatchPriority(
  left: DebugServiceSpec,
  right: DebugServiceSpec,
  templateCwd: string,
  templateRole: DebugServiceRole
): number {
  const leftExact = Number(path.resolve(left.cwd) === templateCwd);
  const rightExact = Number(path.resolve(right.cwd) === templateCwd);

  if (rightExact !== leftExact) {
    return rightExact - leftExact;
  }

  const leftRoleMatch = Number(left.role === templateRole);
  const rightRoleMatch = Number(right.role === templateRole);

  if (rightRoleMatch !== leftRoleMatch) {
    return rightRoleMatch - leftRoleMatch;
  }

  const leftDistance = resolveRelativePathDistance(templateCwd, left.cwd);
  const rightDistance = resolveRelativePathDistance(templateCwd, right.cwd);

  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }

  return left.name.localeCompare(right.name);
}

function resolveRelativePathDistance(leftPath: string, rightPath: string): number {
  const normalizedLeft = withTrailingSeparator(path.resolve(leftPath));
  const normalizedRight = withTrailingSeparator(path.resolve(rightPath));

  if (normalizedLeft === normalizedRight) {
    return 0;
  }

  if (normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft)) {
    return 1;
  }

  return 2;
}

function inferTemplateRole(template: TerminalCommandTemplate): DebugServiceRole {
  const signal = [
    template.name,
    template.cwd,
    template.command,
    ...template.args
  ].join(" ").toLowerCase();

  if (
    signal.includes("frontend")
    || signal.includes("web")
    || signal.includes("ui")
    || signal.includes("vite")
    || signal.includes("next")
    || signal.includes("astro")
    || signal.includes("nuxt")
    || signal.includes("vue")
    || signal.includes("remix")
  ) {
    return "frontend";
  }

  if (signal.includes("worker")) {
    return "worker";
  }

  if (signal.includes("mock")) {
    return "mock";
  }

  if (
    signal.includes("backend")
    || signal.includes("server")
    || signal.includes("api")
    || signal.includes("host")
    || signal.includes("express")
    || signal.includes("nestjs")
    || signal.includes("koa")
    || signal.includes("hono")
    || signal.includes("uvicorn")
    || signal.includes("flask")
    || signal.includes("django")
    || signal.includes("spring")
    || signal.includes("rails")
    || signal.includes("dotnet")
  ) {
    return "backend";
  }

  return "custom";
}

function buildTemplateBackedDebugService(
  template: TerminalCommandTemplate,
  role: DebugServiceRole,
  frameworkAnalysisId: string | null
): DebugServiceSpec {
  return {
    id: template.id,
    targetId: template.debugTargetId ?? "",
    role,
    name: template.name,
    cwd: template.cwd,
    command: template.command,
    args: template.args,
    env: template.env,
    defaultPortHint: template.port,
    protocol: "http",
    healthPath: null,
    adapterKind: template.adapterKind ?? null,
    frameworkAnalysisId,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

function resolveRegisteredTemplateBackendEndpoint(
  contexts: MatchedTemplateAnalysisContext[],
  plannedPortByTemplateId: Map<string, number | null>
): string | null {
  const candidate = contexts.find((context) =>
    context.role === "backend" && plannedPortByTemplateId.get(context.template.id) !== null
  );

  if (!candidate) {
    return null;
  }

  return `http://127.0.0.1:${plannedPortByTemplateId.get(candidate.template.id)}`;
}

function buildServiceDiscoveryEnvPatch(input: {
  role: DebugServiceRole;
  analysis: FrameworkAnalysisResult;
  backendEndpoint: string | null;
}): Record<string, string> {
  if (input.role === "backend" || !input.analysis.requiresServiceDiscoveryHandling || !input.backendEndpoint) {
    return {};
  }

  switch (input.analysis.primaryFramework) {
    case "vite":
      return {
        VITE_API_BASE_URL: input.backendEndpoint,
        API_BASE_URL: input.backendEndpoint
      };
    case "nextjs":
      return {
        NEXT_PUBLIC_API_BASE_URL: input.backendEndpoint,
        API_BASE_URL: input.backendEndpoint
      };
    case "cra":
      return {
        REACT_APP_API_BASE_URL: input.backendEndpoint,
        API_BASE_URL: input.backendEndpoint
      };
    case "astro":
      return {
        PUBLIC_API_BASE_URL: input.backendEndpoint,
        API_BASE_URL: input.backendEndpoint
      };
    case "nuxt":
      return {
        NUXT_PUBLIC_API_BASE_URL: input.backendEndpoint,
        API_BASE_URL: input.backendEndpoint
      };
    case "vue-cli":
      return {
        VUE_APP_API_BASE_URL: input.backendEndpoint,
        API_BASE_URL: input.backendEndpoint
      };
    case "remix":
      return {
        API_BASE_URL: input.backendEndpoint,
        PUBLIC_API_BASE_URL: input.backendEndpoint
      };
    default:
      return {
        API_BASE_URL: input.backendEndpoint,
        BACKEND_BASE_URL: input.backendEndpoint
      };
  }
}

function resolveRegisteredTemplateMissingRequirements(
  analysis: FrameworkAnalysisResult,
  input: {
    role: DebugServiceRole;
    backendEndpoint: string | null;
  }
): string[] {
  const missing: string[] = [];

  if (
    analysis.requiresServiceDiscoveryHandling
    && input.role !== "backend"
    && !input.backendEndpoint
  ) {
    missing.push("service_discovery");
  }

  if (analysis.requiresCallbackHandling) {
    missing.push("callback");
  }

  return missing;
}

async function resolveTemplateRequestedPorts(input: {
  targetRootPath: string;
  templates: TerminalCommandTemplate[];
  portRequests: DebugTargetPortRequest[];
  portLeaseRepository: PortLeaseRepository;
}): Promise<Map<string, number>> {
  const requestedPorts = new Map<string, number>();
  const usedPorts = new Map<number, string>();

  for (const request of input.portRequests) {
    validatePortRequestShape(request);

    const matches = input.templates.filter((template) =>
      matchesTemplatePortRequest(template, input.targetRootPath, request)
    );

    if (matches.length === 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "DEBUG_TARGET_PORT_REQUEST_UNMATCHED",
        detail: `显式端口请求没有匹配到任何启动项：${describePortRequest(request)}`,
        field: "portRequests"
      });
    }

    if (matches.length > 1) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DEBUG_TARGET_PORT_REQUEST_AMBIGUOUS",
        detail: `显式端口请求匹配到了多个启动项：${describePortRequest(request)}`,
        field: "portRequests"
      });
    }

    const matchedTemplate = matches[0]!;
    const previousPort = requestedPorts.get(matchedTemplate.id);

    if (previousPort !== undefined && previousPort !== request.port) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DEBUG_TARGET_PORT_REQUEST_CONFLICT",
        detail: `同一个启动项收到了多个不同的显式端口请求：${matchedTemplate.name}`,
        field: "portRequests"
      });
    }

    const occupiedBy = usedPorts.get(request.port);

    if (occupiedBy && occupiedBy !== matchedTemplate.id) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DEBUG_TARGET_PORT_REQUEST_CONFLICT",
        detail: `多个启动项请求了同一个端口：${request.port}`,
        field: "portRequests"
      });
    }

    await ensureRequestedPortAvailable(request.port, inferTemplateRole(matchedTemplate), input.portLeaseRepository);
    requestedPorts.set(matchedTemplate.id, request.port);
    usedPorts.set(request.port, matchedTemplate.id);
  }

  return requestedPorts;
}

async function resolveRequestedPorts(input: {
  targetRootPath: string;
  services: DebugServiceSpec[];
  portRequests: DebugTargetPortRequest[];
  portLeaseRepository: PortLeaseRepository;
}): Promise<Map<string, number>> {
  const requestedPorts = new Map<string, number>();
  const usedPorts = new Map<number, string>();

  for (const request of input.portRequests) {
    validatePortRequestShape(request);

    const matches = input.services.filter((service) =>
      matchesPortRequest(service, input.targetRootPath, request)
    );

    if (matches.length === 0) {
      throw new AppError({
        statusCode: 400,
        errorCode: "DEBUG_TARGET_PORT_REQUEST_UNMATCHED",
        detail: `显式端口请求没有匹配到任何服务：${describePortRequest(request)}`,
        field: "portRequests"
      });
    }

    if (matches.length > 1) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DEBUG_TARGET_PORT_REQUEST_AMBIGUOUS",
        detail: `显式端口请求匹配到了多个服务：${describePortRequest(request)}`,
        field: "portRequests"
      });
    }

    const matchedService = matches[0]!;
    const previousPort = requestedPorts.get(matchedService.id);

    if (previousPort !== undefined && previousPort !== request.port) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DEBUG_TARGET_PORT_REQUEST_CONFLICT",
        detail: `同一个服务收到了多个不同的显式端口请求：${matchedService.name}`,
        field: "portRequests"
      });
    }

    const occupiedBy = usedPorts.get(request.port);

    if (occupiedBy && occupiedBy !== matchedService.id) {
      throw new AppError({
        statusCode: 409,
        errorCode: "DEBUG_TARGET_PORT_REQUEST_CONFLICT",
        detail: `多个服务请求了同一个端口：${request.port}`,
        field: "portRequests"
      });
    }

    await ensureRequestedPortAvailable(request.port, matchedService.role, input.portLeaseRepository);
    requestedPorts.set(matchedService.id, request.port);
    usedPorts.set(request.port, matchedService.id);
  }

  return requestedPorts;
}

async function allocateManagedPort(
  role: DebugServiceSpec["role"],
  portLeaseRepository: PortLeaseRepository,
  portPoolConfig: DebugPortPoolConfig,
  usedPorts: ReadonlySet<number> = new Set()
): Promise<number> {
  const range = portPoolConfig;

  for (let port = range.start; port <= range.end; port += 1) {
    if (usedPorts.has(port)) {
      continue;
    }

    if (portLeaseRepository.findActiveByPort(port, "tcp")) {
      continue;
    }

    if (!(await isPortAvailable(port))) {
      continue;
    }

    return port;
  }

  throw new AppError({
    statusCode: 409,
    errorCode: "PORT_LEASE_EXHAUSTED",
    detail: `当前服务角色没有可分配的空闲端口：${role}（范围 ${range.start}-${range.end}）`
  });
}

async function ensureRequestedPortAvailable(
  port: number,
  role: DebugServiceSpec["role"],
  portLeaseRepository: PortLeaseRepository
): Promise<void> {
  if (portLeaseRepository.findActiveByPort(port, "tcp")) {
    throw new AppError({
      statusCode: 409,
      errorCode: "DEBUG_TARGET_PORT_NOT_AVAILABLE",
      detail: `显式请求的端口已被平台中的其他运行时占用：${port}`,
      field: "portRequests"
    });
  }

  if (!(await isPortAvailable(port))) {
    throw new AppError({
      statusCode: 409,
      errorCode: "DEBUG_TARGET_PORT_NOT_AVAILABLE",
      detail: `显式请求的端口当前不可用：${port}（服务角色：${role}）`,
      field: "portRequests"
    });
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, "127.0.0.1");
  });
}

function buildEphemeralTemplate(
  service: DebugServiceSpec,
  planItem: DebugLaunchPlanServiceItem,
  runtimeType: TerminalRuntimeType | null
): TerminalCommandTemplate {
  return {
    id: `ephemeral-${service.id}`,
    workspaceId: "",
    name: service.name,
    cwd: service.cwd,
    command: service.command,
    args: planItem.args,
    env: planItem.envPatch,
    port: planItem.leasedPort,
    proxyEnabled: false,
    proxySlug: null,
    runtimeType,
    sourceType: "debug_service",
    debugTargetId: null,
    debugServiceId: service.id,
    frameworkAnalysisId: planItem.frameworkAnalysisId,
    adapterKind: planItem.adapterKind,
    injectionMode: planItem.injectionMode,
    generatedArtifactRef: null,
    serviceDiscoveryMode: planItem.requiresServiceDiscoveryHandling ? "api_base_url" : "none",
    managedBySystem: true,
    createdAt: "",
    updatedAt: ""
  };
}

function resolveProcessInstance(
  processInstanceId: string | null,
  terminalInstanceRepository: {
    findById(id: string): TerminalInstance | null;
  }
): TerminalInstance | null {
  if (!processInstanceId) {
    return null;
  }

  return terminalInstanceRepository.findById(processInstanceId);
}

function validatePortRequestShape(request: DebugTargetPortRequest): void {
  if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65535) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `显式端口请求非法，port 必须是 1 到 65535 之间的整数：${request.port}`,
      field: "portRequests"
    });
  }

  const hasSelector = Boolean(
    request.serviceId?.trim()
    || request.role?.trim()
    || request.cwd?.trim()
    || request.name?.trim()
    || request.command?.trim()
  );

  if (!hasSelector) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "显式端口请求至少要提供 serviceId、role、cwd、name、command 中的一个选择条件",
      field: "portRequests"
    });
  }
}

function matchesPortRequest(
  service: DebugServiceSpec,
  targetRootPath: string,
  request: DebugTargetPortRequest
): boolean {
  if (request.serviceId?.trim() && request.serviceId.trim() !== service.id) {
    return false;
  }

  if (request.role?.trim() && request.role.trim() !== service.role) {
    return false;
  }

  if (request.name?.trim() && request.name.trim() !== service.name) {
    return false;
  }

  if (request.command?.trim() && request.command.trim() !== service.command) {
    return false;
  }

  if (request.cwd?.trim()) {
    const selectorPath = normalizePortRequestCwd(request.cwd, targetRootPath);
    const servicePath = path.resolve(service.cwd);

    if (selectorPath !== servicePath) {
      return false;
    }
  }

  return true;
}

function matchesTemplatePortRequest(
  template: TerminalCommandTemplate,
  targetRootPath: string,
  request: DebugTargetPortRequest
): boolean {
  if (request.serviceId?.trim() && request.serviceId.trim() !== template.id) {
    return false;
  }

  if (request.role?.trim() && request.role.trim() !== inferTemplateRole(template)) {
    return false;
  }

  if (request.name?.trim() && request.name.trim() !== template.name) {
    return false;
  }

  if (request.command?.trim() && request.command.trim() !== template.command) {
    return false;
  }

  if (request.cwd?.trim()) {
    const selectorPath = normalizePortRequestCwd(request.cwd, targetRootPath);
    const templatePath = path.resolve(template.cwd);

    if (selectorPath !== templatePath) {
      return false;
    }
  }

  return true;
}

function clonePortPoolConfig(config: DebugPortPoolConfig): DebugPortPoolConfig {
  return { ...config };
}

function normalizePortRequestCwd(value: string | null | undefined, targetRootPath: string): string {
  const trimmed = value?.trim() || "";

  if (!trimmed) {
    return "";
  }

  return path.resolve(path.isAbsolute(trimmed) ? trimmed : path.join(targetRootPath, trimmed));
}

function describePortRequest(request: DebugTargetPortRequest): string {
  const parts = [
    request.serviceId?.trim() ? `serviceId=${request.serviceId.trim()}` : null,
    request.role?.trim() ? `role=${request.role.trim()}` : null,
    request.cwd?.trim() ? `cwd=${request.cwd.trim()}` : null,
    request.name?.trim() ? `name=${request.name.trim()}` : null,
    request.command?.trim() ? `command=${request.command.trim()}` : null,
    `port=${request.port}`
  ].filter((item): item is string => Boolean(item));

  return parts.join(", ");
}

function resolveAiFallbackNextStatus(action: "apply" | "reject" | "rollback"): AiFallbackEditRecord["status"] {
  switch (action) {
    case "apply":
      return "APPLIED";
    case "reject":
      return "REJECTED";
    case "rollback":
      return "ROLLED_BACK";
    default:
      return "REJECTED";
  }
}
