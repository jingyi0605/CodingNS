import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { hashContent } from "../../shared/utils/hash.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerProject, ButlerRiskLevel, ButlerCheckpointProgressState } from "../../types/domain.js";
import type { SessionCheckpointRepository } from "../../storage/repositories/session-checkpoint-repository.js";
import type { ButlerInboxItemView, ButlerInboxService } from "./butler-inbox-service.js";
import type { ButlerProfileService } from "./butler-profile-service.js";
import type { ButlerProjectService } from "./butler-project-service.js";
import type {
  ButlerProjectSessionView,
  ButlerSessionService
} from "./butler-session-service.js";
import type { PatrolRunService, PatrolRunView } from "./patrol-run-service.js";
import type { ProjectMemoryService } from "./project-memory-service.js";
import type { VerificationRunService, VerificationRunView } from "./verification-run-service.js";

const MAX_PROJECT_RISKS = 5;
const MAX_PROJECT_ACTIONS = 5;
const MAX_GLOBAL_ITEMS = 8;
const MAX_OVERVIEW_PROJECTS = 5;
const MAX_OVERVIEW_SESSIONS = 5;
const MAX_OVERVIEW_RUNS = 5;
const MAX_PROMPT_PROJECTS = 3;
const MAX_PROMPT_ITEMS = 3;

export interface ButlerGlobalDigest {
  projectCount: number;
  activeProjectCount: number;
  blockedProjectCount: number;
  highRiskProjectCount: number;
  topRisks: string[];
  nextActions: string[];
}

export interface ButlerProjectDigest {
  id: string;
  workspaceId: string;
  name: string;
  repoRoot: string;
  lifecycleStatus: ButlerProject["lifecycleStatus"];
  riskLevel: ButlerProject["riskLevel"];
  activeSessionCount: number;
  sessionCount: number;
  memoryCount: number;
  failedPatrolCount: number;
  failedVerificationCount: number;
  latestSessionSummary: string | null;
  latestPatrolSummary: string | null;
  latestVerificationSummary: string | null;
  topRisks: string[];
  nextActions: string[];
  lastActivityAt: string;
  updatedAt: string;
}

export interface ButlerSessionDigest {
  id: string;
  projectId: string;
  sessionId: string;
  provider: string | null;
  title: string | null;
  isArchived: boolean;
  role: ButlerProjectSessionView["role"];
  ownershipMode: ButlerProjectSessionView["ownershipMode"];
  status: ButlerProjectSessionView["status"];
  runningState: ButlerProjectSessionView["runningState"];
  lastSummary: string | null;
  lastCheckpointAt: string | null;
  progressState: ButlerCheckpointProgressState;
  riskFlags: string[];
  nextActions: string[];
  updatedAt: string;
  createdAt: string;
}

export interface ButlerMemoryDigest {
  id: string;
  projectId: string;
  title: string;
  memoryType: string;
  status: string;
  scopePath: string | null;
  tags: string[];
  confidence: number;
  updatedAt: string;
  createdAt: string;
}

export interface ButlerInboxDigest {
  id: string;
  projectId: string;
  workspaceId: string;
  projectName: string;
  itemType: string;
  title: string;
  content: string;
  priority: string;
  status: string;
  updatedAt: string;
  createdAt: string;
  closedAt: string | null;
}

