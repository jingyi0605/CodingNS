import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerInboxItemRepository } from "../../storage/repositories/butler-inbox-item-repository.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../tasks/task-types.js";
import type {
  ButlerInboxAssistantState,
  ButlerInboxItem,
  ButlerInboxItemPriority,
  ButlerInboxItemStatus,
  ButlerInboxItemType,
  ButlerProject,
  ButlerProfileProviderId
} from "../../types/domain.js";
import type { ButlerInboxAnalysisService } from "./butler-inbox-analysis-service.js";
import type { ButlerControlSessionService, ButlerControlSessionView } from "./butler-control-session-service.js";
import type { ButlerFollowUpService, ButlerFollowUpTaskView } from "./butler-follow-up-service.js";
import type { ButlerProjectSessionView, ButlerSessionService } from "./butler-session-service.js";

export interface ButlerInboxItemView extends ButlerInboxItem {
  projectName: string;
  workspaceId: string;
  projectLifecycleStatus: ButlerProject["lifecycleStatus"];
}

export interface ButlerInboxExecutionResult {
  item: ButlerInboxItemView;
  session: ButlerProjectSessionView;
  followUpTask: ButlerFollowUpTaskView | null;
}

export interface ButlerInboxAnalyzeResult {
  item: ButlerInboxItemView;
  controlSession: ButlerControlSessionView;
}

interface ButlerInboxItemInput {
  projectId?: string;
  itemType?: ButlerInboxItemType;
  title?: string;
  content?: string;
  priority?: ButlerInboxItemPriority;
  status?: ButlerInboxItemStatus;
}

export class ButlerInboxService {
  private readonly taskManager: TaskManager;
  private butlerInboxAnalysisService?: Pick<
    ButlerInboxAnalysisService,
    "prepareTodoAnalysisSession" | "readTodoAnalysisResult"
  >;
  private butlerControlSessionService?: Pick<
    ButlerControlSessionService,
    "getSession" | "startSession" | "updateSessionStatusBySessionId"
  >;
  private butlerSessionService?: Pick<ButlerSessionService, "startSession">
    & Partial<Pick<ButlerSessionService, "recoverManagedSession">>;
  private butlerFollowUpService?: Pick<ButlerFollowUpService, "createTask">;

  constructor(
    private readonly butlerProjectRepository: Pick<ButlerProjectRepository, "findById" | "list">,
    private readonly butlerInboxItemRepository: Pick<
      ButlerInboxItemRepository,
      "create" | "list" | "findById" | "update" | "delete"
    >,
    taskManager: TaskManager = createTaskManager()
  ) {
    this.taskManager = taskManager;
    this.registerBackgroundTasks();
  }

  configureLifecycleServices(input: {
    butlerInboxAnalysisService: Pick<
      ButlerInboxAnalysisService,
      "prepareTodoAnalysisSession" | "readTodoAnalysisResult"
    >;
    butlerControlSessionService: Pick<
      ButlerControlSessionService,
      "getSession" | "startSession" | "updateSessionStatusBySessionId"
    >;
    butlerSessionService: Pick<ButlerSessionService, "startSession">;
    butlerFollowUpService: Pick<ButlerFollowUpService, "createTask">;
  }): void {
    this.butlerInboxAnalysisService = input.butlerInboxAnalysisService;
    this.butlerControlSessionService = input.butlerControlSessionService;
    this.butlerSessionService = input.butlerSessionService;
    this.butlerFollowUpService = input.butlerFollowUpService;
  }

  listItems(filters?: {
    workspaceId?: string;
    projectId?: string;
    status?: ButlerInboxItemStatus;
    itemType?: ButlerInboxItemType;
    userId?: string;
  }): ButlerInboxItemView[] {
    const projects = this.butlerProjectRepository.list();
    const projectMap = new Map(projects.map((project) => [project.id, project]));

    return this.butlerInboxItemRepository
      .list({
        projectId: filters?.projectId,
        status: filters?.status,
        itemType: filters?.itemType
      })
      .map((item) => {
        const normalizedItem = this.recoverStaleAnalysisState(item, filters?.userId);
        const project = projectMap.get(item.projectId);
        return project ? this.toView(normalizedItem, project) : null;
      })
      .filter((item): item is ButlerInboxItemView => item !== null)
      .filter((item) => {
        if (!filters?.workspaceId) {
          return true;
        }

        return item.workspaceId === filters.workspaceId;
      });
  }

