import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { AssistantSandboxWorkspace, Workspace } from "../../types/domain.js";
import type { AssistantSandboxWorkspaceRepository } from "../../storage/repositories/assistant-sandbox-workspace-repository.js";
import type { ButlerProfileService } from "./butler-profile-service.js";
import type { ButlerProjectService } from "./butler-project-service.js";
import { createTaskManager, type TaskManager } from "../tasks/task-manager.js";
import { HOST_TASK_TYPES } from "../tasks/task-types.js";
import type { CloneWorkspaceInput, WorkspaceService } from "../workspace/workspace-service.js";

export interface AssistantSandboxWorkspaceView extends AssistantSandboxWorkspace {
  workspace: Workspace | null;
}

export interface CreateAssistantSandboxInput {
  userId: string;
  controlSessionId?: string | null;
  title?: string | null;
  description?: string | null;
  purpose?: string | null;
  expiresAt?: string | null;
  source:
    | {
      kind: "blank";
      directoryName?: string | null;
    }
    | {
      kind: "clone";
      repositoryUrl: string;
      directoryName?: string | null;
      auth?: CloneWorkspaceInput["auth"];
    };
}

export interface PromoteAssistantSandboxInput {
  mode?: "pin" | "project";
  projectName?: string | null;
  defaultProvider?: "codex" | "claude-code" | null;
}

export interface AssistantSandboxCleanupResult {
  dueSandboxCount: number;
  cleanedSandboxCount: number;
  idle: boolean;
}

const DEFAULT_SANDBOX_RETENTION_DAYS = 30;
const DEFAULT_SANDBOX_CLEANUP_LIMIT = 20;

export class AssistantSandboxService {
  private readonly taskManager: TaskManager;

  constructor(
    private readonly repository: AssistantSandboxWorkspaceRepository,
    private readonly butlerProfileService: Pick<ButlerProfileService, "getProfile">,
    private readonly workspaceService: Pick<
      WorkspaceService,
      "importWorkspace" | "cloneWorkspace" | "removeWorkspace" | "getWorkspaceOrThrow"
    >,
    private readonly butlerProjectService?: Pick<ButlerProjectService, "create">,
    taskManager: TaskManager = createTaskManager()
  ) {
    this.taskManager = taskManager;
    this.registerBackgroundTasks();
  }

  listSandboxes(filters: {
    userId: string;
    controlSessionId?: string | null;
    statuses?: Array<"active" | "archived" | "expired" | "orphaned" | "deleted">;
    limit?: number;
  }): AssistantSandboxWorkspaceView[] {
    return this.repository
      .list({
        userId: filters.userId,
        controlSessionId: filters.controlSessionId ?? null,
        statuses: filters.statuses,
        limit: filters.limit
      })
      .map((record) => this.toView(record));
  }

  getSandbox(sandboxId: string, userId: string): AssistantSandboxWorkspaceView {
    return this.toView(this.requireSandbox(sandboxId, userId));
  }

