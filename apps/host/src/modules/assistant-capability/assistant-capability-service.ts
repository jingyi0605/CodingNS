import { createId } from "../../shared/utils/id.js";
import { AppError } from "../../shared/errors/app-error.js";
import { nowIso } from "../../shared/utils/time.js";
import type { AssistantAutomationService } from "../butler/assistant-automation-service.js";
import type { AssistantSandboxService } from "../butler/assistant-sandbox-service.js";
import type { ButlerControlSessionService } from "../butler/butler-control-session-service.js";
import type { ButlerControlTimerService } from "../butler/butler-control-timer-service.js";
import type { ButlerProjectService } from "../butler/butler-project-service.js";
import type { ButlerSessionService } from "../butler/butler-session-service.js";
import type {
  DebugTargetPortRequest,
  DebugTargetService
} from "../debug-target/debug-target-service.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import type { SessionMessageOriginRepository } from "../../storage/repositories/session-message-origin-repository.js";
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

type AssistantCapabilityMode = "read" | "proxy_execute";

export interface AssistantCapabilityDescriptor {
  name: string;
  mode: AssistantCapabilityMode;
  enabled: boolean;
  summary: string;
}

export interface AssistantCapabilityReceipt<TPayload> {
  ok: true;
  capability: string;
  auditId: string;
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
      | "sandbox"
      | "timer"
      | "none";
    id: string | null;
  };
  payload: TPayload;
}