  createItem(input: ButlerInboxItemInput): ButlerInboxItemView {
    const project = this.requireProject(input.projectId);
    const timestamp = nowIso();
    const status = input.status ?? "pending";

    const record: ButlerInboxItem = {
      id: createId(),
      projectId: project.id,
      itemType: input.itemType ?? "task",
      title: this.requireText(input.title, "title", "代办标题不能为空"),
      content: this.requireText(input.content, "content", "代办内容不能为空"),
      priority: input.priority ?? "medium",
      status,
      assistantState: createAssistantState(status),
      createdAt: timestamp,
      updatedAt: timestamp,
      closedAt: status === "closed" ? timestamp : null
    };

    return this.toView(this.butlerInboxItemRepository.create(record), project);
  }

  updateItem(itemId: string, input: ButlerInboxItemInput): ButlerInboxItemView {
    const current = this.requireItem(itemId);
    const project = input.projectId ? this.requireProject(input.projectId) : this.requireProject(current.projectId);
    const nextStatus = input.status ?? current.status;
    const updated: ButlerInboxItem = {
      ...current,
      projectId: project.id,
      itemType: input.itemType ?? current.itemType,
      title:
        input.title === undefined
          ? current.title
          : this.requireText(input.title, "title", "代办标题不能为空"),
      content:
        input.content === undefined
          ? current.content
          : this.requireText(input.content, "content", "代办内容不能为空"),
      priority: input.priority ?? current.priority,
      status: nextStatus,
      assistantState: resolveAssistantStateForManualUpdate(current.assistantState, nextStatus),
      updatedAt: nowIso(),
      closedAt: nextStatus === "closed" ? current.closedAt ?? nowIso() : null
    };

    return this.toView(this.butlerInboxItemRepository.update(updated), project);
  }

  async analyzeItem(itemId: string, userId: string): Promise<ButlerInboxAnalyzeResult> {
    this.ensureAnalysisDependencies();
    const current = this.requireItem(itemId);
    const project = this.requireProject(current.projectId);
    this.ensureItemIsActionable(current);
    const prepared = await this.butlerInboxAnalysisService!.prepareTodoAnalysisSession(current, project, userId);
    const controlSession = await this.butlerControlSessionService!.startSession(userId, {
      content: prepared.prompt,
      model: prepared.model,
      reasoningLevel: prepared.reasoningLevel,
      permissionMode: prepared.permissionMode,
      purpose: "todo_analysis",
      title: prepared.title,
      sourceItemId: current.id
    });

    const timestamp = nowIso();
    const updated = this.butlerInboxItemRepository.update({
      ...current,
      assistantState: {
        ...current.assistantState,
        lifecycleStage: "analyzing",
        analysisControlSessionId: controlSession.id,
        analysisSessionId: controlSession.sessionId,
        lastError: null
      },
      updatedAt: timestamp
    });
    const task = this.taskManager.enqueue<{
      itemId: string;
      userId: string;
      sessionId: string;
      providerId: ButlerProfileProviderId;
    }, void>(HOST_TASK_TYPES.butlerInboxAnalyze, {
      key: itemId.trim(),
      source: "butler_inbox.request_analysis",
      input: {
        itemId: itemId.trim(),
        userId,
        sessionId: controlSession.sessionId,
        providerId: controlSession.providerId
      }
    });

    if (!task.deduped) {
      void task.promise.catch(() => undefined);
    }

    return {
      item: this.toView(updated, project),
      controlSession
    };
  }

