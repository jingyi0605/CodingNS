import { createId } from "../../shared/utils/id.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logResourceScopeDebug } from "../../shared/utils/resource-scope-debug-log.js";
import { nowIso } from "../../shared/utils/time.js";
import type { AuthCallerKind } from "../auth/auth-service.js";
import type { AssistantAutomationService } from "../butler/assistant-automation-service.js";
import type { ButlerControlSessionService } from "../butler/butler-control-session-service.js";
import type { ButlerControlTimerService } from "../butler/butler-control-timer-service.js";
import type {
  ButlerFollowUpService,
  CompleteButlerFollowUpTaskInput,
  ContinueButlerFollowUpTaskInput,
  CreateButlerFollowUpTaskInput,
  FailButlerFollowUpTaskInput,
  WaitingUserButlerFollowUpTaskInput
} from "../butler/butler-follow-up-service.js";
import type { ButlerProjectService } from "../butler/butler-project-service.js";
import type { ButlerSessionService } from "../butler/butler-session-service.js";
import type { DocumentRuntimeService } from "../document-runtime/document-runtime-service.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import type { SessionMessageOriginRepository } from "../../storage/repositories/session-message-origin-repository.js";
import type { ProviderControlRepository } from "../../storage/repositories/provider-control-repository.js";
import type { WorkspaceWorktreeRepository } from "../../storage/repositories/workspace-worktree-repository.js";
import { recordButlerProxyMessageOrigin } from "../sessions/session-message-origin-utils.js";
import type { TerminalService } from "../terminal/terminal-service.js";
import type {
  CloneWorkspaceInput,
  UpdateWorkspaceNavigationStateInput,
  WorkspaceService
} from "../workspace/workspace-service.js";
import type { CreateWorktreeInput, WorktreeManager } from "../worktree/worktree-manager.js";
import type { WorktreeCleanupOptions, WorktreeCleanupService } from "../worktree/worktree-cleanup-service.js";
import type { WorktreeMergeService } from "../worktree/worktree-merge-service.js";
import type { WorktreeSyncService } from "../worktree/worktree-sync-service.js";
import { createProviderDisabledError } from "../provider/provider-disabled.js";
import type { OfficeDocumentExportFormat, OfficeTaskStatus } from "../../types/domain.js";
import type { OfficeService } from "../office/office-service.js";
import type { OfficePreviewLinkService } from "../office/office-preview-link-service.js";

type AssistantCapabilityMode = "read" | "proxy_execute";
export type AssistantCapabilityProfile = "butler-full" | "butler-ui" | "workspace-scoped";
export type AssistantCapabilityScopeKind = "none" | "workspace" | "project";

export interface AssistantCapabilityDescriptor {
  name: string;
  mode: AssistantCapabilityMode;
  enabled: boolean;
  summary: string;
  requiresConfirmation?: boolean;
}

interface AssistantCapabilityDefinition extends AssistantCapabilityDescriptor {
  allowedProfiles: AssistantCapabilityProfile[];
  scopeKind: AssistantCapabilityScopeKind;
}

export interface AssistantExecutionContext {
  userId?: string | null;
  callerKind?: AuthCallerKind | null;
  capabilityProfile?: AssistantCapabilityProfile | null;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  confirmationToken?: string | null;
}

const WORKSPACE_SCOPED_DEFAULT_CAPABILITIES = new Set([
  "capabilities.list",
  "projects.get",
  "sessions.get",
  "sessions.messages.list",
  "sessions.runtime.get",
  "terminals.create",
  "terminals.list",
  "terminals.history.read",
  "office.document.create",
  "office.document.update",
  "office.document.export",
  "office.document.task.get",
  "worktrees.tree",
  "worktrees.create",
  "worktrees.merge-preview",
  "worktrees.cleanup"
]);

const WORKSPACE_SCOPED_CONFIRMATION_CAPABILITIES = new Set([
  "terminals.input.send",
  "terminals.close",
  "worktrees.merge-into-parent"
]);

const PROJECT_SCOPED_CAPABILITIES = new Set([
  "projects.get",
  "projects.sessions.list",
  "projects.sessions.start",
  "worktrees.tree",
  "worktrees.create",
  "worktrees.merge-preview",
  "worktrees.merge-into-parent",
  "worktrees.cleanup"
]);

const WORKSPACE_SCOPED_CAPABILITIES = new Set([
  "capabilities.list",
  "sessions.get",
  "sessions.messages.list",
  "sessions.runtime.get",
  "terminals.create",
  "terminals.list",
  "terminals.history.read",
  "terminals.input.send",
  "terminals.close",
  "office.document.create",
  "office.document.update",
  "office.document.export",
  "office.document.task.get",
]);

export interface AssistantCapabilityReceipt<TPayload> {
  ok: true;
  capability: string;
  auditId: string;
  callerKind?: AuthCallerKind;
  timestamp: string;
  targetRef: {
    kind:
      | "project"
      | "session"
      | "terminal"
      | "workspace"
      | "worktree"
      | "debug_target"
      | "debug_runtime"
      | "automation"
      | "timer"
      | "follow_up"
      | "none";
    id: string | null;
  };
  payload: TPayload;
}

interface ListProjectsInput {
  userId: string;
  workspaceId?: string;
  lifecycleStatus?: "active" | "paused" | "archived";
  riskLevel?: "low" | "medium" | "high";
}

interface SendAssistantSessionMessageInput {
  sessionId: string;
  userId: string;
  content: string;
  clientRequestId?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
}

interface StartAssistantProjectSessionInput {
  projectId: string;
  userId: string;
  content: string;
  providerId?: "codex" | "claude-code" | null;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
}

type AssistantSessionTarget =
  | { kind: "project"; projectId: string }
  | { kind: "workspace"; workspaceId: string };

interface StartAssistantSessionInput {
  target?: AssistantSessionTarget | null;
  userId: string;
  content: string;
  providerId?: "codex" | "claude-code" | null;
  model?: string | null;
  reasoningLevel?: string | null;
  permissionMode?: string | null;
}

interface ForkAssistantSessionInput {
  sessionId: string;
  userId: string;
  sourceType: "session" | "message";
  sourceMessageId?: string | null;
  strategy?: "auto" | "native-only" | "reconstruct-only";
  targetProvider?: string | null;
}

interface ListAssistantTerminalsInput {
  userId: string;
  projectId?: string | null;
  workspaceId?: string | null;
}

interface CreateAssistantTerminalInput {
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  name?: string | null;
  cwd?: string | null;
  shell?: string | null;
}

interface ReadAssistantTerminalHistoryInput {
  terminalId: string;
  beforeSeq: number | null;
  limit: number;
}

interface SendAssistantTerminalInput {
  terminalId: string;
  content: string;
}

interface CreateAssistantTimerInput {
  userId: string;
  controlSessionId?: string | null;
  projectId?: string | null;
  targetSessionId?: string | null;
  title?: string | null;
  content: string;
  dueAt?: string | null;
  afterSeconds?: number | null;
}

interface ListAssistantFollowUpsInput {
  userId: string;
  status?: "active" | "waiting_user" | "completed" | "failed" | "cancelled";
  projectId?: string | null;
  sessionId?: string | null;
  limit?: number | null;
}

interface CreateAssistantFollowUpInput {
  userId: string;
  projectId: string;
  butlerSessionId: string;
  providerId?: "codex" | "claude-code" | null;
  objective: string;
  completionCriteria?: string | null;
  maxAutoContinueCount?: number | null;
  checkIntervalSeconds?: number | null;
}

interface ContinueAssistantFollowUpInput extends ContinueButlerFollowUpTaskInput {
  userId: string;
  taskId: string;
}

interface WaitingUserAssistantFollowUpInput extends WaitingUserButlerFollowUpTaskInput {
  userId: string;
  taskId: string;
}

interface CompleteAssistantFollowUpInput extends CompleteButlerFollowUpTaskInput {
  userId: string;
  taskId: string;
}

interface FailAssistantFollowUpInput extends FailButlerFollowUpTaskInput {
  userId: string;
  taskId: string;
}

interface ListAssistantTimersInput {
  userId: string;
  status?: "active" | "completed" | "cancelled" | "failed";
  controlSessionId?: string | null;
  limit?: number | null;
}

interface ListAssistantAutomationsInput {
  userId: string;
  status?: "active" | "completed" | "cancelled" | "failed";
  controlSessionId?: string | null;
  limit?: number | null;
}

interface CreateAssistantAutomationInput {
  userId: string;
  controlSessionId?: string | null;
  projectId?: string | null;
  title?: string | null;
  content: string;
  triggerType?: "once" | "interval" | "cron" | "condition";
  dueAt?: string | null;
  afterSeconds?: number | null;
  everySeconds?: number | null;
  everyMinutes?: number | null;
  everyHours?: number | null;
  stopAt?: string | null;
  cronMinute?: number | null;
  cronHour?: number | null;
  cronDaysOfWeek?: number[] | null;
  conditionKind?: "git.remote_tag_changed" | "session.runtime_idle" | null;
  repositoryUrl?: string | null;
  pollIntervalSeconds?: number | null;
  expiresAt?: string | null;
  maxChecks?: number | null;
  conditionSessionId?: string | null;
  includeTriggerContext?: boolean;
  targetSessionId?: string | null;
}

interface UpdateAssistantAutomationInput {
  userId: string;
  automationId: string;
  title?: string | null;
  content?: string;
  includeTriggerContext?: boolean;
  dueAt?: string | null;
  everySeconds?: number | null;
  everyMinutes?: number | null;
  everyHours?: number | null;
  stopAt?: string | null;
  cronMinute?: number | null;
  cronHour?: number | null;
  cronDaysOfWeek?: number[] | null;
  pollIntervalSeconds?: number | null;
  expiresAt?: string | null;
  maxChecks?: number | null;
}

