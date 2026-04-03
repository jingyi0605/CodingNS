import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { ButlerProject } from "../../types/domain.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";
import type { ProjectMemory, ProjectMemoryStatus, ProjectMemoryType } from "../../types/domain.js";
import type { ProjectMemoryRepository } from "../../storage/repositories/project-memory-repository.js";

interface InputMemory {
  title?: string;
  scopePath?: string | null;
  content?: string;
  tags?: string[];
  confidence?: number;
  status?: ProjectMemoryStatus;
  memoryType?: ProjectMemoryType;
  evidence?: Record<string, unknown>;
}

export class ProjectMemoryService {
  constructor(
    private readonly projectRepository: ButlerProjectRepository,
    private readonly memoryRepository: ProjectMemoryRepository
  ) {}

  listMemories(
    projectId: string,
    filters?: {
      status?: ProjectMemoryStatus;
      memoryType?: ProjectMemoryType;
      scopePath?: string;
      query?: string;
    }
  ) {
    this.ensureProject(projectId);
    return this.memoryRepository.listByProject(projectId, filters);
  }

  createMemory(projectId: string, input: InputMemory): ProjectMemory {
    const project = this.ensureProject(projectId);
    const title = this.requireText(input.title, "title");
    const content = this.requireText(input.content, "content");
    const confidence = this.normalizeConfidence(input.confidence);

    const record: ProjectMemory = {
      id: createId(),
      projectId: project.id,
      sourceButlerSessionId: null,
      sourceCheckpointId: null,
      memoryType: input.memoryType ?? "note",
      title,
      scopePath: input.scopePath ?? null,
      content,
      tags: input.tags ?? [],
      confidence,
      status: input.status ?? "candidate",
      evidence: input.evidence ?? {},
      supersededBy: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    return this.memoryRepository.create(record);
  }

  updateMemory(projectId: string, memoryId: string, input: InputMemory): ProjectMemory {
    this.ensureProject(projectId);
    const memory = this.memoryRepository.findById(memoryId);

    if (!memory) {
      throw new AppError({ statusCode: 404, errorCode: "MEMORY_NOT_FOUND", detail: "记忆不存在" });
    }

    if (memory.projectId !== projectId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "MEMORY_NOT_FOUND",
        detail: "当前项目下不存在该记忆"
      });
    }

    if (input.title) {
      memory.title = this.requireText(input.title, "title");
    }

    if (input.content) {
      memory.content = this.requireText(input.content, "content");
    }

    if (input.scopePath !== undefined) {
      memory.scopePath = input.scopePath;
    }

    memory.tags = input.tags ?? memory.tags;
    memory.confidence = this.normalizeConfidence(input.confidence, memory.confidence);
    memory.status = input.status ?? memory.status;
    memory.memoryType = input.memoryType ?? memory.memoryType;
    memory.evidence = input.evidence ?? memory.evidence;
    memory.updatedAt = nowIso();

    return this.memoryRepository.update(memory);
  }

  private ensureProject(projectId: string): ButlerProject {
    const project = this.projectRepository.findById(projectId);

    if (!project) {
      throw new AppError({ statusCode: 404, errorCode: "BUTLER_PROJECT_NOT_FOUND", detail: "项目不存在" });
    }

    return project;
  }

  private requireText(value: string | undefined, field: string): string {
    const normalized = value?.trim();

    if (!normalized) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: `${field} 不能为空`,
        field
      });
    }

    return normalized;
  }

  private normalizeConfidence(value?: number, fallback = 0.5): number {
    if (value === undefined) {
      return fallback;
    }

    if (Number.isNaN(value) || value < 0 || value > 1) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "confidence 必须在 0 到 1 之间",
        field: "confidence"
      });
    }

    return value;
  }
}
