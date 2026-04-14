import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerProjectService } from "../butler/butler-project-service.js";
import type { ButlerSessionService } from "../butler/butler-session-service.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import type { TerminalService } from "../terminal/terminal-service.js";

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
    kind: "project" | "session" | "terminal" | "none";
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
    >
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