interface ListAssistantAutomationRunsInput {
  userId: string;
  controlSessionId?: string | null;
  limit?: number | null;
}

interface CreateAssistantWorkspaceDirectoryInput {
  parentPath: string;
  directoryName: string;
}

interface ImportAssistantWorkspaceInput {
  path: string;
  name?: string | null;
}

interface CloneAssistantWorkspaceInput {
  repositoryUrl: string;
  parentPath: string;
  directoryName?: string | null;
  name?: string | null;
  auth?: CloneWorkspaceInput["auth"];
}

interface UpdateAssistantWorkspaceNavigationStateInput {
  workspaceId: string;
  userId: string;
  collapsed?: boolean;
  backgroundColor?: string | null;
  hidden?: boolean;
  shortcutAppsCollapsed?: boolean;
  shortcutAppsSide?: "left" | "right";
}

interface CreateAssistantWorktreeInput {
  sourceWorkspaceId: string;
  branchName: string;
  displayName?: string | null;
  baseRef?: string | null;
}

interface CreateAssistantOfficeDocumentInput {
  userId: string;
  workspaceId?: string | null;
  title: string;
  templateId?: string | null;
  templateKey?: string | null;
  content?: unknown;
  outline?: unknown;
  summary?: string | null;
}

interface UpdateAssistantOfficeDocumentInput {
  userId: string;
  documentId: string;
  title?: string | null;
  templateId?: string | null;
  content?: unknown;
  outline?: unknown;
  summary?: string | null;
  status?: "draft" | "reviewing" | "published" | "archived";
}

interface ExportAssistantOfficeDocumentInput {
  userId: string;
  documentId: string;
  workspaceId?: string | null;
  format?: OfficeDocumentExportFormat;
  riskLevel?: "low" | "medium" | "high";
  execute?: boolean;
}

interface ReplyAssistantOfficeTaskApprovalInput {
  userId: string;
  approvalId: string;
  status: "approved" | "rejected";
  decisionNote?: string | null;
}

const ASSISTANT_CAPABILITIES: AssistantCapabilityDescriptor[] = [
  {
    name: "capabilities.list",
    mode: "read",
    enabled: true,
    summary: "查看当前开放的助手内部能力"
  },
  {
    name: "projects.list",
    mode: "read",
    enabled: true,
    summary: "列出当前托管项目"
  },
  {
    name: "projects.get",
    mode: "read",
    enabled: true,
    summary: "读取指定项目详情和概况"
  },
  {
    name: "projects.sessions.list",
    mode: "read",
    enabled: true,
    summary: "列出指定项目下可操作的会话"
  },
  {
    name: "projects.sessions.start",
    mode: "proxy_execute",
    enabled: true,
    summary: "按当前助手配置为项目新建真实会话"
  },
  {
    name: "sessions.start",
    mode: "proxy_execute",
    enabled: true,
    summary: "按 project 或 workspace 目标新建真实会话"
  },
  {
    name: "sessions.get",
    mode: "read",
    enabled: true,
    summary: "读取指定会话详情"
  },
  {
    name: "sessions.messages.list",
    mode: "read",
    enabled: true,
    summary: "读取指定会话消息窗口"
  },
  {
    name: "sessions.runtime.get",
    mode: "read",
    enabled: true,
    summary: "读取指定会话运行态"
  },
  {
    name: "sessions.message.send",
    mode: "proxy_execute",
    enabled: true,
    summary: "向指定真实项目会话发送消息"
  },
  {
    name: "sessions.fork",
    mode: "proxy_execute",
    enabled: true,
    summary: "从指定会话或消息点 fork 新会话"
  },
  {
    name: "sessions.delete",
    mode: "proxy_execute",
    enabled: true,
    summary: "删除指定真实会话"
  },
  {
    name: "automations.list",
    mode: "read",
    enabled: true,
    summary: "列出当前助手自动化任务"
  },
  {
    name: "automations.get",
    mode: "read",
    enabled: true,
    summary: "读取单个助手自动化任务详情"
  },
  {
    name: "automations.create",
    mode: "proxy_execute",
    enabled: true,
    summary: "创建正式助手自动化任务"
  },
  {
    name: "automations.cancel",
    mode: "proxy_execute",
    enabled: true,
    summary: "取消助手自动化任务"
  },
  {
    name: "automations.runs.list",
    mode: "read",
    enabled: true,
    summary: "读取助手自动化执行记录"
  },
  {
    name: "follow-ups.list",
    mode: "read",
    enabled: true,
    summary: "列出当前助手可见的会话跟进任务"
  },
  {
    name: "follow-ups.get",
    mode: "read",
    enabled: true,
    summary: "读取单个会话跟进任务详情"
  },
  {
    name: "follow-ups.create",
    mode: "proxy_execute",
    enabled: true,
    summary: "创建新的会话跟进任务"
  },
  {
    name: "follow-ups.continue",
    mode: "proxy_execute",
    enabled: true,
    summary: "回写继续推进结论并安排下一轮跟进"
  },
  {
    name: "follow-ups.waiting-user",
    mode: "proxy_execute",
    enabled: true,
    summary: "回写需要等待用户决策的跟进结论"
  },
  {
    name: "follow-ups.complete",
    mode: "proxy_execute",
    enabled: true,
    summary: "回写跟进任务已完成"
  },
  {
    name: "follow-ups.fail",
    mode: "proxy_execute",
    enabled: true,
    summary: "回写跟进任务失败"
  },
  {
    name: "timers.list",
    mode: "read",
    enabled: true,
    summary: "列出当前助手会话相关的计时器"
  },
  {
    name: "timers.get",
    mode: "read",
    enabled: true,
    summary: "读取单个助手计时器详情"
  },
  {
    name: "timers.create",
    mode: "proxy_execute",
    enabled: true,
    summary: "创建助手控制会话的定时继续任务"
  },
  {
    name: "timers.cancel",
    mode: "proxy_execute",
    enabled: true,
    summary: "取消助手控制会话计时器"
  },
  {
    name: "terminals.list",
    mode: "read",
    enabled: true,
    summary: "列出指定工作区或项目下的终端"
  },
  {
    name: "terminals.history.read",
    mode: "read",
    enabled: true,
    summary: "读取终端历史输出"
  },
  {
    name: "terminals.input.send",
    mode: "proxy_execute",
    enabled: true,
    summary: "向受控终端发送输入"
  },
  {
    name: "terminals.close",
    mode: "proxy_execute",
    enabled: true,
    summary: "关闭指定受控终端"
  },
  {
    name: "office.document.create",
    mode: "proxy_execute",
    enabled: true,
    summary: "创建办公文档并返回文档摘要"
  },
  {
    name: "office.document.update",
    mode: "proxy_execute",
    enabled: true,
    summary: "更新办公文档并返回最新修订摘要"
  },
  {
    name: "office.document.export",
    mode: "proxy_execute",
    enabled: true,
    summary: "创建或执行文档导出任务，并返回任务状态与回执"
  },
  {
    name: "office.document.task.get",
    mode: "read",
    enabled: true,
    summary: "读取办公文档导出任务状态、产物与回执"
  },
  {
    name: "office.task.approval.reply",
    mode: "proxy_execute",
    enabled: true,
    summary: "处理办公任务审批，批准后任务可以继续执行"
  },
  {
    name: "workspaces.list",
    mode: "read",
    enabled: true,
    summary: "列出当前可见工作区"
  },
  {
    name: "workspaces.browse",
    mode: "read",
    enabled: true,
    summary: "浏览可导入的本地目录"
  },
  {
    name: "workspaces.directory.create",
    mode: "proxy_execute",
    enabled: true,
    summary: "创建新的工作区目录"
  },
  {
    name: "workspaces.import",
    mode: "proxy_execute",
    enabled: true,
    summary: "把已有目录导入成工作区"
  },
  {
    name: "workspaces.clone",
    mode: "proxy_execute",
    enabled: true,
    summary: "克隆仓库并导入成工作区"
  },
  {
    name: "workspaces.reorder",
    mode: "proxy_execute",
    enabled: true,
    summary: "调整工作区显示顺序"
  },
  {
    name: "workspaces.management.get",
    mode: "read",
    enabled: true,
    summary: "读取工作区管理摘要"
  },
  {
    name: "workspaces.navigation-state.update",
    mode: "proxy_execute",
    enabled: true,
    summary: "更新工作区导航状态"
  },
  {
    name: "workspaces.remove",
    mode: "proxy_execute",
    enabled: true,
    summary: "移除工作区入口"
  },
  {
    name: "worktrees.tree",
    mode: "read",
    enabled: true,
    summary: "读取工作树结构"
  },
  {
    name: "worktrees.create",
    mode: "proxy_execute",
    enabled: true,
    summary: "创建子工作树"
  },
  {
    name: "worktrees.merge-preview",
    mode: "read",
    enabled: true,
    summary: "读取子工作树合并预览"
  },
  {
    name: "worktrees.merge-into-parent",
    mode: "proxy_execute",
    enabled: true,
    summary: "把子工作树合并回父工作区"
  },
  {
    name: "worktrees.cleanup",
    mode: "proxy_execute",
    enabled: true,
    summary: "清理子工作树"
  }
];

export class AssistantCapabilityService {
  private readonly capabilityDefinitions = augmentAssistantCapabilities(ASSISTANT_CAPABILITIES);