  async createSandbox(input: CreateAssistantSandboxInput): Promise<AssistantSandboxWorkspaceView> {
    const timestamp = nowIso();
    const sandboxRootPath = this.ensureSandboxRootPath();
    const workspace = input.source.kind === "blank"
      ? this.createBlankWorkspace(sandboxRootPath, input)
      : await this.createCloneWorkspace(sandboxRootPath, input);
    const record = this.repository.create({
      id: createId(),
      userId: input.userId,
      workspaceId: workspace.id,
      controlSessionId: normalizeNullableText(input.controlSessionId),
      title: normalizeSandboxTitle(input.title, workspace.name),
      description: normalizeNullableText(input.description),
      sourceKind: input.source.kind,
      sourceRef:
        input.source.kind === "clone"
          ? normalizeNullableText(input.source.repositoryUrl)
          : workspace.path,
      visibility: "assistant_only",
      status: "active",
      purpose: normalizeNullableText(input.purpose),
      expiresAt: normalizeNullableIsoTime(input.expiresAt, "expiresAt"),
      promotedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return this.toView(record);
  }

  promoteSandbox(
    sandboxId: string,
    userId: string,
    input: PromoteAssistantSandboxInput = {}
  ): AssistantSandboxWorkspaceView {
    const current = this.requireSandbox(sandboxId, userId);
    const promotedAt = nowIso();
    const updated = this.repository.update({
      ...current,
      controlSessionId: null,
      visibility: "pinned",
      status: "active",
      expiresAt: null,
      promotedAt: current.promotedAt ?? promotedAt,
      updatedAt: promotedAt
    });

    if (input.mode === "project") {
      if (!this.butlerProjectService) {
        throw new AppError({
          statusCode: 500,
          errorCode: "ASSISTANT_SANDBOX_PROMOTE_UNAVAILABLE",
          detail: "当前环境未启用沙箱晋升为项目的能力"
        });
      }

      const workspace = this.workspaceService.getWorkspaceOrThrow(updated.workspaceId);
      this.butlerProjectService.create({
        workspaceId: workspace.id,
        name: normalizeNullableText(input.projectName) ?? workspace.name,
        repoRoot: workspace.repoRoot ?? workspace.path,
        defaultProvider: input.defaultProvider ?? null,
        config: {
          createdFrom: "assistant_sandbox",
          sandboxId: updated.id
        }
      });
    }

    return this.toView(updated);
  }

  markSandboxUsedByControlSession(
    sandboxId: string,
    userId: string,
    controlSessionId: string | null
  ): AssistantSandboxWorkspaceView {
    const current = this.requireSandbox(sandboxId, userId);
    const nextControlSessionId = normalizeNullableText(controlSessionId);

    if (current.controlSessionId === nextControlSessionId) {
      return this.toView(current);
    }

    const updated = this.repository.update({
      ...current,
      controlSessionId: nextControlSessionId,
      updatedAt: nowIso()
    });

    return this.toView(updated);
  }

  markSandboxOrphanedByWorkspaceId(
    workspaceId: string,
    userId: string
  ): AssistantSandboxWorkspaceView | null {
    const current = this.repository.findByWorkspaceId(workspaceId.trim());

    if (!current || current.userId !== userId) {
      return null;
    }

    if (current.status === "deleted") {
      return this.toView(current);
    }

    const updatedAt = nowIso();
    const nextStatus = isAutomaticCleanupProtected(current) ? current.status : "orphaned";
    const updated = this.repository.update({
      ...current,
      controlSessionId: null,
      status: nextStatus,
      expiresAt: nextStatus === "orphaned" ? addDaysIso(updatedAt, DEFAULT_SANDBOX_RETENTION_DAYS) : null,
      updatedAt
    });

    return this.toView(updated);
  }

  expireSandbox(sandboxId: string, userId: string): AssistantSandboxWorkspaceView {
    const current = this.requireSandbox(sandboxId, userId);
    const updatedAt = nowIso();
    const updated = this.repository.update({
      ...current,
      status: "expired",
      updatedAt
    });

    return this.toView(updated);
  }

  removeSandbox(sandboxId: string, userId: string): AssistantSandboxWorkspaceView {
    const current = this.requireSandbox(sandboxId, userId);
    const updatedAt = nowIso();

    try {
      this.workspaceService.removeWorkspace(current.workspaceId);
    } catch {
      // 工作区可能已被清理或移除；这里仍然收口元数据，避免残留不可操作沙箱。
    }

    const updated = this.repository.update({
      ...current,
      status: "deleted",
      updatedAt
    });

    return this.toView(updated);
  }

  async runDueCleanup(referenceAt: string): Promise<AssistantSandboxCleanupResult> {
    return await this.taskManager.enqueue<{ referenceAt: string }, AssistantSandboxCleanupResult>(
      HOST_TASK_TYPES.assistantSandboxTick,
      {
        key: "global",
        source: "assistant_sandbox.run_due_cleanup",
        input: {
          referenceAt
        }
      }
    ).promise;
  }

  resolveWorkspaceId(sandboxId: string, userId: string): string {
    const sandbox = this.requireSandbox(sandboxId, userId);

    if (sandbox.status === "deleted") {
      throw new AppError({
        statusCode: 409,
        errorCode: "ASSISTANT_SANDBOX_UNAVAILABLE",
        detail: "该沙箱已经删除，不能再用于启动会话"
      });
    }

    if (sandbox.status === "expired") {
      throw new AppError({
        statusCode: 409,
        errorCode: "ASSISTANT_SANDBOX_UNAVAILABLE",
        detail: "该沙箱已过期，不能再用于启动会话"
      });
    }

    if (sandbox.status === "orphaned") {
      throw new AppError({
        statusCode: 409,
        errorCode: "ASSISTANT_SANDBOX_UNAVAILABLE",
        detail: "该沙箱已经孤立，不能再用于启动会话"
      });
    }

    return sandbox.workspaceId;
  }

  private registerBackgroundTasks(): void {
    if (!this.taskManager.has(HOST_TASK_TYPES.assistantSandboxTick)) {
      this.taskManager.register<{ referenceAt: string }, AssistantSandboxCleanupResult>({
        taskType: HOST_TASK_TYPES.assistantSandboxTick,
        executionLane: "host_background",
        timeoutMs: 10_000,
        run: async ({ referenceAt }) => await this.runDueCleanupDirect(referenceAt)
      });
    }

    if (!this.taskManager.has(HOST_TASK_TYPES.assistantSandboxCleanup)) {
      this.taskManager.register<{ sandboxId: string; referenceAt: string }, boolean>({
        taskType: HOST_TASK_TYPES.assistantSandboxCleanup,
        executionLane: "host_background",
        timeoutMs: 10_000,
        run: async ({ sandboxId, referenceAt }) => {
          return this.cleanupSandboxDirect(sandboxId, referenceAt);
        }
      });
    }
  }

  private async runDueCleanupDirect(referenceAt: string): Promise<AssistantSandboxCleanupResult> {
    const dueSandboxes = this.repository.listDueCleanup(referenceAt, DEFAULT_SANDBOX_CLEANUP_LIMIT);
    const handles = dueSandboxes.map((sandbox) =>
      this.taskManager.enqueue<{ sandboxId: string; referenceAt: string }, boolean>(
        HOST_TASK_TYPES.assistantSandboxCleanup,
        {
          key: sandbox.id,
          source: "assistant_sandbox.tick.cleanup",
          input: {
            sandboxId: sandbox.id,
            referenceAt
          }
        }
      )
    );

    const results = await Promise.all(handles.map((handle) => handle.promise));
    const cleanedSandboxCount = results.filter(Boolean).length;

    return {
      dueSandboxCount: dueSandboxes.length,
      cleanedSandboxCount,
      idle: dueSandboxes.length === 0
    };
  }

  private async cleanupSandboxDirect(sandboxId: string, referenceAt: string): Promise<boolean> {
    const current = this.repository.findById(sandboxId);

    if (!current || current.status !== "orphaned" || !current.expiresAt || current.expiresAt > referenceAt) {
      return false;
    }

    if (isAutomaticCleanupProtected(current)) {
      this.repository.update({
        ...current,
        status: "active",
        expiresAt: null,
        updatedAt: nowIso()
      });
      return false;
    }

    await this.removeSandboxDirectoryIfSafe(current);
    this.removeSandbox(current.id, current.userId);
    return true;
  }

  private createBlankWorkspace(
    sandboxRootPath: string,
    input: CreateAssistantSandboxInput
  ): Workspace {
    if (input.source.kind !== "blank") {
      throw new Error("invalid blank sandbox input");
    }

    const directoryName = normalizeSandboxDirectoryName(
      input.source.directoryName,
      input.title
    );
    const sandboxPath = path.join(sandboxRootPath, directoryName);

    if (fs.existsSync(sandboxPath)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "ASSISTANT_SANDBOX_EXISTS",
        detail: "目标沙箱目录已存在，请换一个名称",
        field: "directoryName"
      });
    }

    fs.mkdirSync(sandboxPath, { recursive: true });
    return this.workspaceService.importWorkspace(
      sandboxPath,
      normalizeNullableText(input.title) ?? directoryName
    );
  }

