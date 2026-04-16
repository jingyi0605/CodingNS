import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerProjectService } from "../butler/butler-project-service.js";
import type { ButlerSessionService } from "../butler/butler-session-service.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
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
    kind: "project" | "session" | "terminal" | "workspace" | "worktree" | "none";
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
      "listByProject" | "ensureProjectSessionsSynced"
    >,
    private readonly sessionHistoryService: Pick<
      SessionHistoryService,
      "getSession" | "readSessionHistory" | "forkSession"
    >,
    private readonly sessionLiveRuntimeService: Pick<
      SessionLiveRuntimeService,
      "getSessionRuntime" | "sendLiveMessage"
    >,
    private readonly terminalService: Pick<
      TerminalService,
      "listTerminals" | "readTerminalHistory" | "writeInput"
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
    private readonly worktreeCleanupService: Pick<WorktreeCleanupService, "cleanup">
  ) {}

  listCapabilities(): AssistantCapabilityReceipt<{
    version: string;
    items: AssistantCapabilityDescriptor[];
  }> {
    return this.createReceipt("capabilities.list", {
      kind: "none",
      id: null
    }, {
      version: "2026-04-14",
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
    const result = await this.sessionLiveRuntimeService.sendLiveMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      content: input.content,
      clientRequestId: input.clientRequestId?.trim() || null,
      runtimeOptions: {
        model: input.model?.trim() || null,
        reasoningLevel: input.reasoningLevel?.trim() || null,
        permissionMode: input.permissionMode?.trim() || null,
        attachments: []
      }
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
}