  constructor(
    private readonly butlerProjectService: Pick<
      ButlerProjectService,
      "list" | "getById" | "getOverview"
    >,
    private readonly butlerSessionService: Pick<
      ButlerSessionService,
      "listByProject" | "ensureProjectSessionsSynced" | "startSession"
    >,
    private readonly butlerControlSessionService: Pick<ButlerControlSessionService, "getCurrentSession">,
    private readonly assistantAutomationService: Pick<
      AssistantAutomationService,
      | "listTasks"
      | "getTask"
      | "createTask"
      | "updateTask"
      | "cancelTask"
      | "skipCurrentWait"
      | "listRuns"
      | "listRecentRuns"
    >,
    private readonly butlerControlTimerService: Pick<
      ButlerControlTimerService,
      "listTimers" | "getTimer" | "createTimer" | "cancelTimer"
    >,
    private readonly sessionHistoryService: Pick<
      SessionHistoryService,
      "getSession" | "readSessionHistory" | "forkSession" | "deleteSession"
    >,
    private readonly sessionLiveRuntimeService: Pick<
      SessionLiveRuntimeService,
      "getSessionRuntime" | "sendLiveMessage" | "startLiveSession"
    >,
    private readonly terminalService: Pick<
      TerminalService,
      "createTerminal" | "listTerminals" | "readTerminalHistory" | "writeInput" | "closeTerminal" | "getTerminalOrThrow"
    >,
    private readonly workspaceService: Pick<
      WorkspaceService,
      | "list"
      | "listForUser"
      | "browseDirectories"
      | "createDirectory"
      | "importWorkspace"
      | "importWorkspaceForUser"
      | "cloneWorkspace"
      | "cloneWorkspaceForUser"
      | "reorderWorkspaces"
      | "reorderWorkspacesForUser"
      | "getManagementSummary"
      | "getManagementSummaryForUser"
      | "removeWorkspace"
      | "removeWorkspaceForUser"
      | "updateNavigationState"
    >,
    private readonly workspaceWorktreeRepository: Pick<WorkspaceWorktreeRepository, "findByWorkspaceId">,
    private readonly worktreeManager: Pick<WorktreeManager, "getTree" | "create">,
    private readonly worktreeSyncService: Pick<WorktreeSyncService, "syncRoot">,
    private readonly worktreeMergeService: Pick<WorktreeMergeService, "preview" | "apply">,
    private readonly worktreeCleanupService: Pick<WorktreeCleanupService, "cleanup">,
    private readonly sessionMessageOriginRepository: Pick<
      SessionMessageOriginRepository,
      "upsert"
    > | null = null,
    private readonly butlerFollowUpService: Pick<
      ButlerFollowUpService,
      | "listTasks"
      | "getTask"
      | "createTask"
      | "continueTask"
      | "markTaskWaitingUser"
      | "completeTask"
      | "failTask"
    > | null = null,
    private readonly providerControlRepository: Pick<ProviderControlRepository, "get"> | null = null,
    private readonly documentRuntimeService: Pick<
      DocumentRuntimeService,
      | "createDocument"
      | "getDocumentDetail"
      | "updateDocument"
      | "createExportTask"
      | "executeExportTask"
    > | null = null,
    private readonly officeServiceForDocumentTask: Pick<
      OfficeService,
      "getTaskDetail" | "replyApproval"
    > | null = null,
    private readonly officePreviewLinkService: Pick<
      OfficePreviewLinkService,
      "createArtifactLink"
    > | null = null,
    private readonly browserRuntimeService: null = null,
    private readonly opsRuntimeService: null = null
  ) {}

  listCapabilities(context?: AssistantExecutionContext): AssistantCapabilityReceipt<{
    version: string;
    items: AssistantCapabilityDescriptor[];
  }> {
    return this.createReceipt("capabilities.list", {
      kind: "none",
      id: null
    }, {
      version: "2026-04-16",
      items: this.listVisibleCapabilities(context)
    });
  }

  listProjects(input: ListProjectsInput): AssistantCapabilityReceipt<{
    items: ReturnType<ButlerProjectService["list"]>;
  }> {
    const items = this.butlerProjectService.list({
      userId: input.userId,
      workspaceId: input.workspaceId?.trim() || undefined,
      lifecycleStatus: input.lifecycleStatus,
      riskLevel: input.riskLevel
    });

    return this.createReceipt("projects.list", {
      kind: "none",
      id: null
    }, {
      items
    });
  }

  async getProject(
    projectId: string,
    userId: string
  ): Promise<AssistantCapabilityReceipt<{
    project: ReturnType<ButlerProjectService["getById"]>;
    overview: ReturnType<ButlerProjectService["getOverview"]>;
    sessions: ReturnType<ButlerSessionService["listByProject"]>;
  }>> {
    await this.butlerSessionService.ensureProjectSessionsSynced(projectId, userId);
    const project = this.butlerProjectService.getById(projectId, userId);
    const overview = this.butlerProjectService.getOverview(projectId, userId);
    const sessions = this.butlerSessionService.listByProject(projectId, userId);

    return this.createReceipt("projects.get", {
      kind: "project",
      id: projectId
    }, {
      project,
      overview,
      sessions
    });
  }

  async listProjectSessions(
    projectId: string,
    userId: string
  ): Promise<AssistantCapabilityReceipt<{
    items: ReturnType<ButlerSessionService["listByProject"]>;
  }>> {
    await this.butlerSessionService.ensureProjectSessionsSynced(projectId, userId);
    const items = this.butlerSessionService.listByProject(projectId, userId);

    return this.createReceipt("projects.sessions.list", {
      kind: "project",
      id: projectId
    }, {
      items
    });
  }

  createOfficeDocument(
    input: CreateAssistantOfficeDocumentInput
  ): AssistantCapabilityReceipt<{
    document: ReturnType<typeof summarizeOfficeDocumentDetail>;
  }> {
    const detail = this.requireDocumentRuntimeService().createDocument({
      userId: input.userId,
      workspaceId: normalizeAssistantText(input.workspaceId) ?? undefined,
      title: input.title,
      templateId: normalizeAssistantText(input.templateId) ?? undefined,
      templateKey: normalizeAssistantText(input.templateKey) ?? undefined,
      content: input.content,
      outline: input.outline,
      summary: input.summary ?? undefined
    });

    return this.createReceipt("office.document.create", {
      kind: "workspace",
      id: detail.document.workspaceId
    }, {
      document: summarizeOfficeDocumentDetail(detail)
    });
  }

  updateOfficeDocument(
    input: UpdateAssistantOfficeDocumentInput
  ): AssistantCapabilityReceipt<{
    document: ReturnType<typeof summarizeOfficeDocumentDetail>;
  }> {
    const detail = this.requireDocumentRuntimeService().updateDocument({
      documentId: input.documentId,
      userId: input.userId,
      title: input.title ?? undefined,
      templateId: normalizeAssistantText(input.templateId) ?? undefined,
      content: input.content,
      outline: input.outline,
      summary: input.summary ?? undefined,
      status: input.status
    });

    return this.createReceipt("office.document.update", {
      kind: "workspace",
      id: detail.document.workspaceId
    }, {
      document: summarizeOfficeDocumentDetail(detail)
    });
  }

  async exportOfficeDocument(
    input: ExportAssistantOfficeDocumentInput
  ): Promise<AssistantCapabilityReceipt<{
    task: ReturnType<typeof summarizeOfficeTaskDetail>;
    execution:
      | {
        taskId: string;
        executionTaskId: string;
        deduped: boolean;
      }
      | null;
  }>> {
    const createResult = this.requireDocumentRuntimeService().createExportTask({
      documentId: input.documentId,
      userId: input.userId,
      workspaceId: normalizeAssistantText(input.workspaceId) ?? undefined,
      format: input.format ?? "docx",
      riskLevel: input.riskLevel
    });
    const execution = input.execute === false
      ? null
      : await this.requireDocumentRuntimeService().executeExportTask(createResult.task.id, input.userId);
    const detail = this.requireOfficeTaskService().getTaskDetail(createResult.task.id, input.userId);

    return this.createReceipt("office.document.export", {
      kind: "workspace",
      id: detail.task.workspaceId
    }, {
      task: summarizeOfficeTaskDetail(detail, {
        officePreviewLinkService: this.officePreviewLinkService,
        userId: input.userId
      }),
      execution
    });
  }

  getOfficeDocumentTask(
    taskId: string,
    userId: string
  ): AssistantCapabilityReceipt<{
    task: ReturnType<typeof summarizeOfficeTaskDetail>;
  }> {
    const detail = this.requireOfficeTaskService().getTaskDetail(taskId, userId);

    return this.createReceipt("office.document.task.get", {
      kind: "workspace",
      id: detail.task.workspaceId
    }, {
      task: summarizeOfficeTaskDetail(detail, {
        officePreviewLinkService: this.officePreviewLinkService,
        userId
      })
    });
  }

  replyOfficeTaskApproval(
    input: ReplyAssistantOfficeTaskApprovalInput
  ): AssistantCapabilityReceipt<{
    approval: ReturnType<OfficeService["replyApproval"]>;
    task: ReturnType<typeof summarizeOfficeTaskDetail>;
  }> {
    const approval = this.requireOfficeApprovalService().replyApproval({
      approvalId: input.approvalId,
      userId: input.userId,
      status: input.status,
      decisionNote: input.decisionNote ?? undefined
    });
    const detail = this.requireOfficeTaskService().getTaskDetail(approval.taskId, input.userId);

    return this.createReceipt("office.task.approval.reply", {
      kind: "workspace",
      id: detail.task.workspaceId
    }, {
      approval,
      task: summarizeOfficeTaskDetail(detail, {
        officePreviewLinkService: this.officePreviewLinkService,
        userId: input.userId
      })
    });
  }