  private async createCloneWorkspace(
    sandboxRootPath: string,
    input: CreateAssistantSandboxInput
  ): Promise<Workspace> {
    if (input.source.kind !== "clone") {
      throw new Error("invalid clone sandbox input");
    }

    return await this.workspaceService.cloneWorkspace({
      repositoryUrl: input.source.repositoryUrl,
      parentPath: sandboxRootPath,
      directoryName: normalizeSandboxDirectoryName(
        input.source.directoryName,
        input.title,
        input.source.repositoryUrl
      ),
      name: normalizeNullableText(input.title) ?? undefined,
      auth: input.source.auth
    });
  }

  private ensureSandboxRootPath(): string {
    const sandboxRootPath = this.resolveSandboxRootPath();
    fs.mkdirSync(sandboxRootPath, { recursive: true });
    return sandboxRootPath;
  }

  private resolveSandboxRootPath(): string {
    const profile = this.butlerProfileService.getProfile();

    if (!profile) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_PROFILE_NOT_INITIALIZED",
        detail: "代码助手尚未完成初始化，不能创建沙箱工作区"
      });
    }

    const workspacePath = profile.workspacePath;
    return path.join(path.resolve(workspacePath), "sandboxes");
  }

  private async removeSandboxDirectoryIfSafe(record: AssistantSandboxWorkspace): Promise<void> {
    const sandboxPath = this.toView(record).workspace?.path?.trim() || null;

    if (!sandboxPath) {
      return;
    }

    const resolvedSandboxPath = path.resolve(sandboxPath);
    const sandboxRootPath = this.resolveSandboxRootPath();

    if (!isPathInsideDirectory(resolvedSandboxPath, sandboxRootPath)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "ASSISTANT_SANDBOX_DELETE_PATH_UNSAFE",
        detail: "沙箱目录不在允许清理的沙箱根目录内，已拒绝自动删除"
      });
    }

    await fs.promises.rm(resolvedSandboxPath, {
      recursive: true,
      force: true
    });
  }

  private requireSandbox(sandboxId: string, userId: string): AssistantSandboxWorkspace {
    const sandbox = this.repository.findById(sandboxId.trim());

    if (!sandbox || sandbox.userId !== userId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "ASSISTANT_SANDBOX_NOT_FOUND",
        detail: "未找到对应的助手沙箱"
      });
    }

    return sandbox;
  }

  private toView(record: AssistantSandboxWorkspace): AssistantSandboxWorkspaceView {
    try {
      return {
        ...record,
        workspace: this.workspaceService.getWorkspaceOrThrow(record.workspaceId)
      };
    } catch {
      return {
        ...record,
        workspace: null
      };
    }
  }
}