interface ListProjectsInput {
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
  | { kind: "workspace"; workspaceId: string }
  | { kind: "sandbox"; sandboxId: string };

interface StartAssistantSessionInput {
  target: AssistantSessionTarget;
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

interface ListAssistantSandboxesInput {
  userId: string;
  status?: "active" | "archived" | "expired" | "deleted";
  controlSessionId?: string | null;
}

interface CreateAssistantSandboxInput {
  userId: string;
  title?: string | null;
  description?: string | null;
  purpose?: string | null;
  expiresAt?: string | null;
  sourceKind: "blank" | "clone";
  repositoryUrl?: string | null;
  directoryName?: string | null;
  auth?: CloneWorkspaceInput["auth"];
}

interface PromoteAssistantSandboxInput {
  sandboxId: string;
  userId: string;
  mode?: "pin" | "project";
  projectName?: string | null;
  defaultProvider?: "codex" | "claude-code" | null;
}

interface AnalyzeAssistantDebugTargetInput {
  workspaceId: string;
  rootPath: string;
  commandHints?: string[];
}

interface CreateAssistantDebugLaunchPlanInput {
  targetId: string;
  userId: string;
  portRequests: DebugTargetPortRequest[];
}

interface RunAssistantDebugTargetInput {
  targetId: string;
  userId: string;
  shell?: string | null;
  runtimeType?: Parameters<DebugTargetService["run"]>[0]["runtimeType"];
  portRequests: DebugTargetPortRequest[];
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
}

interface CreateAssistantWorktreeInput {
  sourceWorkspaceId: string;
  branchName: string;
  displayName?: string | null;
  baseRef?: string | null;
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
    summary: "按 project/workspace/sandbox 目标新建真实会话"
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
    name: "sandboxes.list",
    mode: "read",
    enabled: true,
    summary: "列出当前助手沙箱"
  },
  {
    name: "sandboxes.create",
    mode: "proxy_execute",
    enabled: true,
    summary: "创建新的助手沙箱"
  },
  {
    name: "sandboxes.promote",
    mode: "proxy_execute",
    enabled: true,
    summary: "保留或晋升助手沙箱"
  },
  {
    name: "sandboxes.expire",
    mode: "proxy_execute",
    enabled: true,
    summary: "标记助手沙箱过期"
  },
  {
    name: "sandboxes.remove",
    mode: "proxy_execute",
    enabled: true,
    summary: "清理助手沙箱"
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
    name: "debug-targets.compatibility-matrix.get",
    mode: "read",
    enabled: true,
    summary: "读取调试框架兼容矩阵"
  },
  {
    name: "debug-targets.analyze",
    mode: "proxy_execute",
    enabled: true,
    summary: "分析工作区调试目标和服务"
  },
  {
    name: "debug-targets.framework-analysis.get",
    mode: "read",
    enabled: true,
    summary: "读取调试目标框架分析结果"
  },
  {
    name: "debug-targets.framework-analysis.refresh",
    mode: "proxy_execute",
    enabled: true,
    summary: "刷新调试目标框架分析结果"
  },
  {
    name: "debug-targets.launch-plan.create",
    mode: "proxy_execute",
    enabled: true,
    summary: "生成调试目标启动计划，支持显式端口请求"
  },
  {
    name: "debug-targets.run",
    mode: "proxy_execute",
    enabled: true,
    summary: "启动调试目标，支持显式端口请求"
  },
  {
    name: "debug-targets.runtime-latest.get",
    mode: "read",
    enabled: true,
    summary: "读取调试目标最近一次运行态"
  },
  {
    name: "debug-targets.runtimes.list",
    mode: "read",
    enabled: true,
    summary: "读取调试目标运行历史"
  },
  {
    name: "debug-runtimes.get",
    mode: "read",
    enabled: true,
    summary: "读取指定调试运行时详情"
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
    private readonly assistantSandboxService: Pick<
      AssistantSandboxService,
      | "listSandboxes"
      | "getSandbox"
      | "createSandbox"
      | "promoteSandbox"
      | "expireSandbox"
      | "removeSandbox"
      | "resolveWorkspaceId"
      | "markSandboxUsedByControlSession"
    >,
    private readonly butlerControlTimerService: Pick<
      ButlerControlTimerService,
      "listTimers" | "getTimer" | "createTimer" | "cancelTimer"
    >,
    private readonly sessionHistoryService: Pick<
      SessionHistoryService,
      "getSession" | "readSessionHistory" | "forkSession"
    >,
    private readonly sessionLiveRuntimeService: Pick<
      SessionLiveRuntimeService,
      "getSessionRuntime" | "sendLiveMessage" | "startLiveSession"
    >,
    private readonly terminalService: Pick<
      TerminalService,
      "listTerminals" | "readTerminalHistory" | "writeInput" | "closeTerminal"
    >,
    private readonly debugTargetService: Pick<
      DebugTargetService,
      | "analyze"
      | "getFrameworkAnalysis"
      | "refreshFrameworkAnalysis"
      | "createLaunchPlan"
      | "run"
      | "getLatestRuntimeDetail"
      | "getRecentRuntimeDetails"
      | "getRuntimeDetail"
      | "getCompatibilityMatrix"
    >,
    private readonly workspaceService: Pick<
      WorkspaceService,
      | "list"
      | "browseDirectories"
      | "createDirectory"
      | "importWorkspace"
      | "cloneWorkspace"
      | "reorderWorkspaces"
      | "getManagementSummary"
      | "removeWorkspace"
      | "updateNavigationState"
    >,
    private readonly worktreeManager: Pick<WorktreeManager, "getTree" | "create">,
    private readonly worktreeSyncService: Pick<WorktreeSyncService, "syncRoot">,
    private readonly worktreeMergeService: Pick<WorktreeMergeService, "preview" | "apply">,
    private readonly worktreeCleanupService: Pick<WorktreeCleanupService, "cleanup">,
    private readonly sessionMessageOriginRepository: Pick<
      SessionMessageOriginRepository,
      "upsert"
    > | null = null
  ) {}

  listCapabilities(): AssistantCapabilityReceipt<{
    version: string;
    items: AssistantCapabilityDescriptor[];
  }> {
    return this.createReceipt("capabilities.list", {
      kind: "none",
      id: null
    }, {
      version: "2026-04-16",
      items: ASSISTANT_CAPABILITIES
    });
  }