  async startProjectSession(
    input: StartAssistantProjectSessionInput
  ): Promise<AssistantCapabilityReceipt<{
    session: Awaited<ReturnType<ButlerSessionService["startSession"]>>;
  }>> {
    const config = this.resolveSessionLaunchConfig(input);
    const session = await this.butlerSessionService.startSession(
      input.projectId,
      {
        role: "adhoc",
        ownershipMode: "managed",
        content: input.content.trim(),
        providerId: config.providerId,
        model: config.model,
        reasoningLevel: config.reasoningLevel,
        permissionMode: config.permissionMode
      },
      input.userId
    );

    return this.createReceipt("projects.sessions.start", {
      kind: "project",
      id: input.projectId
    }, {
      session
    });
  }

  async startSession(
    input: StartAssistantSessionInput
  ): Promise<AssistantCapabilityReceipt<{
    session:
      | Awaited<ReturnType<ButlerSessionService["startSession"]>>
      | Awaited<ReturnType<SessionLiveRuntimeService["startLiveSession"]>>;
    target: {
      kind: AssistantSessionTarget["kind"];
      id: string;
      workspaceId: string;
    };
  }>> {
    const config = this.resolveSessionLaunchConfig(input);
    if (!input.target) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "启动真实会话必须显式提供 projectId 或 workspaceId",
        field: "projectId"
      });
    }

    const target = this.resolveAssistantSessionTarget(input.target, input.userId);

    if (target.kind === "project") {
      const session = await this.butlerSessionService.startSession(
        target.id,
        {
          role: "adhoc",
          ownershipMode: "managed",
          content: input.content.trim(),
          providerId: config.providerId,
          model: config.model,
          reasoningLevel: config.reasoningLevel,
          permissionMode: config.permissionMode
        },
        input.userId
      );

      return this.createReceipt("sessions.start", {
        kind: "project",
        id: target.id
      }, {
        session,
        target
      });
    }

    const session = await this.sessionLiveRuntimeService.startLiveSession({
      workspaceId: target.workspaceId,
      userId: input.userId,
      provider: config.providerId,
      content: input.content.trim(),
      clientRequestId: null,
      runtimeOptions: {
        model: config.model,
        reasoningLevel: config.reasoningLevel,
        permissionMode: config.permissionMode,
        attachments: []
      }
    });

    return this.createReceipt("sessions.start", {
      kind: target.kind,
      id: target.id
    }, {
      session,
      target
    });
  }

  getSession(
    sessionId: string,
    userId: string
  ): AssistantCapabilityReceipt<{
    session: ReturnType<SessionHistoryService["getSession"]>;
  }> {
    const session = this.sessionHistoryService.getSession(sessionId, userId);

    return this.createReceipt("sessions.get", {
      kind: "session",
      id: sessionId
    }, {
      session
    });
  }

  async listSessionMessages(input: {
    sessionId: string;
    userId: string;
    cursor: string | null;
    limit: number;
    direction: "forward" | "backward";
  }): Promise<AssistantCapabilityReceipt<{
    page: Awaited<ReturnType<SessionHistoryService["readSessionHistory"]>>;
  }>> {
    this.sessionHistoryService.getSession(input.sessionId, input.userId);
    const page = await this.sessionHistoryService.readSessionHistory(
      input.sessionId,
      input.cursor,
      input.limit,
      input.direction,
      input.userId
    );

    return this.createReceipt("sessions.messages.list", {
      kind: "session",
      id: input.sessionId
    }, {
      page
    });
  }

  async getSessionRuntime(
    sessionId: string,
    userId: string
  ): Promise<AssistantCapabilityReceipt<{
    runtime: Awaited<ReturnType<SessionLiveRuntimeService["getSessionRuntime"]>>;
  }>> {
    logResourceScopeDebug("assistant_capability.get_session_runtime.start", {
      sessionId,
      userId
    });
    this.sessionHistoryService.getSession(sessionId, userId);
    const runtime = await this.sessionLiveRuntimeService.getSessionRuntime(sessionId, userId);
    logResourceScopeDebug("assistant_capability.get_session_runtime.end", {
      sessionId,
      userId,
      runningState: runtime.runningState,
      errorCode: runtime.errorCode ?? null
    });

    return this.createReceipt("sessions.runtime.get", {
      kind: "session",
      id: sessionId
    }, {
      runtime
    });
  }

  async sendSessionMessage(
    input: SendAssistantSessionMessageInput
  ): Promise<AssistantCapabilityReceipt<{
    result: Awaited<ReturnType<SessionLiveRuntimeService["sendLiveMessage"]>>;
  }>> {
    const requestedAt = nowIso();
    const clientRequestId = recordButlerProxyMessageOrigin(this.sessionMessageOriginRepository, {
      sessionId: input.sessionId,
      clientRequestId: input.clientRequestId?.trim() || null,
      content: input.content,
      createdAt: requestedAt,
      fallbackKey: `assistant-send:${input.sessionId}:${requestedAt}`
    });
    const result = await this.sessionLiveRuntimeService.sendLiveMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      content: input.content,
      clientRequestId,
      runtimeOptions: {
        model: input.model?.trim() || null,
        reasoningLevel: input.reasoningLevel?.trim() || null,
        permissionMode: input.permissionMode?.trim() || null,
        attachments: []
      }
    });
    recordButlerProxyMessageOrigin(this.sessionMessageOriginRepository, {
      sessionId: input.sessionId,
      clientRequestId,
      messageId: result.message?.messageId ?? null,
      content: input.content,
      createdAt: result.acceptedAt,
      fallbackKey: `assistant-send:${input.sessionId}:${result.acceptedAt}`
    });

    return this.createReceipt("sessions.message.send", {
      kind: "session",
      id: input.sessionId
    }, {
      result
    });
  }

  async forkSession(
    input: ForkAssistantSessionInput
  ): Promise<AssistantCapabilityReceipt<{
    session: Awaited<ReturnType<SessionHistoryService["forkSession"]>>;
  }>> {
    const session = await this.sessionHistoryService.forkSession({
      sessionId: input.sessionId,
      userId: input.userId,
      sourceType: input.sourceType,
      sourceMessageId: input.sourceMessageId?.trim() || null,
      strategy: input.strategy ?? "auto",
      targetProvider: input.targetProvider?.trim() || null
    });

    return this.createReceipt("sessions.fork", {
      kind: "session",
      id: input.sessionId
    }, {
      session
    });
  }

  async deleteSession(
    sessionId: string,
    userId: string
  ): Promise<AssistantCapabilityReceipt<{
    sessionId: string;
    deleted: true;
  }>> {
    await this.sessionHistoryService.deleteSession(sessionId, userId);

    return this.createReceipt("sessions.delete", {
      kind: "session",
      id: sessionId
    }, {
      sessionId,
      deleted: true
    });
  }

  listTimers(
    input: ListAssistantTimersInput
  ): AssistantCapabilityReceipt<{
    items: ReturnType<ButlerControlTimerService["listTimers"]>;
  }> {
    const items = this.butlerControlTimerService.listTimers({
      userId: input.userId,
      statuses: input.status ? [input.status] : undefined,
      controlSessionId: input.controlSessionId ?? null,
      limit: input.limit ?? undefined
    });

    return this.createReceipt("timers.list", {
      kind: "none",
      id: null
    }, {
      items
    });
  }

  listAutomations(
    input: ListAssistantAutomationsInput
  ): AssistantCapabilityReceipt<{
    items: ReturnType<AssistantAutomationService["listTasks"]>;
  }> {
    const items = this.safeListAutomations(input);

    return this.createReceipt("automations.list", {
      kind: "none",
      id: null
    }, {
      items
    });
  }

  getAutomation(
    automationId: string,
    userId: string
  ): AssistantCapabilityReceipt<{
    automation: ReturnType<AssistantAutomationService["getTask"]>;
  }> {
    const automation = this.assistantAutomationService.getTask(automationId, userId);

    return this.createReceipt("automations.get", {
      kind: "automation",
      id: automationId
    }, {
      automation
    });
  }

  createAutomation(
    input: CreateAssistantAutomationInput
  ): AssistantCapabilityReceipt<{
    automation: ReturnType<AssistantAutomationService["createTask"]>;
  }> {
    const triggerType = input.triggerType ?? "once";
    const automation = this.assistantAutomationService.createTask({
      userId: input.userId,
      controlSessionId: input.controlSessionId,
      projectId: input.projectId,
      title: input.title,
      trigger: buildAssistantAutomationTriggerInput(triggerType, input),
      action: {
        type: "send_control_message",
        content: input.content,
        includeTriggerContext:
          input.includeTriggerContext ?? triggerType === "condition",
        targetSessionId: input.targetSessionId ?? null
      }
    });

    return this.createReceipt("automations.create", {
      kind: "automation",
      id: automation.id
    }, {
      automation
    });
  }

  updateAutomation(
    input: UpdateAssistantAutomationInput
  ): AssistantCapabilityReceipt<{
    automation: ReturnType<AssistantAutomationService["updateTask"]>;
  }> {
    const automation = this.assistantAutomationService.updateTask({
      taskId: input.automationId,
      userId: input.userId,
      title: input.title,
      content: input.content,
      includeTriggerContext: input.includeTriggerContext,
      dueAt: input.dueAt,
      everySeconds: input.everySeconds,
      everyMinutes: input.everyMinutes,
      everyHours: input.everyHours,
      stopAt: input.stopAt,
      cronMinute: input.cronMinute,
      cronHour: input.cronHour,
      cronDaysOfWeek: input.cronDaysOfWeek,
      pollIntervalSeconds: input.pollIntervalSeconds,
      expiresAt: input.expiresAt,
      maxChecks: input.maxChecks
    });

    return this.createReceipt("automations.update", {
      kind: "automation",
      id: input.automationId
    }, {
      automation
    });
  }

  cancelAutomation(
    automationId: string,
    userId: string
  ): AssistantCapabilityReceipt<{
    automation: ReturnType<AssistantAutomationService["cancelTask"]>;
  }> {
    const automation = this.assistantAutomationService.cancelTask(automationId, userId);

    return this.createReceipt("automations.cancel", {
      kind: "automation",
      id: automationId
    }, {
      automation
    });
  }

  skipAutomationWait(
    automationId: string,
    userId: string
  ): AssistantCapabilityReceipt<{
    automation: ReturnType<AssistantAutomationService["skipCurrentWait"]>;
  }> {
    const automation = this.assistantAutomationService.skipCurrentWait(automationId, userId);

    return this.createReceipt("automations.wait.skip", {
      kind: "automation",
      id: automationId
    }, {
      automation
    });
  }

  listAutomationRuns(
    automationId: string,
    userId: string
  ): AssistantCapabilityReceipt<{
    items: ReturnType<AssistantAutomationService["listRuns"]>;
  }> {
    const items = this.assistantAutomationService.listRuns(automationId, userId);

    return this.createReceipt("automations.runs.list", {
      kind: "automation",
      id: automationId
    }, {
      items
    });
  }

  listRecentAutomationRuns(
    input: ListAssistantAutomationRunsInput
  ): AssistantCapabilityReceipt<{
    items: ReturnType<AssistantAutomationService["listRecentRuns"]>;
  }> {
    const items = this.safeListRecentAutomationRuns(input);

    return this.createReceipt("automations.runs.recent", {
      kind: "none",
      id: null
    }, {
      items
    });
  }

  private safeListAutomations(
    input: ListAssistantAutomationsInput
  ): ReturnType<AssistantAutomationService["listTasks"]> {
    try {
      return this.assistantAutomationService.listTasks({
        userId: input.userId,
        statuses: input.status ? [input.status] : undefined,
        controlSessionId: input.controlSessionId ?? null
      });
    } catch (error) {
      if (isButlerProfileNotInitializedError(error)) {
        return [];
      }

      throw error;
    }
  }

  private safeListRecentAutomationRuns(
    input: ListAssistantAutomationRunsInput
  ): ReturnType<AssistantAutomationService["listRecentRuns"]> {
    try {
      return this.assistantAutomationService.listRecentRuns({
        userId: input.userId,
        controlSessionId: input.controlSessionId ?? null,
        limit: input.limit ?? undefined
      });
    } catch (error) {
      if (isButlerProfileNotInitializedError(error)) {
        return [];
      }

      throw error;
    }
  }

  listFollowUps(
    input: ListAssistantFollowUpsInput
  ): AssistantCapabilityReceipt<{
    items: ReturnType<ButlerFollowUpService["listTasks"]>;
  }> {
    const service = this.requireFollowUpService();
    const items = service.listTasks({
      statuses: input.status ? [input.status] : undefined,
      projectId: input.projectId ?? undefined,
      sessionId: input.sessionId ?? undefined,
      limit: input.limit ?? undefined
    });

    return this.createReceipt("follow-ups.list", {
      kind: "none",
      id: null
    }, {
      items
    });
  }

  getFollowUp(
    taskId: string
  ): AssistantCapabilityReceipt<{
    task: ReturnType<ButlerFollowUpService["getTask"]>;
  }> {
    const service = this.requireFollowUpService();
    const task = service.getTask(taskId);

    return this.createReceipt("follow-ups.get", {
      kind: "follow_up",
      id: taskId
    }, {
      task
    });
  }

  async createFollowUp(
    input: CreateAssistantFollowUpInput
  ): Promise<AssistantCapabilityReceipt<{
    task: Awaited<ReturnType<ButlerFollowUpService["createTask"]>>;
  }>> {
    const service = this.requireFollowUpService();
    const providerId = input.providerId ?? this.butlerControlSessionService.getCurrentSession(input.userId)?.providerId;

    if (!providerId) {
      throw new AppError({
        statusCode: 409,
        errorCode: "ASSISTANT_CONTROL_SESSION_NOT_FOUND",
        detail: "当前没有可用的助手控制会话，无法继承默认 provider"
      });
    }

    this.assertProviderEnabled(providerId, "providerId");

    const task = await service.createTask({
      projectId: input.projectId,
      butlerSessionId: input.butlerSessionId,
      providerId,
      objective: input.objective,
      completionCriteria: input.completionCriteria ?? undefined,
      maxAutoContinueCount: input.maxAutoContinueCount ?? undefined,
      checkIntervalSeconds: input.checkIntervalSeconds ?? undefined
    }, input.userId);

    return this.createReceipt("follow-ups.create", {
      kind: "follow_up",
      id: task.id
    }, {
      task
    });
  }

  async continueFollowUp(
    input: ContinueAssistantFollowUpInput
  ): Promise<AssistantCapabilityReceipt<{
    task: Awaited<ReturnType<ButlerFollowUpService["continueTask"]>>;
  }>> {
    const service = this.requireFollowUpService();
    const task = await service.continueTask(input.taskId, {
      summary: input.summary,
      continuePrompt: input.continuePrompt
    }, input.userId);

    return this.createReceipt("follow-ups.continue", {
      kind: "follow_up",
      id: input.taskId
    }, {
      task
    });
  }

  async markFollowUpWaitingUser(
    input: WaitingUserAssistantFollowUpInput
  ): Promise<AssistantCapabilityReceipt<{
    task: Awaited<ReturnType<ButlerFollowUpService["markTaskWaitingUser"]>>;
  }>> {
    const service = this.requireFollowUpService();
    const task = await service.markTaskWaitingUser(input.taskId, {
      summary: input.summary,
      waitingReason: input.waitingReason
    }, input.userId);

    return this.createReceipt("follow-ups.waiting-user", {
      kind: "follow_up",
      id: input.taskId
    }, {
      task
    });
  }

  async completeFollowUp(
    input: CompleteAssistantFollowUpInput
  ): Promise<AssistantCapabilityReceipt<{
    task: Awaited<ReturnType<ButlerFollowUpService["completeTask"]>>;
  }>> {
    const service = this.requireFollowUpService();
    const task = await service.completeTask(input.taskId, {
      summary: input.summary
    }, input.userId);

    return this.createReceipt("follow-ups.complete", {
      kind: "follow_up",
      id: input.taskId
    }, {
      task
    });
  }

  async failFollowUp(
    input: FailAssistantFollowUpInput
  ): Promise<AssistantCapabilityReceipt<{
    task: Awaited<ReturnType<ButlerFollowUpService["failTask"]>>;
  }>> {
    const service = this.requireFollowUpService();
    const task = await service.failTask(input.taskId, {
      summary: input.summary,
      reason: input.reason ?? null
    }, input.userId);

    return this.createReceipt("follow-ups.fail", {
      kind: "follow_up",
      id: input.taskId
    }, {
      task
    });
  }

  getTimer(
    timerId: string,
    userId: string
  ): AssistantCapabilityReceipt<{
    timer: ReturnType<ButlerControlTimerService["getTimer"]>;
  }> {
    const timer = this.butlerControlTimerService.getTimer(timerId, userId);

    return this.createReceipt("timers.get", {
      kind: "timer",
      id: timerId
    }, {
      timer
    });
  }

  createTimer(
    input: CreateAssistantTimerInput
  ): AssistantCapabilityReceipt<{
    timer: ReturnType<ButlerControlTimerService["createTimer"]>;
  }> {
    const timer = this.butlerControlTimerService.createTimer(input);

    return this.createReceipt("timers.create", {
      kind: "timer",
      id: timer.id
    }, {
      timer
    });
  }

  cancelTimer(
    timerId: string,
    userId: string
  ): AssistantCapabilityReceipt<{
    timer: ReturnType<ButlerControlTimerService["cancelTimer"]>;
  }> {
    const timer = this.butlerControlTimerService.cancelTimer(timerId, userId);

    return this.createReceipt("timers.cancel", {
      kind: "timer",
      id: timerId
    }, {
      timer
    });
  }

  async createTerminal(
    input: CreateAssistantTerminalInput
  ): Promise<AssistantCapabilityReceipt<{
    workspaceId: string;
    terminal: {
      id: string;
      workspaceId: string;
      name: string;
      cwd: string;
      shell: string;
      status: string;
    };
  }>> {
    const workspaceId = input.projectId?.trim()
      ? this.butlerProjectService.getById(input.projectId, input.userId).workspaceId
      : input.workspaceId?.trim() || "";

    if (!workspaceId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "创建终端必须提供 workspaceId 或 projectId",
        field: "workspaceId"
      });
    }

    const terminal = await this.terminalService.createTerminal({
      workspaceId,
      name: normalizeAssistantText(input.name) ?? undefined,
      cwd: normalizeAssistantText(input.cwd) ?? undefined,
      shell: normalizeAssistantText(input.shell) ?? undefined,
      createdByUserId: input.userId
    });

    return this.createReceipt("terminals.create", {
      kind: input.projectId?.trim() ? "project" : "workspace",
      id: input.projectId?.trim() || workspaceId
    }, {
      workspaceId,
      terminal: {
        id: terminal.id,
        workspaceId: terminal.workspaceId,
        name: terminal.name,
        cwd: terminal.cwd,
        shell: terminal.shell,
        status: terminal.status
      }
    });
  }

  async listTerminals(
    input: ListAssistantTerminalsInput
  ): Promise<AssistantCapabilityReceipt<{
    workspaceId: string;
    items: Awaited<ReturnType<TerminalService["listTerminals"]>>;
  }>> {
    const workspaceId = input.projectId?.trim()
      ? this.butlerProjectService.getById(input.projectId, input.userId).workspaceId
      : input.workspaceId?.trim() || "";

    const items = await this.terminalService.listTerminals(workspaceId);

    return this.createReceipt("terminals.list", {
      kind: input.projectId?.trim() ? "project" : "none",
      id: input.projectId?.trim() || null
    }, {
      workspaceId,
      items
    });
  }

  async readTerminalHistory(
    input: ReadAssistantTerminalHistoryInput
  ): Promise<AssistantCapabilityReceipt<{
    page: Awaited<ReturnType<TerminalService["readTerminalHistory"]>>;
  }>> {
    const page = await this.terminalService.readTerminalHistory(
      input.terminalId,
      input.beforeSeq,
      input.limit
    );

    return this.createReceipt("terminals.history.read", {
      kind: "terminal",
      id: input.terminalId
    }, {
      page
    });
  }

  async sendTerminalInput(
    input: SendAssistantTerminalInput
  ): Promise<AssistantCapabilityReceipt<{
    result: Awaited<ReturnType<TerminalService["writeInput"]>>;
  }>> {
    const result = await this.terminalService.writeInput(input.terminalId, input.content);

    return this.createReceipt("terminals.input.send", {
      kind: "terminal",
      id: input.terminalId
    }, {
      result
    });
  }

  async closeTerminal(
    terminalId: string
  ): Promise<AssistantCapabilityReceipt<{
    result: Awaited<ReturnType<TerminalService["closeTerminal"]>>;
  }>> {
    const result = await this.terminalService.closeTerminal(terminalId);

    return this.createReceipt("terminals.close", {
      kind: "terminal",
      id: terminalId
    }, {
      result
    });
  }

  listWorkspaces(userId: string): AssistantCapabilityReceipt<{
    items: ReturnType<WorkspaceService["listForUser"]>;
  }> {
    return this.createReceipt("workspaces.list", {
      kind: "none",
      id: null
    }, {
      items: this.workspaceService.listForUser(userId)
    });
  }

  browseWorkspaces(
    requestedPath?: string | null
  ): AssistantCapabilityReceipt<{
    result: ReturnType<WorkspaceService["browseDirectories"]>;
  }> {
    return this.createReceipt("workspaces.browse", {
      kind: "none",
      id: null
    }, {
      result: this.workspaceService.browseDirectories(requestedPath?.trim() || undefined)
    });
  }

  createWorkspaceDirectory(
    input: CreateAssistantWorkspaceDirectoryInput
  ): AssistantCapabilityReceipt<{
    result: ReturnType<WorkspaceService["createDirectory"]>;
  }> {
    const result = this.workspaceService.createDirectory(input.parentPath, input.directoryName);

    return this.createReceipt("workspaces.directory.create", {
      kind: "none",
      id: null
    }, {
      result
    });
  }

  importWorkspace(
    userId: string,
    input: ImportAssistantWorkspaceInput
  ): AssistantCapabilityReceipt<{
    workspace: ReturnType<WorkspaceService["importWorkspaceForUser"]>;
  }> {
    const workspace = this.workspaceService.importWorkspaceForUser(
      userId,
      input.path,
      input.name ?? undefined
    );

    return this.createReceipt("workspaces.import", {
      kind: "workspace",
      id: workspace.id
    }, {
      workspace
    });
  }

  async cloneWorkspace(
    userId: string,
    input: CloneAssistantWorkspaceInput
  ): Promise<AssistantCapabilityReceipt<{
    workspace: Awaited<ReturnType<WorkspaceService["cloneWorkspaceForUser"]>>;
  }>> {
    const workspace = await this.workspaceService.cloneWorkspaceForUser(userId, {
      repositoryUrl: input.repositoryUrl,
      parentPath: input.parentPath,
      directoryName: input.directoryName ?? undefined,
      name: input.name ?? undefined,
      auth: input.auth ?? undefined
    });

    return this.createReceipt("workspaces.clone", {
      kind: "workspace",
      id: workspace.id
    }, {
      workspace
    });
  }

  reorderWorkspaces(
    userId: string,
    workspaceIds: string[]
  ): AssistantCapabilityReceipt<{
    items: ReturnType<WorkspaceService["reorderWorkspacesForUser"]>;
  }> {
    const items = this.workspaceService.reorderWorkspacesForUser(userId, workspaceIds);

    return this.createReceipt("workspaces.reorder", {
      kind: "none",
      id: null
    }, {
      items
    });
  }

  async getWorkspaceManagementSummary(
    userId: string,
    workspaceId: string
  ): Promise<AssistantCapabilityReceipt<{
    summary: Awaited<ReturnType<WorkspaceService["getManagementSummaryForUser"]>>;
  }>> {
    const summary = await this.workspaceService.getManagementSummaryForUser(userId, workspaceId);

    return this.createReceipt("workspaces.management.get", {
      kind: "workspace",
      id: workspaceId
    }, {
      summary
    });
  }

  updateWorkspaceNavigationState(
    input: UpdateAssistantWorkspaceNavigationStateInput
  ): AssistantCapabilityReceipt<{
    state: ReturnType<WorkspaceService["updateNavigationState"]>;
  }> {
    const state = this.workspaceService.updateNavigationState(input.workspaceId, input.userId, {
      collapsed: input.collapsed,
      backgroundColor: input.backgroundColor,
      hidden: input.hidden,
      shortcutAppsCollapsed: input.shortcutAppsCollapsed,
      shortcutAppsSide: input.shortcutAppsSide
    });

    return this.createReceipt("workspaces.navigation-state.update", {
      kind: "workspace",
      id: input.workspaceId
    }, {
      state
    });
  }

  removeWorkspace(
    userId: string,
    workspaceId: string
  ): AssistantCapabilityReceipt<{
    workspace: ReturnType<WorkspaceService["removeWorkspaceForUser"]>;
  }> {
    const workspace = this.workspaceService.removeWorkspaceForUser(userId, workspaceId);

    return this.createReceipt("workspaces.remove", {
      kind: "workspace",
      id: workspaceId
    }, {
      workspace
    });
  }

  async getWorktreeTree(
    rootWorkspaceId: string
  ): Promise<AssistantCapabilityReceipt<{
    rootWorkspaceId: string;
    items: ReturnType<WorktreeManager["getTree"]>;
  }>> {
    await this.worktreeSyncService.syncRoot(rootWorkspaceId);
    const items = this.worktreeManager.getTree(rootWorkspaceId);

    return this.createReceipt("worktrees.tree", {
      kind: "workspace",
      id: rootWorkspaceId
    }, {
      rootWorkspaceId,
      items
    });
  }

  async createWorktree(
    input: CreateAssistantWorktreeInput
  ): Promise<AssistantCapabilityReceipt<{
    result: Awaited<ReturnType<WorktreeManager["create"]>>;
  }>> {
    const result = await this.worktreeManager.create({
      sourceWorkspaceId: input.sourceWorkspaceId,
      branchName: input.branchName,
      displayName: input.displayName ?? undefined,
      baseRef: input.baseRef ?? undefined
    });

    return this.createReceipt("worktrees.create", {
      kind: "worktree",
      id: result.workspace.id
    }, {
      result
    });
  }

  async getWorktreeMergePreview(
    workspaceId: string
  ): Promise<AssistantCapabilityReceipt<{
    preview: Awaited<ReturnType<WorktreeMergeService["preview"]>>;
  }>> {
    const preview = await this.worktreeMergeService.preview(workspaceId);

    return this.createReceipt("worktrees.merge-preview", {
      kind: "worktree",
      id: workspaceId
    }, {
      preview
    });
  }

  async mergeWorktreeIntoParent(
    workspaceId: string
  ): Promise<AssistantCapabilityReceipt<{
    result: Awaited<ReturnType<WorktreeMergeService["apply"]>>;
  }>> {
    const result = await this.worktreeMergeService.apply(workspaceId);

    return this.createReceipt("worktrees.merge-into-parent", {
      kind: "worktree",
      id: workspaceId
    }, {
      result
    });
  }

  async cleanupWorktree(
    workspaceId: string,
    userId: string,
    options: WorktreeCleanupOptions
  ): Promise<AssistantCapabilityReceipt<{
    result: Awaited<ReturnType<WorktreeCleanupService["cleanup"]>>;
  }>> {
    const result = await this.worktreeCleanupService.cleanup(workspaceId, userId, options);

    return this.createReceipt("worktrees.cleanup", {
      kind: "worktree",
      id: workspaceId
    }, {
      result
    });
  }

  private createReceipt<TPayload>(
    capability: string,
    targetRef: AssistantCapabilityReceipt<TPayload>["targetRef"],
    payload: TPayload
  ): AssistantCapabilityReceipt<TPayload> {
    return {
      ok: true,
      capability,
      auditId: createId(),
      timestamp: nowIso(),
      targetRef,
      payload
    };
  }

  getCapabilityDefinition(capability: string): AssistantCapabilityDefinition | null {
    return this.capabilityDefinitions.find((item) => item.name === capability) ?? null;
  }

  private listVisibleCapabilities(context?: AssistantExecutionContext): AssistantCapabilityDescriptor[] {
    const profile = context?.capabilityProfile ?? resolveAssistantCapabilityProfile(context?.callerKind);
    return this.capabilityDefinitions
      .filter((item) => item.enabled)
      .filter((item) => profile ? item.allowedProfiles.includes(profile) : true)
      .map((item) => toVisibleCapabilityDescriptor(item));
  }

  assertExecutionAllowed(
    capability: string,
    context: AssistantExecutionContext,
    target?: {
      workspaceId?: string | null;
      projectId?: string | null;
      terminalId?: string | null;
      sessionId?: string | null;
      documentId?: string | null;
      officeTaskId?: string | null;
      browserProfileId?: string | null;
      worktreeWorkspaceId?: string | null;
    }
  ): void {
    const definition = this.getCapabilityDefinition(capability);

    if (!definition) {
      return;
    }

    const profile = context.capabilityProfile ?? resolveAssistantCapabilityProfile(context.callerKind);

    if (profile && !definition.allowedProfiles.includes(profile)) {
      throw new AppError({
        statusCode: 403,
        errorCode: "ASSISTANT_CAPABILITY_NOT_ALLOWED",
        detail: `当前调用者无权使用能力 ${capability}`
      });
    }

    if (profile === "workspace-scoped" && definition.requiresConfirmation) {
      this.assertConfirmationSatisfied(capability, context);
    }

    if (profile !== "workspace-scoped") {
      return;
    }

    if (definition.scopeKind === "workspace") {
      const userId = this.requireExecutionUserId(context, capability);
      const targetWorkspaceId = target?.workspaceId
        ?? (target?.projectId ? this.butlerProjectService.getById(target.projectId, userId).workspaceId : null)
        ?? (target?.sessionId ? this.sessionHistoryService.getSession(target.sessionId, userId).workspaceId : null)
        ?? (target?.terminalId ? this.terminalService.getTerminalOrThrow(target.terminalId).workspaceId : null);
      const documentWorkspaceId = target?.documentId
        ? this.requireDocumentRuntimeService().getDocumentDetail(target.documentId, userId).document.workspaceId
        : null;
      const officeTaskWorkspaceId = target?.officeTaskId
        ? this.requireOfficeTaskService().getTaskDetail(target.officeTaskId, userId).task.workspaceId
        : null;
      this.assertConsistentWorkspaceTargets(
        capability,
        [
          targetWorkspaceId,
          documentWorkspaceId,
          officeTaskWorkspaceId
        ]
      );
      const resolvedWorkspaceId = target?.worktreeWorkspaceId
        ? this.resolveRootWorkspaceId(target.worktreeWorkspaceId)
        : officeTaskWorkspaceId
          ?? documentWorkspaceId
          ?? targetWorkspaceId;
      this.assertWorkspaceScopedTarget(context.workspaceId, resolvedWorkspaceId, capability);
      return;
    }

    if (definition.scopeKind === "project") {
      if (capability.startsWith("worktrees.")) {
        this.assertWorktreeExecutionAllowed(capability, context, target?.worktreeWorkspaceId ?? target?.workspaceId);
        return;
      }

      const projectId = target?.projectId
        ?? (target?.worktreeWorkspaceId
          ? (() => {
            const rootWorkspaceId = this.resolveRootWorkspaceId(target.worktreeWorkspaceId);
            const userId = this.requireExecutionUserId(context, capability);
            return rootWorkspaceId ? this.resolveWorkspaceProject(rootWorkspaceId, userId).id : null;
          })()
          : null)
        ?? context.projectId;
      if (!projectId) {
        throw new AppError({
          statusCode: 403,
          errorCode: "ASSISTANT_PROJECT_SCOPE_REQUIRED",
          detail: `能力 ${capability} 必须绑定当前项目作用域`
        });
      }

      const userId = this.requireExecutionUserId(context, capability);
      const project = this.butlerProjectService.getById(projectId, userId);
      this.assertWorkspaceScopedTarget(context.workspaceId, project.workspaceId, capability);

      if (context.projectId && context.projectId !== projectId) {
        throw new AppError({
          statusCode: 403,
          errorCode: "ASSISTANT_PROJECT_SCOPE_MISMATCH",
          detail: `能力 ${capability} 不能跨项目执行`
        });
      }
    }
  }

  private assertWorkspaceScopedTarget(
    scopedWorkspaceId: string | null | undefined,
    targetWorkspaceId: string | null | undefined,
    capability: string
  ): void {
    if (!scopedWorkspaceId || !targetWorkspaceId || scopedWorkspaceId !== targetWorkspaceId) {
      throw new AppError({
        statusCode: 403,
        errorCode: "ASSISTANT_WORKSPACE_SCOPE_MISMATCH",
        detail: `能力 ${capability} 不能跨工作区执行`
      });
    }
  }

  private assertConfirmationSatisfied(capability: string, context: AssistantExecutionContext): void {
    if (normalizeAssistantText(context.confirmationToken) === "confirmed") {
      return;
    }

    throw new AppError({
      statusCode: 409,
      errorCode: "ASSISTANT_CONFIRMATION_REQUIRED",
      detail: `能力 ${capability} 需要用户显式确认后才能执行`,
      data: {
        capability,
        confirmationRequired: true
      }
    });
  }

  private assertConsistentWorkspaceTargets(capability: string, workspaceIds: Array<string | null | undefined>): void {
    const normalized = workspaceIds.filter((item): item is string => Boolean(item));

    if (normalized.length <= 1) {
      return;
    }

    const first = normalized[0];
    if (normalized.some((item) => item !== first)) {
      throw new AppError({
        statusCode: 403,
        errorCode: "ASSISTANT_WORKSPACE_SCOPE_MISMATCH",
        detail: `能力 ${capability} 的目标资源不属于同一工作区`
      });
    }
  }

  private assertWorktreeExecutionAllowed(
    capability: string,
    context: AssistantExecutionContext,
    targetWorkspaceId: string | null | undefined
  ): void {
    if (!targetWorkspaceId) {
      throw new AppError({
        statusCode: 403,
        errorCode: "ASSISTANT_PROJECT_SCOPE_REQUIRED",
        detail: `能力 ${capability} 必须绑定当前项目作用域`
      });
    }

    const scopedRootWorkspaceId = this.resolveRootWorkspaceId(context.workspaceId);
    const targetRootWorkspaceId = this.resolveRootWorkspaceId(targetWorkspaceId);
    this.assertWorkspaceScopedTarget(scopedRootWorkspaceId, targetRootWorkspaceId, capability);
  }

  private resolveRootWorkspaceId(workspaceId: string | null | undefined): string | null {
    const normalizedWorkspaceId = normalizeAssistantText(workspaceId);
    if (!normalizedWorkspaceId) {
      return null;
    }

    return this.workspaceWorktreeRepository.findByWorkspaceId(normalizedWorkspaceId)?.rootWorkspaceId
      ?? normalizedWorkspaceId;
  }

  private requireExecutionUserId(context: AssistantExecutionContext, capability: string): string {
    const userId = normalizeAssistantText(context.userId);
    if (!userId) {
      throw new AppError({
        statusCode: 403,
        errorCode: "ASSISTANT_EXECUTION_CONTEXT_INVALID",
        detail: `能力 ${capability} 缺少用户上下文`
      });
    }

    return userId;
  }

  private resolveWorkspaceProject(workspaceId: string, userId?: string) {
    const candidates = this.butlerProjectService.list({ userId, workspaceId });
    const project = candidates.find((item) => item.lifecycleStatus === "active") ?? candidates[0] ?? null;

    if (!project) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_PROJECT_NOT_FOUND",
        detail: "当前工作区没有可用项目，不能执行项目级能力"
      });
    }

    return project;
  }

  private requireFollowUpService(): Pick<
    ButlerFollowUpService,
    | "listTasks"
    | "getTask"
    | "createTask"
    | "continueTask"
    | "markTaskWaitingUser"
    | "completeTask"
    | "failTask"
  > {
    if (this.butlerFollowUpService) {
      return this.butlerFollowUpService;
    }

    throw new AppError({
      statusCode: 503,
      errorCode: "ASSISTANT_FOLLOW_UP_CAPABILITY_UNAVAILABLE",
      detail: "当前实例没有启用会话跟进能力"
    });
  }

  private requireDocumentRuntimeService(): Pick<
    DocumentRuntimeService,
    | "createDocument"
    | "getDocumentDetail"
    | "updateDocument"
    | "createExportTask"
    | "executeExportTask"
  > {
    if (this.documentRuntimeService) {
      return this.documentRuntimeService;
    }

    throw new AppError({
      statusCode: 503,
      errorCode: "ASSISTANT_OFFICE_DOCUMENT_CAPABILITY_UNAVAILABLE",
      detail: "当前实例没有启用办公文档能力"
    });
  }

  private requireOfficeTaskService(): NonNullable<AssistantCapabilityService["officeServiceForDocumentTask"]> {
    if (this.officeServiceForDocumentTask) {
      return this.officeServiceForDocumentTask;
    }

    throw new AppError({
      statusCode: 503,
      errorCode: "ASSISTANT_OFFICE_DOCUMENT_CAPABILITY_UNAVAILABLE",
      detail: "当前实例没有启用办公文档能力"
    });
  }

  private requireOfficeApprovalService(): NonNullable<AssistantCapabilityService["officeServiceForDocumentTask"]> {
    if (this.officeServiceForDocumentTask) {
      return this.officeServiceForDocumentTask;
    }

    throw new AppError({
      statusCode: 503,
      errorCode: "ASSISTANT_OFFICE_APPROVAL_CAPABILITY_UNAVAILABLE",
      detail: "当前实例没有启用办公审批能力"
    });
  }

  private resolveSessionLaunchConfig(
    input: StartAssistantProjectSessionInput | StartAssistantSessionInput
  ): {
    providerId: "codex" | "claude-code";
    model: string | null;
    reasoningLevel: string | null;
    permissionMode: string | null;
  } {
    const controlSession = this.butlerControlSessionService.getCurrentSession(input.userId);
    const providerId =
      input.providerId?.trim() as "codex" | "claude-code" | undefined
      ?? controlSession?.providerId
      ?? undefined;

    if (!providerId) {
      throw new AppError({
        statusCode: 409,
        errorCode: "ASSISTANT_CONTROL_SESSION_NOT_FOUND",
        detail: "当前没有可用的助手控制会话，无法继承默认 provider"
      });
    }

    this.assertProviderEnabled(providerId, "providerId");

    return {
      providerId,
      model: normalizeAssistantText(input.model) ?? controlSession?.model ?? null,
      reasoningLevel:
        normalizeAssistantText(input.reasoningLevel) ?? controlSession?.reasoningLevel ?? null,
      permissionMode:
        normalizeAssistantText(input.permissionMode) ?? controlSession?.permissionMode ?? null
    };
  }

  private assertProviderEnabled(providerId: string, field: string): void {
    if (this.providerControlRepository?.get(providerId).enabled !== false) {
      return;
    }

    throw createProviderDisabledError(providerId, field);
  }

  private resolveAssistantSessionTarget(
    target: AssistantSessionTarget,
    userId: string
  ): {
    kind: AssistantSessionTarget["kind"];
    id: string;
    workspaceId: string;
  } {
    if (target.kind === "project") {
      const project = this.butlerProjectService.getById(target.projectId, userId);
      return {
        kind: "project",
        id: project.id,
        workspaceId: project.workspaceId
      };
    }

    return {
      kind: "workspace",
      id: target.workspaceId,
      workspaceId: target.workspaceId
    };
  }

}

