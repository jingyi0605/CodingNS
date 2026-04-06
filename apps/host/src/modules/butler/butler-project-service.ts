import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerProject } from "../../types/domain.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";
import type { ButlerSessionRepository } from "../../storage/repositories/butler-session-repository.js";
import type { WorkspaceRepository } from "../../storage/repositories/workspace-repository.js";
import type { ButlerProfileService } from "./butler-profile-service.js";

export interface CreateButlerProjectInput {
  workspaceId: string;
  name: string;
  repoRoot: string;
  defaultProvider?: ButlerProject["defaultProvider"];
  approvalMode?: ButlerProject["approvalMode"];
  config?: Record<string, unknown>;
}

export interface UpdateButlerProjectInput {
  name?: string;
  defaultProvider?: ButlerProject["defaultProvider"];
  approvalMode?: ButlerProject["approvalMode"];
  lifecycleStatus?: ButlerProject["lifecycleStatus"];
  riskLevel?: ButlerProject["riskLevel"];
  config?: Record<string, unknown>;
}

export class ButlerProjectService {
  constructor(
    private readonly butlerProjectRepository: ButlerProjectRepository,
    private readonly butlerSessionRepository: ButlerSessionRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly butlerProfileService?: Pick<ButlerProfileService, "getProfile">
  ) {}

  list(input?: {
    workspaceId?: string;
    lifecycleStatus?: ButlerProject["lifecycleStatus"];
    riskLevel?: ButlerProject["riskLevel"];
  }): ButlerProject[] {
    this.syncManagedProjects();
    return this.butlerProjectRepository.list(input);
  }