export interface ButlerPatrolDigest {
  id: string;
  projectId: string;
  planId: string | null;
  triggeredBy: string;
  status: string;
  riskLevel: string | null;
  summary: string | null;
  suggestions: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ButlerVerificationDigest {
  id: string;
  projectId: string;
  verificationType: string;
  status: string;
  targetRef: string | null;
  summary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ButlerContextSnapshot {
  version: string;
  generatedAt: string;
  global: ButlerGlobalDigest;
  projects: ButlerProjectDigest[];
  sessions: ButlerSessionDigest[];
  memories: ButlerMemoryDigest[];
  inboxItems: ButlerInboxDigest[];
  patrols: ButlerPatrolDigest[];
  verifications: ButlerVerificationDigest[];
}

export interface ButlerOverview {
  version: string;
  generatedAt: string;
  global: ButlerGlobalDigest;
  projects: ButlerProjectDigest[];
  sessions: ButlerSessionDigest[];
  inboxItems: ButlerInboxDigest[];
  patrols: ButlerPatrolDigest[];
  verifications: ButlerVerificationDigest[];
}

export interface ButlerProjectContext {
  version: string;
  generatedAt: string;
  project: ButlerProjectDigest;
  sessions: ButlerSessionDigest[];
  memories: ButlerMemoryDigest[];
  inboxItems: ButlerInboxDigest[];
  patrols: ButlerPatrolDigest[];
  verifications: ButlerVerificationDigest[];
  topRisks: string[];
  nextActions: string[];
}

export interface ButlerPromptContext {
  version: string;
  generatedAt: string;
  scope: "global" | "project";
  projectId: string | null;
  prompt: string;
}

export interface ButlerSearchHit {
  kind: "project" | "session" | "memory" | "patrol" | "verification";
  id: string;
  sessionId: string | null;
  projectId: string | null;
  workspaceId: string | null;
  title: string;
  summary: string;
  score: number;
  updatedAt: string;
  isArchived: boolean;
}

export interface ButlerSearchResult {
  version: string;
  generatedAt: string;
  query: string;
  items: ButlerSearchHit[];
}

interface ProjectAggregateResult {
  project: ButlerProject;
  digest: ButlerProjectDigest;
  sessions: ButlerSessionDigest[];
  memories: ButlerMemoryDigest[];
  inboxItems: ButlerInboxDigest[];
  patrols: ButlerPatrolDigest[];
  verifications: ButlerVerificationDigest[];
}

export class ButlerContextAggregator {
  constructor(
    private readonly butlerProfileService: Pick<ButlerProfileService, "getProfile">,
    private readonly butlerProjectService: Pick<ButlerProjectService, "getById" | "list">,
    private readonly butlerSessionService: Pick<
      ButlerSessionService,
      "ensureProjectSessionsSynced" | "listByProject"
    >,
    private readonly butlerInboxService: Pick<ButlerInboxService, "listItems">,
    private readonly projectMemoryService: Pick<ProjectMemoryService, "listMemories">,
    private readonly patrolRunService: Pick<PatrolRunService, "listRuns">,
    private readonly verificationRunService: Pick<VerificationRunService, "listRuns">,
    private readonly sessionCheckpointRepository: Pick<SessionCheckpointRepository, "listByButlerSessionId">
  ) {}

  async getOverview(userId: string): Promise<ButlerOverview> {
    const generatedAt = nowIso();
    const projectContexts = await this.collectProjectContexts(userId, {
      syncMode: "background"
    });
    const projects = projectContexts.map((item) => item.digest).slice(0, MAX_OVERVIEW_PROJECTS);
    const sessions = projectContexts
      .flatMap((item) => item.sessions)
      .slice(0, MAX_OVERVIEW_SESSIONS);
    const inboxItems = projectContexts
      .flatMap((item) => item.inboxItems)
      .slice(0, MAX_OVERVIEW_SESSIONS);
    const patrols = projectContexts
      .flatMap((item) => item.patrols)
      .slice(0, MAX_OVERVIEW_RUNS);
    const verifications = projectContexts
      .flatMap((item) => item.verifications)
      .slice(0, MAX_OVERVIEW_RUNS);
    const global = buildGlobalDigest(projectContexts);
    const version = buildSnapshotVersion({
      global,
      projects,
      sessions,
      inboxItems,
      patrols,
      verifications
    });

    return {
      version,
      generatedAt,
      global,
      projects,
      sessions,
      inboxItems,
      patrols,
      verifications
    };
  }

  async getSnapshot(userId: string): Promise<ButlerContextSnapshot> {
    const generatedAt = nowIso();
    const projectContexts = await this.collectProjectContexts(userId, {
      syncMode: "background"
    });
    const projects = projectContexts.map((item) => item.digest);
    const sessions = projectContexts.flatMap((item) => item.sessions);
    const memories = projectContexts.flatMap((item) => item.memories);
    const inboxItems = projectContexts.flatMap((item) => item.inboxItems);
    const patrols = projectContexts.flatMap((item) => item.patrols);
    const verifications = projectContexts.flatMap((item) => item.verifications);
    const global = buildGlobalDigest(projectContexts);
    const version = buildSnapshotVersion({
      global,
      projects,
      sessions,
      memories,
      inboxItems,
      patrols,
      verifications
    });

    return {
      version,
      generatedAt,
      global,
      projects,
      sessions,
      memories,
      inboxItems,
      patrols,
      verifications
    };
  }

  async getProjectContext(projectId: string, userId: string): Promise<ButlerProjectContext> {
    const project = this.getProjectOrThrow(projectId);
    const generatedAt = nowIso();
    await this.butlerSessionService.ensureProjectSessionsSynced(project.id, userId, {
      mode: "background"
    });
    const context = this.buildProjectContext(project, userId);
    const version = buildSnapshotVersion({
      project: context.digest,
      sessions: context.sessions,
      memories: context.memories,
      inboxItems: context.inboxItems,
      patrols: context.patrols,
      verifications: context.verifications
    });

    return {
      version,
      generatedAt,
      project: context.digest,
      sessions: context.sessions,
      memories: context.memories,
      inboxItems: context.inboxItems,
      patrols: context.patrols,
      verifications: context.verifications,
      topRisks: context.digest.topRisks,
      nextActions: context.digest.nextActions
    };
  }

  async resolvePromptContext(userId: string, userMessage?: string | null): Promise<ButlerPromptContext> {
    const projectId = this.resolveProjectIdFromMessage(userMessage);

    if (projectId) {
      const context = await this.getProjectContext(projectId, userId);
      const searchResult = await this.searchSummaries(userId, userMessage ?? "", {
        projectId
      });
      return {
        version: context.version,
        generatedAt: context.generatedAt,
        scope: "project",
        projectId,
        prompt: renderProjectPrompt(context, searchResult)
      };
    }

    const overview = await this.getOverview(userId);
    const searchResult = await this.searchSummaries(userId, userMessage ?? "");
    return {
      version: overview.version,
      generatedAt: overview.generatedAt,
      scope: "global",
      projectId: null,
      prompt: renderOverviewPrompt(overview, searchResult)
    };
  }

  async searchSummaries(
    userId: string,
    query: string,
    options: {
      projectId?: string | null;
      includeArchived?: boolean;
    } = {}
  ): Promise<ButlerSearchResult> {
    const normalizedQuery = query.trim();
    const generatedAt = nowIso();

    if (!normalizedQuery) {
      return {
        version: buildSnapshotVersion({
          query: "",
          items: []
        }),
        generatedAt,
        query: "",
        items: []
      };
    }

    const projectContexts = await this.collectProjectContexts(userId, {
      includeArchived: options.includeArchived ?? false,
      syncMode: "background"
    });
    const filteredContexts =
      options.projectId
        ? projectContexts.filter((context) => context.project.id === options.projectId)
        : projectContexts;
    const items = filteredContexts
      .flatMap((context) => buildSearchHits(context, normalizedQuery))
      .sort(compareSearchHits)
      .slice(0, MAX_OVERVIEW_SESSIONS);

    return {
      version: buildSnapshotVersion({
        query: normalizedQuery,
        items
      }),
      generatedAt,
      query: normalizedQuery,
      items
    };
  }

  private async collectProjectContexts(
    userId: string,
    options?: {
      includeArchived?: boolean;
      syncMode?: "blocking" | "background";
    }
  ): Promise<ProjectAggregateResult[]> {
    const focusProjectIds = new Set(this.butlerProfileService.getProfile()?.focus.projectIds ?? []);
    const projects = this.butlerProjectService.list();
    await Promise.all(
      projects.map((project) =>
        this.butlerSessionService.ensureProjectSessionsSynced(project.id, userId, {
          includeArchived: options?.includeArchived ?? false,
          mode: options?.syncMode ?? "blocking"
        })
      )
    );
    const contexts = projects.map((project) =>
      this.buildProjectContext(project, userId, {
        includeArchived: options?.includeArchived ?? false
      })
    );

    return contexts.sort((left, right) => compareProjectContexts(left, right, focusProjectIds));
  }

  private buildProjectContext(
    project: ButlerProject,
    userId: string,
    options?: {
      includeArchived?: boolean;
    }
  ): ProjectAggregateResult {
    const sessions = this.butlerSessionService
      .listByProject(project.id, userId, {
        includeArchived: options?.includeArchived ?? false
      })
      .map((session) => {
        const checkpoint = this.sessionCheckpointRepository.listByButlerSessionId(session.id, 1)[0] ?? null;
        return {
          id: session.id,
          projectId: session.projectId,
          sessionId: session.sessionId,
          provider: session.provider,
          title: session.title,
          isArchived: session.isArchived,
          role: session.role,
          ownershipMode: session.ownershipMode,
          status: session.status,
          runningState: session.runningState,
          lastSummary: session.lastSummary,
          lastCheckpointAt: session.lastCheckpointAt,
          progressState: checkpoint?.progressState ?? "unknown",
          riskFlags: checkpoint?.riskFlags ?? [],
          nextActions: checkpoint?.nextActions ?? [],
          updatedAt: session.updatedAt,
          createdAt: session.createdAt
        } satisfies ButlerSessionDigest;
      })
      .sort((left, right) => compareIso(right.updatedAt, left.updatedAt));
    const memories = this.projectMemoryService
      .listMemories(project.id)
      .map((memory) => ({
        id: memory.id,
        projectId: memory.projectId,
        title: memory.title,
        memoryType: memory.memoryType,
        status: memory.status,
        scopePath: memory.scopePath,
        tags: memory.tags,
        confidence: memory.confidence,
        updatedAt: memory.updatedAt,
        createdAt: memory.createdAt
      }))
      .sort((left, right) => compareIso(right.updatedAt, left.updatedAt));
    const inboxItems = this.butlerInboxService
      .listItems({
        projectId: project.id
      })
      .map((item) => mapInboxItem(item))
      .sort((left, right) => compareInboxItems(left, right));
    const patrols = this.patrolRunService
      .listRuns(project.id)
      .map((run) => mapPatrolRun(run))
      .sort((left, right) => compareIso(right.createdAt, left.createdAt));
    const verifications = this.verificationRunService
      .listRuns(project.id)
      .map((run) => mapVerificationRun(run))
      .sort((left, right) => compareIso(right.createdAt, left.createdAt));
    const topRisks = buildProjectTopRisks(project, sessions, patrols, verifications);
    const nextActions = buildProjectNextActions(project, sessions, patrols, verifications);
    const lastActivityAt = [
      project.updatedAt,
      sessions[0]?.updatedAt,
      memories[0]?.updatedAt,
      inboxItems[0]?.updatedAt,
      patrols[0]?.finishedAt ?? patrols[0]?.startedAt ?? patrols[0]?.createdAt,
      verifications[0]?.finishedAt ?? verifications[0]?.startedAt ?? verifications[0]?.createdAt
    ].filter((value): value is string => Boolean(value)).sort(compareIsoDesc)[0] ?? project.updatedAt;

    return {
      project,
      sessions,
      memories,
      inboxItems,
      patrols,
      verifications,
      digest: {
        id: project.id,
        workspaceId: project.workspaceId,
        name: project.name,
        repoRoot: project.repoRoot,
        lifecycleStatus: project.lifecycleStatus,
        riskLevel: project.riskLevel,
        activeSessionCount: sessions.filter((item) => item.status === "running").length,
        sessionCount: sessions.length,
        memoryCount: memories.length,
        failedPatrolCount: patrols.filter((item) => item.status === "failed").length,
        failedVerificationCount: verifications.filter((item) => item.status === "failed").length,
        latestSessionSummary: sessions[0]?.lastSummary ?? null,
        latestPatrolSummary: patrols[0]?.summary ?? null,
        latestVerificationSummary: verifications[0]?.summary ?? null,
        topRisks,
        nextActions,
        lastActivityAt,
        updatedAt: project.updatedAt
      }
    };
  }

  private resolveProjectIdFromMessage(userMessage?: string | null): string | null {
    const normalized = userMessage?.trim().toLocaleLowerCase();

    if (!normalized) {
      return null;
    }

    const projects = this.butlerProjectService.list();
    const focusedProjectIds = this.butlerProfileService.getProfile()?.focus.projectIds ?? [];

    if (focusedProjectIds.length === 1 && /(这个项目|当前项目|该项目)/u.test(normalized)) {
      const focusedProjectId = focusedProjectIds[0]!;

      if (projects.some((project) => project.id === focusedProjectId)) {
        return focusedProjectId;
      }
    }

    for (const project of projects) {
      const candidates = [
        project.id,
        project.name,
        path.basename(project.repoRoot)
      ]
        .map((item) => item.trim().toLocaleLowerCase())
        .filter((item) => item.length >= 2);

      if (candidates.some((candidate) => normalized.includes(candidate))) {
        return project.id;
      }
    }

    return null;
  }

  private getProjectOrThrow(projectId: string): ButlerProject {
    return this.butlerProjectService.getById(projectId);
  }
}

function mapPatrolRun(run: PatrolRunView): ButlerPatrolDigest {
  return {
    id: run.id,
    projectId: run.projectId,
    planId: run.planId,
    triggeredBy: run.triggeredBy,
    status: run.status,
    riskLevel: run.riskLevel,
    summary: run.summary,
    suggestions: run.suggestions,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt
  };
}

function mapInboxItem(item: ButlerInboxItemView): ButlerInboxDigest {
  return {
    id: item.id,
    projectId: item.projectId,
    workspaceId: item.workspaceId,
    projectName: item.projectName,
    itemType: item.itemType,
    title: item.title,
    content: item.content,
    priority: item.priority,
    status: item.status,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    closedAt: item.closedAt
  };
}

function mapVerificationRun(run: VerificationRunView): ButlerVerificationDigest {
  return {
    id: run.id,
    projectId: run.projectId,
    verificationType: run.verificationType,
    status: run.status,
    targetRef: run.targetRef,
    summary: run.summary,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt
  };
}

function compareInboxItems(left: ButlerInboxDigest, right: ButlerInboxDigest): number {
  const statusPriority = getInboxStatusPriority(left.status) - getInboxStatusPriority(right.status);

  if (statusPriority !== 0) {
    return statusPriority;
  }

  const priorityOrder = getInboxPriorityOrder(left.priority) - getInboxPriorityOrder(right.priority);

  if (priorityOrder !== 0) {
    return priorityOrder;
  }

  return compareIso(right.updatedAt, left.updatedAt);
}

function getInboxStatusPriority(status: string): number {
  switch (status) {
    case "in_progress":
      return 0;
    case "pending":
      return 1;
    case "closed":
      return 2;
    default:
      return 3;
  }
}

function getInboxPriorityOrder(priority: string): number {
  switch (priority) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    default:
      return 3;
  }
}

function compareProjectContexts(
  left: ProjectAggregateResult,
  right: ProjectAggregateResult,
  focusedProjectIds: Set<string>
): number {
  const focusedDiff =
    Number(focusedProjectIds.has(right.project.id)) - Number(focusedProjectIds.has(left.project.id));

  if (focusedDiff !== 0) {
    return focusedDiff;
  }

  const riskDiff = riskWeight(right.project.riskLevel) - riskWeight(left.project.riskLevel);

  if (riskDiff !== 0) {
    return riskDiff;
  }

  const blockerDiff = Number(hasProjectBlocker(right)) - Number(hasProjectBlocker(left));

  if (blockerDiff !== 0) {
    return blockerDiff;
  }

  return compareIso(right.digest.lastActivityAt, left.digest.lastActivityAt);
}

function riskWeight(riskLevel: ButlerRiskLevel): number {
  switch (riskLevel) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function buildProjectTopRisks(
  project: ButlerProject,
  sessions: ButlerSessionDigest[],
  patrols: ButlerPatrolDigest[],
  verifications: ButlerVerificationDigest[]
): string[] {
  const risks: string[] = [];

  if (project.lifecycleStatus === "paused") {
    risks.push("项目当前处于暂停状态，新的推进动作可能被搁置。");
  }

  if (project.riskLevel === "high") {
    risks.push("项目已被标记为高风险，需要优先处理。");
  }

  for (const session of sessions) {
    if (session.progressState === "blocked") {
      risks.push(
        session.title
          ? `会话《${session.title}》当前阻塞：${joinItems(session.riskFlags, "未提供阻塞细节")}`
          : `项目会话当前阻塞：${joinItems(session.riskFlags, "未提供阻塞细节")}`
      );
    } else if (session.status === "failed") {
      risks.push(
        session.title
          ? `会话《${session.title}》执行失败，需要人工确认。`
          : "项目存在失败会话，需要人工确认。"
      );
    }
  }

  for (const patrol of patrols) {
    if (patrol.status === "failed") {
      risks.push(`最近巡视失败：${truncateText(patrol.summary, 80, "巡视失败，尚无摘要")}`);
    }
  }

  for (const verification of verifications) {
    if (verification.status === "failed") {
      risks.push(`最近验证失败：${truncateText(verification.summary, 80, "验证失败，尚无摘要")}`);
    }
  }

  return uniqueItems(risks, MAX_PROJECT_RISKS);
}

function buildProjectNextActions(
  project: ButlerProject,
  sessions: ButlerSessionDigest[],
  patrols: ButlerPatrolDigest[],
  verifications: ButlerVerificationDigest[]
): string[] {
  const actions: string[] = [];

  for (const session of sessions) {
    actions.push(...session.nextActions);
  }

  for (const patrol of patrols) {
    if (patrol.status === "failed") {
      actions.push(...patrol.suggestions);
      actions.push("复查最近一次失败巡视，确认是否需要重新发起。");
    }
  }

  for (const verification of verifications) {
    if (verification.status === "failed") {
      actions.push(
        verification.targetRef
          ? `优先复查目标 ${verification.targetRef} 的失败验证。`
          : "优先复查最近一次失败验证。"
      );
    }
  }

  if (sessions.length === 0) {
    actions.push("当前项目还没有纳管会话，优先导入或启动一个项目会话。");
  }

  if (patrols.length === 0) {
    actions.push("当前项目还没有巡视记录，考虑先发起一次巡视。");
  }

  if (verifications.length === 0) {
    actions.push("当前项目还没有验证记录，考虑补一轮基础验证。");
  }

  if (project.lifecycleStatus === "paused") {
    actions.push("先确认项目是否应该恢复为 active，再继续执行动作。");
  }

  return uniqueItems(actions, MAX_PROJECT_ACTIONS);
}

function buildGlobalDigest(projectContexts: ProjectAggregateResult[]): ButlerGlobalDigest {
  return {
    projectCount: projectContexts.length,
    activeProjectCount: projectContexts.filter((item) => item.project.lifecycleStatus === "active").length,
    blockedProjectCount: projectContexts.filter((item) => hasProjectBlocker(item)).length,
    highRiskProjectCount: projectContexts.filter((item) => item.project.riskLevel === "high").length,
    topRisks: uniqueItems(
      projectContexts.flatMap((item) => item.digest.topRisks),
      MAX_GLOBAL_ITEMS
    ),
    nextActions: uniqueItems(
      projectContexts.flatMap((item) => item.digest.nextActions),
      MAX_GLOBAL_ITEMS
    )
  };
}

function hasProjectBlocker(projectContext: ProjectAggregateResult): boolean {
  return (
    projectContext.project.lifecycleStatus === "paused"
    || projectContext.sessions.some(
      (item) => item.status === "blocked" || item.status === "failed" || item.progressState === "blocked"
    )
    || projectContext.patrols.some((item) => item.status === "failed")
    || projectContext.verifications.some((item) => item.status === "failed")
  );
}

function renderOverviewPrompt(
  overview: ButlerOverview,
  searchResult?: ButlerSearchResult | null
): string {
  const lines = [
    "# 代码助手当前上下文",
    "",
    `- 作用域：全局总览`,
    `- 上下文版本：${overview.version}`,
    `- 生成时间：${overview.generatedAt}`,
    "- 使用规则：先基于下面摘要回答；如果仍然缺信息，明确指出缺口并要求宿主系统下钻，不要编造。",
    "",
    "## 全局摘要",
    `- 项目总数：${overview.global.projectCount}`,
    `- 活跃项目：${overview.global.activeProjectCount}`,
    `- 有阻塞或失败信号的项目：${overview.global.blockedProjectCount}`,
    `- 高风险项目：${overview.global.highRiskProjectCount}`,
    `- 最高优先风险：${joinItems(overview.global.topRisks, "暂无明显风险")}`,
    `- 建议优先动作：${joinItems(overview.global.nextActions, "暂无待办动作")}`,
    "",
    "## 优先项目"
  ];

  if (overview.projects.length === 0) {
    lines.push("- 当前还没有纳管项目。");
  } else {
    for (const project of overview.projects.slice(0, MAX_PROMPT_PROJECTS)) {
      lines.push(
        `- ${project.name}（${project.id}）：风险=${project.riskLevel}，活跃会话=${project.activeSessionCount}，主要风险=${joinItems(project.topRisks, "暂无")}，下一步=${joinItems(project.nextActions, "暂无")}`
      );
    }
  }

  if (overview.sessions.length > 0) {
    lines.push("", "## 最近会话");
    for (const session of overview.sessions.slice(0, MAX_PROMPT_ITEMS)) {
      lines.push(
        `- ${session.title ?? session.sessionId}：状态=${session.status}/${session.progressState}，摘要=${truncateText(session.lastSummary, 80, "暂无摘要")}`
      );
    }
  }

  if (overview.inboxItems.length > 0) {
    lines.push("", "## 收件箱");
    for (const item of overview.inboxItems.slice(0, MAX_PROMPT_ITEMS)) {
      lines.push(`- ${describeInboxItem(item)}`);
    }
  }

  if (overview.verifications.length > 0) {
    lines.push("", "## 最近验证");
    for (const verification of overview.verifications.slice(0, MAX_PROMPT_ITEMS)) {
      lines.push(
        `- ${verification.verificationType}：状态=${verification.status}，摘要=${truncateText(verification.summary, 80, "暂无摘要")}`
      );
    }
  }

  if (overview.patrols.length > 0) {
    lines.push("", "## 最近巡视");
    for (const patrol of overview.patrols.slice(0, MAX_PROMPT_ITEMS)) {
      lines.push(
        `- ${patrol.id}：状态=${patrol.status}，风险=${patrol.riskLevel ?? "unknown"}，摘要=${truncateText(patrol.summary, 80, "暂无摘要")}`
      );
    }
  }

  appendSearchResultLines(lines, searchResult);

  return lines.join("\n");
}

function renderProjectPrompt(
  context: ButlerProjectContext,
  searchResult?: ButlerSearchResult | null
): string {
  const lines = [
    "# 代码助手当前上下文",
    "",
    `- 作用域：项目 ${context.project.name}（${context.project.id}）`,
    `- 上下文版本：${context.version}`,
    `- 生成时间：${context.generatedAt}`,
    "- 使用规则：先回答这个项目的当前情况；如果用户追问更细事实，再要求宿主系统补查具体对象。",
    "",
    "## 项目摘要",
    `- 生命周期：${context.project.lifecycleStatus}`,
    `- 风险级别：${context.project.riskLevel}`,
    `- 活跃会话：${context.project.activeSessionCount}/${context.project.sessionCount}`,
    `- 主要风险：${joinItems(context.topRisks, "暂无明显风险")}`,
    `- 建议下一步：${joinItems(context.nextActions, "暂无待办动作")}`
  ];

  if (context.inboxItems.length > 0) {
    lines.push("", "## 当前代办");
    for (const item of context.inboxItems.slice(0, MAX_PROMPT_ITEMS)) {
      lines.push(`- ${describeInboxItem(item)}`);
    }
  }

  if (context.sessions.length > 0) {
    lines.push("", "## 项目会话");
    for (const session of context.sessions.slice(0, MAX_PROMPT_ITEMS)) {
      lines.push(
        `- ${session.title ?? session.sessionId}：状态=${session.status}/${session.progressState}，风险=${joinItems(session.riskFlags, "暂无")}，摘要=${truncateText(session.lastSummary, 80, "暂无摘要")}`
      );
    }
  }

  if (context.memories.length > 0) {
    lines.push("", "## 相关记忆");
    for (const memory of context.memories.slice(0, MAX_PROMPT_ITEMS)) {
      lines.push(
        `- ${memory.title}：类型=${memory.memoryType}，状态=${memory.status}，标签=${joinItems(memory.tags, "无")}`
      );
    }
  }

  if (context.verifications.length > 0) {
    lines.push("", "## 最近验证");
    for (const verification of context.verifications.slice(0, MAX_PROMPT_ITEMS)) {
      lines.push(
        `- ${verification.verificationType}：状态=${verification.status}，摘要=${truncateText(verification.summary, 80, "暂无摘要")}`
      );
    }
  }

  if (context.patrols.length > 0) {
    lines.push("", "## 最近巡视");
    for (const patrol of context.patrols.slice(0, MAX_PROMPT_ITEMS)) {
      lines.push(
        `- ${patrol.id}：状态=${patrol.status}，风险=${patrol.riskLevel ?? "unknown"}，摘要=${truncateText(patrol.summary, 80, "暂无摘要")}`
      );
    }
  }

  appendSearchResultLines(lines, searchResult);

  return lines.join("\n");
}

function appendSearchResultLines(
  lines: string[],
  searchResult?: ButlerSearchResult | null
): void {
  if (!searchResult || !searchResult.query || searchResult.items.length === 0) {
    return;
  }

  lines.push("", `## 摘要命中（优先回答这些命中的摘要）`, `- 当前查询：${searchResult.query}`);

  for (const item of searchResult.items.slice(0, MAX_PROMPT_ITEMS)) {
    lines.push(
      `- ${describeSearchHit(item)}：${truncateText(item.summary, 120, "暂无摘要")}`
    );
  }
}

function describeSearchHit(item: ButlerSearchHit): string {
  switch (item.kind) {
    case "project":
      return `项目 ${item.title}`;
    case "session":
      return `会话 ${item.title}`;
    case "memory":
      return `记忆 ${item.title}`;
    case "patrol":
      return `巡视 ${item.title}`;
    case "verification":
      return `验证 ${item.title}`;
    default:
      return item.title;
  }
}

function describeInboxItem(item: ButlerInboxDigest): string {
  return `${item.projectName} · ${item.title}：状态=${item.status}，优先级=${item.priority}，类型=${item.itemType}，内容=${truncateText(item.content, 80, "暂无内容")}`;
}

function buildSearchHits(context: ProjectAggregateResult, query: string): ButlerSearchHit[] {
  const hits: ButlerSearchHit[] = [];
  const projectBaseTime = context.digest.lastActivityAt;

  pushSearchHit(
    hits,
      {
        kind: "project",
        id: context.project.id,
        sessionId: null,
        projectId: context.project.id,
        workspaceId: context.project.workspaceId,
        title: context.project.name,
        isArchived: context.project.lifecycleStatus === "archived",
      summary: [
        `风险=${context.digest.riskLevel}`,
        `主要风险=${joinItems(context.digest.topRisks, "暂无")}`,
        `下一步=${joinItems(context.digest.nextActions, "暂无")}`,
        `最近会话摘要=${context.digest.latestSessionSummary ?? "暂无"}`
      ].join("；"),
      updatedAt: projectBaseTime
    },
    query,
    [
      context.project.id,
      context.project.name,
      path.basename(context.project.repoRoot),
      context.digest.latestSessionSummary ?? "",
      context.digest.topRisks.join(" "),
      context.digest.nextActions.join(" ")
    ]
  );

  for (const session of context.sessions) {
    pushSearchHit(
      hits,
      {
        kind: "session",
        id: session.id,
        sessionId: session.sessionId,
        projectId: session.projectId,
        workspaceId: context.project.workspaceId,
        title: session.title ?? session.sessionId,
        isArchived: session.isArchived,
        summary: [
          `状态=${session.status}/${session.progressState}`,
          `风险=${joinItems(session.riskFlags, "暂无")}`,
          `下一步=${joinItems(session.nextActions, "暂无")}`,
          `摘要=${session.lastSummary ?? "暂无"}`
        ].join("；"),
        updatedAt: session.updatedAt
      },
      query,
      [
        session.id,
        session.sessionId,
        session.title ?? "",
        session.lastSummary ?? "",
        session.riskFlags.join(" "),
        session.nextActions.join(" ")
      ]
    );
  }

  for (const memory of context.memories) {
    pushSearchHit(
      hits,
      {
        kind: "memory",
        id: memory.id,
        sessionId: null,
        projectId: memory.projectId,
        workspaceId: context.project.workspaceId,
        title: memory.title,
        isArchived: false,
        summary: `类型=${memory.memoryType}；状态=${memory.status}；标签=${joinItems(memory.tags, "无")}`,
        updatedAt: memory.updatedAt
      },
      query,
      [memory.title, memory.memoryType, memory.status, memory.tags.join(" ")]
    );
  }

  for (const patrol of context.patrols) {
    pushSearchHit(
      hits,
      {
        kind: "patrol",
        id: patrol.id,
        sessionId: null,
        projectId: patrol.projectId,
        workspaceId: context.project.workspaceId,
        title: patrol.id,
        isArchived: false,
        summary: `状态=${patrol.status}；风险=${patrol.riskLevel ?? "unknown"}；摘要=${patrol.summary ?? "暂无"}；建议=${joinItems(patrol.suggestions, "暂无")}`,
        updatedAt: patrol.finishedAt ?? patrol.startedAt ?? patrol.createdAt
      },
      query,
      [patrol.id, patrol.summary ?? "", patrol.suggestions.join(" "), patrol.status, patrol.riskLevel ?? ""]
    );
  }

  for (const verification of context.verifications) {
    pushSearchHit(
      hits,
      {
        kind: "verification",
        id: verification.id,
        sessionId: null,
        projectId: verification.projectId,
        workspaceId: context.project.workspaceId,
        title: verification.verificationType,
        isArchived: false,
        summary: `状态=${verification.status}；目标=${verification.targetRef ?? "未指定"}；摘要=${verification.summary ?? "暂无"}`,
        updatedAt: verification.finishedAt ?? verification.startedAt ?? verification.createdAt
      },
      query,
      [
        verification.id,
        verification.verificationType,
        verification.status,
        verification.targetRef ?? "",
        verification.summary ?? ""
      ]
    );
  }

  return hits;
}

function pushSearchHit(
  hits: ButlerSearchHit[],
  base: Omit<ButlerSearchHit, "score">,
  query: string,
  fields: string[]
): void {
  const score = scoreSearch(fields, query);

  if (score <= 0) {
    return;
  }

  hits.push({
    ...base,
    score
  });
}

function scoreSearch(fields: string[], query: string): number {
  const normalizedFields = fields
    .map((field) => normalizeSearchText(field))
    .filter((field) => field.length > 0);

  if (normalizedFields.length === 0) {
    return 0;
  }

  const normalizedQuery = normalizeSearchText(query);
  const terms = extractSearchTerms(normalizedQuery);
  let score = 0;

  for (const field of normalizedFields) {
    if (field.includes(normalizedQuery)) {
      score += 10;
    }

    for (const term of terms) {
      if (field.includes(term)) {
        score += term.length >= 4 ? 4 : 2;
      }
    }
  }

  return score;
}

function extractSearchTerms(query: string): string[] {
  const terms = new Set<string>();
  const asciiTerms = query.match(/[a-z0-9_-]{2,}/g) ?? [];

  for (const term of asciiTerms) {
    terms.add(term);
  }

  const hanTerms = query.match(/\p{Script=Han}+/gu) ?? [];

  for (const term of hanTerms) {
    terms.add(term);

    if (term.length <= 4) {
      continue;
    }

    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= term.length - size; index += 1) {
        terms.add(term.slice(index, index + size));
      }
    }
  }

  return Array.from(terms).filter((term) => term.trim().length >= 2).slice(0, 16);
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function compareSearchHits(left: ButlerSearchHit, right: ButlerSearchHit): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  return compareIso(right.updatedAt, left.updatedAt);
}

function buildSnapshotVersion(payload: unknown): string {
  return `ctx_${hashContent(JSON.stringify(payload)).slice(0, 16)}`;
}

function uniqueItems(items: string[], limit: number): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const normalized = item.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(normalized);

    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

function truncateText(value: string | null | undefined, maxLength: number, fallback: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function joinItems(items: string[], fallback: string): string {
  return items.length > 0 ? items.join("；") : fallback;
}

function compareIso(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareIsoDesc(left: string, right: string): number {
  return compareIso(right, left);
}