function isAutomaticCleanupProtected(sandbox: AssistantSandboxWorkspace): boolean {
  return sandbox.visibility === "pinned" || sandbox.promotedAt !== null;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeSandboxTitle(input: string | null | undefined, fallback: string): string {
  return normalizeNullableText(input) ?? fallback;
}

function normalizeSandboxDirectoryName(
  requestedName: string | null | undefined,
  title?: string | null,
  repositoryUrl?: string | null
): string {
  const normalized = normalizeNullableText(requestedName)
    ?? slugifyPathSegment(normalizeNullableText(title) ?? inferRepositoryName(repositoryUrl) ?? `sandbox-${createId().slice(0, 8)}`);

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "沙箱目录名不能为空",
      field: "directoryName"
    });
  }

  return normalized;
}

function inferRepositoryName(repositoryUrl: string | null | undefined): string | null {
  const normalized = normalizeNullableText(repositoryUrl);

  if (!normalized) {
    return null;
  }

  const tail = normalized.split("/").pop() ?? "";
  return tail.replace(/\.git$/i, "").trim() || null;
}

function slugifyPathSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized.slice(0, 64);
}

function normalizeNullableIsoTime(
  value: string | null | undefined,
  field: string
): string | null {
  const normalized = normalizeNullableText(value);

  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);

  if (Number.isNaN(timestamp)) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 必须是合法的 ISO 时间`,
      field
    });
  }

  return new Date(timestamp).toISOString();
}

function addDaysIso(referenceAt: string, days: number): string {
  return new Date(new Date(referenceAt).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isPathInsideDirectory(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
