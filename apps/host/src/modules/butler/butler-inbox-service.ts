import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  ButlerInboxItem,
  ButlerInboxItemPriority,
  ButlerInboxItemStatus,
  ButlerInboxItemType,
  ButlerProject
} from "../../types/domain.js";
import type { ButlerInboxItemRepository } from "../../storage/repositories/butler-inbox-item-repository.js";
import type { ButlerProjectRepository } from "../../storage/repositories/butler-project-repository.js";

export interface ButlerInboxItemView extends ButlerInboxItem {
  projectName: string;
  workspaceId: string;
  projectLifecycleStatus: ButlerProject["lifecycleStatus"];
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
  constructor(
    private readonly butlerProjectRepository: Pick<ButlerProjectRepository, "findById" | "list">,
    private readonly butlerInboxItemRepository: Pick<
      ButlerInboxItemRepository,
      "create" | "list" | "findById" | "update" | "delete"
    >
  ) {}

  listItems(filters?: {
    workspaceId?: string;
    projectId?: string;
    status?: ButlerInboxItemStatus;
    itemType?: ButlerInboxItemType;
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
        const project = projectMap.get(item.projectId);
        return project ? this.toView(item, project) : null;
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
      updatedAt: nowIso(),
      closedAt: nextStatus === "closed" ? current.closedAt ?? nowIso() : null
    };

    return this.toView(this.butlerInboxItemRepository.update(updated), project);
  }

  deleteItem(itemId: string): void {
    this.requireItem(itemId);
    this.butlerInboxItemRepository.delete(itemId);
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
}
