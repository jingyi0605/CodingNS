import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { AssistantSandboxWorkspace, Workspace } from "../../types/domain.js";
import type { AssistantSandboxWorkspaceRepository } from "../../storage/repositories/assistant-sandbox-workspace-repository.js";
import type { ButlerProfileService } from "./butler-profile-service.js";
import type { ButlerProjectService } from "./butler-project-service.js";
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

export class AssistantSandboxService {
  constructor(
    private readonly repository: AssistantSandboxWorkspaceRepository,
    private readonly butlerProfileService: Pick<ButlerProfileService, "getProfile">,
    private readonly workspaceService: Pick<
      WorkspaceService,
      "importWorkspace" | "cloneWorkspace" | "removeWorkspace" | "getWorkspaceOrThrow"
    >,
    private readonly butlerProjectService?: Pick<ButlerProjectService, "create">
  ) {}

  listSandboxes(filters: {
    userId: string;
    controlSessionId?: string | null;
    statuses?: Array<"active" | "archived" | "expired" | "deleted">;
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
      visibility: "pinned",
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

    return sandbox.workspaceId;
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
    const profile = this.butlerProfileService.getProfile();

    if (!profile) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_PROFILE_NOT_INITIALIZED",
        detail: "代码助手尚未完成初始化，不能创建沙箱工作区"
      });
    }

    const workspacePath = profile.workspacePath;
    const sandboxRootPath = path.join(path.resolve(workspacePath), "sandboxes");
    fs.mkdirSync(sandboxRootPath, { recursive: true });
    return sandboxRootPath;
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