function normalizeAssistantText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function summarizeAssistantText(content: string): string | null {
  const normalized = normalizeAssistantText(content);

  if (!normalized) {
    return null;
  }

  return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
}

function summarizeOfficeDocumentDetail(
  detail: Awaited<ReturnType<DocumentRuntimeService["createDocument"]>>
) {
  return {
    id: detail.document.id,
    workspaceId: detail.document.workspaceId,
    title: detail.document.title,
    status: detail.document.status,
    template: {
      id: detail.template.id,
      key: detail.template.templateKey,
      version: detail.template.templateVersion,
      displayName: detail.template.displayName
    },
    currentRevision: detail.currentRevision
      ? {
        id: detail.currentRevision.id,
        revisionSeq: detail.currentRevision.revisionSeq,
        summary: detail.currentRevision.summary,
        createdAt: detail.currentRevision.createdAt
      }
      : null,
    revisionCount: detail.revisions.length,
    openCommentCount: detail.comments.filter((item) => item.status === "open").length,
    updatedAt: detail.document.updatedAt
  };
}

function summarizeOfficeTaskDetail(
  detail: ReturnType<OfficeService["getTaskDetail"]>,
  options?: {
    officePreviewLinkService?: Pick<OfficePreviewLinkService, "createArtifactLink"> | null;
    userId?: string | null;
  }
) {
  return {
    id: detail.task.id,
    taskType: detail.task.taskType,
    title: detail.task.title,
    status: detail.task.status as OfficeTaskStatus,
    riskLevel: detail.task.riskLevel,
    workspaceId: detail.task.workspaceId,
    targetRefKind: detail.task.targetRefKind,
    targetRefId: detail.task.targetRefId,
    createdAt: detail.task.createdAt,
    startedAt: detail.task.startedAt,
    finishedAt: detail.task.finishedAt,
    steps: detail.steps.map((step) => ({
      id: step.id,
      stepSeq: step.stepSeq,
      stepType: step.stepType,
      title: step.title,
      status: step.status,
      errorMessage: step.errorMessage,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt
    })),
    artifacts: detail.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      name: artifact.name,
      contentType: artifact.contentType,
      previewPath: buildAssistantOfficeArtifactPreviewPath(artifact.id, options),
      previewUrl: null,
      metadataJson: artifact.metadataJson,
      createdAt: artifact.createdAt
    })),
    receipts: detail.receipts.map((receipt) => ({
      id: receipt.id,
      receiptType: receipt.receiptType,
      summary: receipt.summary,
      payloadJson: receipt.payloadJson,
      createdAt: receipt.createdAt
    }))
  };
}

