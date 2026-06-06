import type { FastifyReply, FastifyRequest } from "fastify";
import { requireUserId } from "../preferences/common.js";
import type { AffairsTagService } from "./affairs-tag-service.js";

interface WorkspaceParams {
  workspaceId: string;
}

interface WorkspaceTagParams extends WorkspaceParams {
  tagId: string;
}

interface WorkspaceDocumentParams extends WorkspaceParams {
  documentId: string;
}

interface ListTagsQuery {
  includeDisabled?: string;
}

interface SaveTagBody {
  name?: string;
  parentId?: string | null;
  description?: string | null;
  status?: "active" | "disabled";
  smartRules?: Array<{
    id?: string;
    relation?: "and" | "or" | "not";
    ruleType?: "file_name_contains" | "file_content_contains" | "file_extension_in" | "modified_time_between" | "document_path_in_folder";
    matcher?: Record<string, unknown>;
    enabled?: boolean;
    priority?: number;
  }>;
}

interface SaveDocumentTagsBody {
  tagIds?: string[];
  createTagPaths?: string[];
}

interface FolderTagDetailsQuery {
  folderPath?: string;
}

interface FolderTagTaskQuery {
  folderPath?: string;
}

interface SaveFolderTagsBody {
  folderPath?: string;
  tagIds?: string[];
  createTagPaths?: string[];
}

interface EnsureTagBody {
  path?: string;
}

export class AffairsTagController {
  constructor(private readonly affairsTagService: AffairsTagService) {}

  readonly listTags = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Querystring: ListTagsQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.listTags(
      request.params.workspaceId,
      requireUserId(request),
      {
        includeDisabled: request.query.includeDisabled === "true",
      },
    ));
  };

  readonly listGlobalTags = async (
    request: FastifyRequest<{ Querystring: ListTagsQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.listGlobalTags(
      requireUserId(request),
      {
        includeDisabled: request.query.includeDisabled === "true",
      },
    ));
  };

  readonly createTag = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: SaveTagBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.saveTagDefinition(
      request.params.workspaceId,
      requireUserId(request),
      {
        name: request.body.name?.trim() ?? "",
        parentId: request.body.parentId?.trim() ?? null,
        description: request.body.description ?? null,
        status: request.body.status,
        smartRules: Array.isArray(request.body.smartRules)
          ? request.body.smartRules.map((rule, index) => ({
              id: rule.id?.trim() ?? `draft-${index}`,
              relation: rule.relation === "or" || rule.relation === "not" ? rule.relation : "and",
              ruleType: rule.ruleType ?? "file_name_contains",
              matcher: rule.matcher ?? {},
              enabled: rule.enabled !== false,
              priority: Number.isFinite(rule.priority) ? Number(rule.priority) : index,
            }))
          : undefined,
      },
    ));
  };

  readonly ensureTag = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: EnsureTagBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.ensureTagDefinition(
      request.params.workspaceId,
      requireUserId(request),
      {
        path: request.body.path?.trim() ?? "",
      },
    ));
  };

  readonly getTagDetail = async (
    request: FastifyRequest<{ Params: WorkspaceTagParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.getTagDetail(
      request.params.workspaceId,
      requireUserId(request),
      request.params.tagId,
    ));
  };

  readonly updateTag = async (
    request: FastifyRequest<{ Params: WorkspaceTagParams; Body: SaveTagBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.saveTagDefinition(
      request.params.workspaceId,
      requireUserId(request),
      {
        tagId: request.params.tagId,
        name: request.body.name?.trim() ?? "",
        parentId: request.body.parentId?.trim() ?? null,
        description: request.body.description ?? null,
        status: request.body.status,
        smartRules: Array.isArray(request.body.smartRules)
          ? request.body.smartRules.map((rule, index) => ({
              id: rule.id?.trim() ?? `draft-${index}`,
              relation: rule.relation === "or" || rule.relation === "not" ? rule.relation : "and",
              ruleType: rule.ruleType ?? "file_name_contains",
              matcher: rule.matcher ?? {},
              enabled: rule.enabled !== false,
              priority: Number.isFinite(rule.priority) ? Number(rule.priority) : index,
            }))
          : undefined,
      },
    ));
  };

  readonly deleteTag = async (
    request: FastifyRequest<{ Params: WorkspaceTagParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.deleteTagDefinition(
      request.params.workspaceId,
      requireUserId(request),
      request.params.tagId,
    ));
  };

  readonly getDocumentTagDetails = async (
    request: FastifyRequest<{ Params: WorkspaceDocumentParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.getDocumentTagDetails(
      request.params.workspaceId,
      requireUserId(request),
      request.params.documentId,
    ));
  };

  readonly saveDocumentTags = async (
    request: FastifyRequest<{ Params: WorkspaceDocumentParams; Body: SaveDocumentTagsBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.saveDocumentTagBindings(
      request.params.workspaceId,
      requireUserId(request),
      request.params.documentId,
      [
        ...(Array.isArray(request.body.tagIds) ? request.body.tagIds : []),
        ...await Promise.all((Array.isArray(request.body.createTagPaths) ? request.body.createTagPaths : []).map(async (tagPath) => (
          this.affairsTagService.ensureTagDefinition(
            request.params.workspaceId,
            requireUserId(request),
            { path: tagPath },
          ).id
        ))),
      ],
    ));
  };

  readonly getDocumentTagTask = async (
    request: FastifyRequest<{ Params: WorkspaceDocumentParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.getDocumentTagApplyTaskSnapshot(
      request.params.workspaceId,
      requireUserId(request),
      request.params.documentId,
    ));
  };

  readonly getFolderTagDetails = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Querystring: FolderTagDetailsQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.getFolderTagDetails(
      request.params.workspaceId,
      requireUserId(request),
      request.query.folderPath?.trim() ?? "",
    ));
  };

  readonly saveFolderTags = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: SaveFolderTagsBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.saveFolderTagBindings(
      request.params.workspaceId,
      requireUserId(request),
      request.body.folderPath?.trim() ?? "",
      [
        ...(Array.isArray(request.body.tagIds) ? request.body.tagIds : []),
        ...await Promise.all((Array.isArray(request.body.createTagPaths) ? request.body.createTagPaths : []).map(async (tagPath) => (
          this.affairsTagService.ensureTagDefinition(
            request.params.workspaceId,
            requireUserId(request),
            { path: tagPath },
          ).id
        ))),
      ],
    ));
  };

  readonly requestFullTagRecompute = async (
    request: FastifyRequest<{ Params: WorkspaceParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.requestFullTagRecompute(
      request.params.workspaceId,
      requireUserId(request),
    ));
  };

  readonly requestTagRecoveryRecompute = async (
    request: FastifyRequest<{ Params: WorkspaceParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.requestFullTagRecompute(
      request.params.workspaceId,
      requireUserId(request),
    ));
  };

  readonly getFullTagRecomputeTask = async (
    request: FastifyRequest<{ Params: WorkspaceParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.getFullTagRecomputeTaskSnapshot(
      request.params.workspaceId,
      requireUserId(request),
    ));
  };

  readonly getTagRecoveryStatus = async (
    request: FastifyRequest<{ Params: WorkspaceParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.getTagRecoveryStatus(
      request.params.workspaceId,
      requireUserId(request),
    ));
  };

  readonly getFolderTagTask = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Querystring: FolderTagTaskQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    reply.send(this.affairsTagService.getFolderTagApplyTaskSnapshot(
      request.params.workspaceId,
      requireUserId(request),
      request.query.folderPath?.trim() ?? "",
    ));
  };
}
