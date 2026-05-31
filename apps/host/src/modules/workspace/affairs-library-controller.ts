import type { FastifyReply, FastifyRequest } from "fastify";

import { requireUserId } from "../preferences/common.js";
import type { AffairsLibraryFavoriteRecord, AffairsLibraryService } from "./affairs-library-service.js";
import type { AffairsLibraryPreviewLinkService } from "./affairs-library-preview-link-service.js";

interface WorkspaceParams {
  workspaceId: string;
}

interface SaveAffairsLibraryBindingBody {
  rootDir?: string;
}

interface SaveAffairsLibraryConfigBody {
  mirrorRoot?: string | null;
  allowedExtensions?: string[];
}

interface SetAffairsLibraryEnabledBody {
  enabled?: boolean;
}

interface RequestAffairsLibraryRefreshBody {
  reason?: string;
}

interface UpdateAffairsLibraryFavoritesBody {
  favorites?: AffairsLibraryFavoriteRecord[];
}

interface ListAffairsLibraryDocumentsQuery {
  browseMode?: string;
  selectedFolderPath?: string;
  selectedTagPath?: string;
  selectedFavoriteId?: string;
  offset?: string;
  limit?: string;
}

interface AffairsLibraryPreviewQuery {
  path?: string;
}

export class AffairsLibraryController {
  constructor(
    private readonly affairsLibraryService: AffairsLibraryService,
    private readonly affairsLibraryPreviewLinkService: AffairsLibraryPreviewLinkService,
    private readonly onBindingChanged?: (workspaceId: string) => void
  ) {}

  readonly getBinding = async (
    request: FastifyRequest<{ Params: WorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.affairsLibraryService.getBinding(request.params.workspaceId, requireUserId(request))
    );
  };

  readonly saveBinding = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: SaveAffairsLibraryBindingBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const binding = this.affairsLibraryService.saveBinding(
        request.params.workspaceId,
        requireUserId(request),
        request.body.rootDir?.trim() ?? ""
      );
    this.onBindingChanged?.(request.params.workspaceId);
    reply.send(binding);
  };

  readonly setEnabled = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: SetAffairsLibraryEnabledBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    const binding = this.affairsLibraryService.setEnabled(
        request.params.workspaceId,
        requireUserId(request),
        request.body.enabled === true
      );
    this.onBindingChanged?.(request.params.workspaceId);
    reply.send(binding);
  };

  readonly getSnapshot = async (
    request: FastifyRequest<{ Params: WorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.affairsLibraryService.getSnapshot(request.params.workspaceId, requireUserId(request))
    );
  };

  readonly getConfig = async (
    request: FastifyRequest<{ Params: WorkspaceParams }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.affairsLibraryService.getConfig(request.params.workspaceId, requireUserId(request))
    );
  };

  readonly saveConfig = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: SaveAffairsLibraryConfigBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.affairsLibraryService.saveConfig(request.params.workspaceId, requireUserId(request), {
        mirrorRoot: request.body.mirrorRoot ?? null,
        allowedExtensions: Array.isArray(request.body.allowedExtensions) ? request.body.allowedExtensions : []
      })
    );
  };

  readonly requestRefresh = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: RequestAffairsLibraryRefreshBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.affairsLibraryService.requestRefresh(
        request.params.workspaceId,
        requireUserId(request),
        request.body.reason?.trim() ?? "manual_refresh"
      )
    );
  };

  readonly updateFavorites = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Body: UpdateAffairsLibraryFavoritesBody }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send({
      items: this.affairsLibraryService.updateFavorites(
        request.params.workspaceId,
        requireUserId(request),
        Array.isArray(request.body.favorites) ? request.body.favorites : []
      )
    });
  };

  readonly listDocuments = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Querystring: ListAffairsLibraryDocumentsQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.affairsLibraryService.listDocuments(
        request.params.workspaceId,
        requireUserId(request),
        {
          browseMode: request.query.browseMode === "tag" ? "tag" : "folder",
          selectedFolderPath: request.query.selectedFolderPath?.trim() ?? null,
          selectedTagPath: request.query.selectedTagPath?.trim() ?? null,
          selectedFavoriteId: request.query.selectedFavoriteId?.trim() ?? null,
          offset: request.query.offset ? Number(request.query.offset) : undefined,
          limit: request.query.limit ? Number(request.query.limit) : undefined
        }
      )
    );
  };

  readonly previewDocument = async (
    request: FastifyRequest<{ Params: WorkspaceParams; Querystring: AffairsLibraryPreviewQuery }>,
    reply: FastifyReply
  ): Promise<void> => {
    const workspaceId = request.params.workspaceId;
    const userId = requireUserId(request);
    const filePath = request.query.path ?? "";
    const preview = this.affairsLibraryService.previewDocument(
      workspaceId,
      userId,
      filePath
    );

    if (preview.supported && (preview.kind === "html" || preview.kind === "image" || preview.kind === "pdf")) {
      const previewLink = this.affairsLibraryPreviewLinkService.createLink(
        workspaceId,
        userId,
        filePath
      );
      preview.previewPath = previewLink.previewPath;
      preview.previewUrl = buildAbsolutePreviewUrl(request, previewLink.previewPath);
    }

    reply.send(preview);
  };
}

function buildAbsolutePreviewUrl(request: FastifyRequest, previewPath: string): string {
  const protocol = resolveRequestProtocol(request);
  const host = resolveRequestHost(request);

  return new URL(previewPath, `${protocol}://${host}/`).toString();
}

function resolveRequestProtocol(request: FastifyRequest): string {
  return (
    (request.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim()
    || request.protocol
    || "http"
  );
}

function resolveRequestHost(request: FastifyRequest): string {
  return (
    (request.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim()
    || request.headers.host
    || "127.0.0.1"
  );
}