  listProjects(input: ListProjectsInput): AssistantCapabilityReceipt<{
    items: ReturnType<ButlerProjectService["list"]>;
  }> {
    const items = this.butlerProjectService.list({
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
    const project = this.butlerProjectService.getById(projectId);
    const overview = this.butlerProjectService.getOverview(projectId);
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
    const target = this.resolveAssistantSessionTarget(input.target, input.userId);
    const currentControlSession = this.butlerControlSessionService.getCurrentSession(input.userId);

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

    if (target.kind === "sandbox") {
      this.assistantSandboxService.markSandboxUsedByControlSession(
        target.id,
        input.userId,
        currentControlSession?.id ?? null
      );
    }

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
    const runtime = await this.sessionLiveRuntimeService.getSessionRuntime(sessionId, userId);

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

  listTimers(
    input: {
      userId: string;
      status?: "active" | "completed" | "cancelled" | "failed";
      controlSessionId?: string | null;
    }
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
    const items = this.assistantAutomationService.listTasks({
      userId: input.userId,
      statuses: input.status ? [input.status] : undefined,
      controlSessionId: input.controlSessionId ?? null
    });

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
    const items = this.assistantAutomationService.listRecentRuns({
      userId: input.userId,
      controlSessionId: input.controlSessionId ?? null,
      limit: input.limit ?? undefined
    });

    return this.createReceipt("automations.runs.recent", {
      kind: "none",
      id: null
    }, {
      items
    });
  }

  listSandboxes(
    input: ListAssistantSandboxesInput
  ): AssistantCapabilityReceipt<{
    items: ReturnType<AssistantSandboxService["listSandboxes"]>;
  }> {
    const items = this.assistantSandboxService.listSandboxes({
      userId: input.userId,
      controlSessionId: input.controlSessionId ?? null,
      statuses: input.status ? [input.status] : undefined
    });

    return this.createReceipt("sandboxes.list", {
      kind: "none",
      id: null
    }, {
      items
    });
  }

  async createSandbox(
    input: CreateAssistantSandboxInput
  ): Promise<AssistantCapabilityReceipt<{
    sandbox: Awaited<ReturnType<AssistantSandboxService["createSandbox"]>>;
  }>> {
    const currentControlSession = this.butlerControlSessionService.getCurrentSession(input.userId);
    const sandbox = await this.assistantSandboxService.createSandbox({
      userId: input.userId,
      controlSessionId: currentControlSession?.id ?? null,
      title: input.title,
      description: input.description,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
      source:
        input.sourceKind === "clone"
          ? {
            kind: "clone",
            repositoryUrl: requireAssistantRepositoryUrl(input.repositoryUrl),
            directoryName: input.directoryName,
            auth: input.auth
          }
          : {
            kind: "blank",
            directoryName: input.directoryName
          }
    });

    return this.createReceipt("sandboxes.create", {
      kind: "sandbox",
      id: sandbox.id
    }, {
      sandbox
    });
  }

  promoteSandbox(
    input: PromoteAssistantSandboxInput
  ): AssistantCapabilityReceipt<{
    sandbox: ReturnType<AssistantSandboxService["promoteSandbox"]>;
  }> {
    const sandbox = this.assistantSandboxService.promoteSandbox(input.sandboxId, input.userId, {
      mode: input.mode,
      projectName: input.projectName,
      defaultProvider: input.defaultProvider
    });

    return this.createReceipt("sandboxes.promote", {
      kind: "sandbox",
      id: input.sandboxId
    }, {
      sandbox
    });
  }

  expireSandbox(
    sandboxId: string,
    userId: string
  ): AssistantCapabilityReceipt<{
    sandbox: ReturnType<AssistantSandboxService["expireSandbox"]>;
  }> {
    const sandbox = this.assistantSandboxService.expireSandbox(sandboxId, userId);

    return this.createReceipt("sandboxes.expire", {
      kind: "sandbox",
      id: sandboxId
    }, {
      sandbox
    });
  }

  removeSandbox(
    sandboxId: string,
    userId: string
  ): AssistantCapabilityReceipt<{
    sandbox: ReturnType<AssistantSandboxService["removeSandbox"]>;
  }> {
    const sandbox = this.assistantSandboxService.removeSandbox(sandboxId, userId);

    return this.createReceipt("sandboxes.remove", {
      kind: "sandbox",
      id: sandboxId
    }, {
      sandbox
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

  async listTerminals(
    input: ListAssistantTerminalsInput
  ): Promise<AssistantCapabilityReceipt<{
    workspaceId: string;
    items: Awaited<ReturnType<TerminalService["listTerminals"]>>;
  }>> {
    const workspaceId = input.projectId?.trim()
      ? this.butlerProjectService.getById(input.projectId).workspaceId
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

  getDebugCompatibilityMatrix(): AssistantCapabilityReceipt<{
    matrix: ReturnType<DebugTargetService["getCompatibilityMatrix"]>;
  }> {
    return this.createReceipt("debug-targets.compatibility-matrix.get", {
      kind: "none",
      id: null
    }, {
      matrix: this.debugTargetService.getCompatibilityMatrix()
    });
  }

  analyzeDebugTarget(
    input: AnalyzeAssistantDebugTargetInput
  ): AssistantCapabilityReceipt<{
    result: ReturnType<DebugTargetService["analyze"]>;
  }> {
    const result = this.debugTargetService.analyze({
      workspaceId: input.workspaceId,
      rootPath: input.rootPath,
      commandHints: input.commandHints ?? []
    });

    return this.createReceipt("debug-targets.analyze", {
      kind: "debug_target",
      id: result.target.id
    }, {
      result
    });
  }

  getDebugFrameworkAnalysis(
    targetId: string
  ): AssistantCapabilityReceipt<{
    result: ReturnType<DebugTargetService["getFrameworkAnalysis"]>;
  }> {
    return this.createReceipt("debug-targets.framework-analysis.get", {
      kind: "debug_target",
      id: targetId
    }, {
      result: this.debugTargetService.getFrameworkAnalysis(targetId)
    });
  }

  refreshDebugFrameworkAnalysis(
    targetId: string
  ): AssistantCapabilityReceipt<{
    result: ReturnType<DebugTargetService["refreshFrameworkAnalysis"]>;
  }> {
    return this.createReceipt("debug-targets.framework-analysis.refresh", {
      kind: "debug_target",
      id: targetId
    }, {
      result: this.debugTargetService.refreshFrameworkAnalysis(targetId)
    });
  }

  async createDebugLaunchPlan(
    input: CreateAssistantDebugLaunchPlanInput
  ): Promise<AssistantCapabilityReceipt<{
    plan: Awaited<ReturnType<DebugTargetService["createLaunchPlan"]>>;
  }>> {
    const plan = await this.debugTargetService.createLaunchPlan(
      input.targetId,
      input.portRequests,
      input.userId
    );

    return this.createReceipt("debug-targets.launch-plan.create", {
      kind: "debug_target",
      id: input.targetId
    }, {
      plan
    });
  }

  async runDebugTarget(
    input: RunAssistantDebugTargetInput
  ): Promise<AssistantCapabilityReceipt<{
    result: Awaited<ReturnType<DebugTargetService["run"]>>;
  }>> {
    const result = await this.debugTargetService.run({
      targetId: input.targetId,
      userId: input.userId,
      shell: input.shell ?? undefined,
      runtimeType: input.runtimeType ?? undefined,
      portRequests: input.portRequests
    });

    return this.createReceipt("debug-targets.run", {
      kind: "debug_target",
      id: input.targetId
    }, {
      result
    });
  }

  async getLatestDebugRuntime(
    targetId: string
  ): Promise<AssistantCapabilityReceipt<{
    runtime: Awaited<ReturnType<DebugTargetService["getLatestRuntimeDetail"]>>;
  }>> {
    const runtime = await this.debugTargetService.getLatestRuntimeDetail(targetId);

    return this.createReceipt("debug-targets.runtime-latest.get", {
      kind: "debug_target",
      id: targetId
    }, {
      runtime
    });
  }

  async listDebugRuntimes(
    input: { targetId: string; limit: number }
  ): Promise<AssistantCapabilityReceipt<{
    history: Awaited<ReturnType<DebugTargetService["getRecentRuntimeDetails"]>>;
  }>> {
    const history = await this.debugTargetService.getRecentRuntimeDetails(input.targetId, input.limit);

    return this.createReceipt("debug-targets.runtimes.list", {
      kind: "debug_target",
      id: input.targetId
    }, {
      history
    });
  }

  async getDebugRuntime(
    runtimeId: string
  ): Promise<AssistantCapabilityReceipt<{
    runtime: Awaited<ReturnType<DebugTargetService["getRuntimeDetail"]>>;
  }>> {
    const runtime = await this.debugTargetService.getRuntimeDetail(runtimeId);

    return this.createReceipt("debug-runtimes.get", {
      kind: "debug_runtime",
      id: runtimeId
    }, {
      runtime
    });
  }

  listWorkspaces(): AssistantCapabilityReceipt<{
    items: ReturnType<WorkspaceService["list"]>;
  }> {
    return this.createReceipt("workspaces.list", {
      kind: "none",
      id: null
    }, {
      items: this.workspaceService.list()
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
    input: ImportAssistantWorkspaceInput
  ): AssistantCapabilityReceipt<{
    workspace: ReturnType<WorkspaceService["importWorkspace"]>;
  }> {
    const workspace = this.workspaceService.importWorkspace(input.path, input.name ?? undefined);

    return this.createReceipt("workspaces.import", {
      kind: "workspace",
      id: workspace.id
    }, {
      workspace
    });
  }

  async cloneWorkspace(
    input: CloneAssistantWorkspaceInput
  ): Promise<AssistantCapabilityReceipt<{
    workspace: Awaited<ReturnType<WorkspaceService["cloneWorkspace"]>>;
  }>> {
    const workspace = await this.workspaceService.cloneWorkspace({
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
    workspaceIds: string[]
  ): AssistantCapabilityReceipt<{
    items: ReturnType<WorkspaceService["reorderWorkspaces"]>;
  }> {
    const items = this.workspaceService.reorderWorkspaces(workspaceIds);

    return this.createReceipt("workspaces.reorder", {
      kind: "none",
      id: null
    }, {
      items
    });
  }

  async getWorkspaceManagementSummary(
    workspaceId: string
  ): Promise<AssistantCapabilityReceipt<{
    summary: Awaited<ReturnType<WorkspaceService["getManagementSummary"]>>;
  }>> {
    const summary = await this.workspaceService.getManagementSummary(workspaceId);

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
      backgroundColor: input.backgroundColor
    });

    return this.createReceipt("workspaces.navigation-state.update", {
      kind: "workspace",
      id: input.workspaceId
    }, {
      state
    });
  }

  removeWorkspace(
    workspaceId: string
  ): AssistantCapabilityReceipt<{
    workspace: ReturnType<WorkspaceService["removeWorkspace"]>;
  }> {
    const workspace = this.workspaceService.removeWorkspace(workspaceId);

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

    return {
      providerId,
      model: normalizeAssistantText(input.model) ?? controlSession?.model ?? null,
      reasoningLevel:
        normalizeAssistantText(input.reasoningLevel) ?? controlSession?.reasoningLevel ?? null,
      permissionMode:
        normalizeAssistantText(input.permissionMode) ?? controlSession?.permissionMode ?? null
    };
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
      const project = this.butlerProjectService.getById(target.projectId);
      return {
        kind: "project",
        id: project.id,
        workspaceId: project.workspaceId
      };
    }

    if (target.kind === "workspace") {
      return {
        kind: "workspace",
        id: target.workspaceId,
        workspaceId: target.workspaceId
      };
    }

    return {
      kind: "sandbox",
      id: target.sandboxId,
      workspaceId: this.assistantSandboxService.resolveWorkspaceId(target.sandboxId, userId)
    };
  }
}

function normalizeAssistantText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
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

function requireAssistantRepositoryUrl(value: string | null | undefined): string {
  const normalized = normalizeAssistantText(value);

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "clone 沙箱必须提供 repositoryUrl",
      field: "repositoryUrl"
    });
  }

  return normalized;
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