  create(input: CreateButlerProjectInput): ButlerProject {
    const workspace = this.getWorkspaceOrThrow(input.workspaceId);
    const name = requireNonEmptyText(input.name, "name", "项目名称不能为空");
    const repoRoot = this.resolveRepoRootWithinWorkspace(workspace.path, input.repoRoot);

    if (this.butlerProjectRepository.list({ workspaceId: workspace.id }).some((item) => item.repoRoot === repoRoot)) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BUTLER_PROJECT_EXISTS",
        detail: "当前工作区下已存在相同仓库路径的代码助手项目",
        field: "repoRoot"
      });
    }

    const timestamp = nowIso();

    return this.butlerProjectRepository.create({
      id: createId(),
      workspaceId: workspace.id,
      name,
      repoRoot,
      defaultProvider: input.defaultProvider?.trim() || null,
      instructionProfileId: null,
      approvalMode: input.approvalMode ?? "controlled",
      lifecycleStatus: "active",
      riskLevel: "low",
      config: input.config ?? {},
      lastPatrolAt: null,
      lastVerificationAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null
    });
  }

  getById(projectId: string): ButlerProject {
    this.syncManagedProjects();
    const project = this.butlerProjectRepository.findById(projectId);

    if (!project) {
      throw new AppError({
        statusCode: 404,
        errorCode: "BUTLER_PROJECT_NOT_FOUND",
        detail: "代码助手项目不存在"
      });
    }

    return project;
  }

  update(projectId: string, input: UpdateButlerProjectInput): ButlerProject {
    const current = this.getById(projectId);

    const nextLifecycleStatus = input.lifecycleStatus ?? current.lifecycleStatus;
    const nextArchivedAt = nextLifecycleStatus === "archived" ? current.archivedAt ?? nowIso() : null;

    const updated = this.butlerProjectRepository.update({
      ...current,
      name: input.name?.trim() || current.name,
      defaultProvider:
        input.defaultProvider === undefined
          ? current.defaultProvider
          : input.defaultProvider?.trim() || null,
      approvalMode: input.approvalMode ?? current.approvalMode,
      lifecycleStatus: nextLifecycleStatus,
      riskLevel: input.riskLevel ?? current.riskLevel,
      config: input.config ?? current.config,
      archivedAt: nextArchivedAt,
      updatedAt: nowIso()
    });

    if (!updated) {
      throw new AppError({
        statusCode: 500,
        errorCode: "BUTLER_PROJECT_UPDATE_FAILED",
        detail: "代码助手项目更新失败"
      });
    }

    return updated;
  }

  getOverview(projectId: string): {
    project: ButlerProject;
    activeSessionCount: number;
    latestPatrolRun: null;
    latestVerificationRun: null;
    topRisks: string[];
    nextSuggestions: string[];
  } {
    this.syncManagedProjects();
    const project = this.getById(projectId);
    const sessions = this.butlerSessionRepository.listByProject(project.id);

    return {
      project,
      activeSessionCount: sessions.filter((session) => session.status === "running").length,
      latestPatrolRun: null,
      latestVerificationRun: null,
      topRisks: [],
      nextSuggestions: []
    };
  }

  private getWorkspaceOrThrow(workspaceId: string) {
    const workspace = this.workspaceRepository.findById(workspaceId);

    if (!workspace || workspace.removedAt) {
      throw new AppError({
        statusCode: 404,
        errorCode: "WORKSPACE_NOT_FOUND",
        detail: "工作区不存在"
      });
    }

    return workspace;
  }

  private syncManagedProjects(): void {
    const activeWorkspaces = this.workspaceRepository.list();
    const activeWorkspaceIds = new Set(activeWorkspaces.map((workspace) => workspace.id));
    const profile = this.butlerProfileService?.getProfile() ?? null;
    const butlerWorkspacePath = profile?.workspacePath ? path.resolve(profile.workspacePath) : null;
    const projects = this.butlerProjectRepository.list();

    for (const workspace of activeWorkspaces) {
      const normalizedWorkspacePath = path.resolve(workspace.path);

      if (butlerWorkspacePath && normalizedWorkspacePath === butlerWorkspacePath) {
        continue;
      }

      const sameWorkspaceProjects = projects.filter((project) => project.workspaceId === workspace.id);
      const autoProject = sameWorkspaceProjects.find(isWorkspaceAutoManagedProject) ?? null;

      if (sameWorkspaceProjects.length === 0) {
        const timestamp = nowIso();

        this.butlerProjectRepository.create({
          id: createId(),
          workspaceId: workspace.id,
          name: workspace.name,
          repoRoot: workspace.repoRoot ?? workspace.path,
          defaultProvider: null,
          instructionProfileId: null,
          approvalMode: "controlled",
          lifecycleStatus: "active",
          riskLevel: "low",
          config: {
            managedBy: "workspace-auto"
          },
          lastPatrolAt: null,
          lastVerificationAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          archivedAt: null
        });
        continue;
      }

      if (!autoProject) {
        continue;
      }

      const nextRepoRoot = workspace.repoRoot ?? workspace.path;
      const shouldRestore = autoProject.lifecycleStatus !== "active" || autoProject.archivedAt !== null;
      const shouldRefreshMeta = autoProject.name !== workspace.name || autoProject.repoRoot !== nextRepoRoot;

      if (!shouldRestore && !shouldRefreshMeta) {
        continue;
      }

      this.butlerProjectRepository.update({
        ...autoProject,
        name: workspace.name,
        repoRoot: nextRepoRoot,
        lifecycleStatus: "active",
        archivedAt: null,
        updatedAt: nowIso()
      });
    }

    for (const project of projects) {
      if (!isWorkspaceAutoManagedProject(project)) {
        continue;
      }

      if (activeWorkspaceIds.has(project.workspaceId)) {
        continue;
      }

      if (project.lifecycleStatus === "archived") {
        continue;
      }

      this.butlerProjectRepository.update({
        ...project,
        lifecycleStatus: "archived",
        archivedAt: project.archivedAt ?? nowIso(),
        updatedAt: nowIso()
      });
    }
  }

  private resolveRepoRootWithinWorkspace(workspacePath: string, repoRoot: string): string {
    const normalized = requireNonEmptyText(repoRoot, "repoRoot", "仓库路径不能为空");
    const resolvedRepoRoot = path.resolve(normalized);

    if (!fs.existsSync(resolvedRepoRoot) || !fs.statSync(resolvedRepoRoot).isDirectory()) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "仓库路径必须是已存在的目录",
        field: "repoRoot"
      });
    }

    const relative = path.relative(path.resolve(workspacePath), resolvedRepoRoot);
    const isInsideWorkspace =
      relative === ""
      || (!relative.startsWith("..") && !path.isAbsolute(relative));

    if (!isInsideWorkspace) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "仓库路径必须位于工作区边界内",
        field: "repoRoot"
      });
    }

    return resolvedRepoRoot;
  }
}

function isWorkspaceAutoManagedProject(project: ButlerProject): boolean {
  return project.config.managedBy === "workspace-auto";
}

function requireNonEmptyText(value: string | undefined, field: string, detail: string): string {
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