function buildAssistantOfficeArtifactPreviewPath(
  artifactId: string,
  options?: {
    officePreviewLinkService?: Pick<OfficePreviewLinkService, "createArtifactLink"> | null;
    userId?: string | null;
  }
) {
  const normalizedUserId = options?.userId?.trim();

  if (!options?.officePreviewLinkService || !normalizedUserId) {
    return null;
  }

  try {
    return options.officePreviewLinkService.createArtifactLink(artifactId, normalizedUserId).previewPath;
  } catch {
    return null;
  }
}

function buildAssistantAutomationTriggerInput(
  triggerType: NonNullable<CreateAssistantAutomationInput["triggerType"]>,
  input: CreateAssistantAutomationInput
) {
  switch (triggerType) {
    case "once":
      return {
        type: "once" as const,
        dueAt: input.dueAt ?? null,
        afterSeconds: input.afterSeconds ?? null
      };
    case "interval":
      return {
        type: "interval" as const,
        seconds: input.everySeconds ?? null,
        minutes: input.everyMinutes ?? null,
        hours: input.everyHours ?? null,
        stopAt: input.stopAt ?? null
      };
    case "cron":
      return {
        type: "cron" as const,
        minute: input.cronMinute ?? null,
        hour: input.cronHour ?? null,
        daysOfWeek: input.cronDaysOfWeek ?? null,
        stopAt: input.stopAt ?? null
      };
    case "condition": {
      const conditionKind = input.conditionKind;

      if (conditionKind === "git.remote_tag_changed") {
        return {
          type: "condition" as const,
          conditionKind,
          repositoryUrl: input.repositoryUrl ?? null,
          pollIntervalSeconds: input.pollIntervalSeconds ?? null,
          expiresAt: input.expiresAt ?? null,
          maxChecks: input.maxChecks ?? null
        };
      }

      return {
        type: "condition" as const,
        conditionKind: requireAssistantConditionKind(conditionKind),
        sessionId: input.conditionSessionId ?? null,
        pollIntervalSeconds: input.pollIntervalSeconds ?? null,
        expiresAt: input.expiresAt ?? null,
        maxChecks: input.maxChecks ?? null
      };
    }
    default:
      return assertNeverAssistantAutomationTriggerType(triggerType);
  }
}