  async startExecution(itemId: string, userId: string): Promise<ButlerInboxExecutionResult> {
    this.ensureExecutionDependencies();
    const current = this.recoverStaleAnalysisState(this.requireItem(itemId), userId);
    const project = this.requireProject(current.projectId);
    this.ensureItemIsActionable(current);
    let latestItem = current;

    if (current.assistantState.linkedButlerSessionId && current.assistantState.linkedSessionId) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_INBOX_SESSION_EXISTS",
        detail: "这条代办已经绑定了执行会话"
      });
    }

    try {
      if (current.assistantState.lifecycleStage === "analyzing") {
        throw new AppError({
          statusCode: 409,
          errorCode: "BUTLER_INBOX_ANALYSIS_RUNNING",
          detail: "这条代办正在后台分析，请等待提示词生成完成"
        });
      }

      const prompt = current.assistantState.generatedPrompt?.trim();

      if (!prompt) {
        throw new AppError({
          statusCode: 409,
          errorCode: "BUTLER_INBOX_PROMPT_NOT_READY",
          detail: "这条代办还没有生成开发提示词，请先执行后台分析"
        });
      }
      const session =
        this.tryRecoverExistingExecutionSession(current, project, prompt, userId)
        ?? await this.butlerSessionService!.startSession(
          project.id,
          {
            role: "execution",
            ownershipMode: "managed",
            content: prompt,
            permissionMode: project.approvalMode === "readonly" ? "default" : "acceptEdits"
          },
          userId
        );
      const sessionCreatedAt = nowIso();
      const sessionLinkedItem = this.butlerInboxItemRepository.update({
        ...current,
        assistantState: {
          ...current.assistantState,
          lifecycleStage: "session_created",
          linkedButlerSessionId: session.id,
          linkedSessionId: session.sessionId,
          lastError: null,
          lastSessionCreatedAt: sessionCreatedAt
        },
        updatedAt: sessionCreatedAt
      });
      latestItem = sessionLinkedItem;
      const followUpTask = await this.butlerFollowUpService!.createTask(
        {
          projectId: project.id,
          butlerSessionId: session.id,
          objective:
            current.assistantState.analysisSummary?.trim()
              ? [
                  `围绕代办「${current.title}」推进实现。`,
                  current.content,
                  current.assistantState.analysisSummary
                ].join("\n")
              : [
                  `围绕代办「${current.title}」推进实现。`,
                  current.content
                ].join("\n"),
          completionCriteria: `代办「${current.title}」需要完成实现并补齐必要验证，结果必须在会话里说明清楚。`
        },
        userId
      );
      const timestamp = nowIso();
      const nextStatus = latestItem.status === "pending" ? "in_progress" : latestItem.status;
      const updated = this.butlerInboxItemRepository.update({
        ...latestItem,
        status: nextStatus,
        assistantState: {
          ...latestItem.assistantState,
          lifecycleStage: "follow_up_active",
          linkedFollowUpTaskId: followUpTask.id,
          lastError: null,
          lastFollowUpAt: timestamp
        },
        updatedAt: timestamp,
        closedAt: nextStatus === "closed" ? latestItem.closedAt ?? timestamp : null
      });

      return {
        item: this.toView(updated, project),
        session,
        followUpTask
      };
    } catch (error) {
      throw this.markActionFailed(latestItem, error);
    }
  }

  deleteItem(itemId: string): void {
    this.requireItem(itemId);
    this.butlerInboxItemRepository.delete(itemId);
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.butlerInboxAnalyze)) {
      this.taskManager.register<{
        itemId: string;
        userId: string;
        sessionId: string;
        providerId: ButlerProfileProviderId;
      }, void>({
        taskType: HOST_TASK_TYPES.butlerInboxAnalyze,
        executionLane: "external_process",
        concurrency: 1,
        timeoutMs: 120_000,
        run: async (input) => {
          await this.runAnalyzeTask(input.itemId, input.userId, input.sessionId, input.providerId);
        }
      });
    }
  }

  private async runAnalyzeTask(
    itemId: string,
    userId: string,
    sessionId: string,
    providerId: ButlerProfileProviderId
  ): Promise<void> {
    const current = this.butlerInboxItemRepository.findById(itemId);

    if (!current || current.status === "closed") {
      return;
    }

    try {
      const analysis = await this.butlerInboxAnalysisService!.readTodoAnalysisResult(
        sessionId,
        providerId,
        userId
      );
      const latest = this.butlerInboxItemRepository.findById(itemId);

      if (!latest || latest.status === "closed") {
        return;
      }

      this.butlerControlSessionService?.updateSessionStatusBySessionId({
        sessionId,
        status: "idle",
        lastSummary: analysis.analysisSummary
      });
      const timestamp = nowIso();

      this.butlerInboxItemRepository.update({
        ...latest,
        assistantState: {
          ...latest.assistantState,
          lifecycleStage: "analyzed",
          analysisSummary: analysis.analysisSummary,
          generatedPrompt: analysis.prompt,
          lastError: null,
          lastAnalyzedAt: timestamp
        },
        updatedAt: timestamp
      });
    } catch (error) {
      const latest = this.butlerInboxItemRepository.findById(itemId);

      if (!latest || latest.status === "closed") {
        return;
      }

      this.butlerControlSessionService?.updateSessionStatusBySessionId({
        sessionId,
        status: "failed",
        lastSummary: error instanceof Error ? error.message : String(error)
      });
      this.markActionFailed(latest, error);
    }
  }

  private ensureAnalysisDependencies(): void {
    if (!this.butlerInboxAnalysisService || !this.butlerControlSessionService) {
      throw new AppError({
        statusCode: 500,
        errorCode: "BUTLER_INBOX_ANALYSIS_UNAVAILABLE",
        detail: "当前环境未启用代办仓库分析能力"
      });
    }
  }

  private ensureExecutionDependencies(): void {
    this.ensureAnalysisDependencies();

    if (!this.butlerSessionService || !this.butlerFollowUpService) {
      throw new AppError({
        statusCode: 500,
        errorCode: "BUTLER_INBOX_EXECUTION_UNAVAILABLE",
        detail: "当前环境未启用代办执行会话能力"
      });
    }
  }

  private ensureItemIsActionable(item: ButlerInboxItem): void {
    if (item.status === "closed") {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_INBOX_ALREADY_CLOSED",
        detail: "已关闭的代办不能再触发助手执行"
      });
    }
  }

  private markActionFailed(current: ButlerInboxItem, error: unknown): Error {
    const detail = error instanceof Error ? error.message : String(error);

    this.butlerInboxItemRepository.update({
      ...current,
      assistantState: {
        ...current.assistantState,
        lifecycleStage: current.status === "closed" ? "completed" : "failed",
        lastError: detail
      },
      updatedAt: nowIso()
    });

    return error instanceof Error ? error : new Error(detail);
  }

  private requireProject(projectId: string | undefined): ButlerProject {
    const normalizedProjectId = projectId?.trim();

    if (!normalizedProjectId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "projectId 不能为空",
        field: "projectId"
      });
    }

    const project = this.butlerProjectRepository.findById(normalizedProjectId);

    if (!project) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_PROJECT_NOT_FOUND",
        detail: "代码助手项目不存在"
      });
    }

    return project;
  }

  private requireItem(itemId: string): ButlerInboxItem {
    const normalizedItemId = itemId.trim();

    if (!normalizedItemId) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "itemId 不能为空",
        field: "itemId"
      });
    }

    const item = this.butlerInboxItemRepository.findById(normalizedItemId);

    if (!item) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_INBOX_ITEM_NOT_FOUND",
        detail: "代办不存在"
      });
    }

    return item;
  }

  private requireText(value: string | undefined, field: string, detail: string): string {
    const normalized = value?.trim();

    if (!normalized) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail,
        field
      });
    }

    return normalized;
  }

  private toView(item: ButlerInboxItem, project: ButlerProject): ButlerInboxItemView {
    return {
      ...item,
      projectName: project.name,
      workspaceId: project.workspaceId,
      projectLifecycleStatus: project.lifecycleStatus
    };
  }

  private recoverStaleAnalysisState(
    item: ButlerInboxItem,
    userId: string | undefined
  ): ButlerInboxItem {
    if (item.assistantState.lifecycleStage !== "analyzing" || !userId || !this.butlerControlSessionService?.getSession) {
      return item;
    }

    const controlSessionId = item.assistantState.analysisControlSessionId?.trim();
    const hasPrompt = Boolean(item.assistantState.generatedPrompt?.trim());

    if (!controlSessionId) {
      return hasPrompt
        ? this.persistRecoveredAssistantState(item, {
          ...item.assistantState,
          lifecycleStage: "analyzed",
          lastError: null
        })
        : this.persistRecoveredAssistantState(item, {
          ...item.assistantState,
          lifecycleStage: "failed",
          lastError: "代办分析任务已经结束，但没有生成新的开发提示词，请重新分析。"
        });
    }

    const controlSession = this.butlerControlSessionService.getSession(controlSessionId, userId);

    if (!controlSession) {
      return hasPrompt
        ? this.persistRecoveredAssistantState(item, {
          ...item.assistantState,
          lifecycleStage: "analyzed",
          lastError: null
        })
        : this.persistRecoveredAssistantState(item, {
          ...item.assistantState,
          lifecycleStage: "failed",
          lastError: "代办分析会话不存在，无法确认结果，请重新分析。"
        });
    }

    const runningState = controlSession.session.runningState;

    if (runningState === "starting" || runningState === "running") {
      return item;
    }

    if (runningState === "failed" || controlSession.status === "failed") {
      this.butlerControlSessionService.updateSessionStatusBySessionId({
        sessionId: controlSession.sessionId,
        status: "failed",
        lastSummary: controlSession.lastSummary
      });
      return this.persistRecoveredAssistantState(item, {
        ...item.assistantState,
        lifecycleStage: "failed",
        lastError: controlSession.lastSummary ?? "代办分析会话执行失败，请重新分析。"
      });
    }

    if (!hasPrompt) {
      this.butlerControlSessionService.updateSessionStatusBySessionId({
        sessionId: controlSession.sessionId,
        status: "failed",
        lastSummary: controlSession.lastSummary
      });
      return this.persistRecoveredAssistantState(item, {
        ...item.assistantState,
        lifecycleStage: "failed",
        lastError: "代办分析任务已经结束，但没有生成新的开发提示词，请重新分析。"
      });
    }

    this.butlerControlSessionService.updateSessionStatusBySessionId({
      sessionId: controlSession.sessionId,
      status: "idle",
      lastSummary: controlSession.lastSummary
    });
    return this.persistRecoveredAssistantState(item, {
      ...item.assistantState,
      lifecycleStage: "analyzed",
      lastError: null
    });
  }

  private persistRecoveredAssistantState(
    item: ButlerInboxItem,
    assistantState: ButlerInboxAssistantState
  ): ButlerInboxItem {
    if (
      item.assistantState.lifecycleStage === assistantState.lifecycleStage
      && item.assistantState.lastError === assistantState.lastError
    ) {
      return item;
    }

    return this.butlerInboxItemRepository.update({
      ...item,
      assistantState,
      updatedAt: nowIso()
    });
  }

  private tryRecoverExistingExecutionSession(
    item: ButlerInboxItem,
    project: ButlerProject,
    prompt: string,
    userId: string
  ): ButlerProjectSessionView | null {
    if (!this.butlerSessionService?.recoverManagedSession) {
      return null;
    }

    if (
      item.assistantState.lifecycleStage !== "failed"
      || item.assistantState.linkedButlerSessionId?.trim()
      || item.assistantState.linkedSessionId?.trim()
    ) {
      return null;
    }

    return this.butlerSessionService.recoverManagedSession(
      project.id,
      {
        role: "execution",
        ownershipMode: "managed",
        content: prompt,
        permissionMode: project.approvalMode === "readonly" ? "default" : "acceptEdits"
      },
      userId,
      {
        recoveryReferenceAt: item.assistantState.lastSessionCreatedAt?.trim() || item.updatedAt
      }
    );
  }
}