function requireAssistantConditionKind(
  value: CreateAssistantAutomationInput["conditionKind"]
): "git.remote_tag_changed" | "session.runtime_idle" {
  if (value === "git.remote_tag_changed" || value === "session.runtime_idle") {
    return value;
  }

  throw new AppError({
    statusCode: 400,
    errorCode: "INVALID_INPUT",
    detail: "condition 自动化必须提供 conditionKind",
    field: "conditionKind"
  });
}

function assertNeverAssistantAutomationTriggerType(value: never): never {
  throw new Error(`Unexpected assistant automation triggerType: ${String(value)}`);
}

function isButlerProfileNotInitializedError(error: unknown): boolean {
  return error instanceof AppError && error.errorCode === "BUTLER_PROFILE_NOT_INITIALIZED";
}

function augmentAssistantCapabilities(
  items: AssistantCapabilityDescriptor[]
): AssistantCapabilityDefinition[] {
  return items.map((item) => {
    const allowedProfiles = (
      WORKSPACE_SCOPED_DEFAULT_CAPABILITIES.has(item.name)
        ? ["butler-full", "butler-ui", "workspace-scoped"] satisfies AssistantCapabilityProfile[]
        : ["butler-full", "butler-ui"] satisfies AssistantCapabilityProfile[]
    );
    const scopeKind = (
      PROJECT_SCOPED_CAPABILITIES.has(item.name)
        ? "project"
        : WORKSPACE_SCOPED_CAPABILITIES.has(item.name)
          ? "workspace"
          : "none"
    );
    const requiresConfirmation = item.requiresConfirmation ?? WORKSPACE_SCOPED_CONFIRMATION_CAPABILITIES.has(item.name);

    return {
      ...item,
      allowedProfiles,
      scopeKind,
      requiresConfirmation
    };
  });
}

function toVisibleCapabilityDescriptor(item: AssistantCapabilityDefinition): AssistantCapabilityDescriptor {
  return {
    name: item.name,
    mode: item.mode,
    enabled: item.enabled,
    summary: item.summary,
    requiresConfirmation: item.requiresConfirmation
  };
}

function resolveAssistantCapabilityProfile(
  callerKind: AuthCallerKind | null | undefined
): AssistantCapabilityProfile | null {
  if (callerKind === "assistant_runtime") {
    return "butler-full";
  }

  if (callerKind === "workspace_session") {
    return "workspace-scoped";
  }

  if (callerKind === "interactive_user") {
    return "butler-ui";
  }

  return null;
}