function createAssistantState(status: ButlerInboxItemStatus): ButlerInboxAssistantState {
  return {
    lifecycleStage: status === "closed" ? "completed" : "pending",
    analysisSummary: null,
    generatedPrompt: null,
    analysisControlSessionId: null,
    analysisSessionId: null,
    linkedButlerSessionId: null,
    linkedSessionId: null,
    linkedFollowUpTaskId: null,
    lastError: null,
    lastAnalyzedAt: null,
    lastSessionCreatedAt: null,
    lastFollowUpAt: null
  };
}

function resolveAssistantStateForManualUpdate(
  state: ButlerInboxAssistantState,
  nextStatus: ButlerInboxItemStatus
): ButlerInboxAssistantState {
  if (nextStatus === "closed") {
    return {
      ...state,
      lifecycleStage: "completed",
      lastError: null
    };
  }

  const nextLifecycleStage =
    state.lifecycleStage === "analyzing"
      ? "analyzing"
      : state.linkedFollowUpTaskId?.trim()
      ? "follow_up_active"
      : state.linkedButlerSessionId?.trim()
        ? "session_created"
        : state.generatedPrompt?.trim()
          ? "analyzed"
          : "pending";

  return {
    ...state,
    lifecycleStage: nextLifecycleStage,
    lastError: null
  };
}
